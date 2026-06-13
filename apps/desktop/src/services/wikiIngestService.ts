// apps/desktop/src/services/wikiIngestService.ts

import { useWikiStore } from '@/store/wikiStore';
import { useVaultStore } from '@/store/vaultStore';
import { CliAdapterRegistry } from '@quill/cli-adapter';
import type { CliAdapter, CliStreamEvent } from '@quill/cli-adapter';
import { useSettingsStore } from '@/store/settingsStore';
import { wikiProvider } from './wikiProvider';
import { pauseWatcher, resumeWatcher } from '@/utils/fileWatcher';
import type { IngestAnalysis, ReviewItem } from '@/types/wiki';
import { collectTextFromStream } from './aiStreamUtils';

async function computeSHA256(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function buildAnalysisPrompt(
  sourceContent: string,
  sourcePath: string,
  schema: string,
  purpose: string,
  index: string,
): string {
  return `You are a wiki maintainer. Analyze this source document and identify entities, concepts, and connections for a knowledge wiki.

## Schema (wiki rules)
${schema}

## Purpose (wiki direction)
${purpose}

## Current Index (existing wiki structure)
${index}

## Source Document: ${sourcePath}
${sourceContent}

## Your Task
Analyze this document and respond with a JSON object (no markdown fences):
{
  "entities": [{"name": "...", "type": "...", "description": "..."}],
  "concepts": [{"name": "...", "definition": "..."}],
  "connections": [{"from": "...", "to": "...", "relationship": "..."}],
  "contradictions": [{"claim": "...", "vs": "...", "existingSource": "..."}],
  "structureRecommendations": ["..."]
}

Focus on the most important entities and concepts. Use kebab-case for identifiers.
Respond in the same language as the source document.`;
}

function buildGenerationPrompt(
  analysis: IngestAnalysis,
  sourcePath: string,
  schema: string,
  existingPages: Record<string, string>,
): string {
  const existingPagesStr = Object.entries(existingPages)
    .map(([path, content]) => `### ${path}\n${content}`)
    .join('\n\n');

  return `You are a wiki maintainer. Based on the analysis below, create or update wiki pages.

## Schema
${schema}

## Analysis Result
${JSON.stringify(analysis, null, 2)}

## Source File: ${sourcePath}

## Existing Wiki Pages to Update
${existingPagesStr || '_No existing pages to update._'}

## Instructions
1. Create a source summary page at \`sources/${toKebabCase(sourcePath)}.md\` with YAML frontmatter
2. Create/update entity pages in \`entities/\` for each identified entity
3. Create/update concept pages in \`concepts/\` for each identified concept
4. Use \`[[wiki://entities/name]]\` for cross-references between wiki pages
5. Use \`[[${sourcePath}]]\` for references back to the source file
6. Every page MUST have YAML frontmatter with: title, type, sources, tags, created, updated, confidence, related

For each file you create or update, use the file editing tool to write it.
Also update \`index.md\` to include any new pages, and append a log entry to \`log.md\`.
Finally, update \`overview.md\` with a brief summary reflecting the new knowledge.

Respond in the same language as the source content.`;
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
  const registry = CliAdapterRegistry.getInstance();
  const adapter = registry.create(settings.cliAdapter);
  let basePath = vault.currentVault.basePath;
  if (basePath.startsWith('~')) {
    const { homeDir } = await import('@tauri-apps/api/path');
    const home = (await homeDir()).replace(/\/+$/, '');
    basePath = home + basePath.slice(1);
  }

  await adapter.start({ cliPath: settings.cliPath, workingDir: basePath });

  try {
    const schema = await wikiProvider.readFile('schema.md').catch(() => '');
    const purpose = await wikiProvider.readFile('purpose.md').catch(() => '');
    const index = await wikiProvider.readFile('index.md').catch(() => '');

    const queue = useWikiStore.getState().ingestQueue;

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

        // Step 1: Analysis
        store.setIngesting(true, 1);
        store.pushActivity('step', `[Step 1/2] 分析 ${task.filePath} ...`);
        const analysisPrompt = buildAnalysisPrompt(content, task.filePath, schema, purpose, index);
        const textPromise = collectTextFromStream(adapter);
        await adapter.send(analysisPrompt);
        const analysisText = await textPromise;

        let analysis: IngestAnalysis;
        try {
          const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
          analysis = JSON.parse(jsonMatch ? jsonMatch[0] : analysisText);
        } catch {
          store.setIngestStatus(task.id, 'error', '分析结果解析失败');
          store.pushActivity('error', `${task.filePath} 分析结果解析失败`);
          continue;
        }

        // Step 2: Generation
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

        const genPrompt = buildGenerationPrompt(analysis, task.filePath, schema, existingPages);

        pauseWatcher();
        const changesPromise = collectFileChangesFromStream(adapter, (msg) => {
          store.setIngestProgress(msg);
        });
        await adapter.send(genPrompt);
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
