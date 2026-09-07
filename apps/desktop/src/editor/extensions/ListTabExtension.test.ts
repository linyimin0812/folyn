import { describe, it, expect } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { computeListTabChange, listTabExtension, handleListTabDemote, handleListTabPromote } from './ListTabExtension';

function stateAt(doc: string, pos: number): EditorState {
  return EditorState.create({ doc, selection: { anchor: pos } });
}

function makeView(doc: string, pos: number): EditorView {
  const state = EditorState.create({
    doc,
    selection: { anchor: pos },
    extensions: [...listTabExtension],
  });
  return new EditorView({ state, parent: document.body });
}

describe('computeListTabChange — demote (Tab)', () => {
  it('adds one nesting indent at line start of a bullet', () => {
    const doc = '- foo';
    const change = computeListTabChange(stateAt(doc, 5), 'demote')!;
    expect(change.insert).toBe('  - foo');
    expect(change.from).toBe(0);
    expect(change.anchor).toBe(5 + 2);
  });

  it('demotes an ordered list item too', () => {
    const doc = '1. foo';
    const change = computeListTabChange(stateAt(doc, 5), 'demote')!;
    expect(change.insert).toBe('  1. foo');
  });

  it('demotes a task list item', () => {
    const doc = '- [ ] foo';
    const change = computeListTabChange(stateAt(doc, 8), 'demote')!;
    expect(change.insert).toBe('  - [ ] foo');
  });

  it('demotes a blockquote', () => {
    const doc = '> foo';
    const change = computeListTabChange(stateAt(doc, 4), 'demote')!;
    expect(change.insert).toBe('  > foo');
  });

  it('returns null for a non-list line (falls through to indentWithTab)', () => {
    const doc = 'plain text';
    expect(computeListTabChange(stateAt(doc, 4), 'demote')).toBeNull();
  });

  it('returns null for a range selection', () => {
    const doc = '- foo';
    const state = EditorState.create({ doc, selection: { anchor: 3, head: 5 } });
    expect(computeListTabChange(state, 'demote')).toBeNull();
  });
});

describe('computeListTabChange — promote (Shift-Tab)', () => {
  it('removes one nesting indent from a nested bullet', () => {
    const doc = '  - foo';
    const change = computeListTabChange(stateAt(doc, 7), 'promote')!;
    expect(change.insert).toBe('- foo');
    expect(change.anchor).toBe(7 - 2);
  });

  it('clamps at 0 — a top-level bullet with no leading indent returns null', () => {
    const doc = '- foo';
    expect(computeListTabChange(stateAt(doc, 5), 'promote')).toBeNull();
  });

  it('removes stray leading whitespace when less than one unit', () => {
    const doc = ' - foo';
    const change = computeListTabChange(stateAt(doc, 6), 'promote')!;
    expect(change.insert).toBe('- foo');
  });

  it('returns null for a non-list line', () => {
    const doc = '  plain text';
    expect(computeListTabChange(stateAt(doc, 5), 'promote')).toBeNull();
  });
});

describe('listTabExtension — handler dispatch', () => {
  it('Tab demotes a bullet in place', () => {
    const doc = '- foo';
    const view = makeView(doc, 5);
    expect(handleListTabDemote(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('  - foo');
    view.destroy();
  });

  it('Shift-Tab promotes a nested bullet', () => {
    const doc = '  - foo';
    const view = makeView(doc, 7);
    expect(handleListTabPromote(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('- foo');
    view.destroy();
  });

  it('Tab on a non-list line returns false (falls through)', () => {
    const doc = 'plain text';
    const view = makeView(doc, 4);
    expect(handleListTabDemote(view)).toBe(false);
    view.destroy();
  });
});
