// apps/desktop/src/services/wikiIngestService.ts

import { useWikiStore } from '@/store/wikiStore';
import { useVaultStore } from '@/store/vaultStore';
import { createAdapter } from '@quill/cli-adapter';
import { useAiConfigStore } from '@/store/aiConfigStore';
import { wikiProvider } from './wikiProvider';
import { pauseWatcher, resumeWatcher } from '@/utils/fileWatcher';
import type { IngestAnalysis } from '@/types/wiki';
import { collectTextFromStream, extractJsonObject } from './aiStreamUtils';
import { getFeatureAgentSendOptions } from './featureAgentService';
import { resolveBasePath } from '@/utils/pathResolver';
import { toKebabCase } from '@/utils/wikiNaming';
import { writeIngestPages, applyIndexAndLog } from './wikiPageWriter';

async function computeSHA256(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
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
 * 构造 overview action 的运行指令（C3.b）。输入：当前 overview + purpose + index + 本次变更列表。
 * 输出：仅 overview.md 正文。
 */
function buildOverviewInstruction(
  overview: string,
  purpose: string,
  index: string,
  batchChanges: { path: string; title: string; type: string; sources: string[] }[],
): string {
  const changesJson = JSON.stringify(batchChanges, null, 2);
  return [
    '动作：overview',
    '',
    '## Current Overview',
    overview,
    '',
    '## Purpose',
    purpose,
    '',
    '## Current Index',
    index,
    '',
    '## This Batch Changes',
    '```json',
    changesJson,
    '```',
    '',
    '请按 overview action 输出契约：基于本次变更刷新知识库简短摘要（≤ 30 行），仅输出 overview.md 正文，不重复 index.md 的清单。',
  ].join('\n');
}

export async function runIngest(filePaths: string[]): Promise<void> {
  const store = useWikiStore.getState();
  const vault = useVaultStore.getState();
  const aiConfig = useAiConfigStore.getState();

  if (!vault.currentVault) throw new Error('No active vault');

  store.addToIngestQueue(filePaths);
  store.setIngesting(true, 1);
  store.pushActivity('info', `开始摄入 ${filePaths.length} 个文件...`, {
    key: 'wiki:activity.started',
    params: { count: filePaths.length },
  });

  await wikiProvider.init();
  const hashCache = await wikiProvider.readHashCache();
  const adapter = createAdapter(aiConfig.cliAdapter);
  const basePath = await resolveBasePath(vault.currentVault.basePath);
  // wiki agent cwd = `<vault>/__wiki__/`：agent 自动发现 `.claude/agents/wiki.md`。
  const workingDir = `${basePath}/__wiki__`;

  await adapter.start({ cliPath: aiConfig.cliPath, workingDir });

  try {
    const schema = await wikiProvider.readFile('schema.md').catch(() => '');
    const purpose = await wikiProvider.readFile('purpose.md').catch(() => '');
    const index = await wikiProvider.readFile('index.md').catch(() => '');

    const queue = useWikiStore.getState().ingestQueue;
    // wiki feature agent 调用 options（agent 文件存在 → bare:false + --agent wiki）。
    const sendOpts = await getFeatureAgentSendOptions('wiki');

    // C3.b: batch-level accumulator for overview refresh at end of batch.
    const batchChanges: { path: string; title: string; type: string; sources: string[] }[] = [];

    for (const task of queue) {
      // Cooperative cancel — Stop button sets cancelIngest; we exit at the
      // next iteration boundary (current file's LLM call finishes first).
      if (useWikiStore.getState().cancelIngest) break;
      if (task.status !== 'pending') continue;

      store.setIngestStatus(task.id, 'analyzing');
      store.setIngestProgress(`分析: ${task.filePath}`);

      try {
        const content = await vault.readFile(task.filePath);
        const hash = await computeSHA256(content);

        if (hashCache[task.filePath] === hash) {
          store.setIngestStatus(task.id, 'done');
          store.setIngestProgress(`跳过 (未变化): ${task.filePath}`);
          store.pushActivity('info', `跳过 ${task.filePath}（内容未变化）`, {
            key: 'wiki:activity.skipped',
            params: { path: task.filePath },
          });
          continue;
        }

        // Step 1: Analysis (ingest action)
        store.setIngesting(true, 1);
        store.pushActivity('step', `[Step 1/3] 分析 ${task.filePath} ...`, {
          key: 'wiki:activity.stepAnalyze',
          params: { path: task.filePath },
        });
        const currentIndex = await wikiProvider.readFile('index.md').catch(() => '');
        const ingestInstruction = buildIngestInstruction(content, task.filePath, schema, purpose, currentIndex);
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

        // Step 2: Code-driven page writes (C1.c, C2.b, C4.b, C5.a, C6.a)
        store.setIngestStatus(task.id, 'generating');
        store.setIngesting(true, 2);
        store.setIngestProgress(`生成 wiki 页面: ${task.filePath}`);
        store.pushActivity('step', `[Step 2/3] 生成 wiki 页面 ...`, {
          key: 'wiki:activity.stepGenerate',
        });
        const entitiesCount = analysis.entities.length;
        const conceptsCount = analysis.concepts.length;
        store.pushActivity('info', `发现 ${entitiesCount} 个实体, ${conceptsCount} 个概念`, {
          key: 'wiki:activity.discovered',
          params: { entities: entitiesCount, concepts: conceptsCount },
        });

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

        const plan = writeIngestPages(analysis, task.filePath, existingPages);

        pauseWatcher();
        for (const change of plan.pages) {
          await wikiProvider.writeFile(change.path, change.content);
          store.pushActivity('success', `写入 ${change.path}`, {
            key: 'wiki:activity.written',
            params: { path: change.path },
          });
        }
        // Append to index.md / log.md (C7 contract).
        const indexContent = await wikiProvider.readFile('index.md').catch(() => '# Wiki Index\n');
        const logContent = await wikiProvider.readFile('log.md').catch(() => '# Wiki Log\n');
        const { index: newIndex, log: newLog } = applyIndexAndLog(indexContent, logContent, task.filePath, plan);
        await wikiProvider.writeFile('index.md', newIndex);
        await wikiProvider.writeFile('log.md', newLog);
        resumeWatcher();
        // Item 2: live-refresh the wiki file tree once per iteration after
        // the page batch + index/log writes commit — newly-written wiki
        // pages appear in the Files tree as the batch progresses, not only
        // at the end of the whole ingest. One refresh per task, not per
        // writeFile (too chatty).
        await store.refreshWikiFiles();

        // Push contradictions + collisions to D review queue.
        if (plan.contradictions.length > 0 || plan.collisions.length > 0) {
          store.addReviewItems([...plan.contradictions, ...plan.collisions]);
          store.pushActivity(
            'info',
            `${plan.contradictions.length} 项矛盾, ${plan.collisions.length} 项命名碰撞已推入 review`,
          );
        }

        // Accumulate for batch-end overview (C3.b).
        for (const entry of plan.indexEntries) {
          const type = entry.path.startsWith('entities/')
            ? 'entity'
            : entry.path.startsWith('concepts/')
              ? 'concept'
              : 'source';
          batchChanges.push({ path: entry.path, title: entry.title, type, sources: [task.filePath] });
        }

        hashCache[task.filePath] = hash;
        await wikiProvider.writeHashCache(hashCache);

        store.setIngestStatus(task.id, 'done');
        store.setIngestProgress(`完成: ${task.filePath} (${plan.pages.length} 个文件变更)`);
        store.pushActivity('success', `${task.filePath} 摄入完成，${plan.pages.length} 个文件变更`, {
          key: 'wiki:activity.done',
          params: { path: task.filePath, count: plan.pages.length },
        });
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

    // C3.b: overview agent action at end of batch.
    // Skip overview + lint when the user aborted — partial batch shouldn't
    // trigger a full overview refresh that takes another LLM round-trip.
    const cancelled = useWikiStore.getState().cancelIngest;
    if (!cancelled && batchChanges.length > 0) {
      store.setIngesting(true, 3);
      store.setIngestProgress('刷新 overview...');
      store.pushActivity('step', '[Step 3/3] 刷新 wiki overview ...', {
        key: 'wiki:activity.stepOverview',
      });
      try {
        const overview = await wikiProvider.readFile('overview.md').catch(() => '');
        const purposeContent = await wikiProvider.readFile('purpose.md').catch(() => '');
        const indexContent = await wikiProvider.readFile('index.md').catch(() => '');
        const instruction = buildOverviewInstruction(overview, purposeContent, indexContent, batchChanges);
        const textPromise = collectTextFromStream(adapter);
        await adapter.send(instruction, sendOpts);
        const newOverview = await textPromise;
        pauseWatcher();
        await wikiProvider.writeFile('overview.md', newOverview);
        resumeWatcher();
        store.pushActivity('success', 'overview 已更新');
      } catch (err) {
        resumeWatcher();
        const msg = err instanceof Error ? err.message : String(err);
        store.pushActivity('error', `overview 更新失败: ${msg}`);
      }
    }

    // B4: auto-run structural lint after ingest batch (semantic lint is manual per E5 settings).
    if (!cancelled && batchChanges.length > 0) {
      store.setIngestProgress('运行结构性 lint...');
      store.pushActivity('step', '运行结构性 lint ...');
      try {
        const { runStructuralLintService } = await import('./wikiLintService');
        // ponytail: runStructuralLintService now adds reviews + pushes the
        // completion toast itself; we only surface the count to the activity log.
        const lintItems = await runStructuralLintService();
        if (lintItems.length > 0) {
          store.pushActivity('info', `lint 发现 ${lintItems.length} 项结构性问题`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        store.pushActivity('error', `lint 失败: ${msg}`);
      }
    }
  } finally {
    await adapter.stop();
    // Capture cancel state BEFORE setIngesting(false) clears it — drives the
    // final activity message ("已终止摄入" vs "摄入完成").
    const wasCancelled = useWikiStore.getState().cancelIngest;
    store.setIngesting(false);
    store.setIngestProgress('');
    store.pushActivity(wasCancelled ? 'info' : 'success', wasCancelled ? '已终止摄入' : '摄入完成', {
      key: wasCancelled ? 'wiki:activity.cancelled' : 'wiki:activity.completed',
    });
    await store.refreshWikiFiles();
  }
}
