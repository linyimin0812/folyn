import { describe, it, expect } from 'vitest';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import {
  splitRowSpans,
  parseTableRow,
  markdownTableToMarkdown,
  displayWidth,
  isSeparatorRow,
} from '@folyn/extension-rich-text/src/markdownTable';
import {
  computeTableTabChange,
  computeTableEnterChange,
  handleTableTab,
  handleTableEnter,
  handleTableShiftTab,
  markdownTableExtension,
  findTableAround,
} from './MarkdownTableExtension';

function stateAt(doc: string, pos: number, extensions: any[] = []): EditorState {
  return EditorState.create({ doc, selection: { anchor: pos }, extensions });
}

function makeView(doc: string, pos: number, extensions: any[] = [...markdownTableExtension]): EditorView {
  const state = EditorState.create({ doc, selection: { anchor: pos }, extensions });
  return new EditorView({ state, parent: document.body });
}

/** 0-based line index → absolute start position. */
function lineStart(doc: string, lineIdx: number): number {
  return doc.split('\n').slice(0, lineIdx).join('\n').length + (lineIdx > 0 ? 1 : 0);
}

const BASIC_TABLE = [
  '| 名字 | 年龄 |',
  '| --- | --- |',
  '| 张三 | 25 |',
].join('\n');

// Realign: col0 width 4 (名字/张三), col1 width 4 (年龄) — 25 right-padded.
const REALIGNED_TABLE = [
  '| 名字 | 年龄 |',
  '| ---- | ---- |',
  '| 张三 | 25   |',
].join('\n');

// ── markdownTable: splitRowSpans / displayWidth / pad formatting ──────────

describe('splitRowSpans', () => {
  it('cells match parseTableRow exactly', () => {
    const lines = [
      '| a | b |',
      'x | y',
      '| a | b',
      '| x \\| y | `p|q` |',
      '**a | b** | c',
      '|',
      '   ',
      'plain text',
      '| --- | :---: |',
    ];
    for (const line of lines) {
      expect(splitRowSpans(line)?.cells ?? []).toEqual(parseTableRow(line));
    }
  });

  it('returns null for blank lines', () => {
    expect(splitRowSpans('')).toBeNull();
    expect(splitRowSpans('   ')).toBeNull();
  });

  it('reports field spans in passed-line coordinates', () => {
    //                         |  a  |  b  |
    // index:                  0 1 2 3 4 5 6 7 8
    const res = splitRowSpans('| a | b |')!;
    expect(res.cells).toEqual(['a', 'b']);
    expect(res.fields[0]).toEqual({ start: 1, end: 4 }); // ends at the pipe
    expect(res.fields[1]).toEqual({ start: 5, end: 8 });
  });

  it('keeps escaped pipes inside one field', () => {
    const res = splitRowSpans('| x \\| y |')!;
    expect(res.cells).toEqual(['x | y']);
    expect(res.fields).toHaveLength(1);
    expect(res.fields[0]).toEqual({ start: 1, end: 9 });
  });

  it('offsets spans by leading whitespace', () => {
    const res = splitRowSpans('  | a | b |')!;
    expect(res.fields[0]).toEqual({ start: 3, end: 6 });
    expect(res.fields[1]).toEqual({ start: 7, end: 10 });
  });

  it('bare row spans cover the whole trimmed line', () => {
    const res = splitRowSpans('x | y')!;
    expect(res.cells).toEqual(['x', 'y']);
    expect(res.fields[0]).toEqual({ start: 0, end: 2 });
    expect(res.fields[1]).toEqual({ start: 3, end: 5 });
  });
});

describe('displayWidth', () => {
  it('counts ASCII as 1', () => {
    expect(displayWidth('abc')).toBe(3);
  });
  it('counts CJK as 2', () => {
    expect(displayWidth('中文')).toBe(4);
    expect(displayWidth('a中')).toBe(3);
  });
  it('counts emoji (astral plane) as 2', () => {
    expect(displayWidth('😀')).toBe(2);
    expect(displayWidth('a😀')).toBe(3);
  });
});

describe('isSeparatorRow (exported)', () => {
  it('detects separator cells', () => {
    expect(isSeparatorRow(['---', ':---:', '---:'])).toBe(true);
    expect(isSeparatorRow(['a', '---'])).toBe(false);
  });
});

describe('markdownTableToMarkdown pad mode', () => {
  it('pads columns to display width, CJK-aware', () => {
    const out = markdownTableToMarkdown(
      { header: ['名字', '年龄'], rows: [['张三', '25'], ['李四五', '30']], alignments: [null, 'right'] },
      { pad: true },
    );
    expect(out).toBe(
      [
        '| 名字   | 年龄 |',
        '| ------ | ---: |',
        '| 张三   |   25 |',
        '| 李四五 |   30 |',
      ].join('\n'),
    );
  });

  it('keeps escaped pipes and code-span pipes verbatim', () => {
    // col0 width 6 (`x \| y`), col1 width 5 (`​`p|q`​` — backticked pipe stays).
    const out = markdownTableToMarkdown(
      { header: ['a', 'b'], rows: [['x | y', '`p|q`']], alignments: [null, null] },
      { pad: true },
    );
    expect(out).toBe(
      [
        '| a      | b     |',
        '| ------ | ----- |',
        '| x \\| y | `p|q` |',
      ].join('\n'),
    );
  });

  it('pads ragged rows without truncating wide rows', () => {
    const out = markdownTableToMarkdown(
      { header: ['a', 'b'], rows: [['1'], ['2', '3', '4']], alignments: [null, null] },
      { pad: true },
    );
    expect(out).toBe(
      [
        '| a   | b   |     |',
        '| --- | --- | --- |',
        '| 1   |     |     |',
        '| 2   | 3   | 4   |',
      ].join('\n'),
    );
  });

  it('compact mode output is unchanged (paste path)', () => {
    const out = markdownTableToMarkdown(
      { header: ['名字', '年龄'], rows: [['张三', '25'], ['李四五', '30']], alignments: [null, 'right'] },
    );
    expect(out).toBe(
      [
        '| 名字 | 年龄 |',
        '| --- | ---: |',
        '| 张三 | 25 |',
        '| 李四五 | 30 |',
      ].join('\n'),
    );
  });

  it('minimum separator width grows a narrow centered column', () => {
    // center alignment: min 3 dashes + 2 colons → column width 5.
    const out = markdownTableToMarkdown(
      { header: ['a'], rows: [['b']], alignments: ['center'] },
      { pad: true },
    );
    expect(out).toBe(['|   a   |', '| :---: |', '|   b   |'].join('\n'));
  });
});

// ── findTableAround ───────────────────────────────────────────────────────

describe('findTableAround', () => {
  it('finds the table block around a body-row cursor', () => {
    const doc = BASIC_TABLE;
    const pos = lineStart(doc, 2) + 4; // inside 张三
    const block = findTableAround(stateAt(doc, pos), pos)!;
    expect(block).not.toBeNull();
    expect(block.from).toBe(0);
    expect(block.to).toBe(doc.length);
    expect(block.grid).toEqual([['名字', '年龄'], ['张三', '25']]);
    expect(block.indent).toBe('');
  });

  it('finds the table when the cursor is in the header', () => {
    const doc = BASIC_TABLE;
    const pos = 3; // inside 名字
    const block = findTableAround(stateAt(doc, pos), pos)!;
    expect(block.grid).toEqual([['名字', '年龄'], ['张三', '25']]);
  });

  it('a prose line with pipes above the header is not part of the table', () => {
    const doc = ['hello | world', '| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n');
    const pos = lineStart(doc, 2) + 3; // in | a | b |
    const block = findTableAround(stateAt(doc, pos), pos)!;
    expect(block.from).toBe(lineStart(doc, 1));
  });

  it('cursor on the prose line above → null', () => {
    const doc = ['hello | world', '| a | b |', '| --- | --- |'].join('\n');
    const pos = 3;
    expect(findTableAround(stateAt(doc, pos), pos)).toBeNull();
  });

  it('blockquote-quoted table lines never start a run', () => {
    const doc = ['> | a | b |', '> | --- | --- |'].join('\n');
    const pos = 5;
    expect(findTableAround(stateAt(doc, pos), pos)).toBeNull();
  });

  it('captures the common indent of a list-item table', () => {
    const doc = ['- item', '  | a | b |', '  | --- | --- |', '  | 1 | 2 |'].join('\n');
    const pos = lineStart(doc, 3) + 6; // inside | 1 | 2 |
    const block = findTableAround(stateAt(doc, pos), pos)!;
    expect(block.indent).toBe('  ');
    expect(block.from).toBe(lineStart(doc, 1));
  });

  it('pipe-containing lines without a separator → null', () => {
    const doc = ['| a | b |', '| c | d |'].join('\n');
    const pos = 3;
    expect(findTableAround(stateAt(doc, pos), pos)).toBeNull();
  });

  it('lines below a blank line do not extend the table', () => {
    const doc = ['| a | b |', '| --- | --- |', '', '| x | y |'].join('\n');
    const pos = lineStart(doc, 1) + 3;
    const block = findTableAround(stateAt(doc, pos), pos)!;
    expect(block.to).toBe(lineStart(doc, 1) + '| --- | --- |'.length);
  });

  it('detects a block inside a code fence, but locate rejects it (see guards)', () => {
    const doc = ['```md', '| a | b |', '| --- | --- |', '```'].join('\n');
    const pos = lineStart(doc, 1) + 3;
    const state = stateAt(doc, pos, [markdown()]);
    // the block is structurally found…
    expect(findTableAround(state, pos)).not.toBeNull();
    // …but the key handlers reject it via insideCodeBlock — see "compute guards".
  });
});

// ── computeTableTabChange ─────────────────────────────────────────────────

describe('computeTableTabChange — Tab', () => {
  it('moves to the next cell and realigns (CJK widths)', () => {
    const doc = BASIC_TABLE;
    const pos = lineStart(doc, 2) + 3; // after 张 (inside 张三)
    const change = computeTableTabChange(stateAt(doc, pos), 'next')!;
    expect(change.kind).toBe('tab');
    expect(change.insert).toBe(REALIGNED_TABLE);
    expect(change.from).toBe(0);
    expect(change.to).toBe(doc.length);
    // cursor at the end of '25' on the realigned line 2
    expect(change.anchor).toBe(lineStart(REALIGNED_TABLE, 2) + 9);
  });

  it('end of the last row appends a row and jumps to its first cell', () => {
    const doc = BASIC_TABLE;
    const pos = lineStart(doc, 2) + 9; // after 25
    const change = computeTableTabChange(stateAt(doc, pos), 'next')!;
    expect(change.kind).toBe('tab');
    expect(change.insert).toBe([REALIGNED_TABLE, '|      |      |'].join('\n'));
    // appended row, first cell → right after '| '
    expect(change.anchor).toBe(lineStart(change.insert, 3) + 2);
  });

  it('Tab from a header cell navigates within the header', () => {
    const doc = BASIC_TABLE;
    const pos = 3; // inside 名字
    const change = computeTableTabChange(stateAt(doc, pos), 'next')!;
    expect(change.insert).toBe(REALIGNED_TABLE);
    expect(change.anchor).toBe(lineStart(REALIGNED_TABLE, 0) + 9); // after 年龄
  });

  it('Tab past the header of a header-only table appends the first body row', () => {
    const doc = ['| a | b |', '| --- | --- |'].join('\n');
    const pos = 8; // inside b (header cell 1, last)
    const change = computeTableTabChange(stateAt(doc, pos), 'next')!;
    expect(change.insert).toBe(['| a   | b   |', '| --- | --- |', '|     |     |'].join('\n'));
    // wraps past the header row → appended row, FIRST cell (after '| ')
    expect(change.anchor).toBe(lineStart(change.insert, 2) + 2);
  });
});

describe('computeTableTabChange — Shift-Tab', () => {
  it('moves to the previous cell', () => {
    const doc = BASIC_TABLE;
    const pos = lineStart(doc, 2) + 10; // after 25
    const change = computeTableTabChange(stateAt(doc, pos), 'prev')!;
    expect(change.kind).toBe('shift-tab');
    expect(change.insert).toBe(REALIGNED_TABLE);
    expect(change.anchor).toBe(lineStart(REALIGNED_TABLE, 2) + 4); // after 张三
  });

  it('first cell of a body row wraps to the header row, last cell', () => {
    const doc = BASIC_TABLE;
    const pos = lineStart(doc, 2) + 2; // inside 张三 (start)
    const change = computeTableTabChange(stateAt(doc, pos), 'prev')!;
    expect(change.kind).toBe('shift-tab');
    expect(change.anchor).toBe(lineStart(REALIGNED_TABLE, 0) + 9); // after 年龄
  });

  it('before the header row first cell → null (fall through)', () => {
    const doc = BASIC_TABLE;
    const pos = 2; // inside 名字
    expect(computeTableTabChange(stateAt(doc, pos), 'prev')).toBeNull();
  });
});

describe('compute guards', () => {
  it('cursor on the separator row → null', () => {
    const doc = BASIC_TABLE;
    const pos = lineStart(doc, 1) + 4; // inside | --- | ---
    expect(computeTableTabChange(stateAt(doc, pos), 'next')).toBeNull();
    expect(computeTableEnterChange(stateAt(doc, pos))).toBeNull();
  });

  it('cursor on the leading pipe / past the trailing pipe → null; on an interior pipe → left cell', () => {
    const doc = BASIC_TABLE;
    // ON the leading pipe (before the first field) → fall through
    expect(computeTableTabChange(stateAt(doc, 0), 'next')).toBeNull();
    // past the line end (after the trailing pipe) → fall through
    const line1End = lineStart(doc, 0) + '| 名字 | 年龄 |'.length;
    expect(computeTableTabChange(stateAt(doc, line1End), 'next')).toBeNull();
    // ON an interior pipe → belongs to the left cell, Tab moves to the right one
    const onPipe = computeTableTabChange(stateAt(doc, 5), 'next')!;
    expect(onPipe.kind).toBe('tab');
    expect(onPipe.anchor).toBe(lineStart(REALIGNED_TABLE, 0) + 9); // after 年龄
  });

  it('range selection → null', () => {
    const doc = BASIC_TABLE;
    const state = EditorState.create({ doc, selection: { anchor: 3, head: 5 } });
    expect(computeTableTabChange(state, 'next')).toBeNull();
    expect(computeTableEnterChange(state)).toBeNull();
  });

  it('non-table line → null', () => {
    const doc = 'plain text';
    expect(computeTableTabChange(stateAt(doc, 3), 'next')).toBeNull();
    expect(computeTableEnterChange(stateAt(doc, 3))).toBeNull();
  });

  it('table inside a code fence → null (locate guard, markdown language loaded)', () => {
    const doc = ['```md', '| a | b |', '| --- | --- |', '```'].join('\n');
    const pos = lineStart(doc, 1) + 3;
    const state = stateAt(doc, pos, [markdown()]);
    expect(computeTableTabChange(state, 'next')).toBeNull();
    expect(computeTableEnterChange(state)).toBeNull();
  });

  it('a table directly after a fence is not swallowed by it (cursor mid-cell)', () => {
    const doc = ['```md', 'x', '```', '| a | b |', '| --- | --- |'].join('\n');
    const pos = lineStart(doc, 3) + 3;
    const state = stateAt(doc, pos, [markdown()]);
    expect(computeTableTabChange(state, 'next')).not.toBeNull();
  });
});

// ── computeTableEnterChange ───────────────────────────────────────────────

describe('computeTableEnterChange', () => {
  it('mid-table: moves to the next row, same column', () => {
    const doc = ['| a | b |', '| --- | --- |', '| 1 | 2 |', '| 3 | 4 |'].join('\n');
    const pos = lineStart(doc, 2) + 6; // in | 1 | 2 |, after '2' (cell 1)
    const change = computeTableEnterChange(stateAt(doc, pos))!;
    expect(change.kind).toBe('enter');
    expect(change.insert).toBe(
      ['| a   | b   |', '| --- | --- |', '| 1   | 2   |', '| 3   | 4   |'].join('\n'),
    );
    // cursor in | 3 | 4 | cell 1 → after '4'
    expect(change.anchor).toBe(lineStart(change.insert, 3) + 9);
  });

  it('last row: appends an empty row, cursor same column', () => {
    const doc = ['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n');
    const pos = lineStart(doc, 2) + 6; // in | 1 | 2 |, after 2 (cell 1)
    const change = computeTableEnterChange(stateAt(doc, pos))!;
    expect(change.insert).toBe(
      ['| a   | b   |', '| --- | --- |', '| 1   | 2   |', '|     |     |'].join('\n'),
    );
    // appended row (line 3), cell 1 → right after '| ' of the second field
    expect(change.anchor).toBe(lineStart(change.insert, 3) + 8);
  });

  it('header row (no body): appends a row', () => {
    const doc = ['| a | b |', '| --- | --- |'].join('\n');
    const pos = 6; // in b
    const change = computeTableEnterChange(stateAt(doc, pos))!;
    expect(change.insert).toBe(['| a   | b   |', '| --- | --- |', '|     |     |'].join('\n'));
    expect(change.anchor).toBe(lineStart(change.insert, 2) + 8); // appended row, cell 1
  });

  it('all-empty body row: deletes the row, cursor exits the table', () => {
    const doc = ['| a | b |', '| --- | --- |', '|   |   |', 'after'].join('\n');
    const pos = lineStart(doc, 2) + 4; // in the empty row
    const change = computeTableEnterChange(stateAt(doc, pos))!;
    expect(change.kind).toBe('exit');
    expect(change.insert).toBe('');
    // delete range = the row's leading newline + its text
    expect(change.from).toBe(lineStart(doc, 1) + '| --- | --- |'.length);
    expect(change.to).toBe(lineStart(doc, 2) + '|   |   |'.length);
    // cursor at the start of 'after' (which moved up)
    expect(change.anchor).toBe(change.from + 1);
  });

  it('mid-table empty row: deletes it, cursor stays in the next row same column', () => {
    const doc = ['| a | b |', '| --- | --- |', '|   |   |', '| 1 | 2 |'].join('\n');
    const pos = lineStart(doc, 2) + 4;
    const change = computeTableEnterChange(stateAt(doc, pos))!;
    expect(change.kind).toBe('exit');
    expect(change.insert).toBe('');
    // cursor in | 1 | 2 | cell 0 → after '1' (offset 2 into the line that moved up)
    expect(change.anchor).toBe(change.from + 1 + 2);
  });

  it('empty row at doc end: deletes it, cursor at the previous line end', () => {
    const doc = ['| a | b |', '| --- | --- |', '|   |   |'].join('\n');
    const pos = lineStart(doc, 2) + 4;
    const change = computeTableEnterChange(stateAt(doc, pos))!;
    expect(change.kind).toBe('exit');
    expect(change.anchor).toBe(change.from);
  });
});

// ── keymap dispatch (real EditorView, jsdom) ──────────────────────────────

describe('keymap dispatch', () => {
  it('Tab beats indentWithTab and defaultKeymap (Prec.highest works)', () => {
    // Real app order: common keymap (defaultKeymap + indentWithTab) FIRST,
    // markdownTableExtension AFTER. Without Prec.highest this is dead code
    // (the keymap-facet-order trap; see the extension's header comment).
    const view = makeView(BASIC_TABLE, lineStart(BASIC_TABLE, 2) + 3, [
      keymap.of([...defaultKeymap, indentWithTab]),
      ...markdownTableExtension,
    ]);
    expect(handleTableTab(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(REALIGNED_TABLE);
    view.destroy();
  });

  it('Tab via real keydown event dispatches and moves the cursor', () => {
    const view = makeView(BASIC_TABLE, lineStart(BASIC_TABLE, 2) + 3, [
      keymap.of([...defaultKeymap, indentWithTab]),
      ...markdownTableExtension,
    ]);
    view.focus();
    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    expect(view.state.doc.toString()).toBe(REALIGNED_TABLE);
    expect(view.state.selection.main.head).toBe(lineStart(REALIGNED_TABLE, 2) + 9);
    view.destroy();
  });

  it('Enter via real keydown event appends a row on the last row', () => {
    const view = makeView(BASIC_TABLE, lineStart(BASIC_TABLE, 2) + 9, [
      keymap.of([...defaultKeymap, indentWithTab]),
      ...markdownTableExtension,
    ]);
    view.focus();
    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(view.state.doc.toString()).toBe([REALIGNED_TABLE, '|      |      |'].join('\n'));
    view.destroy();
  });

  it('Tab outside a table falls through (returns false, doc unchanged)', () => {
    const view = makeView('plain text', 3, [
      keymap.of([...defaultKeymap, indentWithTab]),
      ...markdownTableExtension,
    ]);
    expect(handleTableTab(view)).toBe(false);
    expect(view.state.doc.toString()).toBe('plain text');
    view.destroy();
  });

  it('Shift-Tab in a table works via handler', () => {
    const view = makeView(BASIC_TABLE, lineStart(BASIC_TABLE, 2) + 10);
    expect(handleTableShiftTab(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(REALIGNED_TABLE);
    expect(view.state.selection.main.head).toBe(lineStart(REALIGNED_TABLE, 2) + 4);
    view.destroy();
  });

  it('Enter on an empty row deletes it (handler)', () => {
    const doc = ['| a | b |', '| --- | --- |', '|   |   |', 'after'].join('\n');
    const view = makeView(doc, lineStart(doc, 2) + 4);
    expect(handleTableEnter(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(['| a | b |', '| --- | --- |', 'after'].join('\n'));
    view.destroy();
  });
});
