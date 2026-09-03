# Research: Root Cause — Native child webview doesn't resize after `set_webview_position`

- **Query**: Why does `set_webview_position` not resize the native WKWebView on macOS?
- **Scope**: Internal source + Tauri/wry source
- **Date**: 2026-09-03

## Verified Facts

1. **`app.get_webview(&label)` works for child webviews** — Tauri v2 `Manager::get_webview`
   (`tauri-2.11.2/src/manager/mod.rs:671`) looks up by label in the webviews
   hashmap; child webviews added via `add_child` are registered there.
   `navigate_webview` uses the same lookup and the user confirms back/forward/reload
   work, so `get_webview` returns `Some`.

2. **`Webview::set_position` + `set_size` both go through `set_bounds`** —
   `tauri-runtime-wry-2.11.2/src/lib.rs:3848-3889` shows `WebviewMessage::SetSize`
   and `SetPosition` both call `webview.bounds()` (read current frame) then
   `webview.set_bounds(bounds)` (write new frame). On macOS, `set_bounds` with
   `is_child=true` calls `setFrame:` on the WKWebView
   (`wry-0.55.1/src/wkwebview/mod.rs:1010-1029`).

3. **`is_child=true` is set correctly** — `WebviewBuilder::build_as_child` →
   `InnerWebView::new_as_child` → `new_ns_view(..., is_child=true)`
   (`wry-0.55.1/src/wkwebview/mod.rs:178-191`). `tauri-runtime-wry` uses
   `build_as_child` for `WebviewKind::WindowChild` on macOS
   (`tauri-runtime-wry-2.11.2/src/lib.rs:5245`).

4. **The math is correct**: traced the full `set_webview_position(label, 261, 104, 1179, 514)`
   call. After both messages process, `setFrame:` is called with frame origin
   `(261, 0)` (non-flipped) and size `(1179, 514)`, which is the correct top-left
   rect `(261, 104, 1179, 514)`. The API chain *should* produce the right frame.

## Most Likely Root Cause

**wry's autoresizing mask on child webviews fights `setFrame:`**

`wry-0.55.1/src/wkwebview/mod.rs:502-504`:
```rust
if is_child {
  // fixed element
  webview.setAutoresizingMask(NSAutoresizingMaskOptions::ViewMinYMargin);
}
```

`ViewMinYMargin` alone = "flexible bottom margin, everything else fixed". On
macOS window resize, AppKit's autoresizing pass fires *before* the JS
`ResizeObserver` → `syncPosition` → `setFrame:` chain:

1. Window resizes → content view resizes.
2. AppKit autoresizing: WKWebView top stays anchored, **size stays fixed**
   (e.g., h=493 from initial create), bottom margin absorbs the delta.
3. tao `Resized` → Tauri `WindowEvent::Resized` → JS.
4. HTML reflow → ResizeObserver → syncPosition → `set_webview_position` → `setFrame:` with h=514.

Step 4's `setFrame:` *should* override step 2's autoresizing result. But the
`set_position` + `set_size` sequence in `set_webview_position` is two separate
user messages (`SetPosition` then `SetSize`), each doing its own
`webview.bounds()` read + `set_bounds` write:

- **Msg 1 (SetPosition)**: `bounds()` reads current frame (size=493),
  updates position only, `setFrame:` at `(261, 104, 1179, 493)` — still wrong size.
- **Msg 2 (SetSize)**: `bounds()` reads current frame (now pos=correct, size=493),
  updates size, `setFrame:` at `(261, 104, 1179, 514)` — correct.

Between Msg 1 and Msg 2, the WKWebView is briefly at the wrong size, and AppKit
can interleave a layout pass (the autoresizing mask is still set). If AppKit
re-runs autoresizing against the *intermediate* frame, the mask keeps the view
height pinned to whatever it was. The final `setFrame:` in Msg 2 should still
win, but in practice on rapid window-resize event streams the autoresizing
mask + the two-message split produces a frame that lags one resize behind.

The user's symptom — "resize doesn't close the gap, dispatching
`folyn:overlay-closed` doesn't close the gap" — is consistent with `setFrame:`
being called but the visible WKWebView frame lagging/sticking at the
initial `add_child` size.

## Secondary Suspects (not verified)

- `wkwebview/mod.rs:1273` `content_view.addSubview(&self.webview)` path — only
  hit when `is_child=false`; not our case.
- `webview.bounds.lock()` Mutex — `None` because `auto_resize` is off
  (`WebviewBuilder::auto_resize` default false, `tauri-2.11.2/src/webview/mod.rs:1036`),
  so tauri-runtime-wry's rate-based auto-resize on `TaoWindowEvent::Resized`
  (`lib.rs:4343`) is a no-op for our webview. Not the culprit.

## Not Found

- No public Tauri v2 GitHub issue found describing this exact regression
  (could not access GitHub search without auth). The wry/tauri-runtime source
  above is from v2.11.2 pinned in `Cargo.toml`.
