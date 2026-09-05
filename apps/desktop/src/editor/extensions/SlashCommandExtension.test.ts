import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { computeSlashMenuState } from './SlashCommandExtension';

function stateAt(doc: string, pos: number): EditorState {
  return EditorState.create({ doc, selection: { anchor: pos } });
}

/** State with the Markdown language loaded, so the Lezer syntax tree marks
 *  fenced and indented code blocks and the in-block suppression can fire. */
function stateAtMd(doc: string, pos: number): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor: pos },
    extensions: [markdown()],
  });
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

describe('computeSlashMenuState inside code blocks', () => {
  it('hides the menu inside a fenced code block', () => {
    // ```js\nconst x = /path\n```
    const doc = '```js\nconst x = /path\n```';
    // cursor after "/path"
    const pos = doc.indexOf('/path') + '/path'.length;
    expect(computeSlashMenuState(stateAtMd(doc, pos))).toEqual({ visible: false, pos: 0, filter: '' });
  });

  it('hides the menu inside an indented code block', () => {
    // four-space indented code block
    const doc = '    const x = /path';
    const pos = doc.length;
    expect(computeSlashMenuState(stateAtMd(doc, pos))).toEqual({ visible: false, pos: 0, filter: '' });
  });

  it('still opens the menu outside a fenced code block', () => {
    const doc = '```js\nconsole.log(1)\n```\n\n/callout';
    const pos = doc.length;
    expect(computeSlashMenuState(stateAtMd(doc, pos))).toEqual({ visible: true, pos, filter: 'callout' });
  });
});

describe('computeSlashMenuState inside inline code spans', () => {
  it('hides the menu inside a backtick inline code span', () => {
    const doc = 'run `/path` then text';
    const pos = doc.indexOf('/path') + '/path'.length;
    expect(computeSlashMenuState(stateAtMd(doc, pos))).toEqual({ visible: false, pos: 0, filter: '' });
  });
});
