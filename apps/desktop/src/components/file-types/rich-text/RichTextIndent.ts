import { Extension } from '@tiptap/react';
import type { Editor } from '@tiptap/react';

// ponytail: Tiptap v3 has no @tiptap/extension-indent on npm (404).
// This is a minimal in-house extension: adds an `indent` attr (0..5)
// to paragraph + heading, increments/decrements on Tab/Shift-Tab, maps
// to `text-indent` (first-line indent, CJK convention — 2em per level).
// NOT margin-left — user wants first-line indent, not whole-paragraph
// shift.
//
// Order matters: registered AFTER StarterKit so StarterKit's CodeBlock
// and ListItem Tab handlers get first dibs. They return false when the
// cursor isn't in a code block / list, so this handler only fires for
// paragraph/heading.

const MAX_INDENT = 5;
const INDENT_EM = 2;

function changeIndent(editor: Editor, delta: number): boolean {
  const { state, view } = editor;
  const { from, to } = state.selection;
  let tr = state.tr;
  let changed = false;
  state.doc.nodesBetween(from, to, (node: any, pos: number) => {
    if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return;
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

