/**
 * In-document find (refactor spec Phase 5.3 — 当前文档查找).
 *
 * Searches the editor-absolute SOURCE text (not the rendered DOM), so
 * matches hidden inside `:::tabs` panels and closed `:::collapsible`
 * bodies are findable too — the DOM may not even contain them yet. For
 * each match we precompute the reading context the spec asks the results
 * to show:
 *
 *   - the nearest preceding heading (章节上下文), and
 *   - the enclosing container chain, outer → inner (Tabs › 第二章 › …),
 *     which also tells the jump path what to reveal.
 *
 * Line numbers are 1-based editor-absolute (frontmatter included), matching
 * `data-source-line` in the rendered preview.
 *
 * Deliberately scoped to the CURRENT document only — Vault-wide search is
 * the global panel (Cmd+Shift+F); this is the browser-style in-page find
 * (Cmd+F). No regex, no file names — plain case-insensitive substring.
 */

import { computeOutlineSource, type DirectiveSpan, type SourceHeading } from './outlineModel';

export interface DocMatch {
  /** 1-based editor-absolute line of the match (matches data-source-line space). */
  line: number;
  /** 0-based column where the match starts on that line. */
  colStart: number;
  /** 0-based column just past the match (exclusive). */
  colEnd: number;
  /** The line's raw text (for excerpt rendering). */
  text: string;
  /** Nearest preceding heading text ('' when before the first heading). */
  heading: string;
  /** Container labels, outer → inner: `Tabs · 概述`, `折叠 · 详情`… */
  containers: string[];
  /** True when any enclosing container can hide content (tab panel / collapsible). */
  inHiddenContainer: boolean;
}

export interface FindInDocOptions {
  caseSensitive?: boolean;
  /** Max matches returned (query continues counting; excess are dropped). */
  limit?: number;
}

const FENCE = /^\s*(```|~~~)/;

/** Container label shown in the breadcrumb: `Tabs · 概述`, `折叠 · 详情`. */
function spanLabel(span: DirectiveSpan): string {
  const kind = span.name === 'collapsible' ? '折叠' : span.name === 'tabs' ? 'Tabs' : span.name === 'tab' ? 'Tab' : span.name;
  return span.title ? `${kind} · ${span.title}` : kind;
}

/** Spans enclosing `line`, outermost first. */
function enclosingSpans(spans: DirectiveSpan[], line: number): DirectiveSpan[] {
  return spans
    .filter((s) => line > s.startLine && line <= s.endLine)
    .sort((a, b) => a.startLine - b.startLine);
}

/**
 * Find every occurrence of `query` in the document source. Multi-line
 * matches are NOT supported (line-level excerpting keeps results scannable);
 * each hit is one line's occurrence. Directive open/close lines themselves
 * are searched — their titles are reader-visible (tab labels), and the jump
 * path targets the container wrapper. Code-fence content IS searched.
 */
export function findInDoc(content: string, query: string, opts: FindInDocOptions = {}): DocMatch[] {
  const { caseSensitive = false, limit = 500 } = opts;
  if (!query) return [];
  const lines = content.split('\n');
  const { headings, spans } = computeOutlineSource(content);

  // Heading lookup: binary-search-able by line; simple scan is fine (docs
  // rarely exceed a few thousand lines and this runs per keystroke on a
  // debounced query).
  const findHeading = (line: number): SourceHeading | undefined => {
    let best: SourceHeading | undefined;
    for (const h of headings) {
      if (h.line > line) break;
      best = h;
    }
    return best;
  };

  // Pre-compute per-line container info lazily: only for matched lines.
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: DocMatch[] = [];

  for (let i = 0; i < lines.length && matches.length < limit; i++) {
    const raw = lines[i];
    if (!raw) continue;
    const line = i + 1;
    // Pure fence delimiter lines (``` / ~~~) carry no readable content.
    if (FENCE.test(raw) && raw.trim().length <= 4) continue;

    const hay = caseSensitive ? raw : raw.toLowerCase();
    let col = hay.indexOf(needle);
    while (col !== -1) {
      const encl = enclosingSpans(spans, line);
      const heading = findHeading(line);
      matches.push({
        line,
        colStart: col,
        colEnd: col + query.length,
        text: raw,
        heading: heading?.text ?? '',
        containers: encl.map(spanLabel),
        inHiddenContainer: encl.some((s) => s.name === 'tab' || s.name === 'collapsible' || s.name === 'slide'),
      });
      if (matches.length >= limit) break;
      col = hay.indexOf(needle, col + needle.length);
    }
  }
  return matches;
}

/** Excerpt pieces for rendering: [before, match, after] of one line. */
export function excerptParts(match: DocMatch): [string, string, string] {
  return [
    match.text.slice(0, match.colStart),
    match.text.slice(match.colStart, match.colEnd),
    match.text.slice(match.colEnd),
  ];
}
