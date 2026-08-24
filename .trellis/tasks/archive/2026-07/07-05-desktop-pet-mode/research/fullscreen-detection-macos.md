# Fullscreen Detection on macOS — Research Findings

## Requirement

R7 / AC9: when the foreground app enters macOS fullscreen (a fullscreen
Space), the pet must auto-hide; when the foreground leaves fullscreen, the pet
reappears at its last position.

## What I investigated

1. **Tauri 2 native events.** `tauri::WindowEvent` exposes `Resized`,
   `Moved`, `CloseRequested`, `Focused`, `ScaleFactorChanged`, `DragDrop`,
   `ThemeChanged`. There is **no** `FullscreenChanged` event and **no**
   Space-change notification exposed to Rust/JS. `WebviewWindow::is_fullscreen()`
   only reports *this window's* fullscreen state, not the foreground app's.

2. **`NSWorkspace` / `NSDistributedNotificationCenter`.** The robust macOS
   signal for "a fullscreen Space is now foreground" is
   `NSWorkspaceDidActivateApplicationNotification` + checking the running app's
   `isHidden` / fullscreen window, OR `com.apple.spaces.apiSpaceChange` via
   `NSDistributedNotificationCenter`. Neither is exposed by Tauri 2 without a
   native plugin.

3. **`cocoa`/`objc` crates.** Could be added as a macOS-only dependency and a
   small `tauri::plugin` built inline in `lib.rs` that registers an
   `NSDistributedNotificationCenter` observer, then emits a Tauri event
   (`pet://fullscreen-changed`) the frontend listens for. This is the
   correct path but adds a non-trivial native bridge.

## Decision for MVP

Implement a **best-effort subset**: detect when the **Folyn main window**
itself is fullscreen and hide the pet then. This covers the common case
(user puts the editor in fullscreen) and needs no native code —
`pet_cursor_probe` already returns `main_fullscreen` from
`WebviewWindow::is_fullscreen()` on the main window, polled at 250ms.

**Out of scope for MVP** (documented as a known limitation):
- Detecting when *any other app* (Safari, Keynote, a game) is fullscreen.
  That requires the NSWorkspace/Space-change bridge above.

## Recommended follow-up (post-MVP)

Add a tiny macOS plugin in `src-tauri` that:
1. Subscribes to `com.apple.spaces.apiSpaceChange` via
   `NSDistributedNotificationCenter`.
2. On each Space change, queries the frontmost app's window list for a
   fullscreen (`kCGWindowStatusFullScreen`/level ≥ `CGShieldingWindowLevel`)
   window.
3. Emits `pet://fullscreen-changed { active: bool }` to the pet window.

The pet frontend already has the hide/show plumbing — it would just add a
listener for `pet://fullscreen-changed` alongside the existing
`main_fullscreen` poll.

## Click-through (R6/AC8) — also documented here for context

Implemented via periodic `pet_cursor_probe` + `setIgnoreCursorEvents`:
- Every 250ms the pet frontend probes the screen cursor position and the
  pet window's outer position.
- If the cursor is inside the 80x80 sprite rect (offset 20,20 inside the
  120x120 window), `setIgnoreCursorEvents(false)` so the sprite receives
  clicks/drags.
- Otherwise `setIgnoreCursorEvents(true)` so transparent regions pass
  through to the desktop/apps beneath.

This polling approach sidesteps the chicken-and-egg of "ignore events
prevents mouseenter from firing to re-enable" — the Rust side can always
query the system cursor position regardless of `ignoresMouseEvents`.
