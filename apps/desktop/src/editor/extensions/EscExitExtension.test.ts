import { describe, it, expect } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { computeEscExitChange, escExitExtension, handleEscExit } from './EscExitExtension';

function stateAt(doc: string, pos: number): EditorState {
  return EditorState.create({ doc, selection: { anchor: pos } });
}

function makeView(doc: string, pos: number): EditorView {
  const state = EditorState.create({
    doc,
    selection: { anchor: pos },
    extensions: [...escExitExtension],
  });
  return new EditorView({ state, parent: document.body });
}

describe('computeEscExitChange', () => {
  it('exits an empty unordered bullet `- `', () => {
    const doc = '- ';
    const change = computeEscExitChange(stateAt(doc, doc.length))!;
    expect(change.insert).toBe('');
    expect(change.from).toBe(0);
    expect(change.to).toBe(doc.length);
    expect(change.anchor).toBe(0);
  });

  it('exits an empty blockquote `> `', () => {
    const doc = '> ';
    const change = computeEscExitChange(stateAt(doc, doc.length))!;
    expect(change.insert).toBe('');
    expect(change.to).toBe(doc.length);
  });

  it('exits an empty task `- [ ] `', () => {
    const doc = '- [ ] ';
    const change = computeEscExitChange(stateAt(doc, doc.length))!;
    expect(change.insert).toBe('');
    expect(change.to).toBe(doc.length);
  });

  it('preserves leading indent on exit', () => {
    const doc = '  - ';
    const change = computeEscExitChange(stateAt(doc, doc.length))!;
    expect(change.insert).toBe('  ');
    expect(change.anchor).toBe(2);
  });

  it('does NOT exit when the item has content', () => {
    const doc = '- foo';
    expect(computeEscExitChange(stateAt(doc, doc.length))).toBeNull();
  });

  it('does NOT exit a task that still has content', () => {
    const doc = '- [ ] foo';
    expect(computeEscExitChange(stateAt(doc, doc.length))).toBeNull();
  });

  it('returns null for a plain-text line', () => {
    const doc = 'plain text';
    expect(computeEscExitChange(stateAt(doc, doc.length))).toBeNull();
  });

  it('returns null for a range selection', () => {
    const doc = '- foo';
    const state = EditorState.create({ doc, selection: { anchor: 0, head: 5 } });
    expect(computeEscExitChange(state)).toBeNull();
  });
});

describe('escExitExtension — handler dispatch', () => {
  it('Esc on empty bullet exits the list', () => {
    const doc = '- ';
    const view = makeView(doc, doc.length);
    expect(handleEscExit(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('');
    view.destroy();
  });

  it('Esc on a bullet with content returns false (preserves default Esc)', () => {
    const doc = '- foo';
    const view = makeView(doc, doc.length);
    expect(handleEscExit(view)).toBe(false);
    view.destroy();
  });

  it('Esc on plain text returns false', () => {
    const doc = 'plain text';
    const view = makeView(doc, doc.length);
    expect(handleEscExit(view)).toBe(false);
    view.destroy();
  });
});
