import { Extension } from '@tiptap/react';
import type { Editor } from '@tiptap/react';

// ponytail: Tiptap v3 has no @tiptap/extension-indent on npm (404).
// This is a minimal in-house extension: adds an `indent` attr (0..5)
// to paragraph + heading + listItem, increments/decrements on
// Tab/Shift-Tab. Paragraph/heading map to `text-indent` (first-line
// indent, CJK convention — 2em per level). ListItem maps to
// `margin-left` so the list marker shifts with the item — padding-left
// would widen the gap between marker and text (marker sits in the
// padding area), and text-indent on the inner paragraph shifts only
// the first text line while leaving the marker in place.
//
// Tab inside a list always applies visual indent (margin-left on the
// li). We deliberately do NOT defer to StarterKit's sinkListItem —
// structural nesting renumbers the item to 1 and visually re-parents
// it under the previous item, which doesn't match the user's mental
// model of "Tab = shift this line right, keep its number".
// CodeBlock's Tab is handled by CodeBlockLowlight's own keymap
// (enableTabIndentation) and runs first — no guard needed here.

const MAX_INDENT = 5;
const INDENT_EM = 2;

function listItemAncestor(editor: Editor): { depth: number } | null {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'listItem') return { depth: d };
  }
  return null;
}

function changeIndent(editor: Editor, delta: number): boolean {
  const { state, view } = editor;
  const { from, to } = state.selection;
  // When the cursor sits inside a listItem, target the listItem (not
  // the inner paragraph) so margin-left shifts the marker too.
  // Otherwise target paragraph/heading (top-level first-line indent).
  const inList = listItemAncestor(editor) !== null;
  const targetName = inList ? 'listItem' : null;
  let tr = state.tr;
  let changed = false;
  state.doc.nodesBetween(from, to, (node: any, pos: number) => {
    if (targetName) {
      if (node.type.name !== targetName) return;
    } else if (node.type.name !== 'paragraph' && node.type.name !== 'heading') {
      return;
    }
    const cur = (node.attrs.indent as number | undefined) ?? 0;
    const next = Math.max(0, Math.min(MAX_INDENT, cur + delta));
    if (next !== cur) {
      tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
      changed = true;
    }
  });
  if (changed) view.dispatch(tr);
  return changed;
}

export const RichTextIndent = Extension.create({
  name: 'richTextIndent',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el: HTMLElement) => {
              const ti = (el.style.textIndent || '').trim();
              const m = /^([\d.]+)em$/.exec(ti);
              if (!m) return 0;
              return Math.min(MAX_INDENT, Math.round(parseFloat(m[1]) / INDENT_EM));
            },
            renderHTML: (attrs: Record<string, unknown>) => {
              const v = (attrs.indent as number | undefined) ?? 0;
              return v ? { style: `text-indent: ${v * INDENT_EM}em` } : {};
            },
            // ponytail: default keepOnSplit=true would copy `indent` into the
            // new paragraph after Enter (Tiptap's splitBlock filters attrs via
            // getSplittedAttributes by this flag). Set false so each new
            // paragraph starts at indent 0 — first-line indent belongs to
            // the paragraph the user actually pressed Tab in, not the next.
            keepOnSplit: false,
          },
        },
      },
      {
        types: ['listItem'],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el: HTMLElement) => {
              const ml = (el.style.marginLeft || '').trim();
              const m = /^([\d.]+)em$/.exec(ml);
              if (!m) return 0;
              return Math.min(MAX_INDENT, Math.round(parseFloat(m[1]) / INDENT_EM));
            },
            renderHTML: (attrs: Record<string, unknown>) => {
              const v = (attrs.indent as number | undefined) ?? 0;
              return v ? { style: `margin-left: ${v * INDENT_EM}em` } : {};
            },
            keepOnSplit: false,
          },
        },
      },
    ];
  },
  addKeyboardShortcuts() {
    return {
      Tab: () => changeIndent(this.editor, 1),
      'Shift-Tab': () => changeIndent(this.editor, -1),
      // ponytail: at start of an indented paragraph, Backspace should
      // decrement indent rather than join with the previous block —
      // matches the user's mental model of "Tab to indent, Backspace
      // to undo indent". Only fires when selection is empty and cursor
      // sits at offset 0 of a paragraph/heading with indent > 0; any
      // other position falls through to default backspace.
      Backspace: () => {
        const { state } = this.editor;
        const { selection } = state;
        if (!selection.empty) return false;
        const $from = selection.$from;
        if ($from.parentOffset !== 0) return false;
        const node = $from.parent;
        if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return false;
        const cur = (node.attrs.indent as number | undefined) ?? 0;
        if (cur <= 0) return false;
        return changeIndent(this.editor, -1);
      },
    };
  },
});
