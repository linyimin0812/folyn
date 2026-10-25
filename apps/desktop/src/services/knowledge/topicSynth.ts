/**
 * 主题知识页合成：模型提议主题/结论/引用 → 程序逐条校验 → 自动新建/追加。
 *
 * 写入边界（ADR-0006）：
 * - 新建页与追加内容可自动写入；
 * - 目标页当前 hash ≠ 上次程序写入 hash（用户编辑过）→ 不覆盖，降级进 reviews.json；
 * - 校验（versionHash 匹配、行范围在文件内、锚文本落在行范围内）不过的 claim 丢弃并 console.warn。
 */

import { generateShortId } from '@/utils/idGenerator';
import type { KbFs } from './kbFs';
import { sha256Hex, kbWriteAtomic, readTopicRefs, writeTopicRefs, appendReviews } from './kbFs';
import { kbTopicPagePath, kbSourceSnapshotPath } from './kbPaths';
import type {
  KbClaimProposal,
  KbIndexNode,
  KbManifest,
  KbNavigation,
  KbRef,
  KbReviewItem,
} from './kbTypes';
import { kbChatJson } from './kbLlm';
import { KB_SYNTH_PREAMBLE, kbSynthPrompt } from './kbPrompts';
import { chunkContent, buildIndexSummary } from './sourceIngest';

// ── 主题页 Markdown 序列化/解析（frontmatter 用正则，先例 wikiPageWriter）──────

export interface TopicPageFm {
  id: string;
  title: string;
  sources: string[];
}

const FM_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;

export function parseTopicPage(content: string): { fm: TopicPageFm; body: string } {
  const m = content.match(FM_RE);
  const fmText = m?.[1] ?? '';
  const body = m?.[2] ?? content;
  const id = fmText.match(/^id:\s*(\S+)\s*$/m)?.[1] ?? '';
  const title = fmText.match(/^title:\s*"?(.*?)"?\s*$/m)?.[1] ?? '';
  const sourcesBlock = fmText.match(/^sources:\s*\n((?:\s+-\s+.+\n?)*)/m)?.[1] ?? '';
  const sources = sourcesBlock.split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean);
  return { fm: { id, title, sources }, body };
}

export function serializeTopicPage(fm: TopicPageFm, body: string): string {
  return [
    '---',
    `id: ${fm.id}`,
    `title: ${JSON.stringify(fm.title)}`,
    'sources:',
    ...fm.sources.map((s) => `  - ${s}`),
    '---',
    '',
    body.trimEnd() + '\n',
  ].join('\n');
}

// ── 校验（纯函数）────────────────────────────────────────────────────────────

function isPosInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1;
}

/**
 * 校验模型提议的 claims（行范围 + 锚文本双保险）。srcId/versionHash 的一致性
 * 由调用方（本文件内 versionHash 恒为收录时 hash）保证。
 * `sourceLines` 是资料内容按行拆分后的数组。
 */
export function validateClaims(claims: unknown, sourceLines: string[]): KbClaimProposal[] {
  if (!Array.isArray(claims)) return [];
  const lineCount = sourceLines.length;
  const valid: KbClaimProposal[] = [];
  for (const raw of claims) {
    if (typeof raw !== 'object' || raw === null) continue;
    const c = raw as Record<string, unknown>;
    const text = typeof c['text'] === 'string' ? c['text'].trim() : '';
    const anchorText = typeof c['anchorText'] === 'string' ? c['anchorText'].trim() : '';
    const { startLine, endLine } = c;
    if (!text || !anchorText || !isPosInt(startLine) || !isPosInt(endLine) || endLine < startLine) {
      console.warn('[kb] 丢弃非法 claim:', JSON.stringify(raw));
      continue;
    }
    if (endLine > lineCount) {
      console.warn(`[kb] 丢弃越界 claim (L${startLine}-L${endLine} > ${lineCount}):`, text.slice(0, 40));
      continue;
    }
    const rangeText = sourceLines.slice(startLine - 1, endLine).join('\n');
    if (!rangeText.includes(anchorText)) {
      console.warn(`[kb] 丢弃锚文本不匹配的 claim (L${startLine}-L${endLine}):`, anchorText.slice(0, 40));
      continue;
    }
    valid.push({ text, anchorText, startLine, endLine });
  }
  return valid;
}

/** 模型返回的一个 section（claims 原样保留待逐条校验）。 */
export interface RawSection {
  heading: string;
  body: string;
  rawClaims: unknown;
}

export interface RawTopicProposal {
  title: string;
  mode: 'new' | 'append';
  sections: RawSection[];
}

/** 收窄模型返回的 topics 数组（粗校验：title/heading 非空；claims 细校验后置）。 */
export function narrowTopicProposals(topics: unknown): RawTopicProposal[] {
  if (!Array.isArray(topics)) return [];
  const out: RawTopicProposal[] = [];
  for (const raw of topics) {
    if (typeof raw !== 'object' || raw === null) continue;
    const t = raw as Record<string, unknown>;
    const title = typeof t['title'] === 'string' ? t['title'].trim() : '';
    if (!title) continue;
    const mode = t['mode'] === 'append' ? 'append' : 'new';
    const sections: RawSection[] = [];
    for (const sRaw of Array.isArray(t['sections']) ? t['sections'] : []) {
      if (typeof sRaw !== 'object' || sRaw === null) continue;
      const s = sRaw as Record<string, unknown>;
      const heading = typeof s['heading'] === 'string' ? s['heading'].trim() : '';
      if (!heading) continue;
      sections.push({
        heading,
        body: typeof s['body'] === 'string' ? s['body'].trim() : '',
        rawClaims: s['claims'],
      });
    }
    if (sections.length > 0) out.push({ title, mode, sections });
  }
  return out;
}

// ── 页面/引用组装（纯函数，可测）─────────────────────────────────────────────

function sectionMarkdown(section: { heading: string; body: string }, claims: { proposal: KbClaimProposal; refId: string }[]): string {
  const lines = [`## ${section.heading}`, '', section.body];
  for (const c of claims) {
    lines.push('', `- ${c.proposal.text} [^${c.refId}]`);
  }
  return lines.join('\n');
}

function footnoteDef(ref: KbRef, fallbackSrcPath: string): string {
  return `[^${ref.id}]: ${ref.srcId} · ${ref.srcPath ?? fallbackSrcPath} · L${ref.startLine}-L${ref.endLine} · ${ref.anchorText}`;
}

/** 程序写入的脚注定义行（`[^cN]: ...`）—— 审阅应用（kbReviewActions）复用。 */
export const refFootnoteDef = footnoteDef;

interface BuildTopicContentArgs {
  tpId: string;
  title: string;
  fmSources: string[];
  bodyBefore: string;
  footnoteBefore: KbRef[];
  sections: { heading: string; body: string; claims: KbClaimProposal[] }[];
  srcId: string;
  srcPath: string;
  versionHash: string;
  startRefNum: number;
}

/** 程序管理的脚注定义行（`[^cN]: ...`）。append 重建时从旧正文剥离，避免与新页脚重复。 */
const FOOTNOTE_DEF_RE = /^\[\^c\d+\]:/;

export function stripFootnoteDefs(body: string): string {
  return body
    .split('\n')
    .filter((l) => !FOOTNOTE_DEF_RE.test(l.trim()))
    .join('\n')
    .trimEnd();
}

/** 组装主题页 Markdown + refs（含正文 [^cN] 标记与页脚引用定义）。 */
export function buildTopicContent(args: BuildTopicContentArgs): { markdown: string; refs: KbRef[] } {
  const { tpId, title, fmSources, bodyBefore, footnoteBefore, sections, srcId, srcPath, versionHash, startRefNum } = args;
  const refs: KbRef[] = [...footnoteBefore];
  const bodyParts: string[] = [];
  let refNum = startRefNum;
  for (const section of sections) {
    const claimRefs: { proposal: KbClaimProposal; refId: string }[] = [];
    for (const claim of section.claims) {
      const refId = `c${refNum}`;
      refNum++;
      claimRefs.push({ proposal: claim, refId });
      refs.push({
        id: refId,
        topicId: tpId,
        anchorText: claim.anchorText,
        srcId,
        srcPath,
        versionHash,
        startLine: claim.startLine,
        endLine: claim.endLine,
        status: 'active',
      });
    }
    bodyParts.push(sectionMarkdown(section, claimRefs));
  }
  const bodyBeforeClean = stripFootnoteDefs(bodyBefore);
  const isNewPage = bodyBeforeClean.trim() === '';
  const heading = isNewPage ? `# ${title}` : '';
  const body = [heading, bodyBeforeClean.trimEnd(), ...bodyParts.map((p) => p.trim())]
    .filter((p) => p !== '')
    .join('\n\n');
  const footnotes = refs.map((r) => footnoteDef(r, srcPath));
  const bodyWithFootnotes = footnotes.length > 0 ? `${body}\n\n${footnotes.join('\n')}` : body;
  const markdown = serializeTopicPage({ id: tpId, title, sources: fmSources }, `${bodyWithFootnotes}\n`);
  return { markdown, refs };
}

function upsertNavigation(nav: KbNavigation, tpId: string, title: string, srcId: string): void {
  const existing = nav.topics.find((t) => t.tpId === tpId);
  if (existing) {
    if (!existing.sourceIds.includes(srcId)) existing.sourceIds.push(srcId);
  } else {
    nav.topics.push({ tpId, title, sourceIds: [srcId] });
  }
}

async function suppressWatcher(path: string): Promise<void> {
  try {
    const { suppressWatcherFor } = await import('@/utils/fileWatcher');
    suppressWatcherFor(path);
  } catch {
    // 测试/非 Tauri 环境无监听，忽略
  }
}

// ── 合成主流程 ────────────────────────────────────────────────────────────────

export interface SynthTopicOutcome {
  /** 自动写入（新建+追加）的主题变更数。 */
  applied: number;
  /** 降级进审阅的变更（已 append 到 reviews.json）。 */
  reviews: KbReviewItem[];
}

/**
 * 对一份已收录资料跑主题合成并落盘。manifest.topics / nav 就地更新
 * （调用方在分项发布时原子写回）；reviews 直接追加进 reviews.json。
 */
export async function synthTopicsForSource(opts: {
  fs: KbFs;
  manifest: KbManifest;
  nav: KbNavigation;
  goal: string;
  srcId: string;
  srcPath: string;
  versionHash: string;
  nodes: KbIndexNode[];
  content: string;
}): Promise<SynthTopicOutcome> {
  const { fs, manifest, nav, goal, srcId, srcPath, versionHash, nodes, content } = opts;
  const sourceLines = content.split('\n');
  const indexSummary = buildIndexSummary(nodes);
  const reviews: KbReviewItem[] = [];
  let applied = 0;

  for (const chunk of chunkContent(content)) {
    // 每块重取：同一份资料前一块新建的主题，后一块的 append 提议能对上。
    const existingTopics = Object.entries(manifest.topics).map(([tpId, t]) => ({ tpId, title: t.title }));
    const parsed = await kbChatJson<{ topics?: unknown }>(
      kbSynthPrompt(goal, srcPath, indexSummary, chunk.text, chunk.firstLine, existingTopics),
      KB_SYNTH_PREAMBLE,
    );
    for (const proposal of narrowTopicProposals(parsed.topics)) {
      const sections: { heading: string; body: string; claims: KbClaimProposal[] }[] = [];
      for (const section of proposal.sections) {
        sections.push({ heading: section.heading, body: section.body, claims: validateClaims(section.rawClaims, sourceLines) });
      }
      if (sections.every((s) => s.claims.length === 0)) {
        console.warn(`[kb] 主题「${proposal.title}」无有效 claim，跳过`);
        continue;
      }
      const ok = await applyProposal({ fs, manifest, nav, proposal: { ...proposal, sections }, srcId, srcPath, versionHash, reviews });
      if (ok) applied++;
    }
  }

  if (applied > 0) {
    // ADR-0007：引用已落盘（refs 指向 versionHash），此时才保留该版本快照；
    // 从未被引用的中间版本不落盘。内容用收录时读入的原文（与校验一致）。
    await fs.writeFile(kbSourceSnapshotPath(srcId, versionHash), content);
  }
  if (reviews.length > 0) {
    await appendReviews(fs, reviews);
  }
  return { applied, reviews };
}

async function applyProposal(args: {
  fs: KbFs;
  manifest: KbManifest;
  nav: KbNavigation;
  proposal: { title: string; mode: 'new' | 'append'; sections: { heading: string; body: string; claims: KbClaimProposal[] }[] };
  srcId: string;
  srcPath: string;
  versionHash: string;
  reviews: KbReviewItem[];
}): Promise<boolean> {
  const { fs, manifest, nav, proposal, srcId, srcPath, versionHash, reviews } = args;

  // append 按标题匹配已有 tpId；匹配不到当 new 处理。
  let tpId: string | null = null;
  if (proposal.mode === 'append') {
    tpId = Object.entries(manifest.topics).find(([, t]) => t.title === proposal.title)?.[0] ?? null;
  }

  if (tpId === null) {
    tpId = `tp-${generateShortId()}`;
    const pagePath = kbTopicPagePath(tpId);
    const { markdown, refs } = buildTopicContent({
      tpId,
      title: proposal.title,
      fmSources: [srcId],
      bodyBefore: '',
      footnoteBefore: [],
      sections: proposal.sections,
      srcId,
      srcPath,
      versionHash,
      startRefNum: 1,
    });
    await suppressWatcher(pagePath);
    await kbWriteAtomic(fs, pagePath, markdown);
    await writeTopicRefs(fs, tpId, refs);
    manifest.topics[tpId] = {
      path: pagePath,
      title: proposal.title,
      lastProgramHash: await sha256Hex(markdown),
    };
    upsertNavigation(nav, tpId, proposal.title, srcId);
    return true;
  }

  // append：目标页被用户编辑过（hash ≠ 上次程序写入）→ 降级进审阅，不覆盖。
  const topicEntry = manifest.topics[tpId]!;
  const pagePath = topicEntry.path;
  const current = await fs.readFile(pagePath).catch(() => null);
  if (current === null) {
    console.warn(`[kb] 主题页丢失，跳过 append: ${pagePath}`);
    return false;
  }
  const currentHash = await sha256Hex(current);
  if (topicEntry.lastProgramHash !== null && currentHash !== topicEntry.lastProgramHash) {
    const { markdown, refs } = buildTopicContent({
      tpId,
      title: proposal.title,
      fmSources: [srcId],
      bodyBefore: '',
      footnoteBefore: [],
      sections: proposal.sections,
      srcId,
      srcPath,
      versionHash,
      startRefNum: 1,
    });
    reviews.push({
      id: `rev-${generateShortId()}`,
      topicId: tpId,
      topicPath: pagePath,
      reason: 'user-edited',
      proposedMarkdown: markdown,
      // 采用时程序复核：页面再被编辑 → 标记需重新比较，不直接写入。
      topicHash: currentHash,
      refs,
      createdAt: Date.now(),
      status: 'pending',
    });
    console.warn(`[kb] 主题页被用户编辑过，变更进入审阅: ${pagePath}`);
    return false;
  }

  const parsedPage = parseTopicPage(current);
  const existingRefs = await readTopicRefs(fs, tpId);
  const { markdown, refs } = buildTopicContent({
    tpId,
    title: parsedPage.fm.title || proposal.title,
    fmSources: [...new Set([...parsedPage.fm.sources, srcId])],
    bodyBefore: parsedPage.body,
    footnoteBefore: existingRefs,
    sections: proposal.sections,
    srcId,
    srcPath,
    versionHash,
    startRefNum: existingRefs.length + 1,
  });
  await suppressWatcher(pagePath);
  await kbWriteAtomic(fs, pagePath, markdown);
  await writeTopicRefs(fs, tpId, refs);
  topicEntry.lastProgramHash = await sha256Hex(markdown);
  upsertNavigation(nav, tpId, topicEntry.title, srcId);
  return true;
}
