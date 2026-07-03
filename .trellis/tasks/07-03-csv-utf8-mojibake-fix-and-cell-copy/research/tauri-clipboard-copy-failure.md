# Research: Tauri 2.x WKWebView clipboard copy failure in `@file-viewer/renderer-spreadsheet`

- **Query**: Why does Cmd/Ctrl+C in the CSV preview table fail to copy in a Tauri 2.x macOS app, and what is the recommended fix?
- **Scope**: mixed (internal source inspection + Tauri/WKWebView knowledge)
- **Date**: 2026-07-03

## Root cause

Two compounding problems, both inside the renderer's copy path, NOT in Tauri config:

1. **The async clipboard API path is silently rejected by WKWebView for the `tauri://localhost` custom scheme origin.** Even though `window.isSecureContext === true` on macOS in both dev (`http://localhost:1420`) and release (`tauri://localhost`), WebKit's implementation of `navigator.clipboard.writeText()` is gated not just on "secure context" but also on a "transient user activation" check whose rules for non-`http`/`https` custom-scheme origins are stricter. In practice the promise from `clipboard.writeText(text)` rejects (or, in some WKWebView versions, resolves without writing) when called from a `tauri://` origin, so the renderer's `try { await clipboard.writeText(text) } catch { ... fallback }` falls into the catch branch.

2. **The fallback `document.execCommand('copy')` is invoked from a Promise microtask, AFTER the user gesture has been consumed.** The renderer wraps the entire attempt in `writeSpreadsheetClipboard` (an `async` function) and the caller `copySpreadsheetSelection` invokes it as `void writeSpreadsheetClipboard(...).then(...)`. So when the async API rejects, the `catch` block that calls `copyTextWithTextareaFallback` runs as a microtask — outside the original keydown user-gesture chain. WKWebView (like Safari) only honors `document.execCommand('copy')` synchronously inside a genuine user gesture; from a microtask it returns `false` and writes nothing. The renderer then logs `Spreadsheet copy failed: clipboard fallback returned false.`

The chain that breaks the gesture is in the renderer bundle, not in `e-virt-table` itself. `e-virt-table` actually calls `BEFORE_COPY_METHOD` **synchronously** inside the keydown handler (see Evidence). The async break is introduced by `copySpreadsheetSelection` / `writeSpreadsheetClipboard` in `@file-viewer/renderer-spreadsheet`.

Note: `e-virt-table@1.4.2`'s own `copy()` (line 5703) ALSO calls `navigator.clipboard.writeText(...).then(...)` directly — but only when `BEFORE_COPY_METHOD` is `undefined`. Because the renderer sets `BEFORE_COPY_METHOD: copySelection`, the renderer's path runs first and `e-virt-table`'s own `clipboard.writeText` is never reached (the renderer's `copySelection` returns `undefined` which makes `e-virt-table`'s `copy()` `return` early via `if (!a) return;`). So all copy traffic flows through the renderer's broken async path.

## Evidence

### Renderer copy wiring (already confirmed, cited for completeness)

- `node_modules/.pnpm/@file-viewer+renderer-spreadsheet@2.1.17_patch_hash=za3qzmknglyqjqbcqzfqdmp6ka/node_modules/@file-viewer/renderer-spreadsheet/dist/spreadsheet/view.js:883-889` — `ENABLE_COPY: true`, `BEFORE_COPY_METHOD: copySelection ? (params) => { copySelection(params); return undefined; } : undefined`.
- `…/dist/spreadsheet.js:738-749` — `copySpreadsheetSelection`:
  ```js
  const copySpreadsheetSelection = (params) => {
      const text = serializeSpreadsheetCopyData(params.data);
      void writeSpreadsheetClipboard(documentRef, text).then((copied) => {
          if (copied) { markCopiedSelection(params); return; }
          console.error('Spreadsheet copy failed: clipboard fallback returned false.');
      }).catch((error) => { console.error('Spreadsheet copy failed:', error); });
  };
  ```
- `…/dist/spreadsheet.js:406-421` — `writeSpreadsheetClipboard` (async). Synchronous part: it reads `targetWindow.isSecureContext` and calls `clipboard.writeText(text)`. The `await` then suspends. The `catch { return copyTextWithTextareaFallback(...) }` runs in a microtask when `clipboard.writeText` rejects — this is the gesture-break point.
- `…/dist/spreadsheet.js:370-405` — `copyTextWithTextareaFallback`: creates a hidden textarea, focuses/selects, calls `documentRef.execCommand('copy')`. Returns the boolean from `execCommand`. From a microtask in WKWebView, this returns `false`.

### e-virt-table keydown → copy path (proves the renderer is reached synchronously within the gesture)

- `node_modules/.pnpm/e-virt-table@1.4.2_patch_hash=4qsgisplhrk7qnejqmvcprfx4e/node_modules/e-virt-table/dist/index.es.js:2407` — `bind(window, "keydown", this.handleKeydown.bind(this))`: keydown is a real `window.addEventListener("keydown", …)`, fired by the browser inside the user gesture.
- `…/index.es.js:2439-2442` — `handleKeydown`: `e && this.ctx.isTarget(t) && (this.ctx.dragHeaderIng || this.ctx.emit("keydown", t))`. `ctx.emit` is synchronous (custom event emitter).
- `…/index.es.js:5470-5483` — selector's keydown handler: on `ctrl/meta + KeyC`, calls `this.copy()` synchronously.
- `…/index.es.js:5703-5739` — `copy()`: gates on `ENABLE_COPY`, reads `BEFORE_COPY_METHOD`, calls `s({focusCell, data, xArr, yArr})` synchronously. Because the renderer's wrapper returns `undefined`, `if (!a) return;` fires and `e-virt-table`'s own `navigator.clipboard.writeText` (line 5732) is **never reached**.
- `…/index.es.js:8278-8284` — separate `onCopyKeydown` for in-cell text selection (only fires when `ENABLE_TEXT_SELECTION` is on and a text selection exists). Not the active path for cell-range copy.

### Project integration / capabilities

- `apps/desktop/src-tauri/tauri.conf.json` — `csp: null`, dev URL `http://localhost:1420`, no clipboard plugin configured. `app.windows[0]` is a normal focused window.
- `apps/desktop/src-tauri/Cargo.toml` — no `tauri-plugin-clipboard-manager` Rust dependency.
- `apps/desktop/src-tauri/capabilities/default.json` — no `clipboard-manager:*` permissions. Confirms Tauri-side clipboard IPC is absent.
- `apps/desktop/src/components/file-types/csv/CsvFileViewerPreview.tsx` — thin wrapper around `<FileViewer>` from `@file-viewer/react` with `officePreset`. No keydown handler of its own; no interception of Cmd/Ctrl+C. The renderer's copy path is the only path.
- Patches present: `patches/@file-viewer__renderer-spreadsheet@2.1.17.patch`, `patches/e-virt-table@1.4.2.patch` — patching the renderer is already the established pattern in this repo.

### External references (cannot live-fetch in this env; cite from established docs/issues)

- Tauri 2.x `tauri-plugin-clipboard-manager` docs: https://v2.tauri.app/plugin/clipboard/ — provides Rust-side `write_text`/`read_text` via NSPasteboard on macOS, exposed to JS as `@tauri-apps/plugin-clipboard-manager` `writeText(…)`. Bypasses WKWebView's JS clipboard restrictions entirely because the write happens in Rust, not in WebKit.
- WebKit async clipboard restriction background: `navigator.clipboard.writeText` in WKWebView requires both a secure context and a transient user activation; for non-`http(s)` scheme origins (e.g. custom app schemes like `tauri://`) WebKit's gesture/origin trust checks are stricter and historically reject or no-op the write. This is why the Tauri project ships a clipboard plugin rather than relying on the web API.
- WebKit user-gesture rule for `document.execCommand('copy')`: must be invoked synchronously within the gesture task; microtask/timeout invocation is treated as programmatic and returns `false`. This is the reason the renderer's `.catch` fallback cannot recover after the async API rejects.

## Recommended fix

**Path (a): add `tauri-plugin-clipboard-manager` and patch `@file-viewer/renderer-spreadsheet` to delegate to it when running inside Tauri.**

Rationale:

- The Tauri clipboard plugin writes via Rust/NSPasteboard, which has **no dependency on JS user-gesture state**. This sidesteps both failure modes above (WKWebView rejecting `navigator.clipboard.writeText`, and `execCommand('copy')` running post-gesture).
- The renderer already computes the correct TSV payload (`serializeSpreadsheetCopyData`) and exposes a single choke-point (`writeSpreadsheetClipboard`) — patching that one function flips the entire copy path. This is the smallest, most surgical change and matches the repo's existing patching pattern (`patches/@file-viewer__renderer-spreadsheet@2.1.17.patch`).
- Path (b) — intercepting Cmd/Ctrl+C in `CsvFileViewerPreview.tsx` — would require re-deriving the selected cell range and TSV payload from outside the `e-virt-table` instance, which is not exposed via ref by the renderer. It would also duplicate selection logic and miss the context-menu/copy affordances the renderer may add later. It is a viable fallback but more invasive than patching the renderer.
- Path (c) — adding a Tauri capability/permission alone — does not work: Tauri 2.x has no built-in "unlock `navigator.clipboard`" capability. The web API's behavior is governed by WebKit, not by Tauri permissions. Only the plugin (which routes through Rust) avoids the WebKit gate.

### Cargo / package.json additions

`apps/desktop/src-tauri/Cargo.toml` `[dependencies]`:
```toml
tauri-plugin-clipboard-manager = "2"
```

`apps/desktop/src-tauri/src/lib.rs` (or wherever plugins are registered):
```rust
tauri::Builder::default()
    .plugin(tauri_plugin_clipboard_manager::init())
    // ...existing plugins...
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
```

`apps/desktop/src-tauri/capabilities/default.json` — add to `permissions`:
```json
"clipboard-manager:allow-write-text",
"clipboard-manager:allow-read-text"
```
(Only `allow-write-text` is strictly required for the copy fix; `allow-read-text` is harmless and useful for paste affordances later.)

Frontend dependency (so the patched renderer can import it cleanly):
```bash
pnpm add @tauri-apps/plugin-clipboard-manager
```
Workspace root `package.json`:
```json
"@tauri-apps/plugin-clipboard-manager": "^2"
```

### Patch sketch for `@file-viewer/renderer-spreadsheet`

The patch should modify `writeSpreadsheetClipboard` (in `dist/spreadsheet.js`, lines ~406-421) so that, when `window.__TAURI_INTERNALS__` is present, it routes through the Tauri plugin's `writeText` and skips both the WebKit async-clipboard path and the `execCommand` fallback. The Tauri IPC call is itself async, but because the write happens in Rust (not in WebKit's gated API), it does not need the JS user-gesture chain.

Conceptual diff (not a literal patch — actual patch should be generated with `pnpm patch @file-viewer/renderer-spreadsheet`):

```diff
@@ writeSpreadsheetClipboard (dist/spreadsheet.js ~406)
 const writeSpreadsheetClipboard = async (documentRef, text) => {
+    // Tauri 2.x: route through the Rust clipboard plugin to avoid WKWebView's
+    // navigator.clipboard.writeText rejection on `tauri://` and the broken
+    // post-gesture execCommand('copy') fallback.
+    if (typeof globalThis !== 'undefined' && globalThis.__TAURI_INTERNALS__) {
+        try {
+            const mod = await import('@tauri-apps/plugin-clipboard-manager');
+            await mod.writeText(text);
+            return true;
+        } catch (e) {
+            console.error('Tauri clipboard writeText failed:', e);
+            // fall through to web fallbacks (will likely also fail, but keep behavior)
+        }
+    }
     const targetWindow = documentRef.defaultView;
     const clipboard = targetWindow?.navigator?.clipboard;
     const useAsyncClipboard = !!(targetWindow?.isSecureContext) && typeof clipboard?.writeText === 'function';
     ...
 };
```

Notes on the patch:

- `globalThis.__TAURI_INTERNALS__` is the canonical runtime marker that JS is executing inside a Tauri WebView (Tauri 2.x injects this object). It is present in both `tauri://localhost` (release) and `http://localhost:1420` (dev with `tauri dev`) builds.
- Using dynamic `import()` avoids making `@tauri-apps/plugin-clipboard-manager` a hard runtime dependency for non-Tauri consumers of the renderer (e.g., if the same renderer is ever used in a pure-browser context). It also keeps the bundle-split friendly.
- Because the Tauri `writeText` IPC resolves asynchronously but executes on the Rust side, there is no race with user-gesture expiry. The renderer's existing `void … .then(markCopiedSelection)` flow continues to mark the selection as copied once the IPC resolves.
- If a fully synchronous gesture is desired (so that `execCommand('copy')` would also work as a last-resort fallback), the patch could additionally call `copyTextWithTextareaFallback` synchronously *before* the await — but this is unnecessary once the Tauri plugin is wired in, and would introduce double-writes. Keep it simple.

## Alternatives considered

- **(b) Intercept Cmd/Ctrl+C at `CsvFileViewerPreview.tsx`**: add a `window` keydown listener that, on `metaKey/ctrlKey + KeyC` with an active cell selection, calls `@tauri-apps/plugin-clipboard-manager` `writeText` with a TSV payload. Downside: the React layer has no access to the `e-virt-table` instance or its `ctx.getSelectedData()`, so we'd have to either (i) maintain a parallel selection state in React by subscribing to the renderer's `copyChange` event (which only fires *after* a successful copy — chicken-and-egg), or (ii) reverse-engineer the selection from DOM. Both are brittle. Rejected as primary path; viable as a stopgap if patching the renderer becomes blocked.
- **(c) Tauri capability to "unlock `navigator.clipboard`"**: no such capability exists in Tauri 2.x. The async clipboard API is enforced by WebKit at the browser-engine layer, not by Tauri's permission system. Rejected.
- **Prefer `document.execCommand('copy')` synchronously, skip the async API**: would require patching `writeSpreadsheetClipboard` to call `copyTextWithTextareaFallback` *first* and synchronously, before any `await`. In theory this could work in WKWebView because `execCommand('copy')` is invoked inside the original keydown gesture. In practice this is fragile: WKWebView's `execCommand('copy')` on a programmatically focused hidden textarea has historically been flaky (focus must actually transfer to the textarea element, and the WebView must be the key window at that instant), and it still doesn't explain why the async API was failing. The Tauri plugin path is strictly more reliable. Rejected as primary; could be combined with (a) as a layered fallback inside the patched `writeSpreadsheetClipboard` if belt-and-suspenders is desired.

## Caveats / Not found

- I could not live-fetch the Tauri/WebKit GitHub issues in this environment (no web search tool available). The WebKit behavior described (custom-scheme clipboard rejection, microtask gesture expiry for `execCommand`) is established knowledge; before writing the final spec, the implementer should confirm by manually running the app and checking the WebView console for the `Spreadsheet copy failed: clipboard fallback returned false.` log line and any `NotAllowedError` from `navigator.clipboard.writeText`. That console output will confirm which of the two failure modes is firing first.
- If `navigator.clipboard.writeText` is in fact *succeeding* (resolving) but writing nothing to the system pasteboard on this WKWebView version, the symptom would be identical. The recommended fix (route through the Tauri plugin) is the same either way, so the ambiguity does not block the fix.
- Patching `dist/spreadsheet.js` directly via `pnpm patch` is the established repo pattern, but it makes upgrades of `@file-viewer/renderer-spreadsheet` a manual re-patch step. The patch should be kept minimal (one function) to minimize re-patch burden.
