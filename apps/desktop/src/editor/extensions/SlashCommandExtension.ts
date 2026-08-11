import type { EditorState } from '@codemirror/state';

export interface SlashMenuState {
  visible: boolean;
  pos: number;
  filter: string;
}

/**
 * Derive the slash menu state purely from the editor state (document +
 * cursor). No CodeMirror state field or transaction is involved, so typing
 * during an IME composition never dispatches into the editor — WKWebView
 * commits the composition early when the editor state is touched
 * mid-composition, dropping uncommitted pinyin.
 *
 * Menu rules (mirror the old ViewPlugin's behavior):
 * - Open when the last '/' before the cursor is at line start or preceded by
 *   whitespace, not part of a self-closing tag (">"), and the text after it
 *   contains no whitespace.
 * - `filter` is everything between that '/' and the cursor.
 */
export function computeSlashMenuState(state: EditorState): SlashMenuState {
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  const textBefore = state.doc.sliceString(line.from, pos);
  const slashIdx = textBefore.lastIndexOf('/');

  if (slashIdx === -1) return { visible: false, pos: 0, filter: '' };

  const afterSlash = textBefore.slice(slashIdx + 1);
  const charBeforeSlash = slashIdx > 0 ? textBefore[slashIdx - 1] : ' ';
  const charAfterSlash = afterSlash.length > 0 ? afterSlash[0] : '';
  const isTrigger =
    (charBeforeSlash === ' ' || charBeforeSlash === '\t' || slashIdx === 0) &&
    charAfterSlash !== '>';

  if (!isTrigger || /\s/.test(afterSlash)) {
    return { visible: false, pos: 0, filter: '' };
  }

  return { visible: true, pos, filter: afterSlash };
}
