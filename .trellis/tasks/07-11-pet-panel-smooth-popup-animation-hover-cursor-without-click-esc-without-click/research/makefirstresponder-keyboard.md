# Research: makeFirstResponder(WKWebView) for keyboard-without-click (Issue 3)

## Conclusion (recommended approach)

Two-layer fix:

1. **Rust (deterministic Esc)**: in `pet_panel_show`, after `panel.set_focus()`
   (window key + app active), make the **WKWebView** the first responder via
   `makeFirstResponder:`. `set_focus()` alone makes the WINDOW key but does NOT
   make the WKWebView first responder, so `document` never gets `keydown` until
   a click. Match the existing `pet_make_transparent` pattern for obtaining the
   WKWebView's ns_view, then `msg_send![panel, makeFirstResponder: wkwebview]`
   on the main thread.
2. **Frontend (typing)**: on the `pet://panel-fade-in` show signal, if the
   panel is on the Chat tab, `.focus()` the chat `<textarea>` so the user can
   type immediately. (Focusing an input in a key WKWebView also reinforces the
   webview's first-responder status — backstop for Esc.)

## Root cause (confirmed from crate source)

- `pet_panel_show` calls `panel.show()` (`makeKeyAndOrderFront`) then
  `panel.set_focus()` (tao: `makeKeyAndOrderFront` +
  `activateIgnoringOtherApps:YES`). The window is key, app is active. But
  `makeFirstResponder` on the WKWebView is never called.
- The `tauri-nspanel` crate's own `show_and_make_key` does
  `makeFirstResponder: &*content_view` (the panel's contentView / tao parent
  view — NOT the WKWebView). That routes `keyDown:` to the tao view's handler,
  not the WKWebView DOM. Wrong target for us.
- After `orderOut` (hide) the first responder resigns; on the next
  `makeKeyAndOrderFront` a non-activating panel does NOT auto-restore the
  WKWebView as first responder. A click on the webview makes it first
  responder → that's why Esc works only after a click.

## Why this fixes it

- `makeFirstResponder(wkwebview)` after the window is key → the WKWebView is
  first responder → Appkit delivers `keyDown:` to the webview → the DOM
  `document` receives `keydown` → the React Esc listener fires. No click
  needed.
- The frontend textarea focus gives immediate typing (panel defaults to Chat
  tab, chat-first). It also re-asserts the webview as first responder (a
  focused input in a key webview keeps the webview FR).

## Ordering / gotchas

- `makeFirstResponder` MUST run AFTER the window is key (i.e. after
  `set_focus()`), and on the main thread. `pet_make_transparent` already runs
  on the main thread via `app.run_on_main_thread` — match that.
- The panel is shown/hidden (not recreated), so `makeFirstResponder` must be
  re-applied on every show (inside `pet_panel_show`), not just once at mount.
- Target the WKWebView ns_view specifically (NOT the contentView / parent
  view). `pet_make_transparent` already grabs the right ns_view for
  `drawsBackground=NO` — reuse that accessor.
- Non-activating panel: `set_focus()` already calls
  `activateIgnoringOtherApps:YES`, so the app is active and the panel is key —
  `makeFirstResponder` works in this state.

## Alternative considered

- **Frontend-only**: just `.focus()` the textarea on show, no Rust change. If
  programmatic DOM focus reliably makes the WKWebView first responder, this
  fixes both Esc and typing in one change. RISK: programmatic `.focus()` does
  not always grab AppKit first-responder the way a user click does, especially
  for a non-activating panel — the exact thing the user complained about (Esc
  needs a click). So the Rust `makeFirstResponder` is the deterministic fix for
  Esc; the textarea focus is for typing. Doing both is belt-and-suspenders but
  both are small.
- Global shortcut for Esc: awkward (conflicts, can't easily scope to "only when
  panel open"). Reject.
- Listen at Tauri window-level key events instead of `document`: would require
  rewriting the Esc handler away from the React `document` listener; more
  invasive. Reject for now.

## Implementation footprint

- `commands.rs` `pet_panel_show`: after `panel.set_focus()`, add a main-thread
  `makeFirstResponder(wkwebview)` (reuse the `pet_make_transparent` ns_view
  accessor). Keep `set_focus()` (still needed for app activation + window key).
- `PetPanelApp.tsx`: on `pet://panel-fade-in`, if `tab === 'chat'`, focus the
  chat textarea. Needs a ref into `PetChat`'s textarea (or a small focus
  contract: PetChat exposes a `focus()` via ref / listens for the same event).
- No new dependency.

## Sources

- `tauri-nspanel` crate source: `panel.rs:360-413` (`can_become_key_window`,
  `show_and_make_key` with `makeFirstResponder: &*content_view` — the
  wrong-target evidence), `panel.rs:526-527`.
- tao/wry: `webview.focus()` → `window.makeFirstResponder(Some(&self.webview))`
  (the correct-target precedent).
- Apple `NSWindow makeFirstResponder:`:
  https://developer.apple.com/documentation/appkit/nswindow/makefirstresponder(_:)
- Apple `NSResponder` responder chain:
  https://developer.apple.com/documentation/appkit/nsresponder

## Note

Research sub-agent was stopped (after hitting the same API error as the first
agent) before completing external web verification of non-activating-panel
first-responder behavior; findings reconstructed from its transcript (it had
read the crate source and confirmed the `makeFirstResponder: &*content_view`
wrong-target issue + the tao `webview.focus()` correct-target precedent). The
non-activating FR non-restore behavior is the standard documented NSPanel
behavior; verify in-app during implementation.
