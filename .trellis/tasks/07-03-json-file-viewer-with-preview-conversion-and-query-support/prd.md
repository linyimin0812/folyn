# JSON file viewer with preview, conversion, and query support

## Goal

Add a JSON file type handler (mirroring the CSV handler pattern in `apps/desktop/src/components/file-types/csv/`) and a feature-rich JSON preview pane — a "JSON workbench" — supporting 6 input formats, jq + JSONPath query, 6+ output converters, syntax-highlighted editor with minimap, custom tree viewer, and structural diff. Implemented as **one task, full feature** per user decision.

## Requirements

### R1. File type registration
- New folder `apps/desktop/src/components/file-types/json/` with `index.ts` registering handler for extension `.json`.
- Handler config: `id: 'json'`, `extensions: ['json']`, `supportedViewModes: ['split', 'edit', 'preview']`, `needsFileContent: true`, `useCodeMirror: true`, `Preview: JsonFileViewerPreview`.
- Edit mode continues to use the existing CodeMirror JSON editor in `EditorView.tsx` (already wired with `@codemirror/lang-json` + linter).
- Preview mode renders the new `JsonFileViewerPreview`.

### R2. Preview layout: toolbar tabs + split pane
- Top toolbar with 4 tabs: **Input | Query | Convert | Diff**.
- Left pane: CodeMirror 6 JSON5 editor (custom lightweight setup, no markdown extensions) — accepts pasted content.
- Right pane: tab-dependent content (tree / query result / converter output / diff view).
- Toolbar global toggles (off by default per user decision): **Auto-copy**, **Auto-sort**, theme follows system (automatic via Tailwind tokens).

### R3. Input formats (left pane accepts paste; auto-detect with manual override)
1. **JSON5** — `json5` lib (lazy-loaded). Comments, unquoted keys, trailing commas, hex numbers, etc.
2. **JSON escape string** — unwrap outer quotes + `JSON.parse` with unescape.
3. **Base64-encoded JSON** — native `atob` + `TextDecoder` (UTF-8 safe).
4. **YAML** — `yaml` lib (lazy-loaded).
5. **XML** — `fast-xml-parser` (lazy-loaded), with `@_attr` prefix convention for attributes.
6. **CSV (incl. TSV from Excel clipboard)** — `papaparse` (lazy-loaded); yields `Array<Record<string, string>>` (array root, no wrapper).
- Auto-detect order: JSON5 → escaped-JSON → Base64 → YAML → XML → CSV. Failure falls through. User can force a mode via dropdown.
- Parse result stored as canonical `parsedValue: unknown` (object OR array root).

### R4. Right pane tab: Input (rendered tree)
- Custom React tree viewer using `@radix-ui/react-collapsible`.
- Features: collapsible nodes, copy-key-path-on-click, copy-value-on-click, expand-all/collapse-all, search/filter by key or value.
- Sticky block headers for top-level keys (3 lines of CSS).
- Renders object AND array roots (R3 note).

### R5. Right pane tab: Query
- Toggle between **jq** and **JSONPath**.
- jq: `jq-wasm` (~2 MB, lazy-loaded ONLY when jq tab engaged; loaded into a Web Worker to avoid blocking UI).
- JSONPath: `jsonpath-plus` (~50 KB, lazy-loaded).
- Query result rendered in the same tree viewer as R4.

### R6. Right pane tab: Convert
Buttons producing on-demand output (rendered as text in right pane with copy button):
- **YAML** — `yaml.stringify`.
- **XML** — `fast-xml-parser` `XMLBuilder` with documented attribute convention.
- **Excel (.xlsx)** — `exceljs`, two modes: single-header (flat array) and multi-header (nested object → merged multi-row headers). Triggers a file download via Tauri `dialog.save` + `fs.write`.
- **Base64** — native `TextEncoder` + `btoa` (UTF-8 safe).
- **Escape string** — `JSON.stringify` of the parsed value (single-line).
- **Language serializers** — hand-written template strings (no `quicktype`): Python `json.dumps`, Go `json.Marshal`, Rust `serde_json::to_string`, Java `ObjectMapper.writeValueAsString`, PHP `json_encode`, C# `JsonSerializer.Serialize`. Each ~10 lines.

### R7. Right pane tab: Diff
- Two side-by-side sub-panes: left = current `parsedValue`, right = paste-or-load second JSON (same input-format pipeline as R3).
- Engine: `jsondiffpatch.diff(a, b)` returns structured delta.
- Renderer: `jsondiffpatch.formatters.html` rendered inside an `<iframe srcDoc=...>` for CSS isolation.
- Theme: iframe content re-themed via postMessage or pre-rendered CSS swap on theme change (dark mode support required).
- "Sort both before diff" toolbar toggle (off by default; user can enable for clearer diffs).

### R8. Editor UX (left pane CodeMirror)
- Syntax highlighting via `@codemirror/lang-json` extended for JSON5 (trailing comma, comments, unquoted keys — fall back to `json5` parse + plain text highlight if JSON5 lang support unavailable).
- Code folding: built-in `foldGutter`.
- Block pin (sticky headers): in tree viewer, not editor (per research).
- Minimap: `@replit/codemirror-minimap` (included per user decision).
- Autocomplete: custom `CompletionSource` walking parsed AST for key completion (no off-the-shelf lib).
- Linter: reuse `jsonLintSource` pattern from `EditorView.tsx`, generalized to JSON5.
- Light/dark theme: follows system via Tailwind `dark:` classes; CM theme reconfigured on system theme change.

### R9. Clipboard automation (off by default per user decision)
- **Auto-copy** toggle: when ON, after Format/Sort/Query/Convert operations the result is auto-copied to clipboard with a toast notification.
- **Auto-sort** toggle: when ON, deep recursive key sort (`sortKeysDeep`, 15 lines hand-rolled) applied on every parse.
- Manual copy buttons always available.

### R10. Property auto-sort
- `sortKeysDeep(obj: unknown): unknown` — hand-rolled recursive sort (object keys sorted alphabetically; arrays preserved).
- Applied when Auto-sort toggle is ON (R9) or "Sort both before diff" is ON (R7).

## Acceptance Criteria

- [ ] Opening a `.json` file shows the new preview pane with all 4 tabs functional.
- [ ] Pasting JSON5 content (with comments + unquoted keys) parses and renders the tree.
- [ ] Pasting an escaped JSON string (`"{\"a\":1}"`) parses to `{a:1}` and renders.
- [ ] Pasting Base64-encoded JSON decodes and renders.
- [ ] Pasting YAML / XML / CSV (incl. TSV from Excel) parses and renders.
- [ ] Input-mode dropdown forces a specific parser; auto-detect resume on reset.
- [ ] jq expression (e.g. `.users[].name`) returns matches in the tree.
- [ ] JSONPath expression (e.g. `$.users[*].name`) returns matches in the tree.
- [ ] Convert → YAML/XML/Base64/Escaped produces correct output with copy button.
- [ ] Convert → Excel single-header and multi-header both produce downloadable .xlsx files.
- [ ] At least 3 language serializers (Python/Go/Rust) produce runnable code.
- [ ] Diff tab: side-by-side view renders `jsondiffpatch` HTML in an iframe; add/remove/modify colorized.
- [ ] Diff with "Sort both" toggle ON produces cleaner (smaller) delta on reordered-key inputs.
- [ ] Minimap visible in left editor; folds work; JSON5 lint markers appear on syntax errors.
- [ ] Auto-copy toggle ON → format/sort/query/convert writes to clipboard with toast.
- [ ] Auto-sort toggle ON → keys sorted on parse.
- [ ] Light and dark themes both render correctly (tree, editor, diff iframe).
- [ ] Existing `.json` edit mode (CodeMirror + linter) still works unchanged.
- [ ] CSV handler unaffected; CSV file still opens via `@file-viewer/react`.
- [ ] Unit tests cover: 6 input parsers (positive + negative cases), `sortKeysDeep`, at least 3 converters, jq + JSONPath query.
- [ ] Lint, typecheck, build (`pnpm -w build`) all green.

## Definition of Done

- New deps added to `apps/desktop/package.json`: `json5`, `yaml`, `fast-xml-parser`, `papaparse` (+ `@types/papaparse`), `jsonpath-plus`, `jq-wasm`, `exceljs`, `jsondiffpatch`, `@radix-ui/react-collapsible`, `@replit/codemirror-minimap`.
- Heavy parsers + jq-wasm lazy-loaded via `await import()` (precedent: `@dbml/core` in spec).
- `manualChunks` config in `apps/desktop/vite.config.ts` updated to split jq-wasm into its own chunk.
- Tests added under `apps/desktop/src/components/file-types/json/**/*.test.ts(x)`.
- No regressions in CSV handler or existing JSON edit mode.
- Bundle impact verified via `vite-bundle-visualizer` (jq-wasm chunk isolated, not in initial bundle).
- Rollout: feature ships enabled-by-default (no feature flag needed — opt-in toggles cover risky behaviors).

## Technical Approach

### File structure
```
apps/desktop/src/components/file-types/json/
  index.ts                              # handler registration
  JsonFileViewerPreview.tsx             # main component, owns parsedValue state + tab routing
  components/
    PreviewToolbar.tsx                  # tab switch + global toggles
    JsonTree.tsx                        # custom tree viewer (R4)
    DiffPane.tsx                        # iframe-based diff (R7)
    QueryBar.tsx                        # jq/jsonpath switch + input
    ConvertPanel.tsx                    # converter buttons + output
  lib/
    parseInput.ts                       # auto-detect + parse (R3)
    sortKeysDeep.ts                     # recursive key sort (R10)
    query.ts                            # jq + jsonpath wrappers (lazy-loaded)
    converters/
      index.ts                          # dispatcher
      toYaml.ts
      toXml.ts
      toBase64.ts
      toEscaped.ts
      toExcel.ts                        # single + multi header
      toLanguage.ts                     # Python/Go/Rust/Java/PHP/C# templates
  editor/
    Json5CodeMirror.tsx                 # left-pane editor (R8)
    extensions/
      minimap.ts                        # @replit/codemirror-minimap wiring
      json5Linter.ts                    # JSON5-aware linter
      jsonAutocomplete.ts               # custom CompletionSource
  JsonFileViewerPreview.test.tsx        # smoke tests
  lib/parseInput.test.ts                # parser tests
  lib/converters/toExcel.test.ts        # converter tests
  lib/query.test.ts                     # jq + jsonpath tests
```

### State
- `parsedValue: unknown` — canonical parse result.
- `inputMode: 'auto' | 'json5' | 'escaped' | 'base64' | 'yaml' | 'xml' | 'csv'`.
- `activeTab: 'input' | 'query' | 'convert' | 'diff'`.
- `queryLang: 'jq' | 'jsonpath'`, `queryExpr: string`, `queryResult: unknown`.
- `autoCopy: boolean` (off), `autoSort: boolean` (off), `sortBeforeDiff: boolean` (off).
- `diffValue: unknown` (second input for diff tab).

### Lazy-loading
- `json5`, `yaml`, `fast-xml-parser`, `papaparse`, `jsonpath-plus`, `jq-wasm`, `exceljs`, `jsondiffpatch` — all `await import()` on first use.
- jq-wasm moved to a Web Worker to avoid blocking UI on large queries.
- `manualChunks` split: `jq-wasm` (and its wasm asset), `exceljs`, `jsondiffpatch` each in their own chunk.

## Decision (ADR-lite)

**Context**: User requested 14 capabilities in one JSON preview pane — far broader than the 30-line CSV handler that delegates to `@file-viewer/react`. No equivalent third-party preset covers all capabilities; a custom React component is required.

**Decision**:
1. Build a custom `JsonFileViewerPreview` with 4-tab toolbar + split pane layout.
2. Use researched libraries (json5/yaml/fast-xml-parser/papaparse for input; jq-wasm + jsonpath-plus for query; exceljs + template serializers for output; jsondiffpatch + iframe for diff; @radix-ui/react-collapsible for tree; @replit/codemirror-minimap for editor).
3. All heavy parsers + jq-wasm lazy-loaded.
4. Auto-copy and auto-sort default OFF; both opt-in toggles.
5. Minimap included per user preference (against research recommendation).
6. Diff via jsondiffpatch HTML formatter in iframe (per user preference).
7. Language serializers as template strings, not quicktype.

**Consequences**:
- +10 new deps in `apps/desktop/package.json`; bundle impact mitigated by lazy-loading + manualChunks.
- jq-wasm chunk (~2 MB) only loads when user engages jq tab.
- Diff iframe requires theme-sync logic (CSS swap on dark-mode toggle).
- Custom tree viewer + custom JSON5-aware linter + custom CompletionSource = ~500-800 lines of original code.
- Single task scope = larger PR(s); reviewability managed via file structure (1 file per converter, per parser).

## Out of Scope

- Editing the underlying JSON in preview (existing CodeMirror JSON editor in edit mode already covers this).
- JSON Schema validation (not in user's 14 capabilities).
- Network-based JSON fetch / share / collaboration.
- JMESPath as a third query language (research recommends deferring).
- `quicktype` integration for type-def codegen (language serializers are template strings only).
- `.jsonc` / `.json5` / `.yaml` / `.yml` / `.xml` as separate file-type handlers (could be follow-up tasks; this task only registers `.json`).
- Streaming/partial parse for very large JSON (>50 MB) — out of scope for MVP.
- Tree-view drag-and-drop, multi-select, cut/paste nodes (out of scope).

## Technical Notes

- CSV handler is the template: `apps/desktop/src/components/file-types/csv/index.ts` (16 lines).
- `FileTypeHandler` interface in `apps/desktop/src/components/file-types/types.ts`.
- Registry auto-loads via `import.meta.glob('./*/index.ts')`.
- Existing CM6 JSON support in `apps/desktop/src/editor/EditorView.tsx` (lines 49, 329-339) — extract `jsonLintSource` for reuse, generalize to JSON5.
- Repo precedent for lazy-loading heavy parsers: `@dbml/core` per `.trellis/spec/desktop/frontend/file-type-editors.md` lines 294-303.
- Tailwind theme tokens: `bg-panel`, `bg-surf`, `border-brd`, `text-fg` — reuse throughout.
- Tauri plugins available: `plugin-clipboard-manager` (R9), `plugin-dialog` + `plugin-fs` (R6 Excel download).

## Implementation Plan (small PRs within one task)

- **PR1 — Scaffolding**: file-types/json/index.ts + empty JsonFileViewerPreview + tests for handler registration. Verifies preview opens for .json files.
- **PR2 — Input pipeline**: lib/parseInput.ts + lib/sortKeysDeep.ts + tests for all 6 input formats. No UI yet, pure logic.
- **PR3 — Tree viewer + Input tab**: components/JsonTree.tsx + PreviewToolbar.tsx + Input tab wired to parseInput. Editor pane uses placeholder textarea (CM6 comes in PR6).
- **PR4 — Query tab**: lib/query.ts (jq-wasm worker + jsonpath-plus) + QueryBar.tsx + Query tab wired. ManualChunks updated.
- **PR5 — Convert tab**: lib/converters/* + ConvertPanel.tsx + Excel download via Tauri. Tests for 3+ converters.
- **PR6 — Diff tab**: DiffPane.tsx with iframe + jsondiffpatch + theme-sync + sort-before-diff toggle.
- **PR7 — Editor UX**: Json5CodeMirror.tsx + minimap + JSON5 linter + custom autocomplete + light/dark theme wiring.
- **PR8 — Clipboard & toggles**: Auto-copy + Auto-sort toggles, toast notifications, final integration tests.

Each PR is independently reviewable; PR1-3 unblocks basic JSON preview, PR4-7 add capabilities, PR8 polishes.
