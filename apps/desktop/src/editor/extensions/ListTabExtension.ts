import { EditorView, keymap } from '@codemirror/view';
import { type EditorState } from '@codemirror/state';
import { NESTING_INDENT } from './ListEnterExtension';

/**
 * List marker detection for Tab/Shift-Tab. Unlike ListEnterExtension's
 * LIST_MARKER_RE, this ALSO matches ordered lists (`1. `) — Tab/Shift-Tab
 * promotion/demotion is orthogonal to the ordered-list Enter/renumber logic
 * in OrderedListExtension, so ordered items are demoted/promoted here too.
 */
const LIST_TAB_MARKER_RE = /^(\s*)(?:(-\s\[[ x]\]\s|[-*+]\s|>\s|\d+\.\s))/;

/**
 * Tab / Shift-Tab list promotion & demotion.
 *
 * Inside a list-item header line (`- `, `* `, `+ `, `> `, `- [ ] `, `- [x] `,
 * or `1. `), Tab demotes (insert NESTING_INDENT at line start) and Shift-Tab
 * promotes (remove one NESTING_INDENT unit from the leading indent, clamped at 0).
 * Outside list items, the handlers return false so `indentWithTab` in
 * `defaultKeymap` keeps its plain-text indent behavior unchanged.
 *
 * Ordered lists (`1. `) ARE handled here (Tab/Shift-Tab is orthogonal to the
 * ordered-list Enter/renumber logic in `OrderedListExtension`).
 */

export interface TabChange {
  from: number;
  to: number;
  insert: string;
  anchor: number;
}

/**
 * Pure: compute the change for Tab (dir='demote') or Shift-Tab (dir='promote')
 * at the selection head, or null if the line is not a list/blockquote marker
 * line. Range selections return null (fall through to indentWithTab).
 */
export function computeListTabChange(
  state: EditorState,
  dir: 'demote' | 'promote',
): TabChange | null {
  const { from, to } = state.selection.main;
  if (from !== to) return null;

  const line = state.doc.lineAt(from);
  if (!LIST_TAB_MARKER_RE.test(line.text)) return null;

  const leading = line.text.match(/^(\s*)/)![0];

  if (dir === 'demote') {
    const insert = NESTING_INDENT + line.text;
    return {
      from: line.from,
      to: line.to,
      insert,
      // keep the cursor at the same logical offset (shifted by the indent unit)
      anchor: from + NESTING_INDENT.length,
    };
  }

  // promote: remove one NESTING_INDENT from the leading whitespace, if present
  if (!leading.startsWith(NESTING_INDENT)) {
    // Less than one unit of leading indent — clamp at 0: remove whatever
    // leading whitespace exists (if any), so a top-level list item stays put
    // rather than leaving stray spaces.
    if (leading.length === 0) return null;
    const insert = line.text.slice(leading.length);
    return {
      from: line.from,
      to: line.to,
      insert,
      anchor: Math.max(line.from, from - leading.length),
    };
  }
  const insert = line.text.slice(NESTING_INDENT.length);
  return {
    from: line.from,
    to: line.to,
    insert,
    anchor: from - NESTING_INDENT.length,
  };
}

function runListTab(view: EditorView, dir: 'demote' | 'promote'): boolean {
  const change = computeListTabChange(view.state, dir);
  if (!change) return false;
  view.dispatch({
    changes: { from: change.from, to: change.to, insert: change.insert },
    selection: { anchor: change.anchor },
    userEvent: 'input',
  });
  return true;
}

/** Keymap handlers — exported for direct testing. */
export function handleListTabDemote(view: EditorView): boolean {
  return runListTab(view, 'demote');
}
export function handleListTabPromote(view: EditorView): boolean {
  return runListTab(view, 'promote');
}

export const listTabExtension = [
  keymap.of([
    { key: 'Tab', run: (v) => runListTab(v, 'demote') },
    { key: 'Shift-Tab', run: (v) => runListTab(v, 'promote') },
  ]),
];
