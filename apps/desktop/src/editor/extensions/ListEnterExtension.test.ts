import { describe, it, expect } from 'vitest';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap } from '@codemirror/commands';
import { computeListEnterChange, listEnterExtension, handleListEnter, handleListShiftEnter } from './ListEnterExtension';
import { orderedListExtension } from './OrderedListExtension';

function stateAt(doc: string, pos: number, exts: never[] = []): EditorState {
  return EditorState.create({ doc, selection: { anchor: pos }, extensions: exts });
}

function makeView(doc: string, pos: number, exts: unknown[]): EditorView {
  const state = EditorState.create({
    doc,
    selection: { anchor: pos },
    extensions: [keymap.of(defaultKeymap), ...exts],
  });
  return new EditorView({ state, parent: document.body });
}

describe('computeListEnterChange — Enter (no shift)', () => {
  it('continues an unordered bullet `- foo` at line end', () => {
    const doc = '- foo';
    const change = computeListEnterChange(stateAt(doc, doc.length), false)!;
    expect(change.insert).toBe('\n- ');
    expect(change.from).toBe(doc.length);
    expect(change.anchor).toBe(doc.length + 1 + 2); // +1 \n, +2 '- '
  });

  it('exits when the item is empty `- `', () => {
    const doc = '- ';
    const change = computeListEnterChange(stateAt(doc, doc.length), false)!;
    expect(change.insert).toBe('');
    expect(change.from).toBe(0);
    expect(change.to).toBe(doc.length);
    expect(change.anchor).toBe(0);
  });

  it('splits mid-line `- ab|cd` → next item gets `cd`', () => {
    const doc = '- abcd';
    const pos = doc.indexOf('cd'); // cursor before 'cd'
    const change = computeListEnterChange(stateAt(doc, pos), false)!;
    expect(change.insert).toBe('\n- cd');
    expect(change.from).toBe(pos);
  });

  it('continues a blockquote `> foo` at line end', () => {
    const doc = '> foo';
    const change = computeListEnterChange(stateAt(doc, doc.length), false)!;
    expect(change.insert).toBe('\n> ');
  });

  it('continues a task `- [ ] foo` at line end', () => {
    const doc = '- [ ] foo';
    const change = computeListEnterChange(stateAt(doc, doc.length), false)!;
    expect(change.insert).toBe('\n- [ ] ');
  });

  it('continues a checked task `- [x] foo` at line end', () => {
    const doc = '- [x] foo';
    const change = computeListEnterChange(stateAt(doc, doc.length), false)!;
    expect(change.insert).toBe('\n- [x] ');
  });

  it('preserves leading indent on continuation', () => {
    const doc = '  - foo';
    const change = computeListEnterChange(stateAt(doc, doc.length), false)!;
    expect(change.insert).toBe('\n  - ');
  });

  it('returns null for an ordered list `1. foo` (owned by OrderedListExtension)', () => {
    const doc = '1. foo';
    expect(computeListEnterChange(stateAt(doc, doc.length), false)).toBeNull();
  });

  it('returns null for a plain-text line', () => {
    const doc = 'plain text';
    expect(computeListEnterChange(stateAt(doc, doc.length), false)).toBeNull();
  });

  it('returns null when the cursor is inside the marker prefix', () => {
    const doc = '- foo';
    expect(computeListEnterChange(stateAt(doc, 0), false)).toBeNull();
  });

  it('returns null for a range selection', () => {
    const doc = '- foo';
    const state = EditorState.create({ doc, selection: { anchor: 3, head: 5 } });
    expect(computeListEnterChange(state, false)).toBeNull();
  });
});

describe('computeListEnterChange — Shift-Enter', () => {
  it('inserts a continuation marker line on Shift-Enter', () => {
    const doc = '- foo';
    const change = computeListEnterChange(stateAt(doc, doc.length), true)!;
    expect(change.insert).toBe('\n- ');
  });

  it('Shift-Enter on a task keeps the task marker', () => {
    const doc = '- [ ] foo';
    const change = computeListEnterChange(stateAt(doc, doc.length), true)!;
    expect(change.insert).toBe('\n- [ ] ');
  });
});

describe('listEnterExtension — handler dispatch (with OrderedListExtension co-mounted)', () => {
  it('handleListEnter on unordered bullet inserts a new bullet', () => {
    const doc = '- foo';
    const view = makeView(doc, doc.length, [...orderedListExtension, ...listEnterExtension]);
    expect(handleListEnter(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('- foo\n- ');
    view.destroy();
  });

  it('handleListEnter on empty unordered bullet exits the list', () => {
    const doc = '- ';
    const view = makeView(doc, doc.length, [...orderedListExtension, ...listEnterExtension]);
    expect(handleListEnter(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('');
    view.destroy();
  });

  it('handleListEnter returns false on ORDERED list `1. foo` (OrderedListExtension owns it)', () => {
    const doc = '1. foo';
    const view = makeView(doc, doc.length, [...orderedListExtension, ...listEnterExtension]);
    // ListEnter must NOT handle ordered lists — it returns false so
    // OrderedListExtension's Enter handler (which IS in the keymap and runs
    // for ordered lines) owns the dispatch.
    expect(handleListEnter(view)).toBe(false);
    expect(view.state.doc.toString()).toBe('1. foo');
    view.destroy();
  });

  it('handleListEnter returns false on plain text (no marker)', () => {
    const doc = 'plain text';
    const view = makeView(doc, doc.length, [...orderedListExtension, ...listEnterExtension]);
    expect(handleListEnter(view)).toBe(false);
    view.destroy();
  });

  it('handleListShiftEnter inserts a continuation marker line', () => {
    const doc = '- foo';
    const view = makeView(doc, doc.length, [...orderedListExtension, ...listEnterExtension]);
    expect(handleListShiftEnter(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('- foo\n- ');
    view.destroy();
  });
});
