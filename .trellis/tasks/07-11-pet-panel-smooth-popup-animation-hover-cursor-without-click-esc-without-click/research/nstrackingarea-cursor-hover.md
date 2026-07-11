# Research: NSTrackingArea + cursorUpdate for hover-cursor-without-click (Issue 2)

## Conclusion (recommended approach)

Use the **`tauri-nspanel` crate's built-in `tracking_area` support** — NOT raw
objc. The crate v2.1 (already a Quill dependency) ships first-class
`tracking_area` + `cursorUpdate` via the `panel!` / `panel_event!` macros.

## How it works

1. Add a `with: { tracking_area: { options, auto_resize } }` block to the
   existing `QuillPetPanel` `panel!` macro in `pet_panel_macos.rs`.
   ```rust
   TrackingAreaOptions::new()
       .active_always()              // THE flag: deliver events even when app isn't frontmost / panel isn't key
       .cursor_update()              // NSTrackingCursorUpdate → cursorUpdate: fires on enter
       .mouse_entered_and_exited()   // mouseEntered:/mouseExited: for explicit enter/leave
       .in_visible_rect()            // track the visible rect (window can resize)
   ```
2. Define a `panel_event!` handler and wire `on_cursor_update` (enter → hand)
   + `on_mouse_exited` (leave → arrow). Reuse the existing `pet_set_cursor`
   NSCursor-set logic (`[NSCursor pointingHandCursor] set]` /
   `arrowCursor set]`).
3. The crate's `define_class!` already overrides `cursorUpdate:` /
   `mouseEntered:` / `mouseExited:` on the panel subclass and forwards to the
   delegate — so no method swizzling needed.

## Why it fixes the bug

- `NSTrackingActiveAlways` makes the tracking area deliver mouse/cursor events
  regardless of app activation state or window key status. This is exactly the
  flag that solves "hand cursor on plain hover when Quill isn't frontmost."
- The tracking area is attached to the panel's `contentView` (which has the
  WKWebView as a subview). `cursorUpdate:` is sent to the tracking-area owner
  (contentView) and propagates up the responder chain to the panel subclass's
  override → delegate → callback. The WKWebView does not intercept it. The
  crate's `mouse_tracking` / `hover_activate` examples confirm this works for
  `nonactivating_panel` + `can_become_main_window:false`.
- Setting `[NSCursor pointingHandCursor] set]` from a tracking area's
  `cursorUpdate:` IS the sanctioned way to override the cursor over your
  window when not frontmost — this is why the existing
  `commands.rs:659-660` comment names NSTrackingArea ActiveAlways as the fix.

## Crate API references (verified in source)

- `tauri-nspanel/src/builder.rs:215-313` — `TrackingAreaOptions` builder
  (`active_always`, `cursor_update`, `mouse_entered_and_exited`,
  `in_visible_rect`).
- `tauri-nspanel/src/panel.rs:113-202` — `define_class!` overrides
  `cursorUpdate:` / `mouseEntered:` / `mouseExited:` / `mouseMoved:` on the
  panel subclass, forwarding to the delegate.
- `tauri-nspanel/src/panel.rs:605-608` — `add_tracking_area` runs inside
  `to_panel()` AFTER the class swap, on the contentView. The WKWebView is
  already a subview at that point (Tauri creates the webview before
  `to_panel`), so no extra ordering constraint.
- `tauri-nspanel/src/event.rs:222-253` — `on_mouse_entered` /
  `on_mouse_exited` / `on_mouse_moved` / `on_cursor_update` callbacks.

## Simpler alternatives (rejected)

- `acceptsMouseMovedEvents:YES` + `mouseMoved:` — only delivers when the window
  is KEY. Does not solve the not-frontmost case. Reject.
- `make_key_window()` on mouseEntered (crate's `hover_activate` example) —
  steals keyboard focus from the frontmost app on every hover. Bad for a
  desktop pet. Reject (that pattern is for when you NEED keyboard on hover).
- Deprecated `addTrackingRect` — superseded by NSTrackingArea. No benefit.

## Implementation footprint

- `pet_panel_macos.rs`: add `with: { tracking_area: {...} }` to `QuillPetPanel`
  `panel!`; define + wire a `panel_event!` handler with `on_cursor_update` /
  `on_mouse_exited`.
- `convert_windows`: attach the handler to the `QuillPetPanel` panel instance.
- `PetApp.tsx`: the existing `handleMouseEnter`/`handleMouseLeave`
  `invoke('pet_set_cursor')` calls become redundant once the tracking-area
  cursorUpdate works — remove them (keep `pet_set_cursor` command as a fallback
  or remove if unused). Verify in-app.
- No new dependency. No raw objc NSTrackingArea hand-rolling.

## Sources

- Apple `NSTrackingArea`: https://developer.apple.com/documentation/appkit/nstrackingarea
- `NSTrackingAreaOptions` (ActiveAlways / CursorUpdate / InVisibleRect):
  https://developer.apple.com/documentation/appkit/nstrackingareaoptions
- `NSResponder cursorUpdate:`:
  https://developer.apple.com/documentation/appkit/nsresponder/cursorupdate
- `NSCursor`: https://developer.apple.com/documentation/appkit/nscursor
- `tauri-nspanel` crate source (cargo git checkout, v2.1): builder.rs,
  panel.rs, event.rs (paths above).

## Note

Research sub-agent hit an API error before writing this file; findings
reconstructed from its transcript (it had read the crate source and confirmed
the API). Verify the exact macro syntax against the crate version pinned in
`apps/desktop/src-tauri/Cargo.toml` before implementing.
