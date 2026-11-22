import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { JSONContent } from '@tiptap/react';
import type { ColumnAlignment, ParsedCsvTable, ParsedMarkdownTable, ParsedTsvTable } from '@folyn/markdown-table';
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
// Detection, row parsing and Markdown rendering live in @folyn/markdown-table
// (shared with the host's Markdown editor); this file only builds the
// tiptap nodes.

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
