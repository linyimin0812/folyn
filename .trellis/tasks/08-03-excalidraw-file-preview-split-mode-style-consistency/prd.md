# Excalidraw file-preview split-mode style consistency

## Goal

When a markdown file embeds an `.excalidraw` via `:::file-preview{src="..."}`, the rendered Excalidraw UI lays out differently between markdown **split** mode (preview pane ~50% width → Excalidraw UI grid squeezes, MainMenu icon drifts) and markdown **preview** mode (preview pane full width → Excalidraw UI lays out as designed, icons at top-left). Make split mode render the same way as preview mode.

## Background

- `:::file-preview` directive → `packages/container-plugins/src/plugins/FilePreviewPlugin.tsx` → `FilePreviewComponent`
- Body div: `style={{ height: 420, overflow: 'auto' }}` (fixed height, **width = container width**)
- Inside body: `ctx.renderFile` returns `ExcalidrawPreview` for `.excalidraw` src
- `ExcalidrawPreview` wrapper: `className="w-full h-full relative [&_.excalidraw]:w-full [&_.excalidraw]:h-full"` (no min-width)
- Excalidraw internal UI: `.excalidraw .App-menu_top { grid-template-columns: 1fr 2fr 1fr; grid-gap: 2rem }` — needs ~600–800px to lay out without wrapping; below that, icons shift/wrap

Confirmed in chat: only **one** rendering path for `:::file-preview` (FilePreviewPlugin in both split and preview markdown modes); the divergence is purely Excalidraw UI responding to container width.

## Requirements

- Excalidraw UI inside `:::file-preview` body renders consistently regardless of markdown pane width
- In split mode, icons stay at top-left as they do in preview mode
- No layout regression for standalone `.excalidraw` preview (rare; Topbar hides toggle for `excalidraw`) — min-width only triggers horizontal scroll when pane is narrower than the threshold, which is the desired behavior

## Acceptance Criteria

- [ ] Open a markdown file with `:::file-preview{src="diag.excalidraw"}` in markdown **split** mode → Excalidraw MainMenu / function icons appear at top-left, matching **preview** mode
- [ ] Preview mode (full pane width) rendering unchanged
- [ ] When pane is narrower than min-width, horizontal scroll appears inside the file-preview body (overflow:auto already set)
- [ ] Standalone `.excalidraw` preview (preview pane, full width) still renders correctly

## Technical Approach

Add `min-w-[800px]` to `ExcalidrawPreview`'s wrapper div. `w-full` + `min-w-[800px]` → wrapper is at least 800px wide; parent containers already provide `overflow: auto` (FilePreviewPlugin body, PreviewPane, markdown prev-body), so horizontal scroll handles narrow panes.

Single-file change: `apps/desktop/src/components/file-types/excalidraw/ExcalidrawPreview.tsx`.

### Why min-width on ExcalidrawPreview (not FilePreviewPlugin body)

FilePreviewPlugin renders many file types (dbml/drawio/mmap/excalidraw). A blanket min-width would force horizontal scroll for types that don't need it. Pinning on ExcalidrawPreview scopes the fix to the only component whose internal UI has a width-responsive grid.

## Decision (ADR-lite)

- **Context**: Excalidraw's `.App-menu_top` 3-col grid collapses when container < ~800px, causing icon drift in markdown split mode.
- **Decision**: Force ExcalidrawPreview's wrapper to `min-width: 800px`; rely on existing `overflow: auto` in parents for scroll.
- **Consequences**: Split-mode users see horizontal scroll inside the file-preview body when pane is narrow — matches user's choice ("split 下出现横向滚动"). 800px is a heuristic; if Excalidraw UI still wraps at 800, bump it.

## Out of Scope

- Modifying Excalidraw's internal CSS (`.excalidraw .App-menu_top` overrides) — risky, version-fragile
- Changing `FilePreviewPlugin` body dimensions
- Fixing the `![](diag.excalidraw)` image-embed path (VaultImage in MarkdownPreview) — separate issue, ExcalidrawPreview there has no height context and likely renders at 0-height already

## Technical Notes

- `ExcalidrawPreview.tsx:43` — wrapper div
- `FilePreviewPlugin.tsx:170` — body div with `overflow: 'auto'`
- Excalidraw CSS: `node_modules/.pnpm/@excalidraw+excalidraw@0.18.1_*/dist/prod/index.css` — `.App-menu_top{grid-template-columns:1fr 2fr 1fr;grid-gap:2rem}`
- Tailwind arbitrary value `min-w-[800px]` already used in codebase (e.g. `min-w-[200px]` in PreviewPane)
