import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/react';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import type { JSONContent } from '@tiptap/react';
import { getRichTextExtensions } from './richTextExtensions';
import { selectionTextAlign } from './RichTextToolbar';

// ponytail: jsdom can't host a prosemirror view, but EditorState + a schema
// built from the real extension stack need no view — so the alignment
// resolver is unit-testable. Component-level highlight rendering is verified
// by opening a .richtext file in the running app (same ceiling as RichTextImage).
function makeState(docJson: JSONContent, from?: number, to?: number): EditorState {
  const schema = getSchema(getRichTextExtensions());
  const doc = schema.nodeFromJSON(docJson);
  const selection = from != null && to != null ? TextSelection.create(doc, from, to) : undefined;
  return EditorState.create({ doc, selection });
}

const para = (text: string, align?: string): JSONContent =>
  ({ type: 'paragraph', attrs: align ? { textAlign: align } : {}, content: [{ type: 'text', text }] }) as JSONContent;

describe('selectionTextAlign', () => {
  it('defaults an unset textAlign to left', () => {
    const state = makeState({ type: 'doc', content: [para('hello')] });
    expect(selectionTextAlign(state)).toBe('left');
  });

  it('returns the explicit alignment of a centered paragraph', () => {
    const state = makeState({ type: 'doc', content: [para('hello', 'center')] });
    expect(selectionTextAlign(state)).toBe('center');
  });

  // Regression: the old left-button fallback (!center && !right) forgot
  // 'justify', so a justified paragraph highlighted Left AND Justify.
  it('returns justify for a justified paragraph — never Left + Justify together', () => {
    const state = makeState({ type: 'doc', content: [para('hello', 'justify')] });
    expect(selectionTextAlign(state)).toBe('justify');
  });

  it('reads alignment from a heading textblock', () => {
    const state = makeState({
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 2, textAlign: 'center' }, content: [{ type: 'text', text: 'hi' }] }],
    });
    expect(selectionTextAlign(state)).toBe('center');
  });

  it('returns null when the selection spans mixed alignments (no button highlighted)', () => {
    const schema = getSchema(getRichTextExtensions());
    const doc = schema.nodeFromJSON({ type: 'doc', content: [para('a', 'center'), para('b', 'right')] });
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 1, doc.content.size - 1) });
    expect(selectionTextAlign(state)).toBeNull();
  });

});
