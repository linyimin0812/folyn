# fix pet panel NSTouchBar NSRangeException on macOS

## Goal

App crashes with `NSRangeException` when the pet mascot window is
realized/shown on a Touch Bar-equipped Mac: `_NSTouchBarFinderObservation`
tries to remove its `nextResponder` KVO observer from the swapped
`QuillPetPanel` class but fails — the observer was registered against
the original NSWindow class before `to_panel()` swapped it.

## Root cause

`convert_windows()` in `apps/desktop/src-tauri/src/pet_panel_macos.rs`
calls `window.to_panel::<QuillXxxPanel>()` on each Tauri WebviewWindow.
`to_panel()` uses `object_setClass` to swap the window's class to our
custom `objc2`-defined `RawQuillXxxPanel` subclass. macOS's Touch Bar
finder registers a KVO observer on `nextResponder` against the
pre-swap class; when the finder later invalidates (deinit / bar
recalc), it tries to unregister from the post-swap class and throws
`NSRangeException`.

## Fix

After each `to_panel()` call in `convert_windows()`, disable touch bar
autorecalculation via direct `objc2::msg_send!` on the panel:

```rust
let _: () = msg_send![panel.as_panel(), setAutorecalculatesTouchBar: NO];
```

This mirrors the existing direct-msg_send pattern in `lib.rs:154-170`
(`setLevel:` / `setCollectionBehavior:`) and uses the crate-exposed
`as_panel()` to get the `&NSPanel` reference.

## Acceptance Criteria

- [ ] No `NSRangeException` crash on pet icon click on a Touch Bar Mac
- [ ] Pet mascot still renders, fullscreen overlay still works
- [ ] No regressions on windows without Touch Bar

## Out of Scope

- Refactoring `convert_windows()` repetition (pre-existing)
- TouchBar UI customization (we want it OFF, not customized)

## Technical Notes

- `tauri_panel!` macro only supports `config:` and `with: { tracking_area }` blocks — no method overrides like `makeTouchBar`. Direct msg_send is the only path.
- `setAutorecalculatesTouchBar:` not in objc2-app-kit generated bindings → raw msg_send required.
- Existing pattern: `apps/desktop/src-tauri/src/lib.rs:154` `msg_send![ns_ptr, setLevel: level]`.
