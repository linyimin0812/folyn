# Directory Structure

> How the Tauri backend (Rust layer) is organized.

---

## Directory Layout

```
apps/desktop/src-tauri/
├── Cargo.toml          # Rust dependencies (tauri, serde, tauri-plugin-*)
├── tauri.conf.json     # Tauri app configuration (window, permissions, bundle)
├── build.rs            # Tauri build script
├── capabilities/       # Tauri permission capability definitions
├── icons/              # App icons (various sizes and formats)
└── src/
    ├── main.rs         # Entry point — calls lib::run()
    ├── lib.rs          # Tauri builder: plugins, native menu, invoke_handler registration
    └── commands.rs     # #[tauri::command] functions (open_file, save_file, check_url, webview ops)
```

---

## Module Organization

- **Flat structure** — all Rust source files in `src/`, no submodules beyond `commands`
- **`main.rs`** is minimal — just calls `lib::run()`
- **`lib.rs`** owns the Tauri builder setup: plugin registration, menu building, command handler registration
- **`commands.rs`** contains all `#[tauri::command]` functions

---

## Tauri Commands

Registered in `lib.rs` via `tauri::generate_handler![]`:

| Command | Purpose |
|---------|---------|
| `open_file` | Read file content as string |
| `save_file` | Write string content to file |
| `select_directory` | Directory picker (delegates to tauri-plugin-dialog) |
| `check_url` | HTTP reachability check via curl |
| `create_webview` | Create embedded webview for URL preview |
| `navigate_webview` | Navigate an existing webview to a new URL |
| `close_webview` | Destroy a webview |
| `set_webview_position` | Position webview overlay |
| `hide_all_webviews` | Hide all webview overlays |
| `on_webview_url_changed` | Handle URL change in webview |

---

## Plugins

Registered in `lib.rs`:
- `tauri_plugin_shell` — shell command execution (used by CLI adapters)
- `tauri_plugin_dialog` — native file/directory dialogs
- `tauri_plugin_fs` — filesystem operations

Reference: `apps/desktop/src-tauri/src/lib.rs`, `apps/desktop/src-tauri/src/commands.rs`
