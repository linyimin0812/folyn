# CSV preview: replace @file-viewer/react with in-house table renderer

## Goal

`apps/desktop/src/components/file-types/csv/CsvFileViewerPreview.tsx` currently delegates CSV rendering to `@file-viewer/react` + `virtual:file-viewer-renderers` (the spreadsheet renderer, with a pnpm patch on `@file-viewer/renderer-spreadsheet@2.1.17`). Replace it with an in-house renderer so the desktop app can drop `@file-viewer/react`, `@file-viewer/vite-plugin`, `@file-viewer/preset-all`, `@file-viewer/preset-office`, and the spreadsheet patch entirely.

## What I already know

- Scope is `.csv` only. XLSX / ODS / Office formats are owned by `extensions/file-viewer/src/OfficeFileViewer.tsx` (still uses `@file-viewer/react` + preset-office — that extension keeps its own copy of the dep).
- Current CsvFileViewerPreview.tsx (53 lines):
  - Prepends `\uFEFF` BOM so SheetJS takes the UTF-8 path (avoids mojibake for BOM-less UTF-8 CSV).
  - Wraps content as `new File([...], name, { type: 'text/csv' })`.
  - Dynamically imports `virtual:file-viewer-renderers` (configured to `['spreadsheet']` in `apps/desktop/vite.config.ts`).
  - Passes i18n messages `'spreadsheet.state.rows'` → `'共 {rows} 行'`, `'spreadsheet.state.rowsAndColumns'` → `'共 {rows} 行，{cols} 列'`.
- Spreadsheet patch customizations (in `patches/@file-viewer__renderer-spreadsheet@2.1.17.patch`) that current behavior relies on:
  - `rowHeight: 22`, `TABLE_FONT_SIZE: 12`, `HEADER_HEIGHT: 22`
  - Index column auto-width by total row count digits (`computeIndexColumnWidth`, 28–80 px range; replaces fixed 68)
  - Data columns `widthFillDisable: false` (fill remaining width instead of left-aligning with right whitespace)
  - `SCROLLER_TRACK_SIZE: 0` (hide scrollbar track)
  - **Tauri clipboard routing**: macOS webview `navigator.clipboard.writeText` fails → patch routes copy through `@tauri-apps/plugin-clipboard-manager`.
  - **Document-level `copy` event intercept**: macOS Edit menu's Cmd+C accelerator preempts the webview keydown → patch intercepts the native `copy` event and routes through the same pipeline.
- `papaparse` is already a direct dep of apps/desktop (line 88) — used by `apps/desktop/src/components/file-types/json/lib/parseInput.ts`. CSV parsing does not need a new dep.
- No virtualization lib currently installed in the workspace (`@tanstack/react-virtual`, `react-window`, etc. — none found).
- Test setup glue that becomes dead if we drop file-viewer:
  - `apps/desktop/src/vite-env.d.ts:21` — `declare module 'virtual:file-viewer-renderers'` type referencing `@file-viewer/preset-all`.
  - `apps/desktop/src/main.tsx:29` — comment referencing the virtual module.
  - `apps/desktop/vite.config.ts:3,20-24` — `fileViewerRenderers({ renderers: ['spreadsheet'], copyAssets: true, inject: false })`.
  - `vitest.workspace.ts:39-42` — alias `'virtual:file-viewer-renderers'` → `test/fixtures/file-viewer-renderers.ts`.
  - `test/fixtures/file-viewer-renderers.ts` — fixture returning `[]`.
  - `apps/desktop/src/components/file-types/csv/CsvFileViewerPreview.test.tsx` — `vi.mock('@file-viewer/react', …)`.
- `extensions/file-viewer/src/OfficeFileViewer.tsx` is a separate consumer of `@file-viewer/react` + `@file-viewer/preset-office` + the renderer-* packages — those deps stay at the extension level; this task does not touch them.

## Assumptions (temporary)

- The in-house renderer targets `.csv` only (TSV / pasted tables in rich-text editor already have their own `parseCsvRow` path in `markdownTable.ts` — not in scope).
- The JSON preview pane's CSV parsing (task `07-03-json-file-viewer`) is unaffected; it parses paste input via papaparse, separate code path.
- The `@file-viewer/renderer-spreadsheet@2.1.17` pnpm patch and the root `pnpm.overrides` entry can be removed once apps/desktop no longer needs the spreadsheet renderer (extensions/file-viewer uses `^2.1.30`, not the pinned `2.1.17`, so the override is safe to drop).

## Open Questions

1. **Rendering approach** — ✅ decided: native `<table>` + `@tanstack/react-virtual` windowing. Adds one net-new dep (~7KB gz). Handles 1M-row CSVs without blocking.
2. **Patch customizations** — ✅ decided: keep all.
   - A1: `rowHeight=22`, `TABLE_FONT_SIZE=12`, `HEADER_HEIGHT=22` (Excel-like density).
   - A2: index column width auto-adapts to total-row digit count, clamped to 28–80 px.
   - A3: data columns fill remaining width (`widthFillDisable=false` equivalent — distribute leftover width across data columns).
   - A4: hide scrollbar track (no visible track gutter; scroll still works).
   - B5: macOS Tauri clipboard routing — copy goes through `@tauri-apps/plugin-clipboard-manager` (WKWebView `navigator.clipboard.writeText` fails).
   - B6: document-level `copy` event intercept — macOS Edit menu Cmd+C preempts keydown; intercept native `copy` event and route through the same pipeline.
3. **CSV parsing** — ✅ decided: papaparse, first row treated as data (no header), UTF-8 with automatic BOM stripping, `dynamicTyping: false` (all cells render as text), papaparse default handling for ragged rows (missing trailing fields → empty strings). No GBK/Big5/other-encoding support in MVP.
   - Consequence: the `\uFEFF` BOM-prepend workaround in current `CsvFileViewerPreview.tsx` is deleted (papaparse strips BOM natively).
4. **i18n status line** — ✅ decided: keep "共 {rows} 行，{cols} 列" status display in the preview pane (placement TBD: top toolbar or bottom status bar).
5. **Selection granularity** — ✅ decided: single-cell click + row-select (click index column) + Cmd/Ctrl+A whole-table. No rectangular drag selection. Selected range serialized to TSV on Cmd/Ctrl+C. Keyboard arrow navigation not required in MVP.
6. **Dependency cleanup scope** — ✅ decided: remove all four `@file-viewer/*` entries from `apps/desktop/package.json`:
   - `@file-viewer/react` (line 35)
   - `@file-viewer/vite-plugin` (devDep, line 110)
   - `@file-viewer/preset-all` (line 33)
   - `@file-viewer/preset-office` (line 34)
   And remove from root `package.json`:
   - `pnpm.patchedDependencies` entry `@file-viewer/renderer-spreadsheet@2.1.17`
   - `pnpm.overrides` entry `@file-viewer/renderer-spreadsheet: 2.1.17`
   - The `patches/@file-viewer__renderer-spreadsheet@2.1.17.patch` file
   **Verified safe**: `extensions/file-viewer` uses `@file-viewer/preset-office ^2.1.30` (not pinned to 2.1.17, outside the override range) and declares `clipboard: false` in its manifest — it never depended on the apps/desktop-specific 2.1.17 patch.
7. **Test setup cleanup** — ✅ decided: tied to 6. Remove:
   - `apps/desktop/src/vite-env.d.ts:21` `declare module 'virtual:file-viewer-renderers'`
   - `apps/desktop/src/main.tsx:27-32` comment block referencing the virtual module
   - `apps/desktop/vite.config.ts:3, 20-24` `fileViewerRenderers({…})` plugin + import
   - `vitest.workspace.ts:39-42` `'virtual:file-viewer-renderers'` alias
   - `test/fixtures/file-viewer-renderers.ts`
   - `CsvFileViewerPreview.test.tsx` — rewrite: drop `vi.mock('@file-viewer/react')`, drop `MockFile` BOM-capture harness. New cases: papaparse parsing, cell count, single-cell selection, row selection, Cmd+A, Cmd/Ctrl+C → TSV serialization, Tauri clipboard routing mock.

## Requirements (evolving)

- Render `.csv` content as a table inside the existing preview pane (height 100%, width 100%).
- Preserve the customizations decided in Open Question #2.
- Preserve macOS Cmd+C clipboard behavior (currently relies on a Tauri-specific patch in the spreadsheet renderer).
- Drop the apps/desktop `@file-viewer/*` deps identified in Open Question #5.

## Acceptance Criteria (evolving)

- [ ] CSV preview renders without `@file-viewer/react` in apps/desktop.
- [ ] Large CSV (decide threshold in Q1) renders without blocking the UI for > 500 ms on first paint.
- [ ] macOS Cmd+C inside the preview copies the selected cells to the system clipboard.
- [ ] UTF-8 CSV with quoted fields, CRLF/LF, embedded newlines renders correctly.
- [ ] Existing i18n status line preserved (pending Q4).
- [ ] `pnpm build` and `pnpm test` green after cleanup.

## Definition of Done

- Tests added/updated for parsing, rendering, clipboard.
- Lint / typecheck / CI green.
- The `@file-viewer/*` entries in apps/desktop/package.json and the root patch + override removed.
- Behavior parity confirmed against the current spreadsheet renderer for the customizations we chose to keep.

## Out of Scope

- XLSX / ODS / Office format rendering (stays in `extensions/file-viewer`).
- JSON preview pane (task `07-03-json-file-viewer`).
- Rich-text markdown table paste path (`markdownTable.ts`).

## Technical Notes

- Files inspected:
  - `apps/desktop/src/components/file-types/csv/CsvFileViewerPreview.tsx`
  - `apps/desktop/src/components/file-types/csv/CsvFileViewerPreview.test.tsx`
  - `apps/desktop/src/components/file-types/csv/index.ts`
  - `apps/desktop/vite.config.ts`
  - `vitest.workspace.ts`
  - `test/fixtures/file-viewer-renderers.ts`
  - `patches/@file-viewer__renderer-spreadsheet@2.1.17.patch`
  - `apps/desktop/package.json`
  - `apps/desktop/src/main.tsx` (virtual-module comment)
  - `apps/desktop/src/vite-env.d.ts`
- Constraints:
  - macOS Tauri WKWebView has known clipboard quirks (the patch exists for this reason) — in-house renderer must replicate the routing through `@tauri-apps/plugin-clipboard-manager`.
  - No virtualization lib currently in the workspace; adding one is a net new dep.
