import { describe, it, expect } from 'vitest';
import {
  normalizeTableText,
  parseTableRow,
  separatorAlignment,
  detectMarkdownTable,
  detectTsvTable,
  markdownTableToMarkdown,
  tsvTableToMarkdown,
} from './markdownTable';

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

