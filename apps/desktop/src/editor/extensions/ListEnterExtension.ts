import { EditorView, keymap } from '@codemirror/view';
import { type EditorState } from '@codemirror/state';

/**
 * List Enter continuation for unordered / blockquote / task markers.
 *
 * Ordered lists (`1.`) are OWNED by `OrderedListExtension` (registered
 * before this extension in `markdownExtensions`), so its Enter handler
 * returns true first on ordered lines and this extension never fires there.
 * This extension handles `-` / `*` / `+` / `>` / `- [ ]` / `- [x]` only.
 *
 * Behaviour matrix (mirrors `OrderedListExtension.handleOrderedListEnter`):
 *
 * Cursor on a list/quote header line:
 *   - Empty item (marker + nothing) → exit: remove marker, leave blank line
 *   - Content, cursor at end → insert next same-marker prefix
 *   - Content, cursor mid-line → split: text after cursor → next item
 *
 * Shift-Enter → insert a continuation line (marker + blank), so the user
 * can write multi-line content under one bullet without re-typing the marker.
 */

export const NESTING_INDENT = '  ';

/**
 * Match a list/blockquote/task marker at line start. Captures:
 *   1 = leading whitespace (indent)
 *   2 = the marker including its trailing space (`- `, `* `, `+ `, `> `,
 *       `- [ ] `, `- [x] `)
 * Ordered lists (`1. `) are intentionally NOT matched — owned elsewhere.
 */
export const LIST_MARKER_RE = /^(\s*)(?:(-\s\[[ x]\]\s|[-*+]\s|>\s))/;

export interface EnterChange {
  from: number;
  to: number;
  insert: string;
  anchor: number;
}

/**
 * Pure: compute the document change for pressing Enter at the current
 * selection head, or null if this line is not a list/blockquote marker line
 * (or the cursor is inside the marker prefix). Returns null for range
 * selections.
 */
export function computeListEnterChange(state: EditorState, shift: boolean): EnterChange | null {
  const { from, to } = state.selection.main;
  if (from !== to) return null;

  const line = state.doc.lineAt(from);
  const cursorOffset = from - line.from;
  const m = line.text.match(LIST_MARKER_RE);
  if (!m) return null;

  const indent = m[1];
  const marker = m[2];
  const prefixLength = indent.length + marker.length;
  if (cursorOffset < prefixLength) return null;

  const contentAfterCursor = line.text.slice(cursorOffset);
  const contentBeforeCursor = line.text.slice(prefixLength, cursorOffset);

  // ── Shift-Enter: continuation line (marker + blank) regardless of content ──
  if (shift) {
    const insert = `\n${indent}${marker}${contentAfterCursor}`;
    return {
      from,
      to: line.to,
      insert,
      anchor: from + 1 + indent.length + marker.length,
    };
  }

  // ── Enter: empty item → exit (remove marker, leave the indent) ─────────────
  if (contentBeforeCursor.trim() === '' && contentAfterCursor.trim() === '') {
    return {
      from: line.from,
      to: line.to,
      insert: indent,
      anchor: line.from + indent.length,
    };
  }

  // ── Enter: has content → next same-marker prefix (split if mid-line) ───────
  const insert = `\n${indent}${marker}${contentAfterCursor}`;
  return {
    from,
    to: line.to,
    insert,
    anchor: from + 1 + indent.length + marker.length,
  };
}

function runListEnter(view: EditorView, shift: boolean): boolean {
  const change = computeListEnterChange(view.state, shift);
  if (!change) return false;
  view.dispatch({
    changes: { from: change.from, to: change.to, insert: change.insert },
    selection: { anchor: change.anchor },
    userEvent: 'input',
  });
  return true;
}

/** Keymap handler — exported so tests can call it directly without going
 *  through the keymap facet (which is opaque to introspection). */
export function handleListEnter(view: EditorView): boolean {
  return runListEnter(view, false);
}
export function handleListShiftEnter(view: EditorView): boolean {
  return runListEnter(view, true);
}

const listEnterKeymap = keymap.of([
  { key: 'Shift-Enter', run: (v) => runListEnter(v, true) },
  { key: 'Enter', run: (v) => runListEnter(v, false) },
]);

export const listEnterExtension = [listEnterKeymap];
