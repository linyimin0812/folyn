import { Extension } from '@tiptap/react';
import type { Editor } from '@tiptap/react';

// ponytail: Tiptap v3 has no @tiptap/extension-indent on npm (404).
// This is a minimal in-house extension: adds an `indent` attr (0..5)
// to paragraph + heading, increments/decrements on Tab/Shift-Tab, maps
// to margin-left (24px per level).
//
// Order matters: registered AFTER StarterKit so StarterKit's CodeBlock
// and ListItem Tab handlers get first dibs. They return false when the
// cursor isn't in a code block / list, so this handler only fires for
// paragraph/heading. If a future extension returns true for Tab on
// paragraphs, this handler is silently skipped (Tiptap: first true wins).

const MAX_INDENT = 5;
const INDENT_PX = 24;

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
              const ml = (el.style.marginLeft || '').trim();
              const m = /^(\d+)px$/.exec(ml);
              if (!m) return 0;
              return Math.min(MAX_INDENT, Math.round(parseInt(m[1], 10) / INDENT_PX));
            },
            renderHTML: (attrs: Record<string, unknown>) => {
              const v = (attrs.indent as number | undefined) ?? 0;
              return v ? { style: `margin-left: ${v * INDENT_PX}px` } : {};
            },
          },
        },
      },
    ];
  },
  addKeyboardShortcuts() {
    return {
      Tab: () => changeIndent(this.editor, 1),
      'Shift-Tab': () => changeIndent(this.editor, -1),
    };
  },
});
