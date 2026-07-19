// 学习主题文档的解析/序列化。资料写在 `## 资料` 段，学习单元写在 `## 计划` 段，
// 复习原子写在 `## 复习` 段。`## 笔记` 段为非托管（散文式，原样保留）。
//
// 写回策略（对标 schedule/markdown.ts）：
// - 只重写匹配各段托管正则的行；其余行（含段内散文、其它段、标题、空行、
//   front-matter、未带 `@{...}` 的普通 `- [ ]`）一律原样保留。
// - 已有 lineIndex 的记录：原地重写该行。
// - 新记录（lineIndex < 0）：追加到对应段尾；段不存在则在文件末尾新建。
// - 被删除的托管行：原 parsed 中存在、但不在新数组里的 lineIndex → 移除。

import type {
  ParsedStudy,
  StudyFrontmatter,
  StudyMaterial,
  StudyUnit,
  ReviewAtom,
  Difficulty,
  MaterialKind,
} from './types';
import { DIFFICULTY_LABEL, DEFAULT_REVIEW_ATOM } from './types';

const SECTION_MATERIALS = '资料';
const SECTION_PLAN = '计划';
const SECTION_REVIEW = '复习';

// - @book <书名> | <作者> | <简介> | 难度:<易|中|难>（| <链接> 可选；作者/简介允许空）
const BOOK_RE =
  /^- @book\s+(.+?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*难度:(易|中|难)\s*(?:\|\s*(.*?)\s*)?$/;
// - @web <标题> | <链接> | <简介>（简介允许空，标题与链接必填）
const WEB_RE = /^- @web\s+(.+?)\s*\|\s*(\S+)\s*\|\s*(.*)$/;
// - [ ] N. 单元名 @{est:.. dep:.. prog:..}
const UNIT_RE = /^- \[([ x])\]\s+(\d+)\.\s+(.+?)\s+@\{([^}]*)\}\s*$/;
// - [ ] 摘要 @{next:.. ...}（要求含 next: 才视为托管复习原子）
const REVIEW_RE = /^- \[([ x])\]\s+(.+?)\s+@\{([^}]*)\}\s*$/;
const ATTR_RE = /(\w+):(\S+)/g;
const H2_RE = /^##\s+(.+?)\s*#*\s*$/;
const FM_DELIM_RE = /^---\s*$/;
const FM_KV_RE = /^(\w+):\s*(.*)$/;

const DIFFICULTY_FROM_LABEL: Record<string, Difficulty> = {
  易: 'easy',
  中: 'medium',
  难: 'hard',
};

function parseAttrBlock(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(block)) !== null) {
    out[m[1]] = m[2];
  }
  return out;
}

function clampInt(s: string | undefined, lo: number, hi: number, dflt: number): number {
  if (s == null) return dflt;
  const n = parseInt(s, 10);
  if (Number.isNaN(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

function clampFloat(s: string | undefined, lo: number, dflt: number): number {
  if (s == null) return dflt;
  const n = parseFloat(s);
  if (Number.isNaN(n)) return dflt;
  return Math.max(lo, n);
}

type Section = 'materials' | 'plan' | 'review' | null;

function sectionOf(heading: string): Section {
  const t = heading.trim();
  if (t === SECTION_MATERIALS) return 'materials';
  if (t === SECTION_PLAN) return 'plan';
  if (t === SECTION_REVIEW) return 'review';
  return null;
}

/**
 * 解析单行资料（`- @book` / `- @web`）为数据字段（不含 id / lineIndex）。
 * 供 parseStudy 与 AI 建议文本扫描复用，正则单一来源。不匹配返回 null。
 */
export function parseMaterialLine(line: string): {
  kind: MaterialKind;
  title: string;
  author?: string;
  summary?: string;
  difficulty?: Difficulty;
  url?: string;
} | null {
  const bm = BOOK_RE.exec(line);
  if (bm) {
    return {
      kind: 'book',
      title: bm[1].trim(),
      author: bm[2].trim() || undefined,
      summary: bm[3].trim() || undefined,
      difficulty: DIFFICULTY_FROM_LABEL[bm[4]],
      url: (bm[5] != null ? bm[5].trim() : '') || undefined,
    };
  }
  const wm = WEB_RE.exec(line);
  if (wm) {
    return {
      kind: 'web',
      title: wm[1].trim(),
      url: wm[2],
      summary: wm[3].trim() || undefined,
    };
  }
  return null;
}

/**
 * 解析单行学习单元（`- [ ] N. 单元名 @{...}`）为数据字段（不含 id / lineIndex）。
 * 供 parseStudy 与 AI 建议文本扫描复用。不匹配返回 null。
 */
export function parseUnitLine(line: string): {
  order: number;
  title: string;
  done: boolean;
  est?: string;
  dep?: string;
  prog: number;
} | null {
  const m = UNIT_RE.exec(line);
  if (!m) return null;
  const attrs = parseAttrBlock(m[4]);
  return {
    order: parseInt(m[2], 10),
    title: m[3].trim(),
    done: m[1] === 'x',
    est: attrs.est,
    dep: attrs.dep,
    prog: clampInt(attrs.prog, 0, 100, 0),
  };
}

/** 解析 front-matter（文件开头的 `---` ... `---` 块）。未识别键原样保留在 rawLines。 */
function parseFrontmatter(rawLines: string[]): StudyFrontmatter {
  const fm: StudyFrontmatter = {};
  if (!rawLines.length || !FM_DELIM_RE.test(rawLines[0])) return fm;
  for (let i = 1; i < rawLines.length; i++) {
    if (FM_DELIM_RE.test(rawLines[i])) break;
    const m = FM_KV_RE.exec(rawLines[i]);
    if (!m) continue;
    const key = m[1];
    const val = m[2].trim().replace(/^"(.*)"$/, '$1');
    if (key === 'title') fm.title = val;
    else if (key === 'slug') fm.slug = val;
    else if (key === 'created') fm.created = val;
  }
  return fm;
}

/** 解析一个主题文档。slug 来自 front-matter（用于稳定 id）。 */
export function parseStudy(content: string, slug: string): ParsedStudy {
  const rawLines = content.split('\n');
  const frontmatter = parseFrontmatter(rawLines);
  const materials: StudyMaterial[] = [];
  const units: StudyUnit[] = [];
  const reviewAtoms: ReviewAtom[] = [];
  let section: Section = null;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const h2 = H2_RE.exec(line);
    if (h2) {
      section = sectionOf(h2[1]);
      continue;
    }
    if (section === 'materials') {
      const md = parseMaterialLine(line);
      if (md) {
        materials.push({ id: `${slug}#materials-${i}`, lineIndex: i, ...md });
        continue;
      }
    } else if (section === 'plan') {
      const ud = parseUnitLine(line);
      if (ud) {
        units.push({ id: `${slug}#units-${i}`, lineIndex: i, ...ud });
      }
    } else if (section === 'review') {
      const m = REVIEW_RE.exec(line);
      if (m) {
        const attrs = parseAttrBlock(m[3]);
        // 仅当含 next: 时才视为托管复习原子；否则按未托管行保留
        if (attrs.next == null) continue;
        reviewAtoms.push({
          id: `${slug}#review-${i}`,
          summary: m[2].trim(),
          done: m[1] === 'x',
          next: attrs.next,
          rep: clampInt(attrs.rep, 0, 1e6, DEFAULT_REVIEW_ATOM.rep),
          ef: clampFloat(attrs.ef, 1.3, DEFAULT_REVIEW_ATOM.ef),
          ivl: clampInt(attrs.ivl, 0, 1e6, DEFAULT_REVIEW_ATOM.ivl),
          lapses: clampInt(attrs.lapses, 0, 1e6, DEFAULT_REVIEW_ATOM.lapses),
          topic: attrs.topic,
          src: attrs.src,
          lineIndex: i,
        });
      }
    }
    // section === 'plan'/'notes'/null：未托管行，原样保留（不进结构）
  }

  return { rawLines, frontmatter, materials, units, reviewAtoms };
}

/** 序列化一条资料为规范行。books without url omit the trailing ` | <url>` segment so the line re-parses.
 *  ponytail: DIFFICULTY_LABEL values are baked into persisted markdown
 *  (`难度:易`), so this is data-level — translating it would corrupt daily
 *  notes / topic files on round-trip. Translate at display sites instead. */
export function buildMaterialLine(m: StudyMaterial): string {
  if (m.kind === 'book') {
    const diff = m.difficulty ? DIFFICULTY_LABEL[m.difficulty] : '中';
    const author = m.author ?? '';
    const summary = m.summary ?? '';
    const parts = [m.title, author, summary, `难度:${diff}`];
    if (m.url) parts.push(m.url);
    return `- @book ${parts.join(' | ')}`;
  }
  const url = m.url ?? '';
  const summary = m.summary ?? '';
  return `- @web ${m.title} | ${url} | ${summary}`;
}

/** 序列化一个学习单元为规范行。 */
export function buildUnitLine(u: StudyUnit): string {
  const box = u.done ? '[x]' : '[ ]';
  const est = u.est ?? '-';
  const dep = u.dep ?? '-';
  return `- ${box} ${u.order}. ${u.title} @{est:${est} dep:${dep} prog:${u.prog}}`;
}

/** 序列化一个复习原子为规范行。 */
export function buildReviewLine(r: ReviewAtom): string {
  const box = r.done ? '[x]' : '[ ]';
  const attrs: string[] = [
    `next:${r.next}`,
    `rep:${r.rep}`,
    `ef:${r.ef}`,
    `ivl:${r.ivl}`,
    `lapses:${r.lapses}`,
  ];
  if (r.topic) attrs.push(`topic:${r.topic}`);
  if (r.src) attrs.push(`src:${r.src}`);
  return `- ${box} ${r.summary} @{${attrs.join(' ')}}`;
}

/**
 * 给定解析结果与本主题最新的 materials/units/reviewAtoms，重建文件文本。
 * 行为对标 schedule/markdown.ts 的 serializeDaily。
 */
export function serializeStudy(
  parsed: ParsedStudy,
  materials: StudyMaterial[],
  units: StudyUnit[],
  reviewAtoms: ReviewAtom[],
): string {
  const rawLines = parsed.rawLines.slice();

  // 原行号 → 新行文本（或 null 表示删除）
  const rewrite = new Map<number, string | null>();
  for (const m of materials) {
    if (m.lineIndex >= 0 && m.lineIndex < rawLines.length) rewrite.set(m.lineIndex, buildMaterialLine(m));
  }
  for (const u of units) {
    if (u.lineIndex >= 0 && u.lineIndex < rawLines.length) rewrite.set(u.lineIndex, buildUnitLine(u));
  }
  for (const r of reviewAtoms) {
    if (r.lineIndex >= 0 && r.lineIndex < rawLines.length) rewrite.set(r.lineIndex, buildReviewLine(r));
  }
  // 被删除的托管行：原 parsed 中存在、但不在新数组里的 lineIndex → 标记 null。
  for (const m of parsed.materials) {
    if (m.lineIndex >= 0 && !rewrite.has(m.lineIndex)) rewrite.set(m.lineIndex, null);
  }
  for (const u of parsed.units) {
    if (u.lineIndex >= 0 && !rewrite.has(u.lineIndex)) rewrite.set(u.lineIndex, null);
  }
  for (const r of parsed.reviewAtoms) {
    if (r.lineIndex >= 0 && !rewrite.has(r.lineIndex)) rewrite.set(r.lineIndex, null);
  }

  const newMaterials = materials.filter((m) => m.lineIndex < 0);
  const newUnits = units.filter((u) => u.lineIndex < 0);
  const newReview = reviewAtoms.filter((r) => r.lineIndex < 0);

  const out: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    if (rewrite.has(i)) {
      const v = rewrite.get(i);
      if (v != null) out.push(v);
      continue;
    }
    out.push(rawLines[i]);
  }

  // 依次追加到各段尾；每段在 out 上重新查找范围（前一段插入后索引会漂移）。
  appendToSection(out, findSectionRange(out, SECTION_MATERIALS), SECTION_MATERIALS, newMaterials.map(buildMaterialLine));
  appendToSection(out, findSectionRange(out, SECTION_PLAN), SECTION_PLAN, newUnits.map(buildUnitLine));
  appendToSection(out, findSectionRange(out, SECTION_REVIEW), SECTION_REVIEW, newReview.map(buildReviewLine));

  return out.join('\n');
}

function findSectionRange(lines: string[], heading: string): { start: number; end: number } | null {
  for (let i = 0; i < lines.length; i++) {
    const m = H2_RE.exec(lines[i]);
    if (m && m[1].trim() === heading) {
      let end = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        if (H2_RE.test(lines[j])) { end = j; break; }
      }
      return { start: i, end };
    }
  }
  return null;
}

/** 把 lines 追加到段尾；段不存在则在文件末尾新建段。原地修改 out。 */
function appendToSection(
  out: string[],
  range: { start: number; end: number } | null,
  heading: string,
  lines: string[],
) {
  if (!lines.length) return;
  if (range) {
    out.splice(range.end, 0, ...lines);
  } else {
    if (out.length && out[out.length - 1].trim() !== '') out.push('');
    out.push(`## ${heading}`);
    out.push(...lines);
  }
}

/**
 * 扫描一段自由文本（如 AI 研究动作返回的聊天消息），按行提取资料建议。
 * 复用 parseMaterialLine（正则单一来源），产出 lineIndex=-1 的待加入资料，
 * id 用 `sug-mat-<n>` 前缀保证建议卡片列表 key 唯一。不匹配的行忽略。
 */
export function scanMaterialSuggestions(text: string, slug: string): StudyMaterial[] {
  const out: StudyMaterial[] = [];
  let n = 0;
  for (const line of text.split('\n')) {
    const md = parseMaterialLine(line);
    if (!md) continue;
    out.push({ id: `${slug}#sug-mat-${n}`, lineIndex: -1, ...md });
    n += 1;
  }
  return out;
}

/**
 * 扫描一段自由文本，按行提取学习单元建议。复用 parseUnitLine。
 * 产出 lineIndex=-1 的待加入单元，加入时可由调用方重排序号。
 */
export function scanUnitSuggestions(text: string, slug: string): StudyUnit[] {
  const out: StudyUnit[] = [];
  let n = 0;
  for (const line of text.split('\n')) {
    const ud = parseUnitLine(line);
    if (!ud) continue;
    out.push({ id: `${slug}#sug-unit-${n}`, lineIndex: -1, ...ud });
    n += 1;
  }
  return out;
}
