// apps/desktop/src/services/wikiLintService.ts

import { wikiProvider } from './wikiProvider';
import { useVaultStore } from '@/store/vaultStore';
import { useAiConfigStore } from '@/store/aiConfigStore';
import { createAdapter } from '@quill/cli-adapter';
import type { ReviewItem } from '@/types/wiki';
import { collectTextFromStream } from './aiStreamUtils';
import { getFeatureAgentSendOptions } from './featureAgentService';
import { resolveBasePath } from '@/utils/pathResolver';
import { generateId } from '@/utils/idGenerator';

export function extractFrontmatterSources(content: string): string[] {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return [];
  const sourcesMatch = fmMatch[1].match(/^sources:\s*\n((?:\s+-\s+.+\n?)*)/m);
  if (!sourcesMatch) return [];
  return sourcesMatch[1]
    .split('\n')
    .map((l) => l.replace(/^\s*-\s*/, '').trim())
    .filter(Boolean);
}

/**
 * 构造 lint action 的运行指令（动态部分）。静态输出契约由 canonical
 * `__wiki__/.claude/agents/wiki.md` 承载（action: lint → ReviewItem[] JSON）。
 */
function buildLintInstruction(hashCacheJson: string): string {
  return [
    '动作：lint',
    '',
    '## 当前哈希缓存 (cache/hashes.json)',
    '```json',
    hashCacheJson,
    '```',
    '',
    '请按 lint action 输出契约：扫描 entities/ / concepts/ / sources/ / syntheses/ 下所有 .md 页面，',
    '输出 JSON 数组（缺失页面 / 孤立页面 / 过时内容等 review items）。',
  ].join('\n');
}

interface LintItemShape {
  type?: string;
  title?: string;
  description?: string;
  affectedPages?: unknown;
  suggestedActions?: unknown;
}

/**
 * 调用 wiki feature agent 的 lint action，返回 ReviewItem[]。
 *
 * agent 文件存在 → bare:false + --agent wiki（cwd=`<vault>/__wiki__/` 自动发现）；
 * 不存在 → --bare 回退（agent 不可用时返回空数组，调用方 UI 显示"无问题"）。
 */
export async function runWikiLint(): Promise<ReviewItem[]> {
  const vault = useVaultStore.getState();
  const aiConfig = useAiConfigStore.getState();
  if (!vault.currentVault) return [];

  await wikiProvider.init();
  const hashCache = await wikiProvider.readHashCache();

  const adapter = createAdapter(aiConfig.cliAdapter);
  const basePath = await resolveBasePath(vault.currentVault.basePath);
  // wiki agent cwd = `<vault>/__wiki__/`。
  const workingDir = `${basePath}/__wiki__`;

  await adapter.start({ cliPath: aiConfig.cliPath, workingDir });

  let aiText: string;
  try {
    const sendOpts = await getFeatureAgentSendOptions('wiki');
    const instruction = buildLintInstruction(JSON.stringify(hashCache, null, 2));
    const textPromise = collectTextFromStream(adapter);
    await adapter.send(instruction, sendOpts);
    aiText = await textPromise;
  } finally {
    await adapter.stop();
  }

  // 解析 JSON 数组（容错：agent 可能包裹代码块或附加文字）。
  const arrayMatch = aiText.match(/\[[\s\S]*\]/);
  const jsonText = arrayMatch ? arrayMatch[0] : aiText;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    // agent 返回非 JSON（或 --bare 回退无 agent）→ 视为无问题。
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const now = Date.now();
  const items: ReviewItem[] = (parsed as LintItemShape[]).map((raw, idx) => {
    const suggestedActions = Array.isArray(raw.suggestedActions)
      ? (raw.suggestedActions as Array<Record<string, unknown>>)
          .map((a) => ({
            label: typeof a?.label === 'string' ? a.label : '',
            type: (typeof a?.type === 'string' ? (a.type as ReviewItem['suggestedActions'][number]['type']) : 'reject'),
          }))
          .filter((a) => a.label.length > 0)
      : [{ label: '忽略', type: 'reject' as const }];
    const affectedPages = Array.isArray(raw.affectedPages)
      ? (raw.affectedPages as unknown[]).filter((p): p is string => typeof p === 'string')
      : [];
    const type = (typeof raw.type === 'string' && raw.type) as ReviewItem['type'] || 'structure_change';
    return {
      id: generateId() + `-${idx}`,
      type,
      title: typeof raw.title === 'string' ? raw.title : '未命名问题',
      description: typeof raw.description === 'string' ? raw.description : '',
      affectedPages,
      suggestedActions,
      createdAt: now,
      status: 'pending' as const,
    };
  });

  return items;
}
