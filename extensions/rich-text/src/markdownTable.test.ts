import { describe, it, expect } from 'vitest';
import {
  normalizeTableText,
  parseTableRow,
  separatorAlignment,
  detectMarkdownTable,
  cellToInlineContent,
  markdownTableToTiptap,
  detectTsvTable,
  tsvTableToTiptap,
  markdownTableToMarkdown,
  tsvTableToMarkdown,
  parseCsvRow,
  detectCsvTable,
  csvTableToTiptap,
  csvTableToMarkdown,
} from './markdownTable';
import { detectPasteTable } from './markdownTablePaste';

// ── normalizeTableText ────────────────────────────────────────────────────

describe('normalizeTableText', () => {
  it('converts CRLF and CR to LF', () => {
    expect(normalizeTableText('a\r\nb\rc')).toBe('a\nb\nc');
  });
  it('replaces NBSP with normal space', () => {
    expect(normalizeTableText('a\u00A0b')).toBe('a b');
  });
  it('trims outer whitespace', () => {
    expect(normalizeTableText('  \n| a |\n  ')).toBe('| a |');
  });
  it('does not collapse internal spaces', () => {
    expect(normalizeTableText('| a   b |')).toBe('| a   b |');
  });
});

// ── parseTableRow ──────────────────────────────────────────────────────────

describe('parseTableRow', () => {
  it('splits a standard piped row', () => {
    expect(parseTableRow('| a | b |')).toEqual(['a', 'b']);
  });
  it('splits a bare row (no outer pipes)', () => {
    expect(parseTableRow('a | b', { allowBare: true })).toEqual(['a', 'b']);
  });
  it('keeps an escaped pipe in the cell', () => {
    expect(parseTableRow('| hello \\| world | bye |')).toEqual([
      'hello | world',
      'bye',
    ]);
  });
  it('keeps a pipe inside an inline code span', () => {
    expect(parseTableRow('| test | `a | b` |')).toEqual(['test', '`a | b`']);
  });
  it('preserves inline markdown inside cells', () => {
    expect(parseTableRow('| **bold** | `code` |')).toEqual(['**bold**', '`code`']);
  });
  it('handles empty cells', () => {
    expect(parseTableRow('|  | test |')).toEqual(['', 'test']);
  });
  it('trims padding around cells', () => {
    expect(parseTableRow('|   spaced   |')).toEqual(['spaced']);
  });
  it('returns [] for an empty line', () => {
    expect(parseTableRow('')).toEqual([]);
  });
});

// ── separatorAlignment ────────────────────────────────────────────────────

describe('separatorAlignment', () => {
  it('null for plain ---', () => {
    expect(separatorAlignment('---')).toBeNull();
  });
  it('left for :---', () => {
    expect(separatorAlignment(':---')).toBe('left');
  });
  it('right for ---:', () => {
    expect(separatorAlignment('---:')).toBe('right');
  });
  it('center for :---:', () => {
    expect(separatorAlignment(':---:')).toBe('center');
  });
  it('treats a too-short separator (--) as no explicit alignment', () => {
    // -- is not a valid separator cell at the detector level (needs >=3
    // hyphens), but separatorAlignment only inspects colons, so it returns
    // null (no explicit alignment marker) for a plain --.
    expect(separatorAlignment('--')).toBeNull();
  });
});

// ── detectMarkdownTable ───────────────────────────────────────────────────

describe('detectMarkdownTable', () => {
  it('detects a standard table', () => {
    const r = detectMarkdownTable('| A | B |\n| --- | --- |\n| 1 | 2 |');
    expect(r.matched).toBe(true);
    expect(r.confidence).toBe(100);
    expect(r.table).toEqual({
      header: ['A', 'B'],
      rows: [['1', '2']],
      alignments: [null, null],
    });
  });

  it('detects a bare table (no outer pipes) at confidence 90', () => {
    const r = detectMarkdownTable('A | B\n--- | ---\n1 | 2');
    expect(r.matched).toBe(true);
    expect(r.confidence).toBe(90);
    expect(r.table).toEqual({
      header: ['A', 'B'],
      rows: [['1', '2']],
      alignments: [null, null],
    });
  });

  it('parses alignment syntax', () => {
    const r = detectMarkdownTable(
      '| A | B | C |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |',
    );
    expect(r.table?.alignments).toEqual(['left', 'center', 'right']);
  });

  it('pads missing trailing empty cells', () => {
    const r = detectMarkdownTable('| A | B | C |\n| --- | --- | --- |\n| 1 | 2 |');
    expect(r.table?.rows[0]).toEqual(['1', '2', '']);
  });

  it('handles empty cells', () => {
    const r = detectMarkdownTable('| A | B |\n| --- | --- |\n|  | test |');
    expect(r.table?.rows[0]).toEqual(['', 'test']);
  });

  it('handles empty header cells', () => {
    const r = detectMarkdownTable('| A | | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |');
    expect(r.table?.header).toEqual(['A', '', 'C']);
  });

  it('keeps inline code containing pipes', () => {
    const r = detectMarkdownTable('| A | B |\n| --- | --- |\n| test | `a | b` |');
    expect(r.table?.rows[0][1]).toBe('`a | b`');
  });

  it('keeps escaped pipes', () => {
    const r = detectMarkdownTable('| A | B |\n| --- | --- |\n| test | hello \\| world |');
    expect(r.table?.rows[0][1]).toBe('hello | world');
  });

  it('handles Chinese content', () => {
    const r = detectMarkdownTable('| 名称 | 描述 |\n| --- | --- |\n| Quill | 多文件编辑器 |');
    expect(r.matched).toBe(true);
    expect(r.table?.header).toEqual(['名称', '描述']);
    expect(r.table?.rows[0]).toEqual(['Quill', '多文件编辑器']);
  });

  it('ignores leading/trailing blank lines', () => {
    const r = detectMarkdownTable('\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n');
    expect(r.matched).toBe(true);
  });

  it('stops the table at a blank line in the body', () => {
    const r = detectMarkdownTable('| A | B |\n| --- | --- |\n| 1 | 2 |\n\n| x | y |');
    expect(r.table?.rows).toEqual([['1', '2']]);
  });

  it('preserves inline markdown in cells', () => {
    const r = detectMarkdownTable('| **正常退出** | `stop` |\n| --- | --- |\n| a | b |');
    expect(r.table?.header).toEqual(['**正常退出**', '`stop`']);
  });

  it('does NOT match plain text with pipes', () => {
    expect(detectMarkdownTable('A | B | C').matched).toBe(false);
  });

  it('does NOT match a shell pipe', () => {
    expect(detectMarkdownTable('cat file.txt | grep test').matched).toBe(false);
  });

  it('does NOT match a JS OR operator', () => {
    expect(detectMarkdownTable('a || b').matched).toBe(false);
  });

  it('does NOT match a table with a non-separator second row', () => {
    const r = detectMarkdownTable('| Name | Value |\n| foo  | bar   |\n| 1 | 2 |');
    expect(r.matched).toBe(false);
    expect(r.reason).toContain('separator');
  });

  it('does NOT match a single line', () => {
    expect(detectMarkdownTable('| A | B |').matched).toBe(false);
  });

  it('requires separator column count to match header', () => {
    const r = detectMarkdownTable('| A | B |\n| --- | --- | --- |\n| 1 | 2 |');
    expect(r.matched).toBe(false);
  });
});

// ── cellToInlineContent ────────────────────────────────────────────────────

describe('cellToInlineContent', () => {
  it('returns [] for an empty cell', () => {
    expect(cellToInlineContent('')).toEqual([]);
  });

  it('parses plain text', () => {
    expect(cellToInlineContent('hello')).toEqual([
      { type: 'text', text: 'hello' },
    ]);
  });

  it('parses bold', () => {
    const out = cellToInlineContent('**bold**');
    expect(out).toEqual([
      { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
    ]);
  });

  it('parses italic', () => {
    const out = cellToInlineContent('*italic*');
    expect(out).toEqual([
      { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
    ]);
  });

  it('parses strikethrough (gfm)', () => {
    const out = cellToInlineContent('~~strike~~');
    expect(out).toEqual([
      { type: 'text', text: 'strike', marks: [{ type: 'strike' }] },
    ]);
  });

  it('parses inline code', () => {
    const out = cellToInlineContent('`code`');
    expect(out).toEqual([
      { type: 'text', text: 'code', marks: [{ type: 'code' }] },
    ]);
  });

  it('parses a link', () => {
    const out = cellToInlineContent('[link](https://example.com)');
    expect(out).toEqual([
      {
        type: 'text',
        text: 'link',
        marks: [
          {
            type: 'link',
            attrs: {
              href: 'https://example.com',
              target: '_blank',
              rel: 'noopener noreferrer nofollow',
              class: null,
            },
          },
        ],
      },
    ]);
  });

  it('mixes plain text and marks', () => {
    const out = cellToInlineContent('a **b** c');
    expect(out).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' c' },
    ]);
  });
});

// ── markdownTableToTiptap ─────────────────────────────────────────────────

describe('markdownTableToTiptap', () => {
  it('builds a table node with header + body rows', () => {
    const node = markdownTableToTiptap({
      header: ['A', 'B'],
      rows: [['1', '2']],
      alignments: [null, null],
    });
    expect(node.type).toBe('table');
    expect(node.content).toHaveLength(2);
    const headerRow = node.content![0];
    expect(headerRow.type).toBe('tableRow');
    expect(headerRow.content![0].type).toBe('tableHeader');
    expect(headerRow.content![1].type).toBe('tableHeader');
    const bodyRow = node.content![1];
    expect(bodyRow.content![0].type).toBe('tableCell');
    expect(bodyRow.content![0].content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: '1' }] },
    ]);
  });

  it('applies alignment as a cell attr', () => {
    const node = markdownTableToTiptap({
      header: ['A', 'B', 'C'],
      rows: [['1', '2', '3']],
      alignments: ['left', 'center', 'right'],
    });
    const headerRow = node.content![0];
    expect(headerRow.content![0].attrs).toEqual({ align: 'left' });
    expect(headerRow.content![1].attrs).toEqual({ align: 'center' });
    expect(headerRow.content![2].attrs).toEqual({ align: 'right' });
  });

  it('omits attrs when alignment is null', () => {
    const node = markdownTableToTiptap({
      header: ['A'],
      rows: [['1']],
      alignments: [null],
    });
    expect(node.content![0].content![0].attrs).toBeUndefined();
  });

  it('preserves inline markdown marks in header + body cells', () => {
    const node = markdownTableToTiptap({
      header: ['**正常退出**', '`stop`'],
      rows: [['a', 'b']],
      alignments: [null, null],
    });
    const headerCell0 = node.content![0].content![0].content![0];
    expect(headerCell0).toEqual({
      type: 'paragraph',
      content: [
        { type: 'text', text: '正常退出', marks: [{ type: 'bold' }] },
      ],
    });
    const headerCell1 = node.content![0].content![1].content![0];
    expect(headerCell1).toEqual({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'stop', marks: [{ type: 'code' }] },
      ],
    });
  });

  it('renders an empty cell as an empty paragraph', () => {
    const node = markdownTableToTiptap({
      header: ['A', ''],
      rows: [['1', '2']],
      alignments: [null, null],
    });
    const emptyHeaderCell = node.content![0].content![1];
    expect(emptyHeaderCell.content).toEqual([{ type: 'paragraph' }]);
  });
});

// ── detectPasteTable ──────────────────────────────────────────────────────

describe('detectPasteTable', () => {
  class FakeDataTransfer {
    private store: Record<string, string> = {};
    setData(type: string, value: string): void { this.store[type] = value; }
    getData(type: string): string { return this.store[type] ?? ''; }
  }
  function makeClipboard(text: string, html?: string): FakeDataTransfer {
    const dt = new FakeDataTransfer();
    dt.setData('text/plain', text);
    if (html) dt.setData('text/html', html);
    return dt;
  }

  it('detects a markdown table and flags it as markdown source', () => {
    const dt = makeClipboard('| A | B |\n| --- | --- |\n| 1 | 2 |');
    const r = detectPasteTable(dt);
    expect(r).not.toBeNull();
    expect(r!.tableNode.type).toBe('table');
    expect(r!.isMarkdownSource).toBe(true);
    expect(r!.summary).toBe('2 columns × 2 rows');
    expect(r!.rawText).toContain('| --- |');
  });

  it('detects a TSV table and flags it as non-markdown source', () => {
    const tsv = '维度差在哪举个例子\t\t\n消息格式\t同一条消息\tAnthropic 用 content[]';
    const dt = makeClipboard(tsv, '<table><tr><td>x</td></tr></table>');
    const r = detectPasteTable(dt);
    expect(r).not.toBeNull();
    expect(r!.isMarkdownSource).toBe(false);
    expect(r!.tableNode.content![0].content).toHaveLength(3);
  });

  it('returns null for non-table plain text', () => {
    expect(detectPasteTable(makeClipboard('just some text'))).toBeNull();
  });

  it('defers only for a ProseMirror-native table copy (data-pm-slice)', () => {
    const dt = makeClipboard(
      '| A | B |',
      '<table data-pm-slice="1 1 []"><tr><td>A</td><td>B</td></tr></table>',
    );
    expect(detectPasteTable(dt)).toBeNull();
  });

  it('converts a markdown table even when HTML carries an external <table>', () => {
    const dt = makeClipboard(
      '| A | B |\n| --- | --- |\n| 1 | 2 |',
      '<table><tr><td>A</td><td>B</td></tr></table>',
    );
    expect(detectPasteTable(dt)!.tableNode.type).toBe('table');
  });

  it('returns null when HTML is only a text wrapper (no <table>)', () => {
    expect(detectPasteTable(makeClipboard('not a table', '<p>not a table</p>'))).toBeNull();
  });

  it('returns null for an empty clipboard', () => {
    expect(detectPasteTable(new FakeDataTransfer())).toBeNull();
  });

  it('detects a CSV table and flags it as non-markdown source', () => {
    const dt = makeClipboard('name,age\nlinyimin,18');
    const r = detectPasteTable(dt);
    expect(r).not.toBeNull();
    expect(r!.tableNode.type).toBe('table');
    expect(r!.isMarkdownSource).toBe(false);
    expect(r!.summary).toBe('2 columns × 2 rows');
    // header is a tableHeader cell with "name"
    const head = r!.tableNode.content![0].content![0].content![0];
    expect(head).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'name' }],
    });
  });
});

// ── task example (end-to-end) ─────────────────────────────────────────────

describe('task example end-to-end', () => {
  const input =
    '| **退出路径|触发条件|原因** |                                                    |                                |\n' +
    '| -------------- | -------------------------------------------------- | ------------------------------ |\n' +
    '| **正常退出**       | `stop` / `length` + 无 followUp + 无 pendingMessages | 最常见。模型没要工具，也没追加任务              |\n' +
    '| **硬停止**        | `error` / `aborted`                                | 模型调用本身出了问题，继续跑没意义，不检查 followUp |\n' +
    '| **外部钩子停**      | `shouldStopAfterTurn()` 返回 true                    | 上下文快满了、达到最大 Turn 数等            |\n' +
    '| **工具终止**       | 一批工具的执行结果全部 `terminate: true`              | 所有工具都同意停止（是 \`every\` 不是 \`some\`） |';

  it('detects 3 columns, 1 header row, 4 body rows', () => {
    const r = detectMarkdownTable(input);
    expect(r.matched).toBe(true);
    expect(r.table?.header).toHaveLength(3);
    expect(r.table?.rows).toHaveLength(4);
    expect(r.table?.rows[0]).toHaveLength(3);
  });

  it('preserves inline markdown in header + body cells', () => {
    const r = detectMarkdownTable(input);
    expect(r.table!.header[0]).toBe('**退出路径|触发条件|原因**');
    // The first body row preserves **bold** and `code` inline syntax verbatim
    expect(r.table!.rows[0][0]).toBe('**正常退出**');
    expect(r.table!.rows[0][1]).toContain('`stop`');
    expect(r.table!.rows[3][1]).toContain('`terminate: true`');
  });

  it('converts to a tiptap table with bold + code marks', () => {
    const r = detectMarkdownTable(input);
    const node = markdownTableToTiptap(r.table!);
    expect(node.type).toBe('table');
    expect(node.content).toHaveLength(5); // 1 header + 4 body
    const body0 = node.content![1].content![0].content![0];
    expect(body0).toEqual({
      type: 'paragraph',
      content: [
        { type: 'text', text: '正常退出', marks: [{ type: 'bold' }] },
      ],
    });
  });
});

// ── detectTsvTable / tsvTableToTiptap ─────────────────────────────────────

describe('detectTsvTable', () => {
  it('detects a chrome-rendered table (tabs, no markdown)', () => {
    const tsv =
      '维度差在哪举个例子\t\t\n' +
      '消息格式\t同一条消息\tAnthropic 用 content[]';
    const r = detectTsvTable(tsv);
    expect(r).not.toBeNull();
    expect(r!.header).toEqual(['维度差在哪举个例子', '', '']);
    expect(r!.rows[0]).toEqual(['消息格式', '同一条消息', 'Anthropic 用 content[]']);
  });

  it('returns null for a single line with a tab', () => {
    expect(detectTsvTable('just\ta single line')).toBeNull();
  });

  it('returns null for ragged rows (different column counts)', () => {
    expect(detectTsvTable('a\tb\tc\n1\t2')).toBeNull();
  });

  it('returns null when the first line has no tab', () => {
    expect(detectTsvTable('no tabs here\nstill no tabs')).toBeNull();
  });

  it('returns null for empty text', () => {
    expect(detectTsvTable('')).toBeNull();
  });

  it('trims surrounding whitespace from cells', () => {
    const r = detectTsvTable('  a  \t  b  \n 1 \t 2 ');
    expect(r!.header).toEqual(['a', 'b']);
    expect(r!.rows[0]).toEqual(['1', '2']);
  });
});

describe('tsvTableToTiptap', () => {
  it('builds a table node with header + body rows', () => {
    const node = tsvTableToTiptap({
      header: ['A', 'B'],
      rows: [['1', '2']],
    });
    expect(node.type).toBe('table');
    expect(node.content).toHaveLength(2);
    expect(node.content![0].content![0].type).toBe('tableHeader');
    expect(node.content![1].content![0].type).toBe('tableCell');
    expect(node.content![1].content![0].content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: '1' }] },
    ]);
  });

  it('parses inline markdown in TSV cells', () => {
    const node = tsvTableToTiptap({
      header: ['**bold**'],
      rows: [['`code`']],
    });
    expect(node.content![0].content![0].content![0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'bold', marks: [{ type: 'bold' }] }],
    });
    expect(node.content![1].content![0].content![0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'code', marks: [{ type: 'code' }] }],
    });
  });
});

// ── markdownTableToMarkdown / tsvTableToMarkdown ──────────────────────────

describe('markdownTableToMarkdown', () => {
  it('renders a canonical markdown table', () => {
    const md = markdownTableToMarkdown({
      header: ['A', 'B'],
      rows: [['1', '2']],
      alignments: [null, null],
    });
    expect(md).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |');
  });

  it('renders alignment markers', () => {
    const md = markdownTableToMarkdown({
      header: ['A', 'B', 'C'],
      rows: [['1', '2', '3']],
      alignments: ['left', 'center', 'right'],
    });
    expect(md).toBe('| A | B | C |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |');
  });

  it('escapes bare pipes inside cells', () => {
    const md = markdownTableToMarkdown({
      header: ['a|b'],
      rows: [['1']],
      alignments: [null],
    });
    expect(md).toBe('| a\\|b |\n| --- |\n| 1 |');
  });

  it('does NOT escape pipes inside inline code spans', () => {
    const md = markdownTableToMarkdown({
      header: ['`x | y`'],
      rows: [['1']],
      alignments: [null],
    });
    expect(md).toBe('| `x | y` |\n| --- |\n| 1 |');
  });

  it('round-trips a detected markdown table back to source', () => {
    const input = '| **正常退出** | `stop` |\n| --- | --- |\n| a | b |';
    const r = detectMarkdownTable(input);
    expect(r.matched).toBe(true);
    const md = markdownTableToMarkdown(r.table!);
    // Re-detect: the canonical form should still be a valid markdown table.
    const r2 = detectMarkdownTable(md);
    expect(r2.matched).toBe(true);
    expect(r2.table!.header).toEqual(['**正常退出**', '`stop`']);
  });
});

describe('tsvTableToMarkdown', () => {
  it('renders a chrome-rendered table as markdown source', () => {
    const md = tsvTableToMarkdown({
      header: ['Mode', 'Parameter', 'Description'],
      rows: [
        ['Single', '{ agent, task }', 'One agent, one task'],
        ['Parallel', '{ tasks: [...] }', 'Multiple agents run concurrently'],
      ],
    });
    expect(md).toBe(
      '| Mode | Parameter | Description |\n' +
      '| --- | --- | --- |\n' +
      '| Single | { agent, task } | One agent, one task |\n' +
      '| Parallel | { tasks: [...] } | Multiple agents run concurrently |',
    );
  });

  it('round-trips a detected TSV table into a valid markdown table', () => {
    const tsv =
      'Mode\tParameter\tDescription\nSingle\t{ agent, task }\tOne agent, one task';
    const r = detectTsvTable(tsv);
    expect(r).not.toBeNull();
    const md = tsvTableToMarkdown(r!);
    const mdTable = detectMarkdownTable(md);
    expect(mdTable.matched).toBe(true);
    expect(mdTable.table!.header).toEqual(['Mode', 'Parameter', 'Description']);
  });
});

// ── parseCsvRow / detectCsvTable / csvTableTo* ────────────────────────────

describe('parseCsvRow', () => {
  it('splits a simple row', () => {
    expect(parseCsvRow('a,b,c')).toEqual(['a', 'b', 'c']);
  });
  it('keeps an empty cell', () => {
    expect(parseCsvRow('a,,c')).toEqual(['a', '', 'c']);
  });
  it('keeps a comma inside a quoted field', () => {
    expect(parseCsvRow('"a,b",c')).toEqual(['a,b', 'c']);
  });
  it('unescapes doubled quotes', () => {
    expect(parseCsvRow('"he said ""hi""",c')).toEqual(['he said "hi"', 'c']);
  });
  it('handles a single field with no comma', () => {
    expect(parseCsvRow('hello')).toEqual(['hello']);
  });
});

describe('detectCsvTable', () => {
  it('detects a simple csv table', () => {
    const r = detectCsvTable('name,age\nlinyimin,18');
    expect(r).not.toBeNull();
    expect(r!.header).toEqual(['name', 'age']);
    expect(r!.rows[0]).toEqual(['linyimin', '18']);
  });

  it('detects a csv table with quoted fields', () => {
    const r = detectCsvTable('name,desc\n"a,b",hello\nx,"y,z"');
    expect(r).not.toBeNull();
    expect(r!.rows[0]).toEqual(['a,b', 'hello']);
    expect(r!.rows[1]).toEqual(['x', 'y,z']);
  });

  it('detects a csv table with escaped quotes', () => {
    const r = detectCsvTable('name,desc\nx,"he said ""hi"""');
    expect(r!.rows[0][1]).toBe('he said "hi"');
  });

  it('returns null for a single line with a comma', () => {
    expect(detectCsvTable('just, a line')).toBeNull();
  });

  it('returns null when the first line has no comma', () => {
    expect(detectCsvTable('no comma here\nstill no comma')).toBeNull();
  });

  it('returns null for ragged rows (different column counts)', () => {
    expect(detectCsvTable('a,b,c\n1,2')).toBeNull();
  });

  it('returns null for empty text', () => {
    expect(detectCsvTable('')).toBeNull();
  });

  it('returns null for a single-column file (no comma)', () => {
    expect(detectCsvTable('name\nlinyimin')).toBeNull();
  });

  it('returns null for plain prose with a comma', () => {
    expect(detectCsvTable('Hello, world.\nThis is a sentence.')).toBeNull();
  });
});

describe('csvTableToTiptap', () => {
  it('builds a table node with header + body rows', () => {
    const node = csvTableToTiptap({ header: ['name', 'age'], rows: [['linyimin', '18']] });
    expect(node.type).toBe('table');
    expect(node.content).toHaveLength(2);
    expect(node.content![0].content![0].type).toBe('tableHeader');
    expect(node.content![1].content![0].content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'linyimin' }] },
    ]);
  });
});

describe('csvTableToMarkdown', () => {
  it('renders a canonical markdown table', () => {
    const md = csvTableToMarkdown({ header: ['name', 'age'], rows: [['linyimin', '18']] });
    expect(md).toBe('| name | age |\n| --- | --- |\n| linyimin | 18 |');
  });

  it('round-trips a detected csv table into a valid markdown table', () => {
    const r = detectCsvTable('name,age\nlinyimin,18');
    const md = csvTableToMarkdown(r!);
    const mdTable = detectMarkdownTable(md);
    expect(mdTable.matched).toBe(true);
    expect(mdTable.table!.header).toEqual(['name', 'age']);
  });
});
