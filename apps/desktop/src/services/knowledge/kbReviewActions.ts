/**
 * 审阅操作（ADR-0006：确认前不改写正文）。
 *
 * - applyReview：程序写入。复核目标页当前 hash 与修订生成时的 topicHash
 *   （页面被再次编辑 → 标记需重新比较，不写入）；合并时重编提议的 [^cN]
 *   引用标记（接续页内已有引用编号），写回页面 + refs.json + manifest 的
 *   lastProgramHash，最后把该修订移出 reviews.json。可选 editedBody =
 *   用户在审阅界面编辑后的建议文本（refs 照原提议，重编号逻辑不变）。
 *   写入成功后清除「恢复内容命中」的删除意图 —— 用户确认即意图解除
 *   （ADR-0006：恢复建议经确认生效）。
 * - discardReview：「保留原文 / 保留删除意图」—— 只移除审阅记录，不碰正文
 *   与 deletions.json。
 * - add-ref 修订（重复佐证补引用降级进审阅）：采用 = 只补既有结论的引用
 *   标记与 refs/脚注，不追加正文（supplementRefsToPage，ADR-0006）。
 */

import { errText } from '@/utils/errText';
import type { KbFs } from './kbFs';
import { readManifest, writeManifest, readTopicRefs, writeTopicRefs, readReviews, kbWriteAtomic, sha256Hex } from './kbFs';
import { kbReviewsPath, kbDeletionsPath, kbSourceSnapshotPath } from './kbPaths';
import { readDeletions, writeDeletions, removeDeletionIntents } from './kbDeletions';
import { parseTopicPage, serializeTopicPage, stripFootnoteDefs, refFootnoteDef, supplementRefsToPage, nextRefNum } from './topicSynth';
import type { KbRef, KbReviewItem } from './kbTypes';
import i18n from '@/i18n';

export type ReviewApplyOutcome =
  | { ok: true }
  | { ok: false; reason: 'stale' | 'missing-page' | 'error'; message: string };

export interface ApplyReviewOptions {
  /** 审阅界面「编辑后采用」的文本（替换提议正文；引用标记照原提议重编）。 */
  editedBody?: string;
}

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
  await kbWriteAtomic(fs, kbReviewsPath(fs.root), JSON.stringify(items.filter((r) => r.id !== id), null, 2));
}

export async function discardReview(fs: KbFs, review: KbReviewItem): Promise<void> {
  await removeReview(fs, review.id);
}

export async function applyReview(
  fs: KbFs,
  review: KbReviewItem,
  opts: ApplyReviewOptions = {},
): Promise<ReviewApplyOutcome> {
  try {
    const current = await fs.readFile(review.topicPath).catch(() => null);
    if (current === null) {
      return { ok: false, reason: 'missing-page', message: i18n.t('knowledge:review.missingPage', { path: review.topicPath }) };
    }
    const currentHash = await sha256Hex(current);
    if (review.topicHash && currentHash !== review.topicHash) {
      return { ok: false, reason: 'stale', message: i18n.t('knowledge:review.stale') };
    }

    const manifest = await readManifest(fs);
    const parsedCurrent = parseTopicPage(current);
    const existingRefs = await readTopicRefs(fs, review.topicId);
    const proposalRefs = review.refs ?? [];

    let markdown: string;
    let allRefs: KbRef[];

    if (review.reason === 'add-ref') {
      // 重复佐证补引用（ADR-0006）：采用 = 只在既有结论标记后补 [^cM] 与
      // refs/脚注，不追加正文（editedBody 不适用）。目标结论或其标记的现状
      // 复核不过 → stale，如实失败。
      const res = supplementRefsToPage({
        page: current,
        existingRefs,
        supplements: proposalRefs.map((r) => ({
          claimText: r.claimText ?? r.anchorText,
          anchorText: r.anchorText,
          srcId: r.srcId,
          srcPath: r.srcPath,
          versionHash: r.versionHash,
          startLine: r.startLine,
          endLine: r.endLine,
        })),
      });
      if (!res.ok) {
        return { ok: false, reason: 'stale', message: i18n.t('knowledge:review.addRefFailed', { error: res.error }) };
      }
      markdown = res.markdown;
      allRefs = res.refs;
    } else {
      const parsedProposal = parseTopicPage(review.proposedMarkdown);

      // 重编提议引用的 cN 编号（接续页内已有最大编号，编号有空缺时
      // existingRefs.length 会撞号，见 nextRefNum），同步改写追加正文里的
      // [^cN] 标记。
      const startRefNum = nextRefNum(existingRefs);
      const newRefs: KbRef[] = proposalRefs.map((r, i) => ({
        ...r,
        id: `c${startRefNum + i}`,
        topicId: review.topicId,
      }));
      // 「编辑后采用」：用户改过的文本替换提议正文（引用标记照原提议重编）。
      const proposedBody = opts.editedBody ?? parsedProposal.body;
      let appendBody = stripFootnoteDefs(proposedBody).trim();
      // 重编必须单遍替换：新编号可能落在提议旧编号区间内（如已有 1 条引用、
      // 提议 2 条 → c1→c2, c2→c3），逐个 split/join 会链式误替换（c1 先变 c2
      // 又被第二轮改成 c3），页内标记与 refs.json 失配。
      const idMap = new Map(proposalRefs.map((r, i) => [r.id, newRefs[i]!.id]));
      appendBody = appendBody.replace(/\[\^(c\d+)\]/g, (m, id: string) => {
        const mapped = idMap.get(id);
        return mapped ? `[^${mapped}]` : m;
      });

      allRefs = [...existingRefs, ...newRefs];
      const currentBody = stripFootnoteDefs(parsedCurrent.body).trimEnd();
      const parts = [currentBody];
      if (appendBody) parts.push(appendBody);
      if (allRefs.length > 0) {
        parts.push(allRefs.map((r) => refFootnoteDef(r, manifest?.sources[r.srcId]?.path ?? '')).join('\n'));
      }
      markdown = serializeTopicPage(
        {
          id: review.topicId,
          title: parsedCurrent.fm.title || parsedProposal.fm.title,
          sources: [...new Set([...parsedCurrent.fm.sources, ...parsedProposal.fm.sources])],
        },
        `${parts.join('\n\n')}\n`,
      );
    }

    await suppressWatcher(review.topicPath);
    await kbWriteAtomic(fs, review.topicPath, markdown);
    await writeTopicRefs(fs, review.topicId, allRefs);
    // ADR-0007：refs 落盘即「曾被引用」→ 补齐引用时版本快照。审阅路径的
    // refs 不经过 synthTopicsForSource 的快照写入；这里仅在当前原文确与引用
    // 版本一致（hash 复核）时取材 —— 内容已漂移则不落错版快照，核验会如实
    // 报快照缺失。
    for (const r of proposalRefs) {
      const snap = kbSourceSnapshotPath(r.srcId, r.versionHash, fs.root);
      if (await fs.exists(snap)) continue;
      const entry = manifest?.sources[r.srcId];
      if (!entry || entry.removed || entry.currentHash !== r.versionHash) continue;
      const content = await fs.readFile(entry.path).catch(() => null);
      if (content !== null && (await sha256Hex(content)) === r.versionHash) {
        await fs.writeFile(snap, content);
      }
    }
    if (manifest) {
      const entry = manifest.topics[review.topicId];
      if (entry) {
        // 程序写入后更新 lastProgramHash —— 后续自动追加恢复正常。
        entry.lastProgramHash = await sha256Hex(markdown);
        await writeManifest(fs, manifest);
      }
    }
    // 用户确认采用（含恢复建议的「恢复」）→ 被写入内容命中的删除意图解除
    // （ADR-0006：恢复建议经确认生效；user-edited 修订被显式采用同理）。
    // add-ref 不写正文、不构成「恢复」，不解锁删除意图。
    const anchors = proposalRefs.map((r) => r.anchorText);
    if (review.reason !== 'add-ref' && anchors.length > 0) {
      const deletions = await readDeletions(fs);
      const kept = removeDeletionIntents(deletions, review.topicId, anchors);
      if (kept.length !== deletions.length) {
        await suppressWatcher(kbDeletionsPath(fs.root));
        await writeDeletions(fs, kept);
      }
    }
    await removeReview(fs, review.id);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'error', message: errText(err) };
  }
}
