# Excalidraw export image and copy-to-clipboard do not work in Tauri webview

## Goal

When the user clicks "Save to disk" or "Copy to clipboard" inside Excalidraw's export dialog (main menu → Export image), nothing happens. Wire both flows through Tauri's filesystem + clipboard APIs so they actually work.

## What I already know

* `apps/desktop/src/components/file-types/excalidraw/ExcalidrawEditor.tsx:58-66` — mounts default `<Excalidraw>` with no `UIOptions.canvasActions.export` override; Excalidraw's built-in export UI is what's visible.
* `apps/desktop/src-tauri/tauri.conf.json` — this is a Tauri 2 app, not Electron. WKWebView on macOS.
* `apps/desktop/src-tauri/capabilities/default.json:40` — only `clipboard-manager:allow-write-text` is granted. `allow-write-image` is NOT granted → `write_image` command will reject.
* `apps/desktop/src-tauri/Cargo.toml` — `tauri = { version = "2", features = ["devtools", "unstable", "protocol-asset", "macos-private-api"] }` — no `image-png` feature, so `Image::from_bytes(png)` errors with "expected RGBA image data, found raw bytes". The `JsImage::Rgba { rgba, width, height }` variant works without `image-png`.
* Excalidraw 0.18.1 export behavior:
  * "Save to disk" — uses `<a download href="blob:...">` click. Tauri 2 webview does not handle anchor downloads → click is a silent no-op (no file written, no save dialog).
  * "Copy to clipboard" — calls `exportToClipboard({ type: 'png' })` from `@excalidraw/utils/export`, which internally uses `navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])`. WKWebView's image clipboard write is unreliable / silent-no-op for programmatic non-user-gesture cases in many Tauri setups.
* `@tauri-apps/plugin-clipboard-manager@2.3.2` — `writeImage(image)` accepts `string | Image | Uint8Array | ArrayBuffer | number[]`. Passing a `Uint8Array` of PNG bytes deserializes to `JsImage::Bytes` which errors without `image-png` Cargo feature. Passing an `Image` instance (resource rid) deserializes to `JsImage::Resource`, which always works and routes through the `Image::new(rgba, w, h)` RGBA-pixel path.

## Assumptions (temporary)

* The user's "not taking effect" means: clicking the buttons produces no visible file save dialog / no image on the system clipboard. (Not yet verified in a running dev session.)
* Excalidraw 0.18.1 does NOT expose a user-overridable `onExportImage` prop — it's an internal App method. So we can't replace just the save handler; we intercept at the DOM API level.

## Open Questions

* (See Step-6 Q&A below — one question at a time.)

## Requirements (evolving)

* "Save to disk" in Excalidraw export dialog writes a real file via Tauri `dialog.save` + `fs.writeFile` (not browser anchor download).
* "Copy to clipboard" in Excalidraw export dialog writes the PNG to the system clipboard via Tauri's `clipboard-manager.writeImage` (not `navigator.clipboard.write`).
* Non-excalidraw clipboard flows in the app are unaffected (text copy in chat, etc.).

## Acceptance Criteria (evolving)

* [ ] In a `.excalidraw` tab, opening the export dialog and clicking "Save to disk" opens a Tauri save dialog and writes the chosen file (PNG/SVG).
* [ ] Clicking "Copy to clipboard" places the PNG image on the system clipboard — pasteable into Finder, Preview, image editors.
* [ ] Text-clipboard flows elsewhere in the app (ChatMessageList copy, ContextMenu copy, MarkdownPreview code-copy) still work unchanged.
* [ ] No console errors from the patched clipboard path when the clipboard item is text-only.

## Definition of Done

* Lint / typecheck green.
* Manual check: both buttons in Excalidraw export dialog produce the expected effect (file saved; clipboard holds image).
* Capabilities file updated and verified loaded (rebuild if necessary).
* No new third-party npm deps. No new Cargo features.

## Technical Approach

New helper module `apps/desktop/src/services/tauriBrowserShim.ts` exporting two install-and-return-cleanup functions. Each installs a DOM-level intercept; the returned cleanup function fully reverts the patch. `ExcalidrawEditor.tsx` installs both on mount, cleans up on unmount.

Why a helper: anchor-download and `navigator.clipboard.write` for images are generic "browser-style save/copy in Tauri webview doesn't work" issues, not Excalidraw-specific. Future libraries that ship their own `<a download>` / `navigator.clipboard.write` flows can install the same shim without copy-paste.

### 1. `installAnchorDownloadInterceptor()`

Document-level capture-phase `click` listener. When the target is `<a download>` with `href` starting with `blob:`, `preventDefault()` + `stopPropagation()`, fetch the blob, run `dialog.save({ defaultPath: downloadAttr })`, and `fs.writeFile(path, bytes)`. Returns a cleanup that removes the listener.

Only intercepts blob URLs — leaves real-navigation anchors untouched.

### 2. `installClipboardImageWritePatch()`

Save original `Clipboard.prototype.write`. Replace with a wrapper that inspects the `ClipboardItems[]`. If any item has `image/png` (or `image/svg+xml`):
* Extract the blob.
* For PNG: load into an `HTMLImageElement`, draw onto an offscreen canvas, `getImageData` → RGBA `Uint8Array` + dimensions.
* `Image.new(rgba, w, h)` from `@tauri-apps/api/image` → returns a resource-backed `Image`.
* `writeImage(img)` from `@tauri-apps/plugin-clipboard-manager`.
* Return without calling the original `write`.

For text-only items, fall through to the original `write` (text clipboard already works via `clipboard-manager:allow-write-text` and WKWebView's native text clipboard).

Returns a cleanup that restores the original `write`.

### 3. Wiring in `ExcalidrawEditor.tsx`

```ts
useEffect(() => {
  const cleanups = [
    installAnchorDownloadInterceptor(),
    installClipboardImageWritePatch(),
  ];
  return () => cleanups.forEach(c => c());
}, []);
```

### 4. Capability grant

Add `clipboard-manager:allow-write-image` to `apps/desktop/src-tauri/capabilities/default.json`. Rebuild the Tauri app for the capability to take effect.

## Decision (ADR-lite)

**Context**: Excalidraw's built-in export flows assume a browser environment. Tauri 2's webview does not handle anchor downloads, and `navigator.clipboard.write` for images is unreliable. There is no user-facing Excalidraw prop to override the save/copy handlers. The same gap will affect any future library that ships browser-style save/copy inside the Tauri webview.

**Decision**: Extract a reusable `apps/desktop/src/services/tauriBrowserShim.ts` helper exposing two install-return-cleanup functions — `installAnchorDownloadInterceptor()` and `installClipboardImageWritePatch()`. `ExcalidrawEditor.tsx` wires both on mount, cleans up on unmount. Use the RGBA-pixel path (canvas → `Image.new`) for image clipboard because `Cargo.toml` does not enable `image-png` — adding a Cargo feature is a bigger blast radius than ~15 lines of canvas round-trip code.

**Consequences**: Helper is generic — future libraries can reuse without copy-paste. Monkey-patching a global prototype is invasive but scoped to mount/unmount. If multiple Excalidraw tabs are open simultaneously, the patches stack and each restore-on-unmount restores the prior patch — last-unmount wins, which is correct for the last-closed tab. The canvas round-trip is O(canvas size) and synchronous on the main thread — acceptable for typical diagrams; pathological multi-megapixel canvases would block briefly. Upgrade path if perf matters: enable `image-png` Cargo feature and switch to `Image.fromBytes(pngBytes)` directly, drop the canvas step.

## Out of Scope

* Replacing Excalidraw's export dialog with a custom `renderCustomUI` — would lose the filename / format / scale controls for no real gain.
* Adding `image-png` Cargo feature — deferred; the RGBA path works.
* SVG clipboard copy — Excalidraw only offers PNG for "Copy to clipboard", SVG for "Save to disk". The save path intercept handles SVG via the same blob fetch + `writeFile` path (text content).
* Supporting multiple simultaneously-open Excalidraw tabs — works by accident via stack-restore, not load-tested.
* Wiring the helper into any other file besides `ExcalidrawEditor.tsx` — future libraries opt in when they need it; no proactive wiring.
* Patching `navigator.clipboard.read` (paste flows) — paste already works via native webview + `clipboard-manager:allow-read-text` where applicable.

## Technical Notes

* `apps/desktop/src/components/file-types/excalidraw/ExcalidrawEditor.tsx` — wire both helpers in a `useEffect` (mount install, unmount cleanup).
* `apps/desktop/src/services/tauriBrowserShim.ts` — NEW. Exports `installAnchorDownloadInterceptor()` and `installClipboardImageWritePatch()`, each returns a cleanup function.
* `apps/desktop/src-tauri/capabilities/default.json` — add `clipboard-manager:allow-write-image` permission.
* `node_modules/.pnpm/@tauri-apps+plugin-clipboard-manager@2.3.2/.../dist-js/index.d.ts` — `writeImage(image: string | Image | Uint8Array | ArrayBuffer | number[])`.
* `~/.cargo/registry/src/index.crates.io-*/tauri-2.11.2/src/image/mod.rs:169-225` — `JsImage` enum, `into_img` matches `Rgba { rgba, width, height }` unconditionally (no `image-png` feature required).
* `~/.cargo/registry/src/index.crates.io-*/tauri-plugin-clipboard-manager-2.3.2/src/commands.rs:43-50` — `write_image` command shape.
* Excalidraw export types: `node_modules/.pnpm/@excalidraw+excalidraw@0.18.1*/dist/types/excalidraw/constants.d.ts:185` — `EXPORT_IMAGE_TYPES = { png, svg, clipboard }`.
