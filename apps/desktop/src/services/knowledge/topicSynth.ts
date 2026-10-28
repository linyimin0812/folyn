/**
 * 主题知识页合成：模型提议主题/结论/引用 → 程序逐条校验 → 自动新建/追加。
 *
 * 写入边界（ADR-0006）：
 * - 新建页与追加内容可自动写入；
 * - 目标页当前 hash ≠ 上次程序写入 hash（用户编辑过）→ 不覆盖，降级进 reviews.json；
 * - 提议 claim 命中人工删除意图（kbIntentWatch 记录）→ 不自动写入，转
 *   reason 'restore-suggestion' 的恢复建议审阅（新证据可形成待确认的恢复建议）；
 * - 提议 claim 归一化命中该主题既有结论 → 重复佐证：不追加正文，只在既有
 *   结论的 [^cN] 标记后补新引用标记 + refs/脚注（ADR-0006「重复佐证仅补充
 *   来源引用，不重复生成正文」）；目标页被用户编辑过时降级进 reason
 *   'add-ref' 的审阅（采用时只补引用，不改写正文）；
 * - 校验（versionHash 匹配、行范围在文件内、锚文本落在行范围内）不过的 claim 丢弃并 console.warn。
 */

import { generateShortId } from '@/utils/idGenerator';
import type { KbFs } from './kbFs';
import { sha256Hex, kbWriteAtomic, readTopicRefs, writeTopicRefs, appendReviews } from './kbFs';
import { kbTopicPagePath, kbSourceSnapshotPath } from './kbPaths';
import { readDeletions, isClaimDeleted, anchorMatches } from './kbDeletions';
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
import { chunkContent, buildIndexSummary, chunkPhaseDetailLine, type KbProcessHooks } from './sourceIngest';

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

// ── 重复佐证补引用（ADR-0006：不重复生成正文，只补充来源引用）──────────────

/** 该页已使用的引用编号里最小的空缺编号（如 [c1, c3] → c2；无空缺则接续）。 */
export function smallestUnusedRefId(refs: { id: string }[]): string {
  const used = new Set(refs.map((r) => r.id));
  let n = 1;
  while (used.has(`c${n}`)) n++;
  return `c${n}`;
}

/** 追加新结论用的起始编号（既有最大编号 + 1，避免与引用记录撞号）。 */
export function nextRefNum(refs: { id: string }[]): number {
  let max = 0;
  for (const r of refs) {
    const n = Number(r.id.replace(/^c/, ''));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

/**
 * 提议结论句归一化命中既有结论（refs.json 的 claimText，旧记录回退 anchorText）。
 * ponytail: 复用 kbDeletions.anchorMatches 的去空白包含匹配 —— 字面相似判定。
 * 上限：同义改写（字面不重叠）会漏判；漏判时该提议走常规追加/审阅兜底，
 * 宁可漏判（多一条重复正文行进审阅）也不误合并（把新事实并进旧结论）。
 */
export function findExistingClaim(claimText: string, refs: KbRef[]): KbRef | undefined {
  return refs.find((r) => /^c\d+$/.test(r.id) && anchorMatches(r.claimText ?? r.anchorText, claimText));
}

/** 一条待补充的引用（目标由 claimText 归一化匹配既有结论决定）。 */
export interface RefSupplement {
  /** 用于匹配既有结论的结论句。 */
  claimText: string;
  anchorText: string;
  srcId: string;
  srcPath?: string;
  versionHash: string;
  startLine: number;
  endLine: number;
}

export type RefSupplementOutcome =
  | { ok: true; markdown: string; refs: KbRef[]; newRefs: KbRef[] }
  | { ok: false; error: string };

/**
 * 把补充引用写入主题页：既有结论的 `[^cN]` 标记后插入新标记 `[^cM]`（M 取
 * 该页未用的最小编号），refs.json 追加新条目，脚注定义区追加 `[^cM]: ...`。
 * 正文其余部分不变（不重复生成正文）。目标结论或其标记找不到 → 整批失败
 * （调用方决定丢弃/降级），不做部分写入。
 */
export function supplementRefsToPage(args: {
  page: string;
  existingRefs: KbRef[];
  supplements: RefSupplement[];
}): RefSupplementOutcome {
  const { page, existingRefs, supplements } = args;
  if (supplements.length === 0) return { ok: true, markdown: page, refs: existingRefs, newRefs: [] };
  const parsed = parseTopicPage(page);
  let body = stripFootnoteDefs(parsed.body);
  const refs = [...existingRefs];
  const newRefs: KbRef[] = [];
  for (const s of supplements) {
    const target = findExistingClaim(s.claimText, existingRefs);
    if (!target) {
      return { ok: false, error: `目标结论已不在引用记录中，需人工处理：${s.claimText.slice(0, 40)}` };
    }
    // 标记匹配排除脚注定义（`[^c1]:`）；defs 已剥离，这里防正文内联误配。
    // 定位逐行进行并跳过代码围栏内的行（围栏里的 [^cN] 是示例文本）。
    const markerRe = new RegExp(`\\[\\^${target.id}\\](?!:)`);
    const lines = body.split('\n');
    const fenced = fenceFlags(lines);
    const id = smallestUnusedRefId(refs);
    let placed = false;
    for (let i = 0; i < lines.length; i++) {
      if (fenced[i]) continue;
      if (markerRe.test(lines[i]!)) {
        // ponytail: 同一标记在正文中出现多次时只补第一个出现处。
        lines[i] = lines[i]!.replace(markerRe, (m) => `${m} [^${id}]`);
        placed = true;
        break;
      }
    }
    if (!placed) {
      return { ok: false, error: `正文未找到既有引用标记 [^${target.id}]，需人工处理：${s.claimText.slice(0, 40)}` };
    }
    body = lines.join('\n');
    const ref: KbRef = {
      id,
      topicId: target.topicId,
      anchorText: s.anchorText,
      claimText: s.claimText,
      srcId: s.srcId,
      srcPath: s.srcPath,
      versionHash: s.versionHash,
      startLine: s.startLine,
      endLine: s.endLine,
      status: 'active',
    };
    refs.push(ref);
    newRefs.push(ref);
  }
  const footnotes = refs.map((r) => footnoteDef(r, r.srcPath ?? ''));
  const bodyWithFootnotes = `${body.trimEnd()}\n\n${footnotes.join('\n')}\n`;
  const markdown = serializeTopicPage(
    { ...parsed.fm, sources: [...new Set([...parsed.fm.sources, ...supplements.map((s) => s.srcId)])] },
    bodyWithFootnotes,
  );
  return { ok: true, markdown, refs, newRefs };
}

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

/**
 * 行级代码围栏（``` / ~~~）状态：围栏内的 `[^cN]`/`[^cN]:` 是用户示例文本，
 * 不是程序管理的标记/脚注 —— 剥离与标记定位都必须跳过（改写围栏内容 = 写坏
 * 用户页面）。ponytail: 不处理围栏嵌套与行内代码 `` `[^c1]` `` 中的标记 ——
 * 上限 = 行内代码里的示例标记可能被误配；升级路径 = 逐行 tokenizer。
 */
function fenceFlags(lines: string[]): boolean[] {
  let inFence = false;
  return lines.map((l) => {
    if (/^\s*(```|~~~)/.test(l)) {
      const was = inFence;
      inFence = !inFence;
      return was;
    }
    return inFence;
  });
}

export function stripFootnoteDefs(body: string): string {
  const lines = body.split('\n');
  const fenced = fenceFlags(lines);
  return lines
    .filter((l, i) => fenced[i] || !FOOTNOTE_DEF_RE.test(l.trim()))
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
        // 结论句基线：kbIntentWatch 用它识别用户改写（→ unverified）与删除。
        claimText: claim.text,
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

/** detail 行：单块模型提议的主题数。 */
export function synthProposalDetailLine(count: number): string {
  return `模型提议 ${count} 个主题`;
}

/** detail 行：整份资料的合成结果（新增正文写入 / 仅补引用 / 进入审阅）。 */
export function synthOutcomeDetailLine(newContent: number, addRef: number, reviews: number): string {
  return `合成提议：新增 ${newContent} / 补引用 ${addRef} / 审阅 ${reviews}`;
}

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
  hooks?: KbProcessHooks;
}): Promise<SynthTopicOutcome> {
  const { fs, manifest, nav, goal, srcId, srcPath, versionHash, nodes, content, hooks } = opts;
  const sourceLines = content.split('\n');
  const indexSummary = buildIndexSummary(nodes);
  const reviews: KbReviewItem[] = [];
  let applied = 0;
  let newContent = 0;
  let addRef = 0;

  const chunks = chunkContent(content);
  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci]!;
    hooks?.onDetail?.(chunkPhaseDetailLine('合成块', ci + 1, chunks.length, chunk.firstLine, chunk.firstLine + chunk.text.split('\n').length - 1));
    // 每块重取：同一份资料前一块新建的主题，后一块的 append 提议能对上。
    const existingTopics = Object.entries(manifest.topics).map(([tpId, t]) => ({ tpId, title: t.title }));
    const parsed = await kbChatJson<{ topics?: unknown }>(
      kbSynthPrompt(goal, srcPath, indexSummary, chunk.text, chunk.firstLine, existingTopics),
      KB_SYNTH_PREAMBLE,
      { onChunk: hooks?.onStream },
    );
    const proposals = narrowTopicProposals(parsed.topics);
    hooks?.onDetail?.(synthProposalDetailLine(proposals.length));
    for (const proposal of proposals) {
      const sections: { heading: string; body: string; claims: KbClaimProposal[] }[] = [];
      for (const section of proposal.sections) {
        sections.push({ heading: section.heading, body: section.body, claims: validateClaims(section.rawClaims, sourceLines) });
      }
      if (sections.every((s) => s.claims.length === 0)) {
        console.warn(`[kb] 主题「${proposal.title}」无有效 claim，跳过`);
        continue;
      }
      const outcome = await applyProposal({ fs, manifest, nav, proposal: { ...proposal, sections }, srcId, srcPath, versionHash, reviews });
      if (outcome !== 'none') {
        applied++;
        if (outcome === 'new-content') newContent++;
        else addRef++;
      }
    }
  }

  if (applied > 0) {
    // ADR-0007：引用已落盘（refs 指向 versionHash），此时才保留该版本快照；
    // 从未被引用的中间版本不落盘。内容用收录时读入的原文（与校验一致）。
    await fs.writeFile(kbSourceSnapshotPath(srcId, versionHash, fs.root), content);
  }
  if (reviews.length > 0) {
    await appendReviews(fs, reviews);
  }
  hooks?.onDetail?.(synthOutcomeDetailLine(newContent, addRef, reviews.length));
  return { applied, reviews };
}

/** 提议落点：新建/追加正文、仅补引用、未写入（含降级进审阅）。 */
type ApplyProposalResult = 'new-content' | 'add-ref' | 'none';

async function applyProposal(args: {
  fs: KbFs;
  manifest: KbManifest;
  nav: KbNavigation;
  proposal: { title: string; mode: 'new' | 'append'; sections: { heading: string; body: string; claims: KbClaimProposal[] }[] };
  srcId: string;
  srcPath: string;
  versionHash: string;
  reviews: KbReviewItem[];
}): Promise<ApplyProposalResult> {
  const { fs, manifest, nav, proposal, srcId, srcPath, versionHash, reviews } = args;

  // append 按标题匹配已有 tpId；匹配不到当 new 处理。
  let tpId: string | null = null;
  if (proposal.mode === 'append') {
    tpId = Object.entries(manifest.topics).find(([, t]) => t.title === proposal.title)?.[0] ?? null;
  }

  if (tpId === null) {
    tpId = `tp-${generateShortId()}`;
    const pagePath = kbTopicPagePath(tpId, fs.root);
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
    return 'new-content';
  }

  // append：目标页被用户编辑过（hash ≠ 上次程序写入）→ 降级进审阅，不覆盖。
  const topicEntry = manifest.topics[tpId]!;
  const pagePath = topicEntry.path;
  const current = await fs.readFile(pagePath).catch(() => null);
  if (current === null) {
    console.warn(`[kb] 主题页丢失，跳过 append: ${pagePath}`);
    return 'none';
  }
  const currentHash = await sha256Hex(current);

  // 删除意图分区（ADR-0006：新增权限不能绕过人工删除意图）：命中意图的
  // claim 不自动写入，改为恢复建议审阅；其余 claim 走正常写入/审阅流程。
  const deletions = (await readDeletions(fs)).filter((d) => d.topicId === tpId);
  const freeSections: typeof proposal.sections = [];
  const blockedSections: typeof proposal.sections = [];
  for (const section of proposal.sections) {
    const free = section.claims.filter((c) => !isClaimDeleted(c, deletions, tpId));
    const blocked = section.claims.filter((c) => isClaimDeleted(c, deletions, tpId));
    if (free.length > 0) freeSections.push({ ...section, claims: free });
    if (blocked.length > 0) blockedSections.push({ ...section, claims: blocked });
  }
  if (blockedSections.length > 0) {
    const { markdown, refs } = buildTopicContent({
      tpId,
      title: proposal.title,
      fmSources: [srcId],
      bodyBefore: '',
      footnoteBefore: [],
      sections: blockedSections,
      srcId,
      srcPath,
      versionHash,
      startRefNum: 1,
    });
    reviews.push({
      id: `rev-${generateShortId()}`,
      topicId: tpId,
      topicPath: pagePath,
      reason: 'restore-suggestion',
      proposedMarkdown: markdown,
      // 采用（恢复）时程序复核：页面再被编辑 → 需重新比较，不直接写入。
      topicHash: currentHash,
      refs,
      createdAt: Date.now(),
      status: 'pending',
    });
    console.info(`[kb] ${refs.length} 条结论命中人工删除意图，转恢复建议审阅: ${pagePath}`);
  }
  if (freeSections.length === 0) return 'none';

  // 重复佐证分区（ADR-0006「按知识内容组织新增信息」：重复佐证仅补充已有
  // 结论的来源引用，不重复生成正文）。
  const existingRefs = await readTopicRefs(fs, tpId);
  const newSections: typeof proposal.sections = [];
  const dupSections: typeof proposal.sections = [];
  for (const section of freeSections) {
    const dups = section.claims.filter((c) => findExistingClaim(c.text, existingRefs));
    const fresh = section.claims.filter((c) => !findExistingClaim(c.text, existingRefs));
    if (dups.length > 0) dupSections.push({ ...section, claims: dups });
    if (fresh.length > 0) newSections.push({ ...section, claims: fresh });
  }

  if (topicEntry.lastProgramHash !== null && currentHash !== topicEntry.lastProgramHash) {
    if (newSections.length > 0) {
      const { markdown, refs } = buildTopicContent({
        tpId,
        title: proposal.title,
        fmSources: [srcId],
        bodyBefore: '',
        footnoteBefore: [],
        sections: newSections,
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
    }
    if (dupSections.length > 0) {
      const dupClaims = dupSections.flatMap((s) => s.claims);
      const { markdown } = buildTopicContent({
        tpId,
        title: proposal.title,
        fmSources: [srcId],
        bodyBefore: '',
        footnoteBefore: [],
        sections: dupSections,
        srcId,
        srcPath,
        versionHash,
        startRefNum: 1,
      });
      reviews.push({
        id: `rev-${generateShortId()}`,
        topicId: tpId,
        topicPath: pagePath,
        reason: 'add-ref',
        // 展示用（结论行 + 原文依据）；采用时只补引用标记与 refs，不追加正文。
        proposedMarkdown: markdown,
        // 采用时程序复核目标页与目标结论现状（topicHash + 目标匹配 + 标记定位）。
        // id 为占位：采用时按页内现状重取未用编号。
        topicHash: currentHash,
        refs: dupClaims.map((c, i) => ({
          id: `c${i + 1}`,
          topicId: tpId,
          anchorText: c.anchorText,
          claimText: c.text,
          srcId,
          srcPath,
          versionHash,
          startLine: c.startLine,
          endLine: c.endLine,
          status: 'active',
        })),
        createdAt: Date.now(),
        status: 'pending',
      });
      console.warn(`[kb] 主题页被用户编辑过，重复佐证补引用降级进审阅: ${pagePath}`);
    }
    return 'none';
  }

  const parsedPage = parseTopicPage(current);
  // 重复佐证：在既有结论的 [^cN] 标记后补 [^cM]，正文不重复生成。
  let supplement: Extract<RefSupplementOutcome, { ok: true }> | null = null;
  if (dupSections.length > 0) {
    const res = supplementRefsToPage({
      page: current,
      existingRefs,
      supplements: dupSections.flatMap((s) =>
        s.claims.map((c) => ({
          claimText: c.text,
          anchorText: c.anchorText,
          srcId,
          srcPath,
          versionHash,
          startLine: c.startLine,
          endLine: c.endLine,
        })),
      ),
    });
    if (res.ok) {
      supplement = res;
      console.info(`[kb] ${res.newRefs.length} 条重复佐证补充引用（不重复生成正文）: ${pagePath}`);
    } else {
      // 防御：页与 refs 漂移（正常写入路径不可达）→ 丢弃并记日志，宁漏勿错。
      console.warn(`[kb] 重复佐证补引用失败，丢弃: ${res.error}`);
    }
  }
  const footnoteBefore = supplement?.refs ?? existingRefs;

  if (newSections.length > 0) {
    const { markdown, refs } = buildTopicContent({
      tpId,
      title: parsedPage.fm.title || proposal.title,
      fmSources: [...new Set([...parsedPage.fm.sources, srcId])],
      bodyBefore: supplement ? parseTopicPage(supplement.markdown).body : parsedPage.body,
      footnoteBefore,
      sections: newSections,
      srcId,
      srcPath,
      versionHash,
      startRefNum: nextRefNum(footnoteBefore),
    });
    await suppressWatcher(pagePath);
    await kbWriteAtomic(fs, pagePath, markdown);
    await writeTopicRefs(fs, tpId, refs);
    topicEntry.lastProgramHash = await sha256Hex(markdown);
    upsertNavigation(nav, tpId, topicEntry.title, srcId);
    return 'new-content';
  }
  if (supplement) {
    await suppressWatcher(pagePath);
    await kbWriteAtomic(fs, pagePath, supplement.markdown);
    await writeTopicRefs(fs, tpId, supplement.refs);
    topicEntry.lastProgramHash = await sha256Hex(supplement.markdown);
    upsertNavigation(nav, tpId, topicEntry.title, srcId);
    return 'add-ref';
  }
  return 'none';
}
