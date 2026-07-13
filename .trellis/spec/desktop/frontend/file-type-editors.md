# File Type Editor Patterns

> Patterns for building custom editors for file types beyond plain text/markdown.

---

## Custom Editor Registration

File types that need non-CodeMirror editors register a custom `Editor` component:

```typescript
// src/components/file-types/<type>/index.ts
import type { FileTypeHandler } from '../types';

const handler: FileTypeHandler = {
  id: 'html',
  extensions: ['html', 'htm'],
  supportedViewModes: ['edit', 'preview'],
  defaultViewMode: 'edit',
  needsFileContent: true,
  useCodeMirror: false,        // ← Disables CodeMirror in WorkArea
  Editor: HtmlVisualEditor,    // ← Custom component receives EditorProps
  Preview: HtmlPreview,        // ← Optional read-only preview
};
```

**Contract**: The `Editor` component receives `EditorProps`:
```typescript
interface EditorProps {
  content: string;          // Current file content
  tabId: string;            // Unique tab ID (for key prop)
  filePath: string;         // File path on disk
  onChange: (content: string) => void;  // MUST call on each change
  onSave: () => void;       // Called when save completes
}
```

**Dispatch**: `WorkArea.tsx` renders `handler.Editor` when `useCodeMirror === false && Editor` is defined. It does NOT render CodeMirror in this case — the custom editor owns the edit experience entirely.

**View mode hiding**: Add the file type ID to `HIDE_VIEW_MODE_FILE_TYPES` in `Topbar.tsx` so the split/edit/preview toggle is hidden. The custom editor manages its own mode switching internally.

Reference: `src/components/file-types/html/HtmlVisualEditor.tsx`, `src/components/file-types/excalidraw/index.ts`

---

## Internal Mode Switching

The HTML editor exposes multiple internal modes (visual/source). The active mode is derived from the global editor store's `viewMode` (owned by the Topbar segment, shared with Markdown's split/edit/preview); preview mode is rendered by `WorkArea` via `HtmlPreview`, so `HtmlVisualEditor` only handles `visual` + `source`.

```tsx
// HtmlVisualEditor.tsx
type EditorMode = 'visual' | 'source';

function viewModeToMode(viewMode: string): EditorMode {
  return viewMode === 'source' ? 'source' : 'visual';
}

export function HtmlVisualEditor({ content, onChange }: EditorProps) {
  const viewMode = useEditorStore((state) => state.viewMode);
  const mode = viewModeToMode(viewMode);
  const currentContentRef = useRef(content);

  const handleChange = useCallback((newContent: string) => {
    currentContentRef.current = newContent;
    onChange(newContent);
  }, [onChange]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        {mode === 'visual' && (
          <GrapesEditor content={currentContentRef.current} onChange={handleChange} />
        )}
        {mode === 'source' && (
          <SourceEditCanvas content={currentContentRef.current} onChange={handleChange} />
        )}
      </div>
    </div>
  );
}
```

**Key**: Use `currentContentRef.current` to pass the latest content when switching modes, preventing content loss between canvases. Each canvas manages its own external-vs-user update detection internally — `SourceEditCanvas` diffs the incoming `content` against its CodeMirror doc and suppresses its own change emission during a programmatic swap; `GrapesEditor` is mount-once and never re-reads `content`, so no feedback loop is possible. There is no shared dirty flag between canvases.

Reference: `src/components/file-types/html/HtmlVisualEditor.tsx`, `src/components/file-types/html/GrapesEditor.tsx`

---

## GrapesJS Visual Editor Architecture

The HTML visual mode is a React shell (`GrapesEditor.tsx`) around a GrapesJS editor instance managed by the `useGrapesEditor.ts` hook. Unlike a raw-iframe + host-bridge design, GrapesJS owns the canvas iframe and all in-canvas interaction (selection, drag, rich-text editing, undo/redo, Style/Trait/Layer managers) internally — the host only mounts GrapesJS panels into React-owned container refs and serializes the result.

### Component layout

```
┌──────────────────────────────────┬────────────────┐
│                                  │ styles|layers  │
│   GrapesJS canvas (flex: 1)      │ |traits (260px) │
│   (iframe, GrapesJS-managed)     │ (only when     │
│                                  │  element       │
│                                  │  selected)     │
└──────────────────────────────────┴────────────────┘
```

`GrapesEditor.tsx` holds the DOM refs (`containerRef`, `stylesRef`, `selectorsRef`, `layersRef`, `traitsRef`) and a right-side tabbed panel (`样式` / `图层` / `属性`) that is shown only while a component is selected. The panel container divs are **always mounted** (hidden via the `hidden` class, not unmounted) so the React refs survive show/hide cycles and GrapesJS can attach its managers into them once during the mount-once effect.

### Lifecycle (`useGrapesEditor.ts`)

The hook is **mount-once**: `content` and `onChange` are captured into refs so the GrapesJS lifecycle is not torn down and re-initialized when the parent re-renders. Content echoed back via `onChange` is never fed back into `editor.setComponents` (that would create a write loop).

1. **Init**: `grapesjs.init(createGrapesConfig({...refs}))`, then `registerCustomBlocks(editor)`.
2. **Load content**: `parseHtmlForGrapes(content)` → `editor.setComponents(parsed.bodyContent)` + `editor.setStyle(parsed.styleBlocks.join('\n'))`. A `suppressChangeRef` flag blocks the change pipeline during programmatic load so the input is not echoed back.
3. **On `load`**: `injectExternalLinks(editor, parsed.headContent)` re-injects `<link rel="stylesheet">` tags from the original `<head>` into the canvas iframe, then `injectCanvasScrollbarHide(editor)` hides iframe scrollbars, then `suppressChangeRef` is released.
4. **Change events**: `component:update`, `component:add`, `component:remove`, `component:drag:end`, `styleUpdate`, `style:custom`, `undo`, `redo` are wired to a debounced (500ms) `scheduleContentExtraction` that calls `editor.getHtml()` + `editor.getCss()` → `reconstructHtml(parsed, html, css)` → `onChange(full)`. `component:drag:move` is intentionally NOT wired (fires continuously during drag).
5. **Selection tracking**: `component:select` updates `hasSelection` and bumps a monotonic `selectionTick` (only on non-null selections) so the React shell can show/hide the right panel and reset a user-closed state on each new selection.
6. **Unmount**: `flushFinalContent()` cancels the pending debounce timer and emits the latest `reconstructHtml(...)` BEFORE `editor.destroy()` — so a mode switch before the debounce fires still persists the latest in-memory state.

### Content pipeline (`grapesContentPipeline.ts`)

GrapesJS edits only `<body>` components and the CSS rules; the surrounding document structure is preserved outside the editor and re-attached on serialization.

```typescript
export interface ParsedHtml {
  doctype: string;        // '<!DOCTYPE html>' or ''
  htmlAttrs: string;      // attrs on <html> (e.g. ' lang="en"')
  headContent: string;    // <head> children EXCLUDING <style>/<script> (meta/title/link)
  styleBlocks: string[];  // innerText of each <style> block
  bodyContent: string;    // <body> innerHTML with all <script> tags stripped
  bodyAttrs: string;      // attrs on <body>
  scriptBlocks: string[]; // innerText of every <script> tag in the document
}

export function parseHtmlForGrapes(rawHtml: string): ParsedHtml
export function reconstructHtml(parsed: ParsedHtml, grapesHtml: string, grapesCss: string): string
```

`parseHtmlForGrapes` uses `DOMParser.parseFromString(rawHtml, 'text/html')` and walks `doc.head.childNodes` and `doc.body`, splitting nodes into `styleBlocks` / `scriptBlocks` / `headContent` / `bodyContent`. It is robust to malformed input — on parser failure it falls back to treating the whole string as body content.

`reconstructHtml` reassembles `doctype + <html> + <head> (headContent + a single <style> of merged CSS) + <body> (grapesHtml + scripts)`:

- **CSS merge**: GrapesJS's `getCss()` already serializes the full CssComposer model (including everything fed to `setStyle` on mount), so the original `<style>` blocks are NOT re-appended verbatim — that would compound the file size on every save. Only at-rules GrapesJS may not round-trip faithfully (`@keyframes` / `@font-face` / `@import` / `@charset` / `@namespace`) are filtered out of the originals and re-appended.
- **Scripts**: re-inserted verbatim as the last children of `<body>` (matching end-of-body loading semantics).

### Output cleanliness

GrapesJS's `getHtml()` / `getCss()` produce output free of editor-internal artifacts — no host-injected bridge scripts, no `data-quill-id` tracking attributes, no edit-mode classes. There is no host-side `stripArtifacts` step; serialization is clean by construction.

### Security / script handling

GrapesJS loads content into its own canvas (not a raw iframe with an injected host bridge). Script safety is enforced by the content pipeline, not by sandbox attributes:

- `parseHtmlForGrapes` extracts **all** `<script>` tags (head and body) into `scriptBlocks` and never hands them to `editor.setComponents()`.
- The editor canvas therefore never executes page scripts during editing.
- `reconstructHtml` re-attaches the original scripts verbatim on save, so the file on disk retains them.

### Persistence

Quill owns persistence via the Zustand editor store; GrapesJS's own `storageManager` is disabled (`storageManager: false` in `createGrapesConfig`). The `onChange` callback from `useGrapesEditor` flows into `editorStore.updateTabContent()` → autosave → `vault.writeFile()`. When the file changes on disk externally, `editorStore`'s `externalContentVersion` increments and `WorkArea` remounts `HtmlVisualEditor` (via `key={tabId}-${version}`), re-initializing GrapesJS with the new content.

### Undo/Redo

GrapesJS provides a fine-grained `UndoManager` internally; `undo` and `redo` events are wired into the same debounced content-extraction pipeline. There is no host-side snapshot stack — the host does not need to track history at all.

Reference: `src/components/file-types/html/GrapesEditor.tsx`, `src/components/file-types/html/useGrapesEditor.ts`, `src/components/file-types/html/grapesContentPipeline.ts`, `src/components/file-types/html/grapesConfig.ts`

---

## GrapesJS Panel Configuration

`createGrapesConfig(opts)` (in `grapesConfig.ts`) builds the config handed to `grapesjs.init()`:

- **Panels disabled** (`panels: { defaults: [] }`): the React shell renders its own toolbar; no GrapesJS built-in top bar.
- **Storage disabled**: Quill's store owns persistence.
- **Managers mounted into React refs**: `styleManager.appendTo`, `selectorManager.appendTo`, `layerManager.appendTo`, `traitManager.appendTo`. (BlockManager is left at its default hidden container — the React shell no longer renders a block-library sidebar; `registerCustomBlocks` still mutates the registry.)
- **DeviceManager**: three devices (`桌面` / `平板` 768px / `手机` 375px).
- **Canvas styles**: external font stylesheet injected into the canvas iframe.
- **i18n**: `locale: 'zh'` with a Chinese message map covering StyleManager property labels, trait labels, layers, selectors, and device names.
- **StyleManager sectors**: 6 sectors — `字体` (typography), `背景` (background), `尺寸` (dimensions), `间距` (spacing), `边框` (border), `布局` (layout) — covering the full CSS surface area specified in prd §4.3.
- **Plugin**: `grapesjs-blocks-basic` with `flexGrid: true`.

Helper exports in the same file:

- `injectExternalLinks(editor, headContent)` — re-injects `<link rel="stylesheet">` from the parsed head into the canvas iframe on `load`.
- `injectCanvasScrollbarHide(editor)` — injects a `<style data-quill="canvas-scrollbar-hide">` into the iframe `<head>` to suppress scrollbars while keeping wheel/trackpad scrolling.

Reference: `src/components/file-types/html/grapesConfig.ts`, `src/components/file-types/html/grapesBlocks.ts`

---

## Theme Adaptation

`grapesTheme.css` maps GrapesJS's CSS classes to Quill's design-system CSS variables (`--panel`, `--surf`, `--surf2`, `--brd`, `--hov`, `--acc`, `--accdim`, `--t1`/`--t2`/`--t3`, `--inp`). Because every override references `var(--xxx)`, light/dark theme switching is automatic via the `[data-theme]` attribute on the root — no JavaScript intervention is needed. The file is imported once by `useGrapesEditor.ts` alongside `grapesjs/dist/css/grapes.min.css`.

Reference: `src/components/file-types/html/grapesTheme.css`

---

## FileViewer Spreadsheet Preview (CSV / XLSX / ODS)

CSV, XLSX, ODS previews use `@file-viewer/react` with `@file-viewer/preset-office`. The spreadsheet renderer (`@file-viewer/renderer-spreadsheet`) internally renders via `e-virt-table` — a **canvas-based** virtual table, not an HTML `<table>`.

### Gotcha: CSS overrides on `table/th/td` are dead code

> **Warning**: The spreadsheet renderer does NOT produce an HTML `<table>` element. The cells are drawn on a `<canvas>` by `e-virt-table`. CSS selectors like `.csv-preview-container table { width: 100% }` or `.csv-preview-container td { ... }` match nothing and have zero effect.

If you need to change column-width behavior for CSV/XLSX/ODS, CSS cannot do it. The column widths are computed in JS by the renderer's `buildColumns` (in `dist/spreadsheet/view.js`) and `e-virt-table`'s init logic (in `e-virt-table/dist/index.es.js`).

### Width-fill is hardcoded off; `FileViewerSpreadsheetOptions` has no toggle

The renderer explicitly sets `widthFillDisable: true` on every column (data columns AND the index/row-number column) inside `buildColumns`. This disables `e-virt-table`'s built-in "distribute remaining container width across columns" logic (which fires in `init()` when `resizeNum > 0`). `FileViewerSpreadsheetOptions` only exposes `worker`, `workerUrl`, `workerAutoThreshold`, `resizableColumns`, `resizableRows` — no width-fill switch.

Result: tables render at their measured content width, left-aligned, with empty space on the right when the container is wider than the content.

### Convention: Use `pnpm patch` to enable width-fill for spreadsheet family

When width-fill is required for CSV/XLSX/ODS previews, patch the renderer via `pnpm patch`:

```bash
pnpm patch @file-viewer/renderer-spreadsheet@2.1.17
# edit dist/spreadsheet/view.js in the temp dir
pnpm patch-commit <temp-dir>
```

**The minimal patch**: change line 267 (the data-column branch of `buildColumns`) from `widthFillDisable: true` to `widthFillDisable: false`. Leave line 246 (the `INDEX_COLUMN_KEY` column) as `true` — the row-number column must keep its fixed width.

After the patch, `e-virt-table`'s init() auto-distributes extra container width across data columns on every render and on every container resize. No DOM hack, no instance capture. The patch file lives at `patches/@file-viewer__renderer-spreadsheet@2.1.17.patch` in the repo root and is auto-applied by `pnpm install` via `package.json`'s `pnpm.patchedDependencies` block.

### Scope: only the spreadsheet family is affected

Other FileViewer renderers already fill the container and need no patch:
- **PDF** (`@file-viewer/renderer-pdf`): scale-based zoom, fit-page.
- **Word** (`@file-viewer/renderer-word`): HTML pages with `width: 100% !important`.
- **Presentation** (`@file-viewer/renderer-presentation`): slide HTML, fills container.
- **OFD** (`@file-viewer/renderer-ofd`): page-based, similar to PDF.

### Risks

- Upgrading `@file-viewer/renderer-spreadsheet` may break the patch (line numbers shift, field names change). Pin the version (no `^`) in `package.json` while the patch is in use.
- `e-virt-table` internal API changes (`widthFillDisable` field renamed, `resizeAllColumn` logic changed) would silently re-disable width-fill. Re-verify after any `e-virt-table` version bump.

### Convention: Index/row-number column auto-width by digit count

The renderer hardcodes `INDEX_COLUMN_WIDTH = 68` and applies it as `width = minWidth = maxWidth` on the `__index` column. For small files (single-digit rows) this is too wide and wastes data-column space. Patch `buildColumns` to compute width from `ws.meta.totalRows` digit count:

```js
export const computeIndexColumnWidth = (totalRows = 0) => {
    const digits = Math.max(1, String(totalRows || 1).length);
    return Math.min(80, Math.max(28, 16 + digits * 9));
};
```

Call it inside `buildColumns(ws)` with `ws.meta?.totalRows`. Keep `width = minWidth = maxWidth` (column stays non-resizable) and keep `widthFillDisable: true` (index column does not participate in width-fill distribution — only data columns do).

Reference: `apps/desktop/src/components/file-types/csv/CsvFileViewerPreview.tsx`, `patches/@file-viewer__renderer-spreadsheet@2.1.17.patch`

---

## DBML ER Diagram (`.dbml`)

DBML files use CodeMirror for editing (`useCodeMirror: true`) with SQL syntax highlighting as a fallback, and render an ER diagram preview via `@dbml/core` (parse) + `d3-force` (layout, `erLayout.ts`) + **`@antv/x6` v3** (rendering — `ErDiagramX6.tsx`, replaced the original hand-drawn SVG renderer `ErDiagramPreview.tsx` which no longer exists).

### Handler registration

```typescript
// src/components/file-types/dbml/index.ts
const handler: FileTypeHandler = {
  id: 'dbml',
  extensions: ['dbml'],
  supportedViewModes: ['split', 'edit', 'preview'],
  defaultViewMode: 'split',
  needsFileContent: true,
  useCodeMirror: true,          // CodeMirror editor (SQL fallback highlighting)
  Preview: ErDiagramX6,         // React.lazy-loaded @antv/x6 renderer
};
```

`dbml` is added to `PreviewPane.tsx`'s `fullBleed` set so the diagram fills the pane (no padding/scroll gutter), matching `csv`/`office`.

### CodeMirror SQL fallback for `.dbml`

`@codemirror/language-data` has no DBML LanguageDescription, so `.dbml` would get no highlighting. `EditorView.tsx` special-cases `.dbml` (alongside the `.json` branch) and loads the SQL LanguageDescription from the shared `languages` array:

```typescript
const sqlDesc = languages.find((l) => l.name === 'SQL');
if (sqlDesc) {
  sqlDesc.load().then((langSupport) => {
    view.dispatch({ effects: langCompartment.current.reconfigure(langSupport) });
  });
}
```

No new `@codemirror/lang-sql` direct dependency is needed — it is a transitive dep of `@codemirror/language-data` and loads on demand. DBML-specific keywords (`Table`/`Ref`/`Enum`/`Indexes`) are not in SQL's keyword set, so they render as plain identifiers; this is the accepted trade-off for the MVP (a precise Lezer grammar for DBML is explicitly out of scope).

### Parser: `@dbml/core` (pin `8.3.1`)

- **Version pin is mandatory**: `@dbml/core`'s npm `latest` dist-tag points at `9.0.0-alpha.2`; a bare `@dbml/core` installs the alpha. Pin `"@dbml/core": "8.3.1"` (no `^`) in `apps/desktop/package.json`.
- **Bundle size**: ~15 MB minified — the package bundles antlr4-generated SQL parsers (MySQL/Postgres/MSSQL/Oracle/Snowflake) that cannot be tree-shaken. `parseDbml.ts` therefore lazy-loads it via `await import('@dbml/core')` on first ER preview open, so the rest of the app's first-paint is unaffected.
- **Build memory**: terser minifying the 15 MB chunk exhausts Node's default 4 GB heap → OOM. The `build` script sets `NODE_OPTIONS=--max-old-space-size=8192`.
- **API**: `Parser.parse(str, 'dbml')` is synchronous and returns a `Database`. Use `db.export().schemas[0]` to get plain JSON (avoids circular refs on class instances).
- **Cardinality**: DBML uses operators (`>` `<` `-` `<>`), NOT `[1:*]` bracket syntax (brackets throw a syntax error in 8.3.1). Each `ref.endpoints[i].relation` is `'1'` or `'*'`; for `>`/`<` the endpoints are reordered so ep0 is always the `'1'` side. Read `endpoint.relation` directly; ignore operator direction.
- **Errors**: parse failures throw `CompilerError`; `err.message` is `undefined` — read `err.diags[i].message` + `err.diags[i].location.start.line/column`. Semantic errors sometimes have an empty `message`; fall back to a line-based message.

Reference: `src/components/file-types/dbml/parseDbml.ts`, `src/components/file-types/dbml/erLayout.ts`, `src/components/file-types/dbml/ErDiagramX6.tsx`, `.trellis/tasks/07-03-er-diagram-file-type-with-dbml-syntax/research/dbml-core-api.md`

### Renderer: `@antv/x6` v3 + `manhattan` router (`ErDiagramX6.tsx`)

Table/enum cards are `@antv/x6-react-shape` `register()`-ed React components positioned by `erLayout.ts`'s `layoutEr()` (d3-force). Relationship edges use x6's `manhattan` router (the only *obstacle-aware* built-in router — `er`/`normal`/`orth` ignore other nodes entirely) with **per-edge** `excludeNodes: ['t:${fromTable}', 't:${toTable}']` so the edge's own endpoints don't block its own port-adjacent start/end points (x6 3.1.7's shared obstacle-map cache key already includes `excludeNodes`, so per-edge values correctly force a rebuild — this is not a caching bug to "fix" again).

> **Gotcha — silent fallback draws straight through cards**: `manhattan`'s A* returns `null` when it can't find an accessible start/end point (e.g. two *unrelated* cards sitting closer than the router's `padding`, 16px, apart). On `null`, x6 logs `Unable to execute manhattan algorithm, use orth instead` and silently falls back to `orth`, which is **not** obstacle-aware — the edge is drawn as a straight line through whatever card is in the way. There is no drag-time collision avoidance built into x6 (`interacting.nodeMovable: true` has no collision constraint), so a user dragging two cards close together is the most common real-world trigger.
>
> **Fix (already applied)**: `erLayout.ts` exports a pure `boxesTooClose(a, b, minGap)` helper; `ErDiagramX6.tsx`'s `node:change:position` handler reverts a drag to the last known non-colliding position (tracked in `lastValidPositionsRef`) whenever it would bring the dragged card within `DRAG_MIN_GAP` (24px) of any other card — this keeps every pair of cards far enough apart that the router's obstacle map always has an accessible route, instead of trying to detect/repair a bad path after the fact. If you touch edge routing again, keep this invariant (`DRAG_MIN_GAP` ≥ router `padding`) rather than re-deriving it.

### Pattern: CSS-only edge interaction state (click-to-highlight)

For per-edge interaction feedback (e.g. click-to-highlight with a "flowing dashes" animation), prefer driving it through `edge.attr('line', {...})` + a CSS `@keyframes` string rendered in the component's own JSX (`<style>{EDGE_FLOW_ANIMATION_CSS}</style>`) over a `requestAnimationFrame` loop — it's cheaper and the animation is scoped to the component's lifecycle (mounts/unmounts with it, no manual `document.head` append/cleanup). Track single-selection state in a `useRef<string | null>` (not React state — avoids re-rendering the whole graph on every click) and extract the "which edge should now be selected" transition into a pure function (see `nextSelectedEdgeId` next to `boxesTooClose`) so it's unit-testable without a real x6 `Graph`.

> **Gotcha**: `graph.clearCells()` (called on every content re-parse to rebuild nodes/edges) destroys the currently-selected edge's cell. Any ref tracking "selected edge id" must be reset to `null` at the same point, or a stale id can silently no-op against a cell that no longer exists.

> **Gotcha — jsdom can't render a real x6 `Graph`**: `@antv/x6`'s `NodeView`/`EdgeView` call real SVG APIs (`getScreenCTM`, `createSVGMatrix`, `getBBox`) that jsdom does not implement (`TypeError: svgDocument.createSVGMatrix is not a function`). Don't write vitest tests that mount an actual `Graph` for this file — extract any logic worth testing into pure functions (`boxesTooClose`, `nextSelectedEdgeId`) and unit-test those directly; verify actual rendering/interaction by opening a `.dbml` file in the running app.

### Layout: d3-force, static SVG

`erLayout.ts` runs `forceSimulation` synchronously (`for (i<ticks) sim.tick()`) to convergence — NOT animated on each tick. This gives a stable static layout (no React re-render churn) and deterministic output (grid start positions, since d3-force has no built-in seed). Tables are nodes (`forceCollide` keyed on estimated card size), refs are links. The SVG renders table cards (header + field rows with PK/NN/UQ/AI marks) and bezier relationship lines with cardinality badges (`1` / `∞`) at both endpoints. Theme adapts automatically via CSS variables (`--bg`/`--surf`/`--brd`/`--t1`/`--t2`/`--t3`/`--acc`) — no JS theme switching.

### Out of scope (explicit MVP boundary)

- Interactive drag/zoom/pan (static layout only)
- `TableGroup` / `StickyNote` / `Enum` dedicated visualization
- DBML → SQL DDL generation; reverse engineering from a live database
- Precise DBML Lezer grammar (SQL fallback is accepted)
