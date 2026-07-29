# Rich-text paste image: 403 flash + Tauri callback-id warning

## Goal

Eliminate two benign-but-noisy errors fired when pasting an image into the `.rt` Tiptap editor:
1. `403 Forbidden` on `assets/images/<sha1>.png` (resource load fails, image still ends up rendering).
2. `[TAURI] Couldn't find callback id …` (×3) — IPC reply lands after the JS callback table is gone.

Both are surfaced by the user as "报错但不影响功能". We want a clean console without changing the working behavior.

## What I already know (from code trace)

### Paste → disk → render flow
- Paste handler: `RichTextImage.tsx:120` `imagePasteDropPlugin()` → `handlePaste` collects image File items → `insertImagesAt(view, files, pos)` at `:99` → `persistImageFile` `:94` → `persistImageBytes` `:73`.
- `persistImageBytes` (`:73–91`):
  - sha1 hex of bytes → filename `<imagePath>/<hash>.<ext>` (default `assets/images/`).
  - `resolveBasePath(vaultRoot)` → dynamic `import('@tauri-apps/api/path')` → `homeDir()` → `~` expansion.
  - dynamic `import('@tauri-apps/plugin-fs')` → `exists` / `mkdir` / `writeFile` to absolute path.
  - Returns vault-relative `relPath` (e.g. `assets/images/<hash>.png`) stored in the Image node `src`.
- `insertImagesAt` (`:99–116`): sequential `await persistImageFile(f)` → `view.dispatch(...)` per image. Called fire-and-forget (`void …` at `:138`, `:171`). No cancellation token.
- NodeView `RichTextImageView` (`:185–234`):
  - Reads `vaultRoot` from store; `useEffect` (`:190–204`) calls `resolveBasePath(vaultRoot)` → `setResolvedRoot(r)`; `cancelled` flag guards `setResolvedRoot` on cleanup but does NOT abort the in-flight `homeDir()` invoke.
  - `useMemo` (`:205–216`): if `isLoadableUrlScheme(src)` → src; else `resolveVaultRelativePath(src, resolvedRoot)` → `convertFileSrc(abs)` (Tauri) → `asset://localhost/<abs>`.

### `resolveVaultRelativePath` (`richTextContent.ts:120–130`)
- Empty `resolvedVaultRoot` branch (`:127`) returns the **raw `src`** (ponytail comment: "can't resolve without root; show raw src (won't load, but no crash). Upgrade: surface a broken-image state.").
- Non-empty branch joins `${resolvedRoot}/${src}`.

### Tauri asset scope (`tauri.conf.json:145–151`)
- `assetProtocol.scope.allow = ["$HOME/**", "$APPDATA/**"]`.
- Capabilities `default.json:69–75`: `fs:scope-home-recursive` + `fs:scope-appdata-recursive`.

### Invokes fired per paste (single image)
1. `homeDir()` in `persistImageBytes` → `resolveBasePath`.
2. `join()`.
3. `exists()`.
4. `mkdir()` (conditional).
5. `writeFile()`.
6. `homeDir()` again in NodeView `useEffect` after dispatch.

## Root-cause hypotheses

### Bug 1 — 403 flash
NodeView initial render has `resolvedRoot=''` (async `homeDir()` not yet resolved). `resolveVaultRelativePath(src, '')` returns the **raw `src`** (the ponytail fallback at `richTextContent.ts:127`). The NodeView then calls `convertFileSrc(rawSrc)` → `asset://localhost/<urlencoded raw src>` — which Tauri's asset resolver cannot map to any file under `$HOME` → **403**. Once `homeDir()` resolves and `setResolvedRoot` triggers re-render, the correct `asset://localhost/<abs>` URL is produced and the image loads. This is why the user sees 403 followed by a working image.

### Bug 2 — `Couldn't find callback id` (×3)
Three plausible causes; the x3 count is the tell.
- **(a) StrictMode / ProseMirror dispatch remount**: `view.dispatch` triggers a ProseMirror re-render. NodeViews may unmount→remount; their `useEffect` cleanups set `cancelled=true`, but the `homeDir()` invoke is still pending in Rust. When it replies, the JS callback runs the `.then`, which is a no-op due to `cancelled`. This alone shouldn't trigger the warning — Tauri's callback table is keyed by callback ID, not component lifecycle, so the reply should still find its entry. So this is unlikely to be the direct cause.
- **(b) HMR / page reload during the persist chain**: if Vite HMR fires (or the user navigates away) while the 5 invokes for `persistImageBytes` are pending, the JS context that registered the callbacks is gone. Rust replies arrive, Tauri can't find callback IDs → warning. ×3 matches the trailing invokes (`writeFile`, `exists`-check, NodeView `homeDir`) landing after teardown. Most likely cause given the warning's own message text ("app is reloaded while Rust is running an asynchronous operation").
- **(c) Repeated `homeDir()` invokes pile up**: each paste fires `homeDir()` twice (once in `persistImageBytes`, once in NodeView). Multiple rapid pastes → multiple in-flight invokes. Combined with any teardown, leak amplifies.

Regardless of (a)/(b)/(c), the **lazy root-cause fix is the same**: stop firing `homeDir()` on every paste/render by caching the resolved vault root. Fewer pending invokes → fewer orphan callbacks on teardown.

## Proposed fix (lazy / ponytail)

Two localized changes, no new abstractions:

1. **Cache `homeDir()` at module level in `pathResolver.ts`** — first call resolves via Tauri, subsequent calls return the cached Promise/value. Eliminates the redundant `homeDir()` invoke on NodeView mount and on every `persistImageBytes` call after the first. This directly shrinks the in-flight callback pool that Bug 2 feeds on.

2. **Gate the NodeView `<img>` on `resolvedRoot` being set** — in `RichTextImageView`'s `useMemo` (`:205–216`), if `resolvedRoot === ''` return `''` so the placeholder renders, instead of falling through to `convertFileSrc(rawSrc)` which produces the 403 URL. This eliminates the transient 403.

   - Equivalent alternative: fix the ponytail fallback at `richTextContent.ts:127` to return `''` instead of `src`. But that changes contract for all callers — needs a grep to confirm no one depends on the raw-src passthrough. Local NodeView gate is safer and one line.

3. **(Optional, defer) Cancel pending `persistImageBytes` on editor unmount.** Hard to do cleanly with dynamic `import()` + plugin-fs (no AbortController support). Defer unless the cache alone doesn't clear Bug 2 in practice.

## Acceptance Criteria

- [ ] Pasting an image into the `.rt` editor produces **no 403** in the devtools network tab during the brief pre-render window.
- [ ] Pasting an image produces **no `[TAURI] Couldn't find callback id`** warnings during normal paste (no HMR/reload).
- [ ] Image still renders correctly after paste (regression guard).
- [ ] No new dependencies; no new files.
- [ ] `npm run lint` / `tsc` clean on touched files.

## Definition of Done

- Two fixes above merged; console clean on paste.
- Brief manual verify in the Tauri dev build: paste a PNG, paste a JPG, paste 3 images at once, paste an image URL, paste mixed text+image.
- `ponytail:` comments preserved/updated where the cache shortcut is deliberate.

## Out of Scope

- Refactoring `persistImageBytes` to use the vault provider abstraction (current code intentionally mirrors `imageUploader.ts`'s direct plugin-fs writes; keep one mechanism).
- AbortController-based cancellation of plugin-fs invokes (no API support; defer).
- Adding a broken-image state UI (the placeholder already covers the empty-`resolvedRoot` case).

## Technical Notes

- Files touched:
  - `apps/desktop/src/utils/pathResolver.ts` (cache homeDir result).
  - `apps/desktop/src/components/file-types/rich-text/RichTextImage.tsx` (NodeView `useMemo` gate).
- No spec impact; no new contracts.

## Open Questions

- ~~Fix scope~~ — resolved: **minimal double-fix** (cache `homeDir()` + gate NodeView render). Bug 2's HMR-teardown tail is accepted as benign noise; no AbortController plumbing.

## Decision (ADR-lite)

**Context**: Paste-image flow has two benign-but-noisy errors. Root cause of the 403 is the NodeView rendering with unresolved `resolvedRoot` and producing an out-of-scope `asset://` URL; root cause of the callback leak is repeated `homeDir()` invokes piling up against any teardown.

**Decision**: Minimal double-fix.
1. `pathResolver.ts`: module-level cache for `homeDir()` so the Tauri invoke fires once per session, not once per paste/NodeView-mount.
2. `RichTextImage.tsx` NodeView `useMemo`: return `''` while `resolvedRoot === ''` so the placeholder shows instead of a broken `asset://` URL.

**Consequences**:
- 403 flash gone (placeholder shows for the brief async window).
- Callback-id warnings reduced to the truly-unavoidable HMR/reload case — accepted as benign.
- No new files, no new deps, no API contract changes.
- Future upgrade path: if the residual HMR noise becomes a real issue, wrap `persistImageBytes` in an AbortController-aware module-level importer (deferred).
