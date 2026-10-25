/**
 * 构建编排：展开收录范围 → 逐份资料「索引 → 主题合成」→ 分项发布。
 *
 * 分项发布（ADR-0009）：每份资料处理完即原子写回 manifest（视为发布），
 * 不等整批；中断时已发布项保持完整，未完成项不进入检索。
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
} from './kbFs';
import { isKbPath } from './kbPaths';
import type { KbManifest } from './kbTypes';
import { ingestSource } from './sourceIngest';
import { synthTopicsForSource } from './topicSynth';
import { invalidateKbIndexCache } from './kbAsk';

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
  /** 每份资料状态变化时回调（分项进度）。 */
  onProgress?: (items: BuildItemProgress[], currentIndex: number) => void;
  /** 协作取消：返回 true 时在下一份资料边界退出。 */
  shouldCancel?: () => boolean;
}

/** 获取全库文件路径清单（vaultStore.manager 的一次递归扫描；`__kb__` 在 Rust 侧剪枝）。 */
async function listVaultTree(): Promise<{ path: string; type: 'file' | 'dir' }[]> {
  const { useVaultStore } = await import('@/store/vaultStore');
  const entries = await useVaultStore.getState().manager.listFiles('', true, true, ['__kb__', '.git', 'node_modules']);
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
  const manifest: KbManifest =
    (await readManifest(fs)) ?? { goal, scope, sources: {}, topics: {} };
  // 用户当前会话里的目标/范围总是最新的（构建即采纳）。
  manifest.goal = goal;
  manifest.scope = scope;

  const tree = await listVaultTree();
  let files = expandScope(scope, tree);
  // 已停止跟踪的资料不再收录 —— 除非用户把该文件路径显式加回收录范围（= 重新收录）。
  const removedPaths = new Set(
    Object.values(manifest.sources).filter((e) => e.removed).map((e) => e.path),
  );
  files = files.filter((p) => !removedPaths.has(p) || scope.includes(p));
  if (opts.only) {
    const only = new Set(opts.only);
    files = files.filter((p) => only.has(p));
  }
  const items: BuildItemProgress[] = files.map((path) => ({ path, status: 'pending' }));
  const emit = (currentIndex: number) => opts.onProgress?.(items.map((i) => ({ ...i })), currentIndex);

  await ensureDeletionsPlaceholder(fs);
  const nav = await readNavigation(fs);

  // path -> srcId（沿用稳定标识；新文件生成新 id）。
  const srcIdByPath = new Map<string, string>();
  for (const [srcId, entry] of Object.entries(manifest.sources)) {
    srcIdByPath.set(entry.path, srcId);
  }

  for (let i = 0; i < files.length; i++) {
    if (opts.shouldCancel?.()) break;
    const path = files[i]!;
    const item = items[i]!;
    emit(i);
    try {
      const srcId = srcIdByPath.get(path) ?? `src-${generateShortId()}`;
      srcIdByPath.set(path, srcId);

      item.status = 'indexing';
      emit(i);
      const ingested = await ingestSource(fs, srcId, path, manifest);

      if (!ingested.skipped) {
        item.status = 'synthesizing';
        emit(i);
        const content = await fs.readFile(path);
        await synthTopicsForSource({
          fs,
          manifest,
          nav,
          goal,
          srcId,
          srcPath: path,
          versionHash: ingested.versionHash,
          nodes: ingested.nodes,
          content,
        });
      }

      const prev = manifest.sources[srcId];
      // 重新构建新对象（不带 removed）—— 显式重新收录会清除「已停止跟踪」标记。
      manifest.sources[srcId] = {
        path,
        currentHash: ingested.versionHash,
        indexVersion: (prev?.indexVersion ?? 0) + (ingested.skipped ? 0 : 1),
      };
      // 分项发布：manifest 原子写回即该项对检索可见。
      await writeManifest(fs, manifest);
      await writeNavigation(fs, nav);

      item.status = ingested.skipped ? 'skipped' : 'done';
      item.message = ingested.skipped ? '内容未变化' : undefined;
    } catch (err) {
      item.status = 'error';
      item.message = errText(err);
      console.warn(`[kb] 收录失败: ${path} ${errText(err)}`);
    }
    emit(i);
  }

  invalidateKbIndexCache();
}
