// apps/desktop/src/services/wikiLintService.ts

import { wikiProvider } from './wikiProvider';
import { useVaultStore } from '@/store/vaultStore';
import { useAiConfigStore, getFeatureAdapter, getFeatureCliPath } from '@/store/aiConfigStore';
import { createAdapter } from '@quill/cli-adapter';
import type { ReviewItem, WikiFrontmatter } from '@/types/wiki';
import { collectTextFromStream } from './aiStreamUtils';
import { getFeatureAgentSendOptions } from './featureAgentService';
import { resolveBasePath } from '@/utils/pathResolver';
import { generateId } from '@/utils/idGenerator';
import { runStructuralLint, type LintContext, type LintPage } from './wikiStructuralLint';
import { parsePage } from './wikiPageWriter';
import type { WikiEntry } from '@/types/wiki';
import { useWikiStore } from '@/store/wikiStore';

export function extractFrontmatterSources(content: string): string[] {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return [];
  const sourcesMatch = fmMatch[1]!.match(/^sources:\s*\n((?:\s+-\s+.+\n?)*)/m);
  if (!sourcesMatch) return [];
  return sourcesMatch[1]!
    .split('\n')
    .map((l) => l.replace(/^\s*-\s*/, '').trim())
    .filter(Boolean);
}

/**
 * Build a LintContext by reading all wiki pages and current hash cache.
 */
async function buildLintContext(): Promise<LintContext> {
  const vault = useVaultStore.getState();
  if (!vault.currentVault) throw new Error('No active vault');

  const allEntries: WikiEntry[] = await wikiProvider.listFiles();
  const pagePaths: string[] = [];
  const walk = (entries: WikiEntry[]) => {
    for (const e of entries) {
      if (e.type === 'file' && e.name.endsWith('.md')) pagePaths.push(e.path);
      if (e.type === 'dir' && e.children) walk(e.children);
    }
  };
  walk(allEntries);

  const pages: LintPage[] = [];
  for (const path of pagePaths) {
    try {
      const content = await wikiProvider.readFile(path);
      pages.push({ path, content, parsed: parsePage(content) });
    } catch {
      // skip unreadable
    }
  }

  const hashCache = await wikiProvider.readHashCache();

  // ponytail: vault mtime probe via dynamic import to avoid pulling tauri-fs types in non-tauri test env.
  const vaultExists = async (path: string): Promise<boolean> => {
    try {
      const { exists } = await import('@tauri-apps/plugin-fs');
      const base = await resolveBasePath(vault.currentVault!.basePath);
      return await exists(`${base}/${path}`);
    } catch {
      return false;
    }
  };
  const vaultReadMtime = async (path: string): Promise<number | null> => {
    try {
      const { stat } = await import('@tauri-apps/plugin-fs');
      const base = await resolveBasePath(vault.currentVault!.basePath);
      const s = await stat(`${base}/${path}`);
      return s.mtime ? Number(s.mtime) : null;
    } catch {
      return null;
    }
  };

  // schema.md field set (heuristic — compare against TS WikiFrontmatter fields).
  let schemaFieldSet = new Set<string>();
  try {
    const schemaContent = await wikiProvider.readFile('schema.md');
    schemaFieldSet = new Set(
      (schemaContent.match(/\*\*([a-z_]+)\*\*|^- ([a-z_]+)$/gm) ?? [])
        .map((m) => m.replace(/[\*\- ]/g, ''))
        .filter(Boolean),
    );
  } catch {
    // schema.md missing → schema_drift will fire
  }

  // TS field set
  const tsFields: (keyof WikiFrontmatter)[] = ['title', 'type', 'sources', 'tags', 'created', 'updated', 'confidence', 'related'];
  const schemaFieldSetWithTs = new Set<string>([...schemaFieldSet, ...tsFields.map(String)]);

  return {
    pages,
    hashCache,
    vaultExists,
    vaultReadMtime,
    schemaFieldSet: schemaFieldSetWithTs,
  };
}

/**
 * Runs structural lint (B1.c code-driven). No LLM call. Fast. Adds the new
 * reviews to the wiki store so the Reviews sub-tab count badge reflects
 * them. Returns the reviews for caller activity logging.
 */
export async function runStructuralLintService(): Promise<ReviewItem[]> {
  await wikiProvider.init();
  const ctx = await buildLintContext();
  const reviews = await runStructuralLint(ctx);
  if (reviews.length > 0) {
    useWikiStore.getState().addReviewItems(reviews);
  }
  return reviews;
}

/**
 * 构造 lint (semantic) action 的运行指令（动态部分）。
 * 静态输出契约由 canonical `__wiki__/.claude/agents/wiki.md` 承载
 * （action: lint → merge_suggestion[] JSON）。
 */
function buildSemanticLintInstruction(): string {
  return [
    '动作：lint',
    '',
    '请按 lint action 输出契约：扫描 entities/ / concepts/ / sources/ / syntheses/ 下所有 .md 页面，',
    '输出 JSON 数组（仅 merge_suggestion：两个 entity/concept 页描述同一概念，建议合并）。',
  ].join('\n');
}

interface SemanticLintItemShape {
  type?: string;
  title?: string;
  description?: string;
  affectedPages?: unknown;
  suggestedActions?: unknown;
}

/**
 * 调用 wiki feature agent 的 lint (semantic) action，返回 ReviewItem[]。
 * B1.c: only semantic merge suggestions; structural checks run via runStructuralLintService.
 */
export async function runSemanticLint(): Promise<ReviewItem[]> {
  const vault = useVaultStore.getState();
  const aiConfig = useAiConfigStore.getState();
  if (!vault.currentVault) return [];

  await wikiProvider.init();

  const adapter = createAdapter(getFeatureAdapter('wiki', aiConfig));
  const basePath = await resolveBasePath(vault.currentVault.basePath);
  const workingDir = `${basePath}/__wiki__`;

  await adapter.start({ cliPath: getFeatureCliPath('wiki', aiConfig), workingDir });

  let aiText: string;
  try {
    const sendOpts = await getFeatureAgentSendOptions('wiki');
    const instruction = buildSemanticLintInstruction();
    const textPromise = collectTextFromStream(adapter);
    await adapter.send(instruction, sendOpts);
    aiText = await textPromise;
  } finally {
    await adapter.stop();
  }

  const arrayMatch = aiText.match(/\[[\s\S]*\]/);
  const jsonText = arrayMatch ? arrayMatch[0] : aiText;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const now = Date.now();
  const items: ReviewItem[] = (parsed as SemanticLintItemShape[]).map((raw, idx) => {
    const suggestedActions = Array.isArray(raw.suggestedActions)
      ? (raw.suggestedActions as Array<Record<string, unknown>>)
          .map((a) => ({
            label: typeof a?.label === 'string' ? a.label : '',
            type: (typeof a?.type === 'string' ? (a.type as ReviewItem['suggestedActions'][number]['type']) : 'reject'),
          }))
          .filter((a) => a.label.length > 0)
      : [{ label: '合并', type: 'merge' as const }, { label: '忽略', type: 'reject' as const }];
    const affectedPages = Array.isArray(raw.affectedPages)
      ? (raw.affectedPages as unknown[]).filter((p): p is string => typeof p === 'string')
      : [];
    return {
      id: generateId() + `-${idx}`,
      type: 'merge_suggestion' as const,
      checkId: 'semantic_duplicate_merge_suggestion',
      dedupKey: `semantic_duplicate_merge_suggestion:${affectedPages.slice().sort().join('|')}`,
      title: typeof raw.title === 'string' ? raw.title : '语义重复',
      description: typeof raw.description === 'string' ? raw.description : '',
      affectedPages,
      suggestedActions,
      createdAt: now,
      lastSeenAt: now,
      status: 'pending' as const,
    };
  });

  return items;
}

/**
 * Backward-compat: old API returned all lint results. Now dispatches structural + semantic.
 * Caller should prefer runStructuralLintService for auto-after-ingest (B4) and runSemanticLint
 * for manual "deep check".
 */
export async function runWikiLint(): Promise<ReviewItem[]> {
  const structural = await runStructuralLintService();
  return structural;
}
