/**
 * 人工删除意图（deletions.json）的读写与匹配（ADR-0006「尊重人工删除意图」）。
 *
 * 记录由 kbIntentWatch 在用户编辑知识页时写入；topicSynth 写入前用它拦截
 * 命中意图的提议（转恢复建议审阅）；kbReviewActions 在用户确认恢复后清除。
 */

import { generateShortId } from '@/utils/idGenerator';
import type { KbFs } from './kbFs';
import { kbWriteAtomic } from './kbFs';
import { kbDeletionsPath } from './kbPaths';
import type { KbDeletionIntent, KbRef } from './kbTypes';

export async function readDeletions(fs: KbFs): Promise<KbDeletionIntent[]> {
  if (!(await fs.exists(kbDeletionsPath(fs.root)))) return [];
  try {
    return JSON.parse(await fs.readFile(kbDeletionsPath(fs.root))) as KbDeletionIntent[];
  } catch (err) {
    console.warn('[kb] deletions.json 损坏，按空处理', err);
    return [];
  }
}

export async function writeDeletions(fs: KbFs, intents: KbDeletionIntent[]): Promise<void> {
  await kbWriteAtomic(fs, kbDeletionsPath(fs.root), JSON.stringify(intents, null, 2));
}

export async function appendDeletions(fs: KbFs, intents: KbDeletionIntent[]): Promise<void> {
  if (intents.length === 0) return;
  await writeDeletions(fs, [...(await readDeletions(fs)), ...intents]);
}

/** 归一化：去全部空白（中英文锚文本对空白都不敏感）。 */
export function normAnchor(s: string): string {
  return s.replace(/\s+/g, '');
}

/**
 * ponytail: 归一化（去空白）后相等或互为包含即视为命中 —— 字面相似判定。
 * 上限：同义改写（字面不重叠）会漏判；宁可漏判（该结论刚被新证据再次
 * 支持）也不误判阻断正常收录，漏掉的走常规审阅链路兜底。
 */
export function anchorMatches(a: string, b: string): boolean {
  const na = normAnchor(a);
  const nb = normAnchor(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/** 提议 claim 是否命中该主题的活跃删除意图。 */
export function isClaimDeleted(
  claim: { anchorText: string },
  intents: KbDeletionIntent[],
  topicId: string,
): boolean {
  return intents.some((d) => d.topicId === topicId && anchorMatches(d.anchorText, claim.anchorText));
}

/** 从被删除的引用构造删除意图记录。 */
export function makeDeletionIntent(ref: KbRef, now: number): KbDeletionIntent {
  return {
    id: `del-${generateShortId()}`,
    topicId: ref.topicId,
    anchorText: ref.anchorText,
    srcId: ref.srcId,
    versionHash: ref.versionHash,
    createdAt: now,
  };
}

/** 清除「主题 + 锚文本命中」的删除意图（用户确认恢复后调用）。 */
export function removeDeletionIntents(
  intents: KbDeletionIntent[],
  topicId: string,
  anchors: string[],
): KbDeletionIntent[] {
  return intents.filter(
    (d) => !(d.topicId === topicId && anchors.some((a) => anchorMatches(d.anchorText, a))),
  );
}
