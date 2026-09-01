import { Extension } from '@tiptap/react';
import type { EditorView } from '@tiptap/pm/view';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import {
  detectMarkdownTable,
  markdownTableToTiptap,
  detectTsvTable,
  tsvTableToTiptap,
  detectCsvTable,
  csvTableToTiptap,
} from './markdownTable';
import type { JSONContent } from '@tiptap/react';

// ponytail: smart paste → Markdown table detection. Runs AFTER the image
// paste plugin (RichTextImage) returns false, and only when the clipboard
// holds plain text with NO text/html table (ProseMirror's default HTML
// parsing already handles pasted <table> HTML). When the plain text is a
// valid Markdown table, a native tiptap table node is inserted in place of
// the raw text. Non-table plain text falls through to ProseMirror's default
// text insertion unchanged.

const markdownTablePasteKey = new PluginKey('rich-text-markdown-table-paste');

/**
 * Minimal clipboard surface this plugin reads. Structural so the real
 * `DataTransfer` (browser) and a tiny test stub both satisfy it without
 * needing jsdom to implement DataTransfer (it doesn't).
 */
export interface ClipboardReadSurface {
  getData(type: string): string;
}

/**
 * Decide whether a paste event should become a native tiptap table. Priority:
 *   1. If text/html carries a ProseMirror-native table (data-pm-slice), defer
 *      to TipTap's built-in HTML paste (it round-trips natively).
 *   2. Else, if text/plain is a valid Markdown table → convert it.
 *   3. Else, if text/plain is a tab-separated table (e.g. a rendered table
 *      copied from a Chrome web page, where text/plain is cell text joined by
 *      tabs, not markdown) → convert it.
 *   4. Else, if text/plain is a comma-separated (CSV) table → convert it.
 *   5. Else null → default plain-text paste.
 *
 * External (non-ProseMirror) HTML <table> payloads are NOT trusted to
 * round-trip natively in TipTap, so Markdown/TSV/CSV plain text is the
 * preferred source — it yields a clean native table and preserves inline marks.
 */
export interface DetectedPasteTable {
  /** The tiptap table JSONContent node to insert. */
  tableNode: JSONContent;
  /** Human-readable summary, e.g. "3 columns × 4 rows". */
  summary: string;
  /** The raw clipboard text/plain (for the paste-as-text fallback). */
  rawText: string;
  /** Whether the source was already markdown syntax (no prompt needed). */
  isMarkdownSource: boolean;
}

/**
 * Detect a Markdown or TSV table on the clipboard and return the tiptap table
 * node plus metadata for the host's confirmation flow. Returns null when the
 * clipboard carries a ProseMirror-native table copy (defer to TipTap's native
 * paste) or holds no table.
 */
export function detectPasteTable(
  clipboardData: ClipboardReadSurface | null,
): DetectedPasteTable | null {
  if (!clipboardData) return null;
  const html = clipboardData.getData('text/html');
  // Defer only to ProseMirror-native table copies.
  if (html && /<\s*table\b[^>]*data-pm-slice/i.test(html)) {
    return null;
  }
  const text = clipboardData.getData('text/plain');
  if (!text) return null;
  // Markdown table (raw `| a | b |` with a separator row).
  const md = detectMarkdownTable(text);
  if (md.matched && md.table) {
    return {
      tableNode: markdownTableToTiptap(md.table),
      summary: `${md.table.header.length} columns × ${md.table.rows.length + 1} rows`,
      rawText: text,
      isMarkdownSource: true,
    };
  }
  // TSV table (rendered table copied from a web page).
  const tsv = detectTsvTable(text);
  if (tsv) {
    return {
      tableNode: tsvTableToTiptap(tsv),
      summary: `${tsv.header.length} columns × ${tsv.rows.length + 1} rows`,
      rawText: text,
      isMarkdownSource: false,
    };
  }
  // CSV table (comma-separated, may include quoted fields).
  const csv = detectCsvTable(text);
  if (csv) {
    return {
      tableNode: csvTableToTiptap(csv),
      summary: `${csv.header.length} columns × ${csv.rows.length + 1} rows`,
      rawText: text,
      isMarkdownSource: false,
    };
  }
  return null;
}

/**
 * Host hook for the rich-text table-paste flow. Called synchronously from
 * handlePaste when a table is detected and the host must decide:
 *   'convert' — insert the native table now (host already has the node).
 *   'text'    — paste as plain text (host returns false so default paste runs).
 *   'ask'     — host shows the confirmation dialog, then dispatches the table
 *               or replays the raw text once the user resolves.
 *
 * The host receives the resolved view + tableNode + rawText + summary so it
 * can perform the dispatch itself (it owns the editor + dialog state).
 */
export type TablePasteDecision = 'convert' | 'text' | 'ask';
export interface TablePasteHostPayload {
  view: EditorView;
  tableNode: JSONContent;
  rawText: string;
  summary: string;
  isMarkdownSource: boolean;
}
export type TablePasteHandler = (payload: TablePasteHostPayload) => TablePasteDecision;

/**
 * Insert a native tiptap table node, replacing the current selection.
 */
export function dispatchTableNode(view: EditorView, tableNode: JSONContent): void {
  const tr = view.state.tr;
  tr.replaceSelectionWith(view.state.schema.nodeFromJSON(tableNode));
  view.dispatch(tr);
}

function markdownTablePastePlugin(onTablePaste?: TablePasteHandler): Plugin {
  return new Plugin({
    key: markdownTablePasteKey,
    props: {
      handlePaste: (view: EditorView, event: ClipboardEvent) => {
        const cb = event.clipboardData;
        if (!cb) return false;
        const detected = detectPasteTable(cb);
        if (!detected) return false;
        // Already-markdown source: the clipboard is valid markdown table syntax
        // — convert directly to a native table, no prompt (mirrors the .md
        // editor's "paste markdown tables directly" rule).
        if (detected.isMarkdownSource) {
          event.preventDefault();
          dispatchTableNode(view, detected.tableNode);
          return true;
        }
        // TSV source: conversion is the only path to a table, so defer to the
        // host's preference (ask / convert / text).
        if (!onTablePaste) {
          // No host hook (export pipeline) — convert directly.
          event.preventDefault();
          dispatchTableNode(view, detected.tableNode);
          return true;
        }
        const decision = onTablePaste({
          view,
          tableNode: detected.tableNode,
          rawText: detected.rawText,
          summary: detected.summary,
          isMarkdownSource: detected.isMarkdownSource,
        });
        if (decision === 'convert') {
          event.preventDefault();
          dispatchTableNode(view, detected.tableNode);
          return true;
        }
        if (decision === 'ask') {
          // Host will show the dialog; we claim the paste now and the host
          // dispatches (table or raw text) on resolve.
          event.preventDefault();
          return true;
        }
        // 'text' → default plain-text paste.
        return false;
      },
    },
  });
}

/**
 * TipTap extension: detects Markdown/TSV tables on plain-text paste and
 * inserts them as native editable tiptap tables. Markdown-source tables
 * convert directly; TSV tables route through the optional `onTablePaste`
 * host hook so the editor can show a confirmation dialog. Registered in
 * getRichTextExtensions so both the live editor and the export pipeline see
 * the extension (export never pastes, so the plugin is inert there).
 */
export const MarkdownTablePaste = Extension.create<{ onTablePaste?: TablePasteHandler }>({
  name: 'markdownTablePaste',
  addOptions() {
    return { onTablePaste: undefined };
  },
  addProseMirrorPlugins() {
    return [markdownTablePastePlugin(this.options.onTablePaste)];
  },
});
