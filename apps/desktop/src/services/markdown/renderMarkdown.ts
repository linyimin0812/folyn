import { Fragment, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { unified, type PluggableList } from 'unified';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeMathjax from 'rehype-mathjax';
import rehypeReact from 'rehype-react';
import { jsx, jsxs } from 'react/jsx-runtime';

// ── Segment scanner (shared by transformMathBrackets + editor) ─────────────

interface Seg { type: 'text' | 'code'; from: number; to: number }

/**
 * Walk the markdown source and split it into text and code segments.
 * Fenced code blocks (line-start ```/~~~ runs) and inline code (N+ backticks
 * to matching close) are emitted as `code` segments; everything else is
 * `text`. Used by `transformMathBrackets` (string-level replacement) and
 * by the editor's math highlighter (range decoration) so the two views
 * agree on what counts as code.
 */
function listSegments(md: string): Seg[] {
  const n = md.length;
  const out: Seg[] = [];
  let i = 0;
  const atLineStart = (p: number) => p === 0 || md[p - 1] === '\n';

  const tryFence = (p: number): number => {
    if (!atLineStart(p)) return -1;
    const m = md.slice(p).match(/^(\s{0,3})(`{3,}|~{3,})/);
    if (!m) return -1;
    const marker = m[2];
    const ch = marker[0];
    const minLen = marker.length;
    let j = p + m[0].length;
    while (j < n && md[j] !== '\n') j++;
    if (j < n) j++;
    while (j < n) {
      if (atLineStart(j)) {
        const cm = md.slice(j).match(new RegExp(`^\\s{0,3}${ch}{${minLen},}`));
        if (cm) {
          let k = j + cm[0].length;
          while (k < n && md[k] !== '\n') k++;
          if (k < n) k++;
          return k;
        }
      }
      j++;
    }
    return n;
  };

  const tryInlineCode = (p: number): number => {
    if (md[p] !== '`') return -1;
    let ticks = 0;
    let j = p;
    while (j < n && md[j] === '`') { ticks++; j++; }
    while (j < n) {
      if (md[j] === '`') {
        let run = 0;
        let m = j;
        while (m < n && md[m] === '`') { run++; m++; }
        if (run >= ticks) return m;
        j = m;
      } else {
        j++;
      }
    }
    return -1;
  };

  while (i < n) {
    const fe = tryFence(i);
    if (fe > i) { out.push({ type: 'code', from: i, to: fe }); i = fe; continue; }
    const ce = tryInlineCode(i);
    if (ce > i) { out.push({ type: 'code', from: i, to: ce }); i = ce; continue; }
    const s = i;
    i++;
    while (i < n) {
      if (tryFence(i) > i || tryInlineCode(i) > i) break;
      i++;
    }
    out.push({ type: 'text', from: s, to: i });
  }
  return out;
}

/** Replace `\[..\]` → `$$..$$` and `\(..\)` → `$..$`. */
function replaceBrackets(s: string): string {
  return s
    .replace(/\\\[([\s\S]*?)\\\]/g, (_m, b: string) => `$$${b}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_m, b: string) => `$${b}$`);
}

/**
 * Preprocess LaTeX display/inline markers (`\[..\]` / `\(..\)`) into the
 * dollar form (`$$..$$` / `$..$`) that remark-math recognizes. Fenced and
 * inline code spans are passed through verbatim. `\$` escapes are left to
 * remark-parse's backslash-escape (it converts `\$` to plain `$`, never math).
 *
 * ponytail: a string-level pass is shorter than writing a micromark
 * extension. Edge case: prose like `text \\[x\\] end` (markdown `\\` =
 * literal backslash, so the writer meant `\` + `[x\]` text) is misread
 * as `\[x\]` math; rare in prose, accept the tradeoff.
 */
export function transformMathBrackets(md: string): string {
  let out = '';
  for (const seg of listSegments(md)) {
    const slice = md.slice(seg.from, seg.to);
    out += seg.type === 'code' ? slice : replaceBrackets(slice);
  }
  return out;
}

// ── Math segment finder (editor + tests) ───────────────────────────────────

export type MathKind = 'display' | 'inline';
export interface MathSegment { from: number; to: number; kind: MathKind }

const MATH_RE = /(?<!\\)\$\$[\s\S]*?(?<!\\)\$\$|\\\[[\s\S]*?\\\]|(?<!\\)\$[^$\n]*?(?<!\\)\$|\\\([^]*?\\\)/g;

/**
 * Find all math segments in the markdown source, skipping fenced and inline
 * code. Returns ranges with `from`/`to` positions in the source. Used by
 * the editor's math highlighter to decorate `$$..$$` / `$..$` / `\[..\]` /
 * `\(..\)`.
 *
 * ponytail: `(?<!\\)` skips `\$` escapes — `\$` is markdown's literal-
 * dollar escape. The `\\$` case (escaped backslash + unescaped dollar) is
 * misread as escaped; rare in prose, accept the tradeoff.
 */
export function findMathSegments(md: string): MathSegment[] {
  const segs: MathSegment[] = [];
  for (const seg of listSegments(md)) {
    if (seg.type === 'code') continue;
    const text = md.slice(seg.from, seg.to);
    MATH_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MATH_RE.exec(text)) !== null) {
      const from = seg.from + m.index;
      const to = from + m[0].length;
      const display = m[0].startsWith('$$') || m[0].startsWith('\\[');
      segs.push({ from, to, kind: display ? 'display' : 'inline' });
    }
  }
  return segs;
}

// ── Unified pipeline ───────────────────────────────────────────────────────

export interface MathRenderOptions {
  /** Extra remark plugins to add between remarkMath and remarkRehype
   *  (e.g. remarkGfm, remarkBreaks, remarkDirective). */
  remarkPlugins?: PluggableList;
  /** Extra rehype plugins to add after rehypeMathjax (e.g. rehypeHighlight). */
  rehypePlugins?: PluggableList;
  /** React component overrides for rehype-react. */
  components?: Record<string, React.ComponentType<any>>;
  /** Allow raw HTML in the markdown (uses rehype-raw). Defaults to false. */
  allowDangerousHtml?: boolean;
}

function buildProcessor(opts: MathRenderOptions) {
  // ponytail: build the pipeline as a single PluggableList to avoid
  // reassignment — unified's Processor generic narrows on each `.use()`
  // and a `let p = ...; p = p.use(...)` chain trips assignability. One
  // call with the whole list avoids the chase.
  const pipeline: any[] = [
    remarkParse,
    remarkMath,
    ...(opts.remarkPlugins ?? []),
    [remarkRehype, { allowDangerousHtml: opts.allowDangerousHtml ?? false }],
    ...(opts.allowDangerousHtml ? [rehypeRaw] : []),
    rehypeMathjax,
    ...(opts.rehypePlugins ?? []),
  ];
  return unified().use(pipeline as PluggableList);
}

/** Render markdown to a React node tree. Math is rendered to inline SVG
 *  via rehype-mathjax at parse time — no runtime MathJax typeset needed.
 *  Sync (processSync). */
export function renderMarkdownToReact(md: string, opts: MathRenderOptions = {}): ReactNode {
  const p = buildProcessor(opts).use(rehypeReact, {
    jsx,
    jsxs,
    Fragment,
    components: opts.components,
    passNode: true,
  } as any);
  return p.processSync(transformMathBrackets(md)).result as ReactNode;
}

/** Render markdown to an HTML string (React SSR via renderToStaticMarkup).
 *  Same pipeline as renderMarkdownToReact. Sync. */
export function renderMarkdownToHtml(md: string, opts: MathRenderOptions = {}): string {
  const node = renderMarkdownToReact(md, opts);
  return renderToStaticMarkup(node as React.ReactElement);
}
