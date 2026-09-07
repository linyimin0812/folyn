import { EditorView, keymap } from '@codemirror/view';
import { type EditorState, Prec } from '@codemirror/state';
import { LIST_MARKER_RE } from './ListEnterExtension';

/**
 * Esc exits a syntax block.
 *
 * When the cursor is on a line that is ONLY a list/blockquote marker with no
 * content after it (e.g. `- `, `> `, `- [ ] `), pressing Esc removes the
 * marker and lands the cursor at the (de-indented) line start — exiting the
 * structure. On any other line, the handler returns false so the default Esc
 * behavior (e.g. clear selection) is preserved.
 *
 * `Prec.highest` keeps this handler ahead of `defaultKeymap`'s Esc binding so
 * the exit fires first and falls through cleanly on false.
 */

export interface EscChange {
  from: number;
  to: number;
  insert: string;
  anchor: number;
}

/**
 * Pure: compute the change for Esc at the selection head, or null if the line
 * is not an empty list/blockquote marker line. Range selections return null.
 */
export function computeEscExitChange(state: EditorState): EscChange | null {
  const { from, to } = state.selection.main;
  if (from !== to) return null;

  const line = state.doc.lineAt(from);
  const m = line.text.match(LIST_MARKER_RE);
  if (!m) return null;

  const indent = m[1];
  const marker = m[2];
  const prefixLength = indent.length + marker.length;
  const content = line.text.slice(prefixLength);
  // Only exit when the item is EMPTY — a marker with content is real content,
  // not a stray marker the user wants to dismiss.
  if (content.trim() !== '') return null;

  return {
    from: line.from,
    to: line.to,
    insert: indent,
    anchor: line.from + indent.length,
  };
}

function runEscExit(view: EditorView): boolean {
  const change = computeEscExitChange(view.state);
  if (!change) return false;
  view.dispatch({
    changes: { from: change.from, to: change.to, insert: change.insert },
    selection: { anchor: change.anchor },
    userEvent: 'delete',
  });
  return true;
}

/** Keymap handler — exported for direct testing. */
export function handleEscExit(view: EditorView): boolean {
  return runEscExit(view);
}

export const escExitExtension = [
  Prec.highest(
    keymap.of([
      { key: 'Escape', run: runEscExit },
    ]),
  ),
];
