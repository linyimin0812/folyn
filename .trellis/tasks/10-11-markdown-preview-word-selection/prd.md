# Fix Markdown preview double-click word selection

## Goal

Double-clicking preview text must select only the clicked word, as requested by the user.

## Requirements

- Select one English or Chinese word under the pointer in paragraphs, lists, tables, inline formatting, and code.
- Do not select whitespace-only ranges or extend the selection to unrelated blocks.
- Preserve single-click dragging, interactive controls, and native triple-click behavior.
- Finish the existing uncommitted selection work and remove its temporary logging.

## Acceptance Criteria

- WebKit browser regression reproduces the faulty selection before the fix and selects the expected word after it.
- Targeted tests cover selection lifecycle and component integration.
- No whole-project compile or build.

## Technical Notes

- Existing dirty MarkdownPreview.tsx contains unfinished selection locking, whitespace search, and TEMP-DEBUG logging. Other dirty files belong to another task and must remain untouched.
- Captured `/tmp/folyn-dbl-debug.log` records double-click list selections of a bare newline, painted as a large highlight.
- Existing CSS bisect in 10-10-markdown-preview-pinch-zoom did not reproduce the native bug.
- Codex uses inline dispatch per .trellis/config.yaml; relevant frontend specs are loaded directly.

## Out of Scope

Preview zoom, editor selection, export behavior, and unrelated dirty task files.
