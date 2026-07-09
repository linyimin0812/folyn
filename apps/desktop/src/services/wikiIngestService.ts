// apps/desktop/src/services/wikiIngestService.ts

import { useWikiStore } from '@/store/wikiStore';
import { useVaultStore } from '@/store/vaultStore';
import { createAdapter } from '@quill/cli-adapter';
import type { CliAdapter, CliStreamEvent } from '@quill/cli-adapter';
import { useSettingsStore } from '@/store/settingsStore';
import { wikiProvider } from './wikiProvider';
import { pauseWatcher, resumeWatcher } from '@/utils/fileWatcher';
import type { IngestAnalysis, ReviewItem } from '@/types/wiki';
import { collectTextFromStream, extractJsonObject } from './aiStreamUtils';
import { getFeatureAgentSendOptions } from './featureAgentService';
import { resolveBasePath } from '@/utils/pathResolver';

async function computeSHA256(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toKebabCase(str: string): string {
  return str
    .replace(/\.\w+$/, '')
    .replace(/[/\\]/g, '-')
    .replace(/[^a-zA-Z0-9一-鿿-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

/**
 * 构造 ingest action 的运行指令（动态部分）。静态输出契约由 canonical
 * `__wiki__/.claude/agents/wiki.md` 承载（action: ingest → JSON）。
 */
function buildIngestInstruction(
  sourceContent: string,
  sourcePath: string,
  schema: string,
  purpose: string,
  index: string,
): string {
  return [
    '动作：ingest',
    `源文档路径：${sourcePath}`,
    '',
    '## Schema (wiki rules)',
    schema,
    '',
    '## Purpose (wiki direction)',
    purpose,
    '',
    '## Current Index (existing wiki structure)',
    index,
    '',
    '## Source Document Content',
    sourceContent,
    '',
    '请按 ingest action 输出契约返回 JSON（entities/concepts/connections/contradictions/structureRecommendations）。',
  ].join('\n');
}

/**
 * 构造 generate action 的运行指令（动态部分）。静态输出契约由 canonical
 * `__wiki__/.claude/agents/wiki.md` 承载（action: generate → 直写 wiki 页面）。
 */
function buildGenerateInstruction(
  analysis: IngestAnalysis,
  sourcePath: string,
  schema: string,
  existingPages: Record<string, string>,
): string {
  const existingPagesStr = Object.entries(existingPages)
    .map(([path, content]) => `### ${path}\n${content}`)
    .join('\n\n');

  return [
    '动作：generate',
    `源文档路径：${sourcePath}`,
    '',
    '## Schema',
    schema,
    '',
    '## Analysis Result (JSON)',
    '```json',
    JSON.stringify(analysis, null, 2),
    '```',
    '',
    '## Existing Wiki Pages to Update',
    existingPagesStr || '_No existing pages to update._',
    '',
    '请按 generate action 输出契约：',
    `1. 在 sources/${toKebabCase(sourcePath)}.md 创建源摘要页（含 YAML frontmatter）`,
    '2. 为每个 entity 在 entities/ 下创建/更新页面',
    '3. 为每个 concept 在 concepts/ 下创建/更新页面',
    '4. 页面间互引用 [[wiki://entities/name]]，引用源文件用 [[' + sourcePath + ']]',
    '5. 每个页面必须含 frontmatter：title/type/sources/tags/created/updated/confidence/related',
    '6. 更新 index.md（追加新页面）、log.md（追加变更条目）、overview.md（刷新摘要）',
  ].join('\n');
}

function collectFileChangesFromStream(
  adapter: CliAdapter,
  onProgress: (msg: string) => void,
): Promise<{ path: string; content: string }[]> {
  return new Promise((resolve, reject) => {
    const changes: { path: string; content: string }[] = [];
    const handler = (event: CliStreamEvent) => {
      if (event.type === 'file_change' && event.fileChange) {
        changes.push({
          path: event.fileChange.path,
          content: event.fileChange.newContent,
        });
        onProgress(`写入: ${event.fileChange.path}`);
      }
      if (event.type === 'text' && event.content) {
        // stream progress text
      }
      if (event.type === 'error') {
        adapter.offEvent(handler);
        reject(new Error(event.content || 'LLM error'));
      }
      if (event.type === 'done') {
        adapter.offEvent(handler);
        resolve(changes);
      }
    };
    adapter.onEvent(handler);
  });
}

export async function runIngest(filePaths: string[]): Promise<void> {
  const store = useWikiStore.getState();
  const vault = useVaultStore.getState();
  const settings = useSettingsStore.getState();

  if (!vault.currentVault) throw new Error('No active vault');

  store.addToIngestQueue(filePaths);
  store.setIngesting(true, 1);
  store.pushActivity('info', `开始摄入 ${filePaths.length} 个文件...`);

  await wikiProvider.init();
  const hashCache = await wikiProvider.readHashCache();
  const adapter = createAdapter(settings.cliAdapter);
  const basePath = await resolveBasePath(vault.currentVault.basePath);
  // wiki agent cwd = `<vault>/__wiki__/`：agent 自动发现 `.claude/agents/wiki.md`。
  const workingDir = `${basePath}/__wiki__`;

  await adapter.start({ cliPath: settings.cliPath, workingDir });

  try {
    const schema = await wikiProvider.readFile('schema.md').catch(() => '');
    const purpose = await wikiProvider.readFile('purpose.md').catch(() => '');
    const index = await wikiProvider.readFile('index.md').catch(() => '');

    const queue = useWikiStore.getState().ingestQueue;
    // wiki feature agent 调用 options（agent 文件存在 → bare:false + --agent wiki）。
    const sendOpts = await getFeatureAgentSendOptions('wiki');

    for (const task of queue) {
      if (task.status !== 'pending') continue;

      store.setIngestStatus(task.id, 'analyzing');
      store.setIngestProgress(`分析: ${task.filePath}`);

      try {
        const content = await vault.readFile(task.filePath);
        const hash = await computeSHA256(content);

        if (hashCache[task.filePath] === hash) {
          store.setIngestStatus(task.id, 'done');
          store.setIngestProgress(`跳过 (未变化): ${task.filePath}`);
          store.pushActivity('info', `跳过 ${task.filePath}（内容未变化）`);
          continue;
        }

        // Step 1: Analysis (ingest action)
        store.setIngesting(true, 1);
        store.pushActivity('step', `[Step 1/2] 分析 ${task.filePath} ...`);
        const ingestInstruction = buildIngestInstruction(content, task.filePath, schema, purpose, index);
        const textPromise = collectTextFromStream(adapter);
        await adapter.send(ingestInstruction, sendOpts);
        const analysisText = await textPromise;

        let analysis: IngestAnalysis;
        try {
          const jsonStr = extractJsonObject(analysisText);
          analysis = JSON.parse(jsonStr ?? analysisText);
        } catch {
          store.setIngestStatus(task.id, 'error', '分析结果解析失败');
          store.pushActivity('error', `${task.filePath} 分析结果解析失败`);
          continue;
        }

        // Step 2: Generation (generate action)
        store.setIngestStatus(task.id, 'generating');
        store.setIngesting(true, 2);
        store.setIngestProgress(`生成 wiki 页面: ${task.filePath}`);
        store.pushActivity('step', `[Step 2/2] 生成 wiki 页面 ...`);
        const entitiesCount = analysis.entities.length;
        const conceptsCount = analysis.concepts.length;
        store.pushActivity('info', `发现 ${entitiesCount} 个实体, ${conceptsCount} 个概念`);

        const existingPages: Record<string, string> = {};
        for (const entity of analysis.entities) {
          const path = `entities/${toKebabCase(entity.name)}.md`;
          if (await wikiProvider.exists(path)) {
            existingPages[path] = await wikiProvider.readFile(path);
          }
        }
        for (const concept of analysis.concepts) {
          const path = `concepts/${toKebabCase(concept.name)}.md`;
          if (await wikiProvider.exists(path)) {
            existingPages[path] = await wikiProvider.readFile(path);
          }
        }

        const genInstruction = buildGenerateInstruction(analysis, task.filePath, schema, existingPages);

        pauseWatcher();
        const changesPromise = collectFileChangesFromStream(adapter, (msg) => {
          store.setIngestProgress(msg);
        });
        await adapter.send(genInstruction, sendOpts);
        const changes = await changesPromise;

        for (const change of changes) {
          await wikiProvider.writeFile(change.path, change.content);
          store.pushActivity('success', `写入 ${change.path}`);
        }
        resumeWatcher();

        hashCache[task.filePath] = hash;
        await wikiProvider.writeHashCache(hashCache);

        if (analysis.contradictions.length > 0) {
          const reviewItems: ReviewItem[] = analysis.contradictions.map((c) => ({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: 'contradiction' as const,
            title: `矛盾: ${c.claim}`,
            description: `新说法: "${c.claim}" vs 已有: "${c.vs}" (来源: ${c.existingSource})`,
            affectedPages: [c.existingSource],
            suggestedActions: [
              { label: '接受新说法', type: 'accept' as const },
              { label: '保留旧说法', type: 'reject' as const },
              { label: '搜索更多信息', type: 'research' as const },
            ],
            createdAt: Date.now(),
            status: 'pending' as const,
          }));
          store.addReviewItems(reviewItems);
        }

        store.setIngestStatus(task.id, 'done');
        store.setIngestProgress(`完成: ${task.filePath} (${changes.length} 个文件变更)`);
        store.pushActivity('success', `${task.filePath} 摄入完成，${changes.length} 个文件变更`);
      } catch (err) {
        resumeWatcher();
        const msg = err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : (err && typeof err === 'object' && 'message' in err)
              ? String((err as { message: unknown }).message)
              : JSON.stringify(err);
        store.setIngestStatus(task.id, 'error', msg);
        store.pushActivity('error', `${task.filePath} 失败: ${msg}`);
      }
    }
  } finally {
    await adapter.stop();
    store.setIngesting(false);
    store.setIngestProgress('');
    store.pushActivity('success', '摄入完成');
    await store.refreshWikiFiles();
  }
}
