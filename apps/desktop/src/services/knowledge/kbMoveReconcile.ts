/**
 * 移动/重命名识别（ADR-0009 稳定标识：身份由 srcId 承载，路径只是位置）。
 *
 * 构建时发现 manifest 中某 srcId 的旧路径已从树中消失 → 在收录范围内按内容
 * hash 匹配「未被认领」的新路径 → 命中视为移动：只改 manifest 路径
 * （srcId、引用、refs 不动），索引文件的 path 字段同步更新；内容未变，
 * 后续 ingest 按 hash 命中直接跳过。未命中 → 维持现状（「来源已移除」
 * 派生状态照旧）。移动且内容也改过（hash 不匹配）按删除+新建处理 ——
 * 第一版接受，不做模糊匹配。
 */

import type { KbFs } from './kbFs';
import { sha256Hex, readSourceIndex, writeSourceIndex } from './kbFs';
import type { KbManifest } from './kbTypes';

/**
 * @param scopeFiles 收录范围展开后的全部受支持文件（不受 only 过滤 ——
 *   单文件重试触发的构建也要能识别移动）。
 * @param srcIdByPath manifest 的 path -> srcId 映射（就地更新：命中移动后
 *   新路径认领该 srcId）。
 * @param treePaths 当前树中的全部路径 —— 判定「旧路径消失」必须对整棵树，
 *   否则 only 过滤会把「未列入本次处理」误判成「已消失」。
 * @returns 发生移动识别的资料数。
 */
export async function reconcileMovedSources(
  fs: KbFs,
  manifest: KbManifest,
  scopeFiles: string[],
  srcIdByPath: Map<string, string>,
  treePaths: Set<string>,
): Promise<number> {
  const missing = Object.entries(manifest.sources).filter(
    ([, entry]) => !entry.removed && !treePaths.has(entry.path),
  );
  if (missing.length === 0) return 0;

  // 候选 = 收录范围内尚无 srcId 认领的文件（新文件或移动后的新路径）。
  const candidates = scopeFiles.filter((p) => !srcIdByPath.has(p));
  if (candidates.length === 0) return 0;

  // ponytail: 逐候选读盘 + hash，O(missing × candidates)。1000 份资料的
  // 验收规模下 missing 通常为 0-几个、候选为几个；若大范围重排成为常态，
  // 再换「一次性读盘 hash 全体候选」的批处理。
  let moved = 0;
  for (const [srcId, entry] of missing) {
    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i]!;
      let hash: string;
      try {
        hash = await sha256Hex(await fs.readFile(cand));
      } catch {
        continue; // 不可读（竞争删除等），不是移动候选
      }
      if (hash !== entry.currentHash) continue;
      entry.path = cand;
      srcIdByPath.set(cand, srcId);
      candidates.splice(i, 1); // 一个候选只能被认领一次
      const index = await readSourceIndex(fs, srcId);
      if (index && index.path !== cand) {
        index.path = cand;
        await writeSourceIndex(fs, index);
      }
      moved++;
      console.info(`[kb] 移动/重命名识别: ${srcId} → ${cand}`);
      break;
    }
  }
  return moved;
}
