import { type EditorState } from '@codemirror/state';
import { foldService } from '@codemirror/language';

/**
 * Heading-level folding for Markdown.
 *
 * Registers a `foldService` that, for any line that starts with `#`–`######`,
 * returns a fold range covering everything from the end of the heading line
 * up to the start of the next heading at the same or higher level (so folding
 * an H2 collapses its whole section body, stopping at the next H1/H2).
 * `foldGutter` (already mounted in `EditorView.tsx`) picks this up and shows
 * the fold chevron automatically.
 *
 * Persistence is session-only (CodeMirror `foldState` default — does not
 * survive a reload); matches the existing fold-gutter behavior.
 */

const HEADING_RE = /^(#{1,6})\s/;

/**
 * Pure: given the start/end document positions of a line, return the fold
 * range for a heading section if this line is a heading, else null.
 *
 * `lineStart`/`lineEnd` are document offsets (CodeMirror foldService calls
 * with the line's extent, NOT a 1-based line number).
 */
export function computeHeadingFoldRange(
  state: EditorState,
  lineStart: number,
  lineEnd: number,
): { from: number; to: number } | null {
  const line = state.doc.lineAt(lineStart);
  const m = line.text.match(HEADING_RE);
  if (!m) return null;

  const level = m[1].length;
  const totalLines = state.doc.lines;

  // Walk forward from the line AFTER the heading; stop at the first line
  // whose heading level is <= this heading's level (same or higher), or at
  // the end of the document.
  let stopLine = line.number;
  for (let n = line.number + 1; n <= totalLines; n++) {
    const candidate = state.doc.line(n).text;
    const cm = candidate.match(HEADING_RE);
    if (cm && cm[1].length <= level) {
      stopLine = n - 1;
      break;
    }
    stopLine = n;
  }

  // Nothing to fold if the heading is the last line or immediately followed
  // by a same/higher-level heading.
  if (stopLine <= line.number) return null;

  const toLine = state.doc.line(stopLine);
  return { from: lineEnd, to: toLine.to };
}

export const headingFoldExtension = [
  foldService.of(computeHeadingFoldRange),
];
