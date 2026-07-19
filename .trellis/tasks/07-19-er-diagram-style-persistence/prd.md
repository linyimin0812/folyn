# ER Diagram Style Persistence

## Goal

Persist user-adjusted ER diagram styles (drag positions, zoom, grid, optional
theme/background) so reopening a `.dbml` file restores the prior view. Mimic
the mmap plaintext persistence pattern: a trailing metadata block appended to
the file content, written back through `PreviewProps.onChange`. Add a bottom
button that opens a floating panel showing the persisted style summary.

## What I already know

### ER diagram (dbml) — current state
- `apps/desktop/src/components/file-types/dbml/index.tsx` — handler, omits `onChange` (PreviewProps.onChange is optional, see `../types.ts:24`)
- `apps/desktop/src/components/file-types/dbml/ErDiagramX6.tsx` (~1435 lines) — main renderer using `@antv/x6`
  - Runtime state: `showGrid` (line 82), `zoomPct` (line 83), `manualPositionsRef` (line 90), `lastValidPositionsRef` (line 96), `selectedEdgeIdRef` (line 100), `firstLoadRef` (line 104)
  - Colors come from CSS vars (`--t3`, `--brd2`, `--hov`) + DBML per-table `headerColor` field (line 727); no per-file theme switcher exists
  - Top-right floating `Toolbar` (line 540, defined at :582): zoom in/out, fit, grid toggle. No bottom button currently
- `apps/desktop/src/components/file-types/dbml/parseDbml.ts` — DBML parser wrapper; dynamic-imports `@dbml/core`. No meta-block handling today
- DBML uses `//` and `/* */` for comments; HTML `<!-- -->` is not standard but we strip the meta block before parsing, so format is our choice

### mmap persistence pattern (to mimic)
- `apps/desktop/src/components/file-types/mmap/outlineConverter.ts:155-339`
- Format: trailing `<!-- mmap:meta\n<directive-per-line>\n-->` block at end of file
- Directives: `styles: <JSON>`, `mapStyle: <JSON>`, `arrow:`, `summary:`, `link:`
- `extractMetaBlock(content)` (line 228) splits outline text from meta block; parser only sees outline text
- `serializeMetaBlock(meta)` (line 317) emits the block only when at least one directive exists (empty = no block)
- mmap wires `onChange` in `index.ts`; `MindMapCanvas.syncOut` (line 297) calls `onChange(mindElixirDataToOutline(inst.getData(), canvasStyleRef.current))` on every operation event
- Plain text file = single source of truth, no sidecar, no IndexedDB

## Requirements

- **Wire `onChange`** for dbml PreviewProps so the preview can write back to the file content (and `editorStore.updateTabContent` persists via Cmd+S / auto-save)
- **Meta block format**: trailing `<!-- dbml:meta\n<directives>\n-->` block at end of file; stripped before parsing so `@dbml/core` never sees it; emitted only when at least one style differs from defaults
- **Persisted fields** (decision: skip theme persistence — no per-file theme switcher exists today):
  - `positions: <JSON map of tableName -> {x,y}>` — manual node drag positions (manualPositionsRef)
  - `view: <JSON of {zoomPct, showGrid}>` — zoom + grid toggle
- **Write-back trigger**: on debounced changes to manualPositions / zoomPct / showGrid (debounce ~500ms, like mmap's syncOut cadence), regenerate meta block + emit full content (dbml text + meta block) via onChange
- **Parse on load**: `parseDbml` (or a thin wrapper) extracts the meta block first; ErDiagramX6 reads meta to restore positions/zoom/grid/theme before/after graph init
- **Bottom button**: a small button pinned to the bottom-center (or bottom-right) of the canvas; click opens a floating panel showing a read-only summary of the currently-persisted style state (positions count, zoom, grid, theme) — similar to mmap's right-edge vertical toolbar + floating `CanvasStylePanel` but at the bottom and read-only display only

## Open Questions

- (Resolved 2026-07-19) Color theme / canvas background — **skip**. ErDiagramX6 has no per-file theme switcher today (colors come from app CSS vars + DBML `headerColor`). Adding a theme/background picker is scope-creep beyond "persist what exists". If a theme switcher is added later, extend the meta block with a `theme:` directive — format reserved.

## Acceptance Criteria

- [ ] Opening a `.dbml` file, dragging nodes, toggling grid, zooming, then Cmd+S — closing and reopening the tab restores the exact positions/zoom/grid
- [ ] A user with no style adjustments has NO meta block in their file (no behavioral change for existing files)
- [ ] Editing dbml content in CodeMirror while a meta block exists preserves the meta block (no loss on text edits)
- [ ] Bottom button visible in the ER preview; clicking opens a panel showing the persisted style summary
- [ ] `@dbml/core` parser never receives the meta block (stripped before parse) — no regression in parse errors

## Definition of Done

- Lint / typecheck / build green
- Manual test: open a `.dbml` file, adjust styles, save, reopen — state restored
- Manual test: existing `.dbml` files without meta block behave identically to before
- No new dependencies added

## Out of Scope

- Per-table headerColor editing in the preview (DBML source already drives this via the `headerColor` field)
- Sidecar files / IndexedDB / separate persistence layer
- Per-edge style persistence (only node positions, zoom, grid, theme)
- Backwards-compat shims for any pre-existing meta format (no prior format exists)

## Technical Approach

### Format
```
<!-- dbml:meta
positions: {"users":{"x":120,"y":80},"orders":{"x":340,"y":200}}
view: {"zoomPct":85,"showGrid":true}
-->
```

### Code changes
1. `parseDbml.ts` — add `extractDbmlMeta(content)` returning `{ dbml, meta }`; `parseDbml` strips meta before calling `@dbml/core`. Export `serializeDbmlMeta(meta)` for write-back.
2. `ErDiagramX6.tsx` — accept `onChange` from PreviewProps; on debounced state changes, regenerate meta block + emit full content via onChange. On mount/`content` change, read meta and seed `manualPositionsRef`/`zoomPct`/`showGrid` before graph init.
3. `dbml/index.tsx` — pass `onChange` through to `ErDiagramPreview` (mirror mmap handler).
4. Bottom button — small floating button at bottom-center of canvas; click opens a read-only panel showing position count, zoom %, grid state, theme (if applicable).

### mmap analogues
- `outlineConverter.ts`'s `extractMetaBlock` / `serializeMetaBlock` → our `extractDbmlMeta` / `serializeDbmlMeta`
- `MindMapCanvas.syncOut` → our debounced `syncMetaOut` helper inside ErDiagramX6
- mmap right-edge vertical toolbar → our bottom button (display only, no edit affordance)

## Technical Notes

- The dbml editor is CodeMirror (separate from preview); unlike mmap where OutlineEditor IS the editor. When preview writes back via onChange, the CodeMirror editor content updates too — the user will see the `<!-- dbml:meta -->` block at the bottom of their file. Acceptable: it's clearly-marked as metadata, users don't need to edit it, accidental deletion just loses style state (not data loss).
- Merge invariant: when emitting content via onChange, we MUST preserve the user's current dbml text exactly (strip existing meta block first, then append the new one). Failure to do so would rewrite the user's dbml with stale text.
- `parseDbml` is called from ErDiagramX6 mount effect; the meta-strip must happen there (or inside parseDbml itself). Putting it inside parseDbml keeps ErDiagramX6 simpler.
- `ponytail:` ceiling: positions keyed by table NAME (not x6 internal cell id) — renaming a table in dbml orphans its position entry, which is silently dropped on next serialize. Matches mmap's topic-text ceiling. Upgrade path: inline `#id:xxx` suffix on table defs if renaming becomes common.
