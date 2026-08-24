# windows-close-tray-reopen-fails

## Goal

Fix: on Windows, after clicking X to close (tray icon enabled, window hidden), double-clicking the Folyn app icon in Explorer/Desktop does not bring the window back. Expected: second launch surfaces the hidden main window.

## What I already know

- `1d368d1e fix(windows): keep app alive on close when tray icon enabled` changed CloseRequested to hide instead of quit when tray is on.
- `tauri-plugin-single-instance` is registered (`lib.rs:1151-1172`). On Windows the second launch forwards its argv to the running instance.
- The callback calls `commands::filter_argv_paths(&argv)` and **early-returns when paths is empty** (`lib.rs:1156-1158`). A bare double-click passes no file path → paths empty → early return → `main.show()`/`set_focus()` below never runs.
- The comment at `lib.rs:1148` literally says "surface the main window (pet-mode close-to-hide keeps it alive but hidden)" — intent was there, gated wrong.

## Root Cause

Early-return at `lib.rs:1156-1158` skips window-surfacing when the second launch carries no file argument.

## Requirements

- Bare double-click of the app icon (no file arg) on Windows, while a tray-alive instance is running hidden, must show and focus the main window.
- File-arg launch path must keep working unchanged (push pending, emit, show).

## Acceptance Criteria

- [ ] On Windows: enable tray icon, click X to hide; double-click Folyn icon → main window visible + focused.
- [ ] On Windows: same setup, drop a file onto Folyn icon → existing open-external-file flow still works.

## Technical Approach

Reorder the callback so `main.show()` + `set_focus()` run whenever the main window is hidden, regardless of path presence. Keep pending-paths push + emit gated on non-empty paths (no spurious `app://open-external-file` events).

## Out of Scope

- Linux single-instance wiring (already deferred per PRD 08-16).
- macOS (uses `RunEvent::Opened`, not single-instance plugin).

## Technical Notes

- `apps/desktop/src-tauri/src/lib.rs:1151-1172`
- `apps/desktop/src-tauri/Cargo.toml:22-27`
