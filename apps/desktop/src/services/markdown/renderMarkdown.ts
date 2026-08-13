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

/**
 * Collapse single `\n` adjacent to inline math (`$..$` / `\(..\)`, NOT
 * display `$$..$$` / `\[..\]`) into a space so remark-breaks doesn't emit
 * `<br>` around inline math. `\n\n` (paragraph break) is preserved; code
 * regions are skipped (math markers inside code are not math).
 *
 * Why: when the user writes inline math on its own line for source
 * readability (`text\n$x^2$\ntext`), remark-breaks inserts `<br>` before
 * and after the math, forcing it onto its own visual line. The user reports
 * this as "inline math shouldn't directly line-break". Collapsing the `\n`
 * into a space keeps the math in the inline flow.
 *
 * ponytail: reuse `findMathSegments` (already code-aware, distinguishes
 * inline vs display) and collect edit ranges, then apply in reverse so
 * indices stay valid. Shorter than a custom remark plugin walking mdast.
 *
 * Ceiling: this is a string-level pass, so it can't see mdast structure —
 * if a list item puts inline math on its own indented line (`  $x^2$`), the
 * leading `  ` is preserved and remark-breaks still sees a soft break on
 * the previous line. Acceptable: the common case is bare math on its own
 * line at column 0; list-item math is rare and still renders, just with a
 * stray `<br>`.
 */
export function unwrapInlineMath(md: string): string {
  const inlineSegs = findMathSegments(md).filter((s) => s.kind === 'inline');
  if (inlineSegs.length === 0) return md;

  const edits: { from: number; to: number }[] = [];
  for (const { from, to } of inlineSegs) {
    // \n (with optional trailing ws) immediately before inline math;
    // skip if part of \n\n (paragraph break).
    let p = from - 1;
    while (p >= 0 && (md[p] === ' ' || md[p] === '\t')) p--;
    if (p >= 0 && md[p] === '\n' && !(p >= 1 && md[p - 1] === '\n')) {
      edits.push({ from: p, to: from });
    }
    // \n (with optional leading ws) immediately after inline math;
    // skip if part of \n\n.
    let q = to;
    while (q < md.length && (md[q] === ' ' || md[q] === '\t')) q++;
    if (q < md.length && md[q] === '\n' && !(q + 1 < md.length && md[q + 1] === '\n')) {
      edits.push({ from: to, to: q + 1 });
    }
  }

  if (edits.length === 0) return md;
  edits.sort((a, b) => b.from - a.from);
  let out = md;
  for (const { from, to } of edits) {
    out = out.slice(0, from) + ' ' + out.slice(to);
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
  return p.processSync(unwrapInlineMath(transformMathBrackets(md))).result as ReactNode;
}

/** Render markdown to an HTML string (React SSR via renderToStaticMarkup).
 *  Same pipeline as renderMarkdownToReact. Sync. */
export function renderMarkdownToHtml(md: string, opts: MathRenderOptions = {}): string {
  const node = renderMarkdownToReact(md, opts);
  return renderToStaticMarkup(node as React.ReactElement);
}

/**
 * CSS rule pinning `mjx-container` to a stable font + size so MathJax SVG
 * `width="Xex"` resolves consistently in standalone export HTML, and
 * hinting the SVG rasterizer toward geometric precision on 1x DPI screens.
 *
 * Why font pin: MathJax v3 SVG output uses CSS `ex` units for `width`/`height`
 * (see `OutputJax.SVG.prototype.ex` — divides internal coords by `x_height`
 * and appends `'ex'`). `1ex` is the x-height of the surrounding font. In
 * the in-app preview 'Sora' is loaded from Google Fonts via `@import`, so
 * `1ex` resolves to Sora's x-height. In exported HTML the `@import` rule
 * is captured by `collectAppCss()`, but Sora only loads when the export
 * is opened ONLINE — offline or blocked loads fall back to the system
 * font, whose x-height differs. SVG then renders at a different pixel
 * size, and at small sizes (~13×17px) the path rasterization picks up
 * subpixel anti-aliasing that looks blurry vs the in-app preview.
 *
 * Math content is vector path data, not text — `font-family` only
 * affects the SVG's display dimensions (via the `ex` unit), not glyph
 * shapes. Pinning to a system-font stack guarantees the ex-height is
 * stable regardless of whether 'Sora' loads from CDN.
 *
 * Why shape-rendering: with the font pinned, the SVG's display size is
 * stable, but on a 1x DPI (non-Retina) screen the SVG's viewBox
 * (~814×1058 internal units) is rasterized to ~13×17 device pixels —
 * a 60x downsample that picks up heavy subpixel anti-aliasing and reads
 * as blurry. `shape-rendering: geometricPrecision` (plus
 * `text-rendering: geometricPrecision` on the container) asks the
 * rasterizer to favor geometric accuracy over speed. This is a hint,
 * not a guarantee — but it's one CSS rule with no layout/align side
 * effects, so it's the ponytail rung before the 2x-render-and-scale
 * upgrade (option B in the task brief).
 *
 * ponytail: one CSS rule. Bundling 'Sora' as `@font-face` base64 would
 * also work but bloats every export by ~50KB+ for a font that only
 * affects MathJax's reference `ex` — the math glyphs themselves are
 * vector paths from MathJax's TeX font, embedded inline. If
 * `geometricPrecision` proves insufficient on 1x DPI screens, upgrade
 * to 2x font-size + `transform: scale(0.5)` (option B) — but that
 * reopens vertical-align and layout-box compensation, so try the hint
 * first.
 */
export const MATHJAX_CONTAINER_CSS = `
mjx-container {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  text-rendering: geometricPrecision;
}
mjx-container svg {
  shape-rendering: geometricPrecision;
}
`;
