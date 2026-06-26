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
