import { useVaultStore } from '@/store/vaultStore';
/**
 * 构建编排：展开收录范围 → 资料级并行（worker pool）逐份「索引 → 主题合成」→
 * 分项发布；单份资料内部索引块/合成块受限并发（sourceIngest / topicSynth）。
 *
 * 分项发布（ADR-0009）：每份资料处理完即原子写回 manifest（视为发布），
 * 不等整批；中断时已发布项保持完整，未完成项不进入检索。跨文件落盘
 * （manifest+nav、主题页/refs、reviews）经 kbFs 的写入串行队列，并行下
 * 不撞 `.tmp` 名、不丢读-改-写更新。
 */

import { generateShortId } from '@/utils/idGenerator';
import { errText } from '@/utils/errText';
import type { KbFs } from './kbFs';
import {
  readManifest,
  writeManifest,
  readNavigation,
  writeNavigation,
  ensureDeletionsPlaceholder,
  kbWriteQueue,
} from './kbFs';
import { isKbPath } from './kbPaths';
import type { KbManifest } from './kbTypes';
import { reconcileMovedSources } from './kbMoveReconcile';
import { ingestSource, KbBuildCancelled, type KbProcessHooks } from './sourceIngest';
import { synthTopicsForSource } from './topicSynth';
import { invalidateKbIndexCache } from './kbAsk';
import i18n from '@/i18n';

/** 资料级并行：同时处理的资料份数上限（worker pool）。 */
export const SOURCE_CONCURRENCY = 3;

/** 知识库第一版直接支持的资料类型（ADR-0005）。 */
const SOURCE_EXTS = ['.md', '.txt', '.markdown'];

export function isSupportedSourcePath(path: string): boolean {
  const lower = path.toLowerCase();
  return SOURCE_EXTS.some((ext) => lower.endsWith(ext));
}

/**
 * 展开收录范围（纯函数）：scope 中的文件直接收录，目录递归收录其中
 * 支持的文件；`__kb__` 数据目录永不作为原始资料（ADR-0005：知识页不循环收录）。
 */
export function expandScope(
  scope: string[],
  tree: { path: string; type: 'file' | 'dir' }[],
): string[] {
  const scopeSet = new Set(scope);
  const scopedDirs = tree.filter((e) => e.type === 'dir' && scopeSet.has(e.path)).map((e) => e.path);
  const files: string[] = [];
  for (const entry of tree) {
    if (entry.type !== 'file') continue;
    if (!isSupportedSourcePath(entry.path)) continue;
    if (isKbPath(entry.path)) continue;
    const inScope =
      scopeSet.has(entry.path) ||
      scopedDirs.some((d) => entry.path.startsWith(`${d}/`));
    if (inScope) files.push(entry.path);
  }
  return files.sort();
}

export interface BuildItemProgress {
  path: string;
  /** done/skipped/error 的单项就算发布完成（error 项不入检索，等重试）。 */
  status: 'pending' | 'indexing' | 'synthesizing' | 'done' | 'skipped' | 'error';
  message?: string;
}

export interface BuildOptions {
  goal: string;
  scope: string[];
  /** 只处理指定路径（单项重试）。缺省处理全部收录范围。 */
  only?: string[];
  /** 每份资料状态变化时回调（分项进度）。completed = done/skipped/error 的份数
   *  （并行模型下没有单一「当前项」，多项同处非 pending 态属预期）。 */
  onProgress?: (items: BuildItemProgress[], completed: number) => void;
  /** 阶段事实行（索引/合成的真实过程，供「详细过程」展示）；path 标识所属资料。 */
  onDetail?: (line: string, path: string) => void;
  /** 模型正文流增量（path 标识所属资料；尾部 buffer 由调用方维护）。 */
  onStream?: (text: string, path: string) => void;
  /** 协作取消：worker 取任务与块循环边界检查；在途模型调用不可中断（文档化上限）。 */
  shouldCancel?: () => boolean;
}

/** 获取全库文件路径清单（vaultStore.manager 的一次递归扫描；`__kb__` 在 Rust 侧剪枝）。 */
async function listVaultTree(manager: ReturnType<typeof useVaultStore.getState>['manager']): Promise<{ path: string; type: 'file' | 'dir' }[]> {
  const entries = await manager.listFiles('', true, true, ['__kb__', '.git', 'node_modules']);
  const out: { path: string; type: 'file' | 'dir' }[] = [];
  const walk = (items: typeof entries) => {
    for (const e of items) {
      out.push({ path: e.path, type: e.type });
      if (e.type === 'dir' && e.children) walk(e.children);
    }
  };
  walk(entries);
  return out;
}

export async function buildKnowledge(fs: KbFs, opts: BuildOptions): Promise<void> {
  const { goal, scope } = opts;
  const manager = useVaultStore.getState().manager;
  const manifest: KbManifest =
    (await readManifest(fs)) ?? { goal, scope, sources: {}, topics: {} };
  // 用户当前会话里的目标/范围总是最新的（构建即采纳）。
  manifest.goal = goal;
  manifest.scope = scope;

  const tree = await (fs.listSourceTree ? fs.listSourceTree() : listVaultTree(manager));
  let files = expandScope(scope, tree);
  // 已停止跟踪的资料不再收录 —— 除非用户把该文件路径显式加回收录范围（= 重新收录）。
  const removedPaths = new Set(
    Object.values(manifest.sources).filter((e) => e.removed).map((e) => e.path),
  );
  files = files.filter((p) => !removedPaths.has(p) || scope.includes(p));
  const items: BuildItemProgress[] = [];

  await ensureDeletionsPlaceholder(fs);
  const nav = await readNavigation(fs);

  // path -> srcId（沿用稳定标识；新文件生成新 id）。
  const srcIdByPath = new Map<string, string>();
  for (const [srcId, entry] of Object.entries(manifest.sources)) {
    srcIdByPath.set(entry.path, srcId);
  }

  // 移动/重命名识别（切片 B，ADR-0009）：在 only 过滤之前、对全量
  // scopeFiles 做匹配 —— 重命名只产生新路径的 Create 事件，单文件触发
  // （only=[新路径]）时也能把 srcId 认领回新路径；且「旧路径消失」必须对
  // 整棵树判定，否则 only 过滤会把未列入本次处理的资料误判为已删除。
  // 命中即改 manifest 并立即发布（分项发布，不等整批）。
  const treePaths = new Set(tree.map((e) => e.path));
  const movedCount = await reconcileMovedSources(fs, manifest, files, srcIdByPath, treePaths);
  if (movedCount > 0) {
    await writeManifest(fs, manifest);
  }

  if (opts.only) {
    const only = new Set(opts.only);
    files = files.filter((p) => only.has(p));
  }
  for (const path of files) items.push({ path, status: 'pending' });
  const TERMINAL: readonly BuildItemProgress['status'][] = ['done', 'skipped', 'error'];
  const emit = () =>
    opts.onProgress?.(items.map((i) => ({ ...i })), items.filter((i) => TERMINAL.includes(i.status)).length);

  const processFile = async (i: number): Promise<void> => {
    const path = files[i]!;
    const item = items[i]!;
    // detail/stream 显式携带资料路径 —— 并行下没有单一「当前项」可推断归属。
    const hooks: KbProcessHooks = {
      onDetail: opts.onDetail ? (line) => { opts.onDetail?.(line, path); } : undefined,
      onStream: opts.onStream ? (text) => { opts.onStream?.(text, path); } : undefined,
      shouldCancel: opts.shouldCancel,
    };
    let failurePhase = i18n.t('knowledge:build.phaseIndexing');
    try {
      const srcId = srcIdByPath.get(path) ?? `src-${generateShortId()}`;
      srcIdByPath.set(path, srcId);

      item.status = 'indexing';
      emit();
      const ingested = await ingestSource(fs, srcId, path, manifest, hooks);

      if (!ingested.skipped) {
        failurePhase = i18n.t('knowledge:build.phaseSynthesizing');
        item.status = 'synthesizing';
        emit();
        const content = await fs.readFile(path);
        await synthTopicsForSource({
          fs,
          manifest,
          nav,
          goal,
          language: manifest.language ?? 'auto',
          srcId,
          srcPath: path,
          versionHash: ingested.versionHash,
          nodes: ingested.nodes,
          content,
          hooks,
        });
      }

      failurePhase = i18n.t('knowledge:build.phasePublishing');
      const prev = manifest.sources[srcId];
      // 重新构建新对象（不带 removed）—— 显式重新收录会清除「已停止跟踪」标记。
      manifest.sources[srcId] = {
        path,
        currentHash: ingested.versionHash,
        indexVersion: (prev?.indexVersion ?? 0) + (ingested.skipped ? 0 : 1),
      };
      // 分项发布：manifest+nav 原子写回即该项对检索可见（跨文件写经串行队列，
      // 并行 worker 间不撞 `.tmp` 名；manifest/nav 内存修改保持同步段模式）。
      await kbWriteQueue(async () => {
        await writeManifest(fs, manifest);
        await writeNavigation(fs, nav);
      });

      item.status = ingested.skipped ? 'skipped' : 'done';
      item.message = ingested.skipped ? i18n.t('knowledge:build.unchanged') : undefined;
    } catch (err) {
      if (err instanceof KbBuildCancelled) {
        // 协作取消：该项未发布，回到 pending（与未开始项一致）；已发布部分保留。
        item.status = 'pending';
        item.message = undefined;
      } else {
        item.status = 'error';
        item.message = `${failurePhase}：${errText(err)}`;
        console.warn(`[kb] 收录失败: ${path} ${errText(err)}`);
      }
    }
    emit();
  };

  // 资料级并行：worker pool。每个 worker 在任务边界检查协作取消。
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (opts.shouldCancel?.()) return;
      const i = nextIndex++;
      if (i >= files.length) return;
      await processFile(i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(0, Math.min(SOURCE_CONCURRENCY, files.length)) }, () => worker()));

  invalidateKbIndexCache();
}
