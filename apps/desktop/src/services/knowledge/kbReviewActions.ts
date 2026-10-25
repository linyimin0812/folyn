/**
 * 审阅操作（ADR-0006：确认前不改写正文）。
 *
 * - applyReview：程序写入。复核目标页当前 hash 与修订生成时的 topicHash
 *   （页面被再次编辑 → 标记需重新比较，不写入）；合并时重编提议的 [^cN]
 *   引用标记（接续页内已有引用编号），写回页面 + refs.json + manifest 的
 *   lastProgramHash，最后把该修订移出 reviews.json。
 * - discardReview：「保留原文」—— 只移除审阅记录，不碰正文。
 * 恢复删除类修订（对应「保留删除意图」写 deletions.json）留给切片 C：
 * 当前 schema 的 reason 只有 'user-edited'，不存在恢复类记录。
 */

import { errText } from '@/utils/errText';
import type { KbFs } from './kbFs';
import { readManifest, writeManifest, readTopicRefs, writeTopicRefs, readReviews, kbWriteAtomic, sha256Hex } from './kbFs';
import { kbReviewsPath } from './kbPaths';
import { parseTopicPage, serializeTopicPage, stripFootnoteDefs, refFootnoteDef } from './topicSynth';
import type { KbRef, KbReviewItem } from './kbTypes';

export type ReviewApplyOutcome =
  | { ok: true }
  | { ok: false; reason: 'stale' | 'missing-page' | 'error'; message: string };

async function suppressWatcher(path: string): Promise<void> {
  try {
    const { suppressWatcherFor } = await import('@/utils/fileWatcher');
    suppressWatcherFor(path);
  } catch {
    // 测试/非 Tauri 环境无监听，忽略
  }
}

/** 从 reviews.json 移除一条记录（原子写）。 */
export async function removeReview(fs: KbFs, id: string): Promise<void> {
  const items = await readReviews(fs);
  await kbWriteAtomic(fs, kbReviewsPath(), JSON.stringify(items.filter((r) => r.id !== id), null, 2));
}

export async function discardReview(fs: KbFs, review: KbReviewItem): Promise<void> {
  await removeReview(fs, review.id);
}

export async function applyReview(fs: KbFs, review: KbReviewItem): Promise<ReviewApplyOutcome> {
  try {
    const current = await fs.readFile(review.topicPath).catch(() => null);
    if (current === null) {
      return { ok: false, reason: 'missing-page', message: `主题页不存在或不可读：${review.topicPath}` };
    }
    const currentHash = await sha256Hex(current);
    if (review.topicHash && currentHash !== review.topicHash) {
      return { ok: false, reason: 'stale', message: '页面在修订生成后被修改，需重新比较后再采用。' };
    }

    const manifest = await readManifest(fs);
    const parsedCurrent = parseTopicPage(current);
    const parsedProposal = parseTopicPage(review.proposedMarkdown);
    const existingRefs = await readTopicRefs(fs, review.topicId);
    const proposalRefs = review.refs ?? [];

    // 重编提议引用的 cN 编号（接续页内已有引用），同步改写追加正文里的 [^cN] 标记。
    const newRefs: KbRef[] = proposalRefs.map((r, i) => ({
      ...r,
      id: `c${existingRefs.length + i + 1}`,
      topicId: review.topicId,
    }));
    let appendBody = stripFootnoteDefs(parsedProposal.body).trim();
    // 重编必须单遍替换：新编号可能落在提议旧编号区间内（如已有 1 条引用、
    // 提议 2 条 → c1→c2, c2→c3），逐个 split/join 会链式误替换（c1 先变 c2
    // 又被第二轮改成 c3），页内标记与 refs.json 失配。
    const idMap = new Map(proposalRefs.map((r, i) => [r.id, newRefs[i]!.id]));
    appendBody = appendBody.replace(/\[\^(c\d+)\]/g, (m, id: string) => {
      const mapped = idMap.get(id);
      return mapped ? `[^${mapped}]` : m;
    });

    const allRefs = [...existingRefs, ...newRefs];
    const currentBody = stripFootnoteDefs(parsedCurrent.body).trimEnd();
    const parts = [currentBody];
    if (appendBody) parts.push(appendBody);
    if (allRefs.length > 0) {
      parts.push(allRefs.map((r) => refFootnoteDef(r, manifest?.sources[r.srcId]?.path ?? '')).join('\n'));
    }
    const markdown = serializeTopicPage(
      {
        id: review.topicId,
        title: parsedCurrent.fm.title || parsedProposal.fm.title,
        sources: [...new Set([...parsedCurrent.fm.sources, ...parsedProposal.fm.sources])],
      },
      `${parts.join('\n\n')}\n`,
    );

    await suppressWatcher(review.topicPath);
    await kbWriteAtomic(fs, review.topicPath, markdown);
    await writeTopicRefs(fs, review.topicId, allRefs);
    if (manifest) {
      const entry = manifest.topics[review.topicId];
      if (entry) {
        // 程序写入后更新 lastProgramHash —— 后续自动追加恢复正常。
        entry.lastProgramHash = await sha256Hex(markdown);
        await writeManifest(fs, manifest);
      }
    }
    await removeReview(fs, review.id);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'error', message: errText(err) };
  }
}
