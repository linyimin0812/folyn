import { ViewPlugin, ViewUpdate, Decoration, type DecorationSet, type EditorView } from '@codemirror/view';
import { RangeSet, type Extension, type EditorState } from '@codemirror/state';
import { foldService } from '@codemirror/language';
import { findMathSegments, type MathSegment } from '@/services/markdown/renderMarkdown';

/**
 * CodeMirror 6 extension: syntax-highlight math segments and treat
 * `$$..$$` / `\[..\]` as foldable.
 *
 * ponytail: `@codemirror/lang-markdown`'s lezer parser doesn't recognize
 * math, and writing a lezer InlineParser is overkill for our needs. We
 * scan the doc with the same segment scanner as the render pipeline and
 * apply `Decoration.mark` to each math range. Folding uses `foldService`
 * to return the inner range of a `$$..$$` / `\[..\]` block on demand.
 *
 * Code blocks and inline code are skipped (the scanner doesn't return
 * math ranges inside code). `\$` is left to remark-parse at render time;
 * in the editor, a literal `\$` followed by `$x$` would still highlight
 * the second `$x$` as math — acceptable, since the editor is just hinting
 * intent, the render pipeline makes the final call.
 *
 * Perf (large docs): both hot paths used to materialize the WHOLE doc
 * (`state.doc.toString()` + `findMathSegments`) — the highlighter per
 * keystroke, and the fold service per viewport line via `foldGutter`
 * (~60 full-doc materializations per keystroke/scroll step on multi-MB
 * files). Both now scan only a line window: the highlighter scans the
 * view's visible ranges (CM6 decorations are viewport-scoped by design),
 * the fold service scans the run (maximal block of non-blank lines) that
 * contains the queried line. A run is a sound scan unit because the
 * render pipeline's math flow (micromark `mathFlow`) also ends at a
 * blank line — no renderable math block spans one — and the shared
 * scanner (`findMathSegments`) matches the exact same segment inside the
 * run as over the whole doc.
 *
 * Ceilings of run/viewport-scoped scanning (accepted, documented):
 * - Display math containing a blank line (`$$\na\n\nb\n$$`) is no longer
 *   matched across the gap. The renderer splits it into two math blocks
 *   anyway; the old whole-doc fold disagreed with the preview.
 * - A window that starts INSIDE a long fenced code block with internal
 *   blank lines can't see the fence's opening marker, so math-looking
 *   text there may highlight (cosmetic, transient, viewport-scoped).
 *   `computeMathFoldRange` guards the fold path (see below).
 * - Runs longer than `SCAN_CONTEXT_MAX_LINES` are never foldable (a
 *   >1000-line run without a blank line is pathological).
 */

const inlineMark = Decoration.mark({ class: 'tok-math-inline' });
const displayMark = Decoration.mark({ class: 'tok-math-display' });

// ── Run-scoped scanning ───────────────────────────────────────────────────

const FENCE_MARKER_RE = /^\s{0,3}(?:`{3,}|~{3,})/;

/** How far a scan window may extend beyond the queried range (lines). */
const SCAN_CONTEXT_MAX_LINES = 1000;

function isBlankLine(text: string): boolean {
  return text.trim() === '';
}

/**
 * Line numbers of the scan window for the range [from, to]: the run
 * (maximal block of non-blank lines) containing each end, extended at
 * most `SCAN_CONTEXT_MAX_LINES` beyond it, never past the doc bounds.
 * Uses per-line text only — `doc.line(n).text` slices one line, never
 * materializing the whole document.
 */
function runContextLines(state: EditorState, from: number, to: number): { fromLine: number; toLine: number } {
  const doc = state.doc;
  const startLine = doc.lineAt(Math.min(Math.max(from, 0), doc.length)).number;
  const endLine = doc.lineAt(Math.min(Math.max(to, 0), doc.length)).number;
  const minLine = Math.max(1, startLine - SCAN_CONTEXT_MAX_LINES);
  const maxLine = Math.min(doc.lines, endLine + SCAN_CONTEXT_MAX_LINES);
  let a = startLine;
  while (a > minLine && !isBlankLine(doc.line(a - 1).text)) a--;
  let b = endLine;
  while (b < maxLine && !isBlankLine(doc.line(b + 1).text)) b++;
  return { fromLine: a, toLine: b };
}

/** Did the window hit the line cap instead of a run boundary / doc end?
 *  The scan can then start mid-run (possibly mid-math) — segment matches
 *  near it are not trustworthy. */
function windowCapped(state: EditorState, fromLine: number, toLine: number): boolean {
  const doc = state.doc;
  const cappedAbove = fromLine > 1 && !isBlankLine(doc.line(fromLine - 1).text);
  const cappedBelow = toLine < doc.lines && !isBlankLine(doc.line(toLine + 1).text);
  return cappedAbove || cappedBelow;
}

/** True when any line in [fromLine, toLine] starts a fenced-code marker.
 *  Fence pairing inside a window that contains a fence marker may
 *  misattribute code as text (or text as code), so the fold service
 *  refuses to fold such windows — never fold on ambiguous context. */
function windowHasFenceMarker(state: EditorState, fromLine: number, toLine: number): boolean {
  const doc = state.doc;
  for (let n = fromLine; n <= toLine; n++) {
    if (FENCE_MARKER_RE.test(doc.line(n).text)) return true;
  }
  return false;
}

/**
 * Math segments inside the scan window for [from, to], in DOCUMENT
 * positions: the shared scanner runs on the window slice (`doc.sliceString`
 * over just those lines), and the slice-local offsets are mapped back.
 */
function findMathSegmentsInWindow(state: EditorState, from: number, to: number): MathSegment[] {
  const { fromLine, toLine } = runContextLines(state, from, to);
  const windowFrom = state.doc.line(fromLine).from;
  const windowTo = state.doc.line(toLine).to;
  if (windowTo <= windowFrom) return [];
  const slice = state.doc.sliceString(windowFrom, windowTo);
  return findMathSegments(slice).map((seg) => ({ ...seg, from: windowFrom + seg.from, to: windowFrom + seg.to }));
}

// ── Highlight (viewport-scoped decorations) ───────────────────────────────

/**
 * Build the math decorations for the given document ranges (the view's
 * visible ranges). Only math intersecting a range's scan window is
 * decorated — off-viewport math has no highlight until scrolled into
 * view, which matches CM6's viewport-scoped decoration model.
 */
export function buildMathDecorations(state: EditorState, ranges: readonly { from: number; to: number }[]): DecorationSet {
  const marks: { from: number; to: number; mark: typeof inlineMark | typeof displayMark }[] = [];
  for (const range of ranges) {
    if (range.to <= range.from || range.from > state.doc.length) continue;
    for (const seg of findMathSegmentsInWindow(state, range.from, range.to)) {
      marks.push({ from: seg.from, to: seg.to, mark: seg.kind === 'display' ? displayMark : inlineMark });
    }
  }
  return RangeSet.of(
    marks.map((m) => m.mark.range(m.from, m.to)),
    true,
  );
}

const mathHighlightExtension = ViewPlugin.fromClass(
  class MathHighlight {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildMathDecorations(view.state, view.visibleRanges);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) {
        this.decorations = buildMathDecorations(u.view.state, u.view.visibleRanges);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

// ── Fold (run-scoped, cursor-gated) ───────────────────────────────────────

/**
 * Fold range for a `$$..$$` / `\[..\]` block containing the cursor, when
 * the queried line is that cursor's line. `lineStart`/`lineEnd` are the
 * line's document offsets (what CodeMirror's `foldable()` passes).
 *
 * Same fold range as the whole-doc scan: the inner range between the
 * opening and closing markers (both are 2 chars). Inline `$..$` /
 * `\(..\)` is skipped (kind filter); multi-line `$$..$$` works because
 * the scan window is the whole run, not just the queried line.
 *
 * Guards (all cheap line checks BEFORE any string materialization):
 * - cursor outside [lineStart, lineEnd] → null (this is what foldGutter
 *   hits for every non-cursor viewport line — the per-keystroke cost).
 * - window capped by the line limit, or containing a fence marker → null
 *   (ambiguous code context: never fold on it).
 */
export function computeMathFoldRange(
  state: EditorState,
  lineStart: number,
  lineEnd: number,
): { from: number; to: number } | null {
  const pos = state.selection.main.head;
  if (pos < lineStart || pos > lineEnd) return null;
  const { fromLine, toLine } = runContextLines(state, lineStart, lineEnd);
  if (windowCapped(state, fromLine, toLine)) return null;
  if (windowHasFenceMarker(state, fromLine, toLine)) return null;
  for (const seg of findMathSegmentsInWindow(state, lineStart, lineEnd)) {
    if (seg.kind !== 'display') continue;
    if (pos >= seg.from && pos <= seg.to) {
      if (seg.to - seg.from <= 4) return null;
      return { from: seg.from + 2, to: seg.to - 2 };
    }
  }
  return null;
}

const mathFoldService = foldService.of(computeMathFoldRange);

export const mathExtension: Extension[] = [mathHighlightExtension, mathFoldService];
