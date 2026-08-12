import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { computeSlashMenuState } from './SlashCommandExtension';

function stateAt(doc: string, pos: number): EditorState {
  return EditorState.create({ doc, selection: { anchor: pos } });
}

describe('computeSlashMenuState (pure derivation from doc + cursor)', () => {
  it('opens the menu with an empty filter right after "/"', () => {
    expect(computeSlashMenuState(stateAt('/', 1))).toEqual({ visible: true, pos: 1, filter: '' });
  });

  it('filters by the text typed after "/"', () => {
    expect(computeSlashMenuState(stateAt('/tab', 4))).toEqual({ visible: true, pos: 4, filter: 'tab' });
  });

  it('keeps Chinese filter text (matches 文件预览 in SlashMenu)', () => {
    expect(computeSlashMenuState(stateAt('/文件', 3))).toEqual({ visible: true, pos: 3, filter: '文件' });
  });

  it('uses the last "/" before the cursor', () => {
    expect(computeSlashMenuState(stateAt('text /callout', 13))).toEqual({ visible: true, pos: 13, filter: 'callout' });
  });

  it('hides when there is no "/" before the cursor', () => {
    expect(computeSlashMenuState(stateAt('hello world', 5))).toEqual({ visible: false, pos: 0, filter: '' });
  });

  it('hides when "/" is mid-word (not after whitespace or line start)', () => {
    expect(computeSlashMenuState(stateAt('a/b', 3))).toEqual({ visible: false, pos: 0, filter: '' });
  });

  it('hides when the filter contains whitespace', () => {
    expect(computeSlashMenuState(stateAt('/tab bar', 8))).toEqual({ visible: false, pos: 0, filter: '' });
  });

  it('hides for a self-closing HTML tag "/>"', () => {
    expect(computeSlashMenuState(stateAt('<br/>', 5))).toEqual({ visible: false, pos: 0, filter: '' });
  });
});
