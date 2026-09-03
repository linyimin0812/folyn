# Research: Proposed Fix

- **Query**: Minimal code change to make `set_webview_position` actually resize the native WKWebView
- **Date**: 2026-09-03

## Primary Fix — One atomic `set_bounds` call

Replace the two-message `set_position` + `set_size` sequence in
`apps/desktop/src-tauri/src/commands/webview_commands.rs:277-293` with a single
`set_bounds` call. `Webview::set_bounds` is exposed in Tauri v2
(`tauri-2.11.2/src/webview/mod.rs:1509`) and maps to one
`WebviewMessage::SetBounds` user message — no intermediate "wrong size" frame,
no AppKit layout pass interleaving between position and size writes.

```rust
#[tauri::command]
pub async fn set_webview_position(
    app: tauri::AppHandle,
    label: String,
    x: f64, y: f64, width: f64, height: f64,
) -> Result<(), AppError> {
    use tauri::{LogicalPosition, LogicalSize};
    if let Some(wv) = app.get_webview(&label) {
        wv.set_bounds(tauri_runtime::dpi::Rect {
            position: LogicalPosition::new(x, y).into(),
            size: LogicalSize::new(width, height).into(),
        }).map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

`tauri_runtime::dpi::Rect` re-exports as `tauri::dpi::Rect`; if the latter is
in scope at the call site, prefer it for shorter path.

## Why this should work

- `WebviewMessage::SetBounds` handler (`tauri-runtime-wry-2.11.2/src/lib.rs:3829`)
  calls `webview.set_bounds(bounds)` directly with the full rect — no
  `webview.bounds()` read-modify-write, no intermediate frame.
- One user message → one `setFrame:` on the main thread.
- `is_child=true` branch (`wry-0.55.1/src/wkwebview/mod.rs:1012`) handles the
  `setFrame:` correctly.

## Apply the same fix to `hide_all_webviews`

`webview_commands.rs:299-310` uses the same `set_position` + `set_size` split
for hiding. It currently works because the target rect `(-10000, -10000, 1, 1)`
is degenerate and the size doesn't matter. Leave as-is unless the primary fix
doesn't resolve the issue, then switch it too for consistency.

## If `set_bounds` alone doesn't fix it — verification steps

Before adding more code, verify the fix is actually reaching the native side:

1. Add `eprintln!("[set_webview_position] label={label} rect=({x},{y},{width},{height}) found={}", wv.label().is_some());`
   inside the `if let Some(wv)` branch — confirms the command fires with the
   right rect.
2. In `WebViewer.tsx` `syncPosition`, add `console.log('[syncPosition]', label, rect)` before `invoke` — confirms `webviewLabelRef.current` is set and the rect is non-zero.
3. If both log correctly and the gap persists, the issue is at the wry/AppKit
   level (the autoresizing mask hypothesis). Next escalation: in
   `create_webview`, after `add_child`, explicitly clear the autoresizing mask
   via raw objc2 — `webview.setAutoresizingMask(NSAutoresizingMaskOptions::empty())`
   — but this requires patching wry, which is out of scope for this task.

## What NOT to change

- The frontend `syncPosition` logic, ResizeObserver setup, and effect deps are
  all correct as written. The body div is the right element to observe.
  `webViewerRef.current` is assigned before effects run. Don't touch the frontend.
- `create_webview` initial rect is also fine — the body div's rect is read
  correctly at create time.
