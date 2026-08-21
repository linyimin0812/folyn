# Replace mmap file type with markmap

## Goal

Replace the current `.mmap` editor + renderer (mind-elixir + hand-rolled `OutlineEditor` + skeletons + arrows/summaries/per-node styles) with markmap.js — markdown-driven mindmap rendering. Per user decision: **integral replacement, no old-file migration, drop all mind-elixir-only features**.

Keep the file type id `mmap` and extension `.mmap` to avoid ripple through i18n, file-icon, chat/filePath, export menu, file templates. Only the *implementation* changes; the external identity stays.

## Requirements

### R1. Dependencies
- Add `markmap-lib` + `markmap-view` to `apps/desktop/package.json` (workspace root `package.json` if needed for patches).
- Remove `mind-elixir` from `apps/desktop/package.json`, `patches/mind-elixir@5.14.0.patch`, and `pnpm-lock.yaml`.

### R2. File handler (`apps/desktop/src/components/file-types/mmap/`)
- `index.ts` — same id `mmap`, extension `mmap`. `useCodeMirror: true` so edit mode uses the existing CodeMirror Markdown editor (no custom editor). `Preview: MarkmapPreview`. `supportedViewModes: ['split', 'edit', 'preview']`, `defaultViewMode: 'split'`, `needsFileContent: true`.
- `MarkmapPreview.tsx` (replaces `MindMapCanvas.tsx` + `MmapFileViewerPreview.tsx`):
  - `<svg ref>` mount; instantiate `Markmap` once on the svg, call `setData(data)` on content change.
  - Use `Transformer` from `markmap-lib` to transform markdown → `{ root, features }` then `markmap.viewUtils`/built-in `deriveOptions` for styling.
  - Light/dark: read `useAppearanceStore` isDark and toggle a CSS class on the container; markmap picks colors from CSS vars by default — provide minimal CSS overrides for dark.
  - `fit`-on-load + on content change (markmap-view's `fitView`/`autoFit` option).
  - `onChange` writeback: source of truth is the markdown string in `content`; the preview is read-only. No edit-in-canvas.
- Delete: `MindMapCanvas.tsx`, `OutlineEditor.tsx`, `OutlineEditor.test.tsx`, `MindMapCanvas.click.test.tsx`, `outlineConverter.ts`, `topicMarkdown.ts`, `mmapRoundTrip.test.ts`, `MmapFileViewerPreview.tsx`, `skeletons/`.

### R3. File content format
- On disk: markdown text (headings `#`/`##`/`###`/... and bullet `-`/`*` for non-heading children; markmap's default grammar).
- No metadata block, no arrows, no summaries, no per-node style, no skeleton selection. Drop the `<!-- mmap:meta ... -->` block entirely.

### R4. Export service (`apps/desktop/src/services/export/mmap.ts`)
- Rewrite `enhance`: instead of calling `mind-elixir.exportSvg`, render a standalone markmap SVG from the file's markdown content via `Transformer` + a transient `Markmap` mounted off-DOM, then replace the export container's body with that SVG.
- If implementation cost is high, drop the `.mmap` export enhancement entirely and let `exportService` skip `.mmap` files (markmap SVGs can still be obtained by the user via the preview's own "export SVG" toolbar button if we add one — defer to R5).

### R5. Preview toolbar (minimum)
- One button: "Export SVG" — calls `Markmap.getSvg()` (or builds one from the current data) and triggers a Tauri file save dialog. Lazy/optional: defer if time is tight; the export service (R4) is the canonical path.
- Zoom-to-fit on mount + on content change (no manual zoom buttons in v1).

### R6. i18n (`apps/desktop/src/i18n/locales/*/mmap.json`)
- Leave the namespace `mmap` (id unchanged). Delete only keys that referenced deleted UI (skeleton picker, arrows panel, summaries panel, per-node style panel). Keep keys that still apply (preview/export/title).
- If trimming all 7 locales is too noisy, leave the files alone — unused keys are inert. **Default: leave alone** unless a key clearly conflicts.

### R7. File template
- Update the `.mmap` file template (registered in `feat: add plantuml/graphviz/dbml file templates with backfill` pattern) to emit a minimal markdown seed: `# Title\n## Child\n### Grandchild\n`.

## Acceptance Criteria

- [ ] Opening a `.mmap` file shows split view: CodeMirror Markdown editor on the left, markmap SVG on the right.
- [ ] Typing `# Hello\n## World\n### Deep` in the editor updates the SVG live.
- [ ] Light/dark toggle re-themes the SVG.
- [ ] No references to `mind-elixir`, `OutlineEditor`, `outlineConverter`, `skeletons`, `topicMarkdown` remain in `apps/desktop/src`.
- [ ] `pnpm install` succeeds with `mind-elixir` removed and `markmap-lib` + `markmap-view` added.
- [ ] Existing `.mmap` file icon + chat/filePath entry + export menu wiring remain functional (no rename ripple).

## Open questions (decide at impl time)

- markmap-view version + API: `Markmap.create(svg, opts, data)` vs `new Markmap(svg, opts)`. Match whatever the installed version's README shows.
- Dark theme: markmap colors come from the SVG's CSS (`--markmap-*` vars or color tokens). Provide a minimal `:root.dark` override block; avoid pulling a full theme lib.
- `useCodeMirror: true` routing: confirm `EditorView.tsx` actually picks up markdown for `.mmap` when `useCodeMirror` flips from `false` to `true` (it currently special-cases mmap). May need to remove the special case.
