import { EditorView, keymap } from '@codemirror/view';
import { type EditorState, Prec } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import {
  splitRowSpans,
  isSeparatorRow,
  separatorAlignment,
  markdownTableToMarkdown,
  type ColumnAlignment,
  type ParsedMarkdownTable,
} from '@folyn/extension-rich-text/src/markdownTable';

/**
 * Markdown source-mode table editing assistance.
 *
 * Hijacks Tab / Shift-Tab / Enter only when the cursor sits inside a cell
 * of a piped GFM table (header + separator + rows; every line starts with
 * `|` after its indent). Everything else — prose, bare tables, blockquoted
 * tables, code fences, the separator row itself, cursors on a pipe —
 * returns false and falls through to the default keymap:
 *
 *   Tab        → next cell; row end wraps to the next row; past the last
 *                row appends an empty row and jumps to its first cell
 *   Shift-Tab  → previous cell; before the table's first cell falls through
 *   Enter      → next row, same column; on the last row appends a row; on
 *                an all-empty body row deletes it and exits the table
 *
 * Every hijacked key realigns the whole table block: columns padded to
 * their display width (CJK = 2 cells, see markdownTable.displayWidth),
 * separator alignment markers kept, the block's common indent re-prefixed
 * (list-item tables survive). One dispatch = one undo step.
 *
 * ponytail: `Prec.highest` is REQUIRED — keymap facet order is registration
 * order within a precedence level, and defaultKeymap (Enter → newline,
 * indentWithTab → Tab) is registered in commonExtensions BEFORE this
 * extension. Plain `keymap.of` here would be dead code (the same trap the
 * list extensions fell into; EscExit/CodeBlock already use Prec.highest).
 * Autocomplete's completion keymap is also Prec.highest but registered
 * EARLIER (commonExtensions), so when a completion tooltip is active its
 * Tab/Enter accept runs first — desirable, no conflict.
 */

interface TableLine {
  from: number;
  to: number;
  text: string;
  kind: 'header' | 'sep' | 'row';
}

interface TableBlock {
  from: number;
  to: number;
  /** Common leading whitespace of all table lines (re-prefixed on emit). */
  indent: string;
  lines: TableLine[];
  /** Header + body cell texts, one array per grid row (grid row 0 = header). */
  grid: string[][];
  alignments: ColumnAlignment[];
}

export interface TableChange {
  from: number;
  to: number;
  insert: string;
  anchor: number;
  kind: 'tab' | 'shift-tab' | 'enter' | 'exit';
}

/** Row-like for run expansion: piped style only (bare tables fall through —
 *  a `> | a |` blockquote line or list marker must never join a table run). */
function isRowLine(text: string): boolean {
  return text.trimStart().startsWith('|');
}

function commonIndent(texts: string[]): string {
  let indent = texts[0].match(/^[ \t]*/)![0];
  for (const t of texts.slice(1)) {
    const ind = t.match(/^[ \t]*/)![0];
    let k = 0;
    while (k < indent.length && k < ind.length && indent[k] === ind[k]) k++;
    indent = indent.slice(0, k);
    if (indent === '') break;
  }
  return indent;
}

/** True when `pos` sits inside a fenced/indented code block. */
function insideCodeBlock(state: EditorState, pos: number): boolean {
  // any: SyntaxNode isn't exported by this @codemirror/language version;
  // the loop's null guard keeps the walk safe (same as EditorView.tsx).
  let node: any = syntaxTree(state).resolveInner(pos, -1);
  while (node) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') return true;
    node = node.parent;
  }
  return false;
}

/**
 * Find the GFM table block around `pos`, or null. The maximal run of
 * row-like lines is scanned for the first (line, separator) pair — that
 * line is the header, every row-like line below is the body (GFM: later
 * separator-looking lines are data rows). Lines above the pair are an
 * ordinary paragraph; the cursor must be on the header line or below to
 * count as "in the table".
 */
export function findTableAround(state: EditorState, pos: number): TableBlock | null {
  const doc = state.doc;
  const cursorNo = doc.lineAt(pos).number;
  if (!isRowLine(doc.line(cursorNo).text)) return null;

  let startNo = cursorNo;
  while (startNo > 1 && isRowLine(doc.line(startNo - 1).text)) startNo--;
  let endNo = cursorNo;
  while (endNo < doc.lines && isRowLine(doc.line(endNo + 1).text)) endNo++;

  let headerNo = -1;
  for (let n = startNo; n + 1 <= endNo; n++) {
    const cells = splitRowSpans(doc.line(n + 1).text)?.cells ?? [];
    if (isSeparatorRow(cells)) {
      headerNo = n;
      break;
    }
  }
  if (headerNo === -1 || cursorNo < headerNo) return null;

  const headerLine = doc.line(headerNo);
  const sepLine = doc.line(headerNo + 1);
  const headerRes = splitRowSpans(headerLine.text);
  const sepRes = splitRowSpans(sepLine.text);
  if (!headerRes || !sepRes || !isSeparatorRow(sepRes.cells)) return null;

  const lines: TableLine[] = [
    { from: headerLine.from, to: headerLine.to, text: headerLine.text, kind: 'header' },
    { from: sepLine.from, to: sepLine.to, text: sepLine.text, kind: 'sep' },
  ];
  const grid: string[][] = [headerRes.cells];
  const alignments = sepRes.cells.map(separatorAlignment);
  for (let n = headerNo + 2; n <= endNo; n++) {
    const line = doc.line(n);
    const res = splitRowSpans(line.text);
    if (!res) break; // blank line ends the table
    lines.push({ from: line.from, to: line.to, text: line.text, kind: 'row' });
    grid.push(res.cells);
  }

  return {
    from: lines[0].from,
    to: lines[lines.length - 1].to,
    indent: commonIndent(lines.map((l) => l.text)),
    lines,
    grid,
    alignments,
  };
}

/**
 * Grid coordinate of the cursor's cell, or null (separator line, cursor on
 * a pipe or outside the block). Grid rows: header = 0, body rows 1+.
 */
function cellRefAt(state: EditorState, block: TableBlock, pos: number): { row: number; col: number } | null {
  const line = state.doc.lineAt(pos);
  const lineIdx = block.lines.findIndex((l) => l.from === line.from);
  if (lineIdx === -1) return null;
  if (block.lines[lineIdx].kind === 'sep') return null;
  const res = splitRowSpans(line.text);
  if (!res) return null;
  const c = pos - line.from;
  for (let k = 0; k < res.fields.length; k++) {
    const f = res.fields[k];
    // Inclusive of end: a cursor on a pipe belongs to the left cell.
    if (c >= f.start && c <= f.end) {
      const row = lineIdx === 0 ? 0 : lineIdx - 1;
      return { row, col: k };
    }
  }
  return null;
}

function locate(state: EditorState): { block: TableBlock; cell: { row: number; col: number } } | null {
  const sel = state.selection.main;
  if (sel.from !== sel.to) return null;
  if (state.readOnly) return null;
  const pos = sel.head;
  if (insideCodeBlock(state, pos)) return null;
  const block = findTableAround(state, pos);
  if (!block) return null;
  const cell = cellRefAt(state, block, pos);
  if (!cell) return null;
  return { block, cell };
}

function gridCols(block: TableBlock): number {
  return block.grid.reduce((m, r) => Math.max(m, r.length), 0);
}

/** Render the block's grid (+ optional appended empty row) as padded
 *  markdown lines, each prefixed with the block's common indent. */
function formatBlockLines(block: TableBlock, appendEmptyRow: boolean): string[] {
  const grid = appendEmptyRow
    ? [...block.grid, new Array<string>(gridCols(block)).fill('')]
    : block.grid;
  const table: ParsedMarkdownTable = { header: grid[0], rows: grid.slice(1), alignments: block.alignments };
  return markdownTableToMarkdown(table, { pad: true })
    .split('\n')
    .map((l) => block.indent + l);
}

/** Grid row → raw line index in the formatted block (header 0, sep 1). */
function lineIndexForGridRow(gridRow: number): number {
  return gridRow === 0 ? 0 : gridRow + 1;
}

/** Cursor position for the target cell in the NEW text: just after the
 *  last non-space char of its raw field; an empty field lands one space in
 *  (right after the `| ` prefix). Falls back to the line end. The line's
 *  own start offset inside the inserted block is added — anchors live on
 *  the TARGET line, not the block's first line. */
function anchorAt(newLines: string[], blockFrom: number, lineIdx: number, col: number): number {
  const text = newLines[lineIdx] ?? '';
  let lineStart = 0;
  for (let i = 0; i < lineIdx && i < newLines.length; i++) lineStart += newLines[i].length + 1;
  const field = splitRowSpans(text)?.fields[col];
  if (!field) return blockFrom + lineStart + text.length;
  let e = field.end;
  while (e > field.start && (text[e - 1] === ' ' || text[e - 1] === '\t')) e--;
  const off = e > field.start ? e : Math.min(field.start + 1, field.end);
  return blockFrom + lineStart + off;
}

function buildChange(
  block: TableBlock,
  kind: TableChange['kind'],
  targetRow: number,
  targetCol: number,
  appendEmptyRow: boolean,
): TableChange {
  const newLines = formatBlockLines(block, appendEmptyRow);
  const anchor = anchorAt(newLines, block.from, lineIndexForGridRow(targetRow), targetCol);
  return { from: block.from, to: block.to, insert: newLines.join('\n'), anchor, kind };
}

/**
 * Pure: Tab (dir='next') / Shift-Tab (dir='prev') in a table cell.
 * Returns null when the key should fall through to the default keymap.
 */
export function computeTableTabChange(state: EditorState, dir: 'next' | 'prev'): TableChange | null {
  const loc = locate(state);
  if (!loc) return null;
  const { block, cell } = loc;

  if (dir === 'next') {
    let col = cell.col + 1;
    let row = cell.row;
    let append = false;
    if (col >= block.grid[cell.row].length) {
      // end of row → wrap to the next row's first cell
      col = 0;
      row = cell.row + 1;
    }
    if (row >= block.grid.length) {
      // past the last row → append an empty row
      row = block.grid.length;
      append = true;
    }
    return buildChange(block, 'tab', row, col, append);
  }

  let col = cell.col - 1;
  let row = cell.row;
  if (col < 0) {
    row = cell.row - 1;
    if (row < 0) return null; // before the table's first cell → fall through
    col = block.grid[row].length - 1;
  }
  return buildChange(block, 'shift-tab', row, col, false);
}

/**
 * Pure: Enter in a table cell. An all-empty body row is deleted and the
 * cursor exits the table; otherwise the cursor moves one row down (same
 * column), appending a row when already on the last one.
 */
export function computeTableEnterChange(state: EditorState): TableChange | null {
  const loc = locate(state);
  if (!loc) return null;
  const { block, cell } = loc;

  // All-empty body row → delete it and exit the table.
  if (cell.row > 0 && block.grid[cell.row].every((c) => c === '')) {
    const lineIdx = cell.row + 1; // header 0, sep 1, body rows 2+
    const line = block.lines[lineIdx];
    // Delete from the previous line's end so the row's leading newline
    // goes too; the line that followed moves up to `from + 1`.
    const from = block.lines[lineIdx - 1].to;
    let anchor = from;
    const next = block.lines[lineIdx + 1];
    if (next && next.kind === 'row') {
      // mid-table: stay in the table, same column of the row that moves up
      const field = splitRowSpans(next.text)?.fields[cell.col];
      let s = field ? field.start : 0;
      if (field) {
        while (s < field.end && next.text[s] === ' ') s++;
        if (s >= field.end) s = field.start;
      }
      anchor = from + 1 + s;
    } else if (line.to < state.doc.length) {
      // a non-table line follows in the doc → exit to its start
      anchor = from + 1;
    }
    return { from, to: line.to, insert: '', anchor, kind: 'exit' };
  }

  let row = cell.row + 1;
  let append = false;
  if (row >= block.grid.length) {
    row = block.grid.length;
    append = true;
  }
  return buildChange(block, 'enter', row, cell.col, append);
}

function runTableKey(view: EditorView, compute: (state: EditorState) => TableChange | null): boolean {
  const change = compute(view.state);
  if (!change) return false;
  view.dispatch({
    changes: { from: change.from, to: change.to, insert: change.insert },
    selection: { anchor: change.anchor },
    userEvent: 'input',
  });
  return true;
}

/** Keymap handlers — exported for direct testing. */
export function handleTableTab(view: EditorView): boolean {
  return runTableKey(view, (s) => computeTableTabChange(s, 'next'));
}
export function handleTableShiftTab(view: EditorView): boolean {
  return runTableKey(view, (s) => computeTableTabChange(s, 'prev'));
}
export function handleTableEnter(view: EditorView): boolean {
  return runTableKey(view, computeTableEnterChange);
}

export const markdownTableExtension = [
  Prec.highest(
    keymap.of([
      { key: 'Tab', run: handleTableTab },
      { key: 'Shift-Tab', run: handleTableShiftTab },
      { key: 'Enter', run: handleTableEnter },
    ]),
  ),
];
