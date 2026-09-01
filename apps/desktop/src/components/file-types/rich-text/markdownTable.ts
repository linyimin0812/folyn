import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { JSONContent } from '@tiptap/react';
// Minimal structural shape of a remark (mdast) inline node. Defined locally
// instead of importing `@types/mdast` so no extra type-only package needs to
// be hoisted into the desktop node_modules. Only the fields the inline
// converter reads are present.
interface MdastInlineNode {
  type: string;
  value?: string;
  url?: string;
  title?: string | null;
  alt?: string;
  children?: MdastInlineNode[];
}

// ponytail: smart paste → Markdown table detection for the rich-text editor.
// When the clipboard carries plain text that is a valid Markdown table (with
// a separator row), this parses it into a native tiptap table node, reusing
// the existing @tiptap/extension-table TableKit model — no second table model.
// Inline Markdown inside cells (bold/italic/strike/code/link) is parsed via
// the same remark-parse + remark-gfm pipeline MarkdownPreview uses, then
// mapped to tiptap inline JSONContent so marks survive as real editor marks.
// The detector + row parser + converter are pure functions (no prosemirror
// view) so they're unit-testable under the jsdom ceiling (file-type-editors.md).

export type ColumnAlignment = 'left' | 'center' | 'right' | null;

export interface ParsedMarkdownTable {
  header: string[];
  rows: string[][];
  alignments: ColumnAlignment[];
}

export interface MarkdownTableDetectionResult {
  matched: boolean;
  confidence: number;
  table?: ParsedMarkdownTable;
  reason?: string;
}

// ── normalize clipboard text ──────────────────────────────────────────────

/**
 * Normalize clipboard text before table detection. CRLF/CR → LF, NBSP → space,
 * trim outer whitespace. Does NOT collapse spaces inside cells — meaningful
 * whitespace in cell content must survive.
 */
export function normalizeTableText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00A0/g, ' ')
    .trim();
}

// ── cell parser (state machine) ───────────────────────────────────────────
//
// A | only splits cells when it is NOT escaped (\|) and NOT inside an inline
// code span (`...`). Pipes inside `a | b` or hello \| world must stay in the
// cell. Tracks escaped + inCodeSpan.

interface ParseRowOptions {
  /** Allow a table row with no leading/trailing pipe (bare style: `A | B`). */
  allowBare?: boolean;
}

export function parseTableRow(line: string, options: ParseRowOptions = {}): string[] {
  const { allowBare = false } = options;
  const trimmed = line.trim();
  if (trimmed === '') return [];

  const hasLeadingPipe = trimmed.startsWith('|');
  const hasTrailingPipe = trimmed.endsWith('|') && !trimmed.endsWith('\\|');

  // Standard Markdown tables require the row to start with `|` OR, in the
  // bare style, contain at least one `|` delimiter. A line with no pipes at
  // all cannot be a row.
  if (!hasLeadingPipe && !allowBare) {
    // ponytail: a leading-pipe table that drops the pipe on one row is a
    // malformed row, not a bare row. Treat absence of any pipe as not-a-row
    // so a stray paragraph line under a valid header+separator doesn't get
    // force-split.
    if (!trimmed.includes('|')) return [];
  }

  // Strip one leading and one trailing pipe; the content between them holds
  // the real cells. Trailing backslash-pipe is an escaped pipe, not a border.
  let body = trimmed;
  if (hasLeadingPipe) body = body.slice(1);
  if (hasTrailingPipe) body = body.slice(0, -1);

  // ponytail: first pass — mark which character indices are "inside" an
  // inline construct so a pipe at those positions does NOT split a cell.
  // We track escaped chars, inline code spans, AND inline emphasis runs
  // (**/**/_/__) so a pipe inside `a | b`, hello \| world, or
  // **退出路径|触发条件|原因** stays in its cell. Emphasis is matched by
  // toggling on an opening delimiter run when a same-length closing run
  // exists later in the row (a pragmatic, line-local heuristic — full
  // CommonMark emphasis nesting is the remark parser's job downstream).
  const n = body.length;
  const splitHere = new Array<boolean>(n).fill(true);
  let i = 0;
  while (i < n) {
    const ch = body[i];
    if (ch === '\\') {
      // Escaped next char: never split at i or i+1.
      splitHere[i] = false;
      if (i + 1 < n) splitHere[i + 1] = false;
      i += 2;
      continue;
    }
    if (ch === '`') {
      let run = 0;
      while (body[i + run] === '`') run++;
      const fence = '`'.repeat(run);
      const closeRel = body.slice(i + run).indexOf(fence);
      if (closeRel !== -1) {
        const end = i + run + closeRel + run;
        for (let j = i; j < end && j < n; j++) splitHere[j] = false;
        i = end;
        continue;
      }
      i += run;
      continue;
    }
    if (ch === '*' || ch === '_') {
      let run = 0;
      while (body[i + run] === ch) run++;
      // Only treat as emphasis when a matching close of the same length
      // exists later (line-local). `**`/`__` → bold; `*`/`_` → italic.
      const delim = ch.repeat(run);
      const closeRel = body.slice(i + run).indexOf(delim);
      if (closeRel !== -1) {
        const end = i + run + closeRel + run;
        for (let j = i; j < end && j < n; j++) splitHere[j] = false;
        i = end;
        continue;
      }
      i += run;
      continue;
    }
    i++;
  }

  // Second pass: split only at pipes whose index is marked splittable.
  const cells: string[] = [];
  let current = '';
  for (let k = 0; k < body.length; k++) {
    const ch = body[k];
    if (ch === '|' && splitHere[k]) {
      cells.push(current);
      current = '';
      continue;
    }
    if (ch === '\\' && body[k + 1] === '|') {
      // Escaped pipe → literal pipe in the cell (drop the backslash).
      current += '|';
      k++;
      continue;
    }
    current += ch;
  }
  cells.push(current);

  // Trim each cell's surrounding whitespace (Markdown allows padding around
  // cell content) but keep internal whitespace intact.
  return cells.map((c) => c.trim());
}

// ── separator validation ──────────────────────────────────────────────────

const SEPARATOR_CELL_RE = /^:?-{3,}:?$/;

/**
 * Determine column alignment from a separator cell. Returns null for a plain
 * `---` (no explicit alignment marker).
 */
export function separatorAlignment(cell: string): ColumnAlignment | null {
  const trimmed = cell.trim();
  const left = trimmed.startsWith(':');
  const right = trimmed.endsWith(':');
  if (left && right) return 'center';
  if (left) return 'left';
  if (right) return 'right';
  return null;
}

function isSeparatorRow(cells: string[]): boolean {
  if (cells.length === 0) return false;
  return cells.every((c) => SEPARATOR_CELL_RE.test(c.trim()));
}

// ── detector ─────────────────────────────────────────────────────────────

/**
 * Detect whether `text` is a valid Markdown table. Requires a header row
 * followed by a separator row (the strongest signal). The separator row is
 * mandatory — plain text with pipes (`A | B | C`, `a || b`, shell pipes) is
 * never auto-converted because it has no separator row.
 *
 * Confidence:
 *   100 — standard table with leading/trailing pipes on every row.
 *   90  — bare table (no outer pipes) but valid separator.
 *    0  — not a table.
 */
export function detectMarkdownTable(rawText: string): MarkdownTableDetectionResult {
  const text = normalizeTableText(rawText);
  if (!text) return { matched: false, confidence: 0, reason: 'empty' };

  const lines = text.split('\n');
  if (lines.length < 2) {
    return { matched: false, confidence: 0, reason: 'need header + separator (>=2 lines)' };
  }

  // Locate the header row: the first non-empty line. (normalizeTableText
  // trims outer blank lines, so line 0 is the header in the common case.)
  let headerIdx = 0;
  while (headerIdx < lines.length && lines[headerIdx].trim() === '') headerIdx++;
  if (headerIdx >= lines.length - 1) {
    return { matched: false, confidence: 0, reason: 'no body after header' };
  }

  const headerLine = lines[headerIdx];
  const separatorLine = lines[headerIdx + 1];

  const headerHasOuterPipes = headerLine.trim().startsWith('|');
  // ponytail: the header style (piped vs bare) governs how ALL rows are
  // parsed — a bare header means bare rows, a piped header means piped rows.
  const headerCells = parseTableRow(headerLine, { allowBare: !headerHasOuterPipes });
  const separatorCells = parseTableRow(separatorLine, { allowBare: !headerHasOuterPipes });

  if (headerCells.length < 1) {
    return { matched: false, confidence: 0, reason: 'header has no cells' };
  }
  if (headerCells.length !== separatorCells.length) {
    return {
      matched: false,
      confidence: 0,
      reason: `column count mismatch (header ${headerCells.length} vs separator ${separatorCells.length})`,
    };
  }
  if (!isSeparatorRow(separatorCells)) {
    return { matched: false, confidence: 0, reason: 'second row is not a separator' };
  }

  const alignments = separatorCells.map(separatorAlignment);

  // Parse body rows. Only lines that look like table rows are consumed; a
  // blank line terminates the table. Rows with fewer cells are padded; rows
  // with too many cells are kept verbatim (we do not silently merge).
  const rows: string[][] = [];
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') break; // blank line ends the table
    const cells = parseTableRow(line, { allowBare: !headerHasOuterPipes });
    if (cells.length === 0) break;
    if (cells.length > headerCells.length) {
      // Too many cells → not a well-formed row of this table; stop here.
      break;
    }
    while (cells.length < headerCells.length) cells.push('');
    rows.push(cells);
  }

  const confidence = headerHasOuterPipes ? 100 : 90;
  return {
    matched: true,
    confidence,
    table: { header: headerCells, rows, alignments },
  };
}

// A tiptap mark in JSON form. JSONContent.marks[] requires `type` to be a
// required string (JSONContent's own type makes it optional at the top level),
// so this narrows it for the mark objects the converter builds.
interface MarkJSON {
  type: string;
  attrs?: Record<string, any>;
  [key: string]: any;
}

// ── inline markdown → tiptap inline JSONContent ───────────────────────────

/**
 * Parse a cell's raw Markdown into tiptap inline JSONContent (text nodes with
 * marks), reusing the remark-parse + remark-gfm pipeline. Only inline content
 * (strong/emphasis/delete/inlineCode/link/text/break) is mapped — block-level
 * constructs inside a cell are flattened to text so a cell never holds a
 * nested paragraph/heading/list (tiptap table cells contain paragraphs only).
 *
 * Returns an array of inline JSONContent nodes for a single paragraph. Empty
 * cells yield [] (the caller wraps in an empty paragraph).
 */
export function cellToInlineContent(cell: string): JSONContent[] {
  if (!cell) return [];
  // ponytail: parse as a markdown paragraph so inline constructs resolve.
  // Wrapping in an explicit paragraph node guarantees remark treats the cell
  // as inline content even when it begins with a construct that remark could
  // otherwise interpret at block level (e.g. `# heading`).
  const tree = unified().use(remarkParse).use(remarkGfm).parse(`${cell}\n`);
  const para = tree.children.find((c) => c.type === 'paragraph');
  if (!para || !para.children || para.children.length === 0) return [];
  const inline = (para.children as unknown as MdastInlineNode[]).map(mdastInlineToTiptap).flat();
  // Drop trailing empty text nodes produced by trailing whitespace.
  while (inline.length > 0 && inline[inline.length - 1].text === '') {
    inline.pop();
  }
  return inline;
}

function mdastInlineToTiptap(node: MdastInlineNode): JSONContent[] {
  switch (node.type) {
    case 'text': {
      return [{ type: 'text', text: node.value ?? '' }];
    }
    case 'strong': {
      return wrapChildren(node, { type: 'bold' });
    }
    case 'emphasis': {
      return wrapChildren(node, { type: 'italic' });
    }
    case 'delete': {
      return wrapChildren(node, { type: 'strike' });
    }
    case 'inlineCode': {
      // Inline code is a mark in tiptap (StarterKit ships `code` as a mark),
      // so map to a text node carrying the code mark.
      return [{ type: 'text', text: node.value ?? '', marks: [{ type: 'code' }] }];
    }
    case 'link': {
      // ponytail: tiptap's Link mark (from StarterKit) stores href/target/
      // rel/class as attrs. A markdown link title has no tiptap attr slot —
      // it's dropped (rare in table cells) rather than corrupting the URL.
      const linkMark: MarkJSON = {
        type: 'link',
        attrs: {
          href: node.url ?? '',
          target: '_blank',
          rel: 'noopener noreferrer nofollow',
          class: null,
        },
      };
      return wrapChildren(node, linkMark);
    }
    case 'break': {
      return [{ type: 'hardBreak' }];
    }
    case 'image':
    case 'imageReference': {
      // ponytail: images inside table cells are rare; render the alt text (or
      // url) as text rather than embedding a block Image node in a paragraph.
      const alt = node.alt ?? '';
      return [{ type: 'text', text: alt || node.url || '' }];
    }
    default: {
      // Any unrecognized inline node → flatten its text value.
      const value = node.value;
      if (value) return [{ type: 'text', text: value }];
      return [];
    }
  }
}

function wrapChildren(node: MdastInlineNode, mark: MarkJSON): JSONContent[] {
  const children = node.children ?? [];
  const out: JSONContent[] = [];
  for (const child of children) {
    for (const inline of mdastInlineToTiptap(child)) {
      out.push(applyMark(inline, mark));
    }
  }
  return out;
}

function applyMark(node: JSONContent, mark: MarkJSON): JSONContent {
  if (node.type === 'text') {
    const marks: MarkJSON[] = (node.marks as MarkJSON[] | undefined) ? [...(node.marks as MarkJSON[])] : [];
    marks.push(mark);
    return { ...node, marks };
  }
  // Non-text inline nodes (e.g. hardBreak) can't carry marks; return as-is.
  return node;
}

// ── markdown table → tiptap table node ────────────────────────────────────

function makeCell(content: JSONContent[], isHeader: boolean, align: ColumnAlignment): JSONContent {
  const paragraph: JSONContent = {
    type: 'paragraph',
    content: content.length > 0 ? content : undefined,
  };
  const attrs: Record<string, unknown> = {};
  if (align) attrs.align = align;
  const cell: JSONContent = {
    type: isHeader ? 'tableHeader' : 'tableCell',
    attrs: Object.keys(attrs).length > 0 ? attrs : undefined,
    content: [paragraph],
  };
  return cell;
}

/**
 * Convert a parsed Markdown table into a tiptap table JSONContent node. The
 * first row becomes tableHeader cells; body rows become tableCell cells.
 * Alignment from the separator row is applied as the cell `align` attr (the
 * same attr RichTextTableCell/TableHeader render as `text-align`).
 */
export function markdownTableToTiptap(table: ParsedMarkdownTable): JSONContent {
  const { header, rows, alignments } = table;

  const headerRow: JSONContent = {
    type: 'tableRow',
    content: header.map((cellText, i) =>
      makeCell(cellToInlineContent(cellText), true, alignments[i] ?? null),
    ),
  };

  const bodyRows: JSONContent[] = rows.map((row) => ({
    type: 'tableRow',
    content: row.map((cellText, i) =>
      makeCell(cellToInlineContent(cellText), false, alignments[i] ?? null),
    ),
  }));

  return {
    type: 'table',
    content: [headerRow, ...bodyRows],
  };
}

// ── TSV (tab-separated) table detection ───────────────────────────────────
//
// When a user copies a RENDERED table from a web page (Chrome, etc.), the
// clipboard's text/plain is the rendered cell text joined by tabs (\t) with
// rows separated by newlines — NOT raw Markdown. text/html carries the real
// <table>, but an external HTML table is not trusted to round-trip natively
// in TipTap (see markdownTablePaste). This TSV detector recovers the table
// from the tab-separated plain text and builds the same native tiptap table.
//
// Only matches when the text is genuinely tab-delimited AND rectangular
// (every row the same column count, >=2 rows) so a single line of prose
// with a tab (e.g. a code indent) never becomes a table.

export interface ParsedTsvTable {
  header: string[];
  rows: string[][];
}

/**
 * Detect whether `text` is a tab-separated table. Requires at least 2 rows
 * and a tab in the first row, with every row sharing the same column count.
 * Cells are trimmed of surrounding whitespace (Chrome pads rendered cells).
 */
export function detectTsvTable(rawText: string): ParsedTsvTable | null {
  const text = normalizeTableText(rawText);
  if (!text) return null;
  const lines = text.split('\n');
  if (lines.length < 2) return null;
  // Require the first line to contain a tab (a genuine TSV header).
  if (!lines[0].includes('\t')) return null;

  const table = lines.map((line) => line.split('\t'));
  const cols = table[0].length;
  // Rectangular: every row must have the same column count. This rejects
  // prose that happens to contain a tab, and rejects ragged clipboard data.
  for (const row of table) {
    if (row.length !== cols) return null;
  }
  // Trim surrounding whitespace from each cell (rendered cells carry padding)
  // but keep internal text intact.
  const [header, ...rows] = table.map((row) => row.map((c) => c.trim()));
  return { header, rows };
}

/**
 * Convert a parsed TSV table into a native tiptap table node. The first row
 * becomes tableHeader cells; the rest become tableCell cells. Inline
 * markdown inside cells is parsed via the same remark pipeline so bold/code
 * marks survive when the copied cell text contains markdown.
 */
export function tsvTableToTiptap(table: ParsedTsvTable): JSONContent {
  const { header, rows } = table;
  const headerRow: JSONContent = {
    type: 'tableRow',
    content: header.map((cellText) =>
      makeCell(cellToInlineContent(cellText), true, null),
    ),
  };
  const bodyRows: JSONContent[] = rows.map((row) => ({
    type: 'tableRow',
    content: row.map((cellText) =>
      makeCell(cellToInlineContent(cellText), false, null),
    ),
  }));
  return {
    type: 'table',
    content: [headerRow, ...bodyRows],
  };
}

// ── → Markdown source string (for the CodeMirror markdown editor) ─────────
//
// The CodeMirror markdown editor stores raw Markdown text — it can't hold a
// native table node. When the user pastes a TSV/rendered table there, we
// convert it to a Markdown table source string and insert that, so the
// split-view preview renders a real table. A markdown table pasted as
// text/plain is already source and is inserted unchanged.

function escapePipeInCell(cell: string): string {
  // ponytail: a literal | inside a cell must be escaped so the row re-parses
  // as the same column count. Backslash-escape; inline code pipes are safe
  // because they're inside backticks.
  // First, protect pipes inside inline code spans by leaving them alone —
  // the markdownTableToMarkdown only escapes bare pipes outside code. We do a
  // light pass: escape unescaped | that is not inside a code span.
  let out = '';
  let inCode = false;
  let codeTicks = 0;
  for (let i = 0; i < cell.length; i++) {
    const ch = cell[i];
    if (ch === '`') {
      let run = 0;
      while (cell[i + run] === '`') run++;
      const fence = '`'.repeat(run);
      if (inCode && codeTicks === run) {
        out += fence;
        i += run - 1;
        inCode = false;
        codeTicks = 0;
        continue;
      }
      if (!inCode) {
        const rest = cell.slice(i + run);
        const closeIdx = rest.indexOf(fence);
        if (closeIdx !== -1) {
          inCode = true;
          codeTicks = run;
          out += fence;
          i += run - 1;
          continue;
        }
      }
      out += fence;
      i += run - 1;
      continue;
    }
    if (ch === '|' && !inCode) {
      out += '\\|';
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Render a parsed Markdown table back to a canonical Markdown source string
 * (with outer pipes and `| --- |` separator). Used when inserting into the
 * CodeMirror markdown editor, where the storage format is source text.
 */
export function markdownTableToMarkdown(table: ParsedMarkdownTable): string {
  const { header, rows, alignments } = table;
  const cols = header.length;
  // ponytail: build the separator from the actual column count, padding a
  // short alignments array (TSV tables carry no alignment info → all `---`)
  // so a 3-col table always emits 3 separator cells, never a single empty one.
  const sepCells: string[] = [];
  for (let i = 0; i < cols; i++) {
    const a = alignments[i] ?? null;
    sepCells.push(a === 'left' ? ':---' : a === 'center' ? ':---:' : a === 'right' ? '---:' : '---');
  }
  const sep = sepCells.join(' | ');
  const head = header.map(escapePipeInCell).join(' | ');
  const lines = [`| ${head} |`, `| ${sep} |`];
  for (const row of rows) {
    const cells = [...row];
    while (cells.length < cols) cells.push('');
    lines.push(`| ${cells.slice(0, cols).map(escapePipeInCell).join(' | ')} |`);
  }
  return lines.join('\n');
}

/**
 * Render a parsed TSV table to a canonical Markdown source string (first row
 * as header). Mirrors markdownTableToMarkdown but always uses plain `---`
 * separators (TSV has no alignment info).
 */
export function tsvTableToMarkdown(table: ParsedTsvTable): string {
  return markdownTableToMarkdown({ header: table.header, rows: table.rows, alignments: [] });
}

// ── CSV (comma-separated) table detection ─────────────────────────────────
//
// When a user pastes CSV-formatted text (e.g. `name,age\nlinyimin,18`),
// detect it and offer to convert it to a table. CSV fields may be quoted
// (`"a,b"`, `he said ""hi"""`), so a state-machine row parser handles quoted
// fields, embedded commas, and escaped double-quotes — never a naive
// line.split(','). Mirrors the TSV flow; only matches when genuinely
// comma-delimited AND rectangular (≥2 rows, ≥2 cols, consistent counts) so
// a single sentence with a comma never becomes a table.

/**
 * Parse a single CSV row into field strings, honoring RFC 4180 quoting:
 *  - `"` opens a quoted field that continues through newlines and commas
 *    until a closing `"`.
 *  - Inside a quoted field, `""` is a literal `"`.
 *  - Outside quotes, `,` separates fields.
 *  - A trailing newline is not part of the field.
 */
export function parseCsvRow(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        // Doubled quote inside a quoted field → literal ".
        if (line[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        // Closing quote.
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    // Not in quotes.
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      fields.push(field);
      field = '';
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  fields.push(field);
  // ponytail: a trailing newline in the field (from split keeping \r) would
  // corrupt the last cell; normalize CR/LF endings at the caller (detectCsv
  // passes already-normalized lines), so no trimming here to preserve quoted
  // whitespace verbatim. Only trim surrounding whitespace for unquoted fields
  // is NOT applied — preserve exact cell content like the TSV path.
  return fields;
}

export interface ParsedCsvTable {
  header: string[];
  rows: string[][];
}

/**
 * Detect whether `text` is a comma-separated table. Requires ≥2 rows, the
 * first row to contain a comma (a genuine CSV header), and every row to share
 * the same column count (≥2). Quoted fields with embedded commas are parsed
 * correctly so they don't inflate the column count.
 */
export function detectCsvTable(rawText: string): ParsedCsvTable | null {
  const text = normalizeTableText(rawText);
  if (!text) return null;
  const lines = text.split('\n');
  if (lines.length < 2) return null;
  // Require a comma in the first line (a genuine CSV header).
  if (!lines[0].includes(',')) return null;

  // Parse rows; a quoted field may span newlines, so re-join continuation
  // lines back into the row that opened the quote.
  const rows: string[][] = [];
  let buffer = '';
  let inQuotes = false;
  for (const line of lines) {
    buffer = buffer ? buffer + '\n' + line : line;
    // Count quote parity on this accumulated buffer to detect an open quote.
    for (let i = 0; i < buffer.length; i++) {
      if (buffer[i] === '"') {
        // Doubled quote is not a toggle.
        if (buffer[i + 1] === '"') {
          i++;
          continue;
        }
        inQuotes = !inQuotes;
      }
    }
    if (inQuotes) {
      // Quote still open → next line is a continuation.
      continue;
    }
    rows.push(parseCsvRow(buffer));
    buffer = '';
  }
  // ponytail: if a quote was never closed, the data is malformed — bail.
  if (inQuotes) return null;
  if (rows.length < 2) return null;

  const cols = rows[0].length;
  if (cols < 2) return null;
  // Rectangular: every row must share the same column count.
  for (const row of rows) {
    if (row.length !== cols) return null;
  }
  const [header, ...body] = rows.map((row) => row.map((c) => c.trim()));
  return { header, rows: body };
}

/**
 * Convert a parsed CSV table into a native tiptap table node. First row →
 * tableHeader; the rest → tableCell. Inline markdown in cells is parsed via
 * the same remark pipeline so marks survive.
 */
export function csvTableToTiptap(table: ParsedCsvTable): JSONContent {
  const { header, rows } = table;
  const headerRow: JSONContent = {
    type: 'tableRow',
    content: header.map((cellText) =>
      makeCell(cellToInlineContent(cellText), true, null),
    ),
  };
  const bodyRows: JSONContent[] = rows.map((row) => ({
    type: 'tableRow',
    content: row.map((cellText) =>
      makeCell(cellToInlineContent(cellText), false, null),
    ),
  }));
  return { type: 'table', content: [headerRow, ...bodyRows] };
}

/**
 * Render a parsed CSV table as a canonical Markdown source string (first row
 * as header). Bare pipes in cells are escaped; pipes inside inline code spans
 * are preserved. Reuses markdownTableToMarkdown's separator + escaping logic.
 */
export function csvTableToMarkdown(table: ParsedCsvTable): string {
  return markdownTableToMarkdown({ header: table.header, rows: table.rows, alignments: [] });
}
