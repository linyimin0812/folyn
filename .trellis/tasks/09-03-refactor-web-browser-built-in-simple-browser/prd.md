# refactor: built-in browser "打不开" bug fix + Simple Browser cleanup

## Root cause of "经常显示打不开"

`WebViewer.tsx:377` gates webview creation behind a `check_url` preflight:

```tsx
const result = await invoke('check_url', { url: filePath });
if (!result.reachable) { setStatus({ error: { code: 'unknown' } }); return; }
```

`check_url` (`file_commands.rs:26`) spawns a `curl` subprocess with **no User-Agent**, no system proxy, 8s timeout, before the real webview is even created. When curl gets HTTP status 0 (timeout / DNS / Cloudflare blocks `curl/*` UA / sandbox blocks the spawn), the frontend shows the `web-viewer-error` block ("页面无法打开") — **even though WKWebView, a real browser with real UA + system network + cookies, would load the page fine**. The preflight is a second, worse implementation of "can this URL load" that disagrees with the actual browser engine. Frontend doesn't even use `result.error` (always sets `unknown`).

Secondary bug: `WebViewer.tsx:384-386` — if the container is 0×0 at the 150ms timer (tab not laid out), the create path returns silently and `status` stays `'loading'` forever (stuck "正在连接…" spinner).

## Phase 1 — fix the bug (do first)

* **Delete the `check_url` preflight** from `WebViewer.tsx` (lines ~377-381). The webview IS the reachability test. Keep only the cheap synchronous `invalid_url` protocol guard (lines 366-371). Let the init_script's existing 2s blank-page detection (`webview_commands.rs:88`) handle blank/broken renders — it already renders "页面无法显示".
* **Fix the 0×0 container race**: don't bail silently when `rect` is 0×0; wait for the container to have non-zero size before creating the webview (ResizeObserver-backed retry, or create-on-first-nonzero-rect). Eliminates the stuck-"正在连接…" case.
* **Remove `check_url` Rust command** + its `lib.rs:1053` registration (only caller is the preflight we're deleting).

Acceptance:
* [ ] Opening a URL that WKWebView can load never shows the "页面无法打开" error because of a curl false-negative.
* [ ] No stuck "正在连接…" spinner when the tab isn't laid out at mount.
* [ ] Truly invalid URLs (non-http(s) protocol) still show the invalid_url error.
* [ ] Lint / typecheck / build green.

## Phase 2 — Simple Browser cleanup (after bug fix)

Confirmed via grep — all removal targets have only `WebViewer.tsx` (+ tests) as consumers, no sibling callers:

* **Remove password autofill**: `fill_webview_credentials` (Rust + `lib.rs:1075` reg) + `WebViewer.tsx` password dropdown UI + `browserStore` password fields + `import_chrome_passwords` (`lib.rs:1071` reg) + `browserStore.test.ts` password cases.
* **Remove cookie import**: `import_chrome_cookies` (`lib.rs:1068`), `apply_imported_cookies` (`lib.rs:1069`), `apply_imported_cookies_to_label` (called from `webview_commands.rs:120`) + `WebViewer.tsx` cookie import UI + `browserStore` cookie fields + test cases.
* **Remove `on_webview_url_changed` event machinery**: Rust emitter (`webview_commands.rs:380`), init-script hook (`webview_commands.rs:36-73`), frontend listener (`WebViewer.tsx:442-449`), `lib.rs:1062` registration. Address bar becomes static (won't track in-page SPA navigation) — explicit user ask.
* **Drop dead store API**: `editorStore.updateWebTabUrl` (only caller was the removed listener).
* **Slim `browserStore`**: if all its fields are password/cookie, remove the store + test file entirely; otherwise slim to what remains.

Keep: `create_webview`, `load_url_webview`, `navigate_webview` (back/forward/reload — already exists), `set_webview_position`, `hide_all_webviews`, `close_webview`, `hide_webview`/`show_webview`, `getWebviewLabels`, hide-on-overlay behavior, clip-from-URL, back-to-clip, external-open.

Note: PRD originally said "add back/forward/reload" — already implemented (`navigate_webview` + `WebViewer.tsx:496`). No work needed there.

## Out of scope

* Dockable panel form, multi-tab, history/bookmarks, iframe renderer, plugin tool windows.

## Definition of done

* Phase 1 + Phase 2 acceptance boxes ticked.
* `directory-structure.md` spec updated: canonical webview command set reflects `check_url` removal + `on_webview_url_changed`/password/cookie removals.
* No dead code referencing removed commands/events/stores.
* Lint / typecheck / CI green.
