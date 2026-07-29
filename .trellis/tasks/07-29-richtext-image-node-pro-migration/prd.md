# Rich Text: Migrate to Tiptap Image Node Pro

## Goal

Replace the hand-rolled `RichTextImage` extension with Tiptap's official **Image Node Pro** UI component (vendored source via `npx @tiptap/cli add image-node-pro floating-element toolbar`). Solves the user's recurring pain points structurally instead of with CSS patches:

- **Blur** on retina screenshots → drag-to-resize lets the user size to device-pixel parity (no CSS upscale).
- **Click selection highlight** flip-flopping → built-in selection highlighting with proper visual feedback.
- **Drag = copy** bug → proper drag-handle node-view path = move.
- Plus: editable captions, alignment, floating toolbar, delete button, accessibility / keyboard nav.

## What I already know

- Current: `apps/desktop/src/components/file-types/rich-text/RichTextImage.tsx` extends `@tiptap/extension-image@3.29.2` with:
  - React `NodeView` that resolves vault-relative `src` → loadable `asset://` URL (async `homeDir()` resolution via `resolveBasePath`).
  - Paste/drop plugin that writes image files to vault (hash-named, dedup) and inserts vault-relative-src Image node.
  - Pure helpers `resolveVaultRelativePath` + `isLoadableUrlScheme` (unit-tested in `rich-text-image.test.ts`).
  - `persistImageBytes` exported — used by `RichTextToolbar.tsx`'s file-picker path.
- Disk format: tiptap native JSON string (`serializeToDisk` / `deserializeToContent` in `richTextContent.ts`); anti-loop predicate (`shouldApplyExternalContent`).
- `RichTextToolbar.tsx` is a host-drawn icon toolbar for text formatting (bold/italic/headings/lists/link/image/table/undo/redo) + table-cell controls.
- Tiptap deps locked at `3.29.2` across `@tiptap/{core,extension-image,extension-table,extension-task-item,extension-task-list,pm,react,starter-kit}`.
- No prior vendored Tiptap UI components in repo — `@/components/tiptap-node/` and `@/components/tiptap-ui-*` do not exist yet.
- `sass` / `sass-embedded` are NOT currently devDeps — Image Node Pro's `.scss` requires adding them.
- Spec doc: `.trellis/spec/desktop/frontend/file-type-editors.md` references the current `RichTextImage.tsx`.
- CSP `img-src` allows `asset:` + `data:` + `blob:` (tauri.conf.json).

## Assumptions (to validate)

- Image Node Pro's `Image` extension does NOT ship its own paste/drop plugin — we keep the existing `imagePasteDropPlugin`. (Verify on install.)
- Vault-relative src disk format is preserved — `figure`/`figcaption` only appears when a caption is non-empty; captionless images stay `<img src="assets/...">` on disk.
- `FloatingElement` + `ImageNodeFloating` toolbar appears only when an image is selected; coexists with the existing top `RichTextToolbar` (text formatting).

## Open Questions

- SCSS theme token mapping: vendor's `image-node.scss` likely uses its own CSS vars (e.g. `--tt-*`). Decide during implementation: accept vendor defaults, override CSS vars to map to our tokens, or fork the .scss to use our tokens directly.

## Requirements (evolving)

- Install `image-node-pro` + `floating-element` + `toolbar` via Tiptap CLI → vendored source under `@/components/tiptap-node/...` and `@/components/tiptap-ui-*/...`.
- Add `sass` + `sass-embedded` devDeps.
- Wrap `RichTextEditor` with `EditorContext.Provider` + mount `FloatingElement` + `ImageNodeFloating` (inside `Toolbar`).
- Merge vault-asset src resolution into the vendored `ImageNodeView` (fork the vendored source — Tiptap UI Components are delivered as editable source files; this is the intended extension point).
- Keep existing paste/drop plugin (writes to vault + inserts vault-relative-src Image node).
- Caption: **enabled** — captioned images serialize as `<figure><img><figcaption>`, captionless as `<img>`.
- Alignment: **enabled** — `data-align` attr persisted (left/center/right).
- `RichTextImage.tsx` → slim wrapper (ponytail: keep the file, don't add new ones):
  - Exports `persistImageBytes` (used by `RichTextToolbar`).
  - Exports `RichTextImage` extension that wraps the vendored Image extension with `addProseMirrorPlugins() { return [imagePasteDropPlugin()] }`.
  - Keeps `extFromImageFile` + `imagePasteDropPlugin` private.
  - Deletes the old `RichTextImageView` React component (replaced by vendored fork).
- Update `rich-text-roundtrip.test.ts` if serialization shape changes (figure/figcaption).
- Update spec doc `file-type-editors.md` to reference new node-view location.

## Acceptance Criteria (evolving)

- [ ] Paste screenshot → image displays sharp on retina (user can drag-resize to verify pixel-parity).
- [ ] Click image → single clean selection highlight (no double ring).
- [ ] Drag image → moves (not copies) within the doc.
- [ ] Drag-to-resize handle on hover; width persisted across reloads.
- [ ] Caption toggle works (if enabled); captionless images serialize as `<img>`, captioned as `<figure>`.
- [ ] Alignment buttons work (if enabled); `data-align` persisted.
- [ ] Floating toolbar with delete/align/caption/download buttons appears when image selected.
- [ ] Existing vault-asset paste/drop + file-picker path unchanged behaviorally.
- [ ] Roundtrip tests pass (update if shape changes).
- [ ] Lint / typecheck / build green.

## Definition of Done

- Tests added/updated (roundtrip, pure helpers still covered).
- Lint / typecheck / CI green.
- Spec doc `file-type-editors.md` updated.
- Vendored source committed (not gitignored).

## Out of Scope

- Image upload to remote storage / AI attachment pipeline.
- Multi-image figure (Image Node Pro already declines to collapse multi-img figures — accept that).
- Migrating `RichTextToolbar` itself to Tiptap UI primitives — keep host-drawn toolbar for text formatting; only image actions move to `ImageNodeFloating`.

## Technical Approach

**Approach: Self-implement Image Node Pro's feature set in our codebase** — Tiptap CLI install path requires Tiptap Cloud paid authentication, can't use. Build the features ourselves inside the existing `RichTextImage.tsx` + a new floating-toolbar component. No vendor source, no `sass`/`sass-embedded` deps, no `EditorContext.Provider` wiring.

The existing `RichTextImage` NodeView already handles: vault-src resolution, paste/drop, selection highlight (default), drag-to-move (default `draggable: true` + `data-drag-handle`). The new code adds the missing pieces: drag-to-resize, caption, alignment, floating toolbar.

## Decision (ADR-lite)

**Context**: User wanted Tiptap's official Image Node Pro to structurally fix blur / click-highlight / drag-copy. Tiptap CLI install requires Tiptap Cloud paid auth — blocked. User asked to self-implement following Image Node Pro's feature set + style.

**Decision**: Build the features in-repo. Reuse the existing `RichTextImage.tsx` NodeView as the base; extend it with:
- Drag-to-resize handles (left/right side grips on hover) → width attr persisted to node attrs.
- Editable caption (inline content editable inside the image node, becomes `<figcaption>` on serialization when populated).
- Alignment buttons (left/center/right) → `data-align` attr.
- Floating toolbar with delete + align + caption buttons (appears on NodeSelection).

**Out of MVP** (defer until asked): image download button, keyboard nav around captionless images, read-only-safe captions, multi-image figure.

**Consequences**:
- + No vendor lock-in, no `npx ... -o` re-install risk, no SCSS deps.
- + Full control over styling — uses our Tailwind tokens directly, no CSS-var mapping.
- − We own the maintenance; no upstream fixes for resize/caption edge cases.
- + Disk format unchanged for captionless/unaligned images — only adds `width` and `data-align` attrs when user interacts. Backward compatible with existing docs.

## Implementation Plan

Phased — each phase is independently shippable.

**Phase 1 — Drag-to-resize** (the blur structural fix):
- Extend `RichTextImage` NodeView with two drag handles (left/right) shown on hover.
- On drag, update `width` attr on the image node (px). Height auto via aspect.
- Persist `width` across reloads (attr is in the JSON).
- Revert the `[image-rendering:-webkit-optimize-contrast]` CSS once resize-to-device-pixel parity is the primary path.

**Phase 2 — Caption + Alignment**:
- Add `caption` content (inline editable inside image node; renders `<figcaption>` when populated, plain `<img>` when empty).
- Add `data-align` attr (left/center/right) with CSS `margin-left/right: auto` for center.
- Update `rich-text-roundtrip.test.ts` for `figure/figcaption` + `data-align`.

**Phase 3 — Floating toolbar**:
- New `RichTextImageFloating.tsx` component: appears when image is NodeSelected. Buttons: delete, align left/center/right, toggle caption.
- Mount inside `RichTextEditor.tsx` (track selection; render floating near the selected image's DOM rect).
- No `EditorContext.Provider` needed — pass editor via prop / context.

**Deferred** (out of MVP unless asked):
- Image download button.
- Keyboard nav (ArrowUp/Down to skip caption content).
- Read-only mode handling.
- Multi-image figure.
