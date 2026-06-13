# Quality Guidelines

> Code quality standards for the Tauri backend.

---

## Required Patterns

- All commands are **`async`** — even synchronous-looking I/O uses async signatures
- Commands registered in `lib.rs` via `tauri::generate_handler![commands::name]`
- Native capabilities use **Tauri plugins** (`tauri-plugin-shell`, `tauri-plugin-dialog`, `tauri-plugin-fs`) — not raw FFI
- Native menu built via `MenuBuilder` / `SubmenuBuilder` in the `setup` hook
- Commands return `Result<T, String>` for error propagation to frontend

---

## Forbidden Patterns

| Pattern | Why | Alternative |
|---------|-----|-------------|
| Blocking I/O in commands | Blocks Tauri event loop | Use async or `tokio::task::spawn_blocking` |
| Panics in commands | Crashes the app | Return `Result::Err` |
| Direct window manipulation | Fragile | Use Tauri `Manager` API |
| Raw FFI for native features | Bypasses Tauri safety | Tauri plugins |

---

## Menu Setup

Native menu is built declaratively in `lib.rs`:

```rust
let app_menu = SubmenuBuilder::new(app, "Quill")
    .about(None)
    .separator()
    .services()
    .separator()
    .hide()
    .hide_others()
    .show_all()
    .separator()
    .quit()
    .build()?;
```

---

## Debug Configuration

DevTools open automatically in debug builds:

```rust
#[cfg(debug_assertions)]
if let Some(window) = app.get_webview_window("main") {
    window.open_devtools();
}
```

Reference: `apps/desktop/src-tauri/src/lib.rs`
