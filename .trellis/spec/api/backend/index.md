# Backend Development Guidelines

> Guidelines for the Tauri Rust backend layer.

---

## Overview

Mochi's "backend" is the Tauri Rust layer at `apps/desktop/src-tauri/src/`. It provides native filesystem operations, shell command execution, webview management, and native menu setup. The frontend communicates with it via `invoke()` from `@tauri-apps/api/core`.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | main.rs, lib.rs, commands.rs layout | Filled |
| [Error Handling](./error-handling.md) | Result&lt;T, String&gt;, structured responses, frontend catch | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Async commands, plugins, menu, forbidden patterns | Filled |
| [Logging Guidelines](./logging-guidelines.md) | Minimal logging, frontend console conventions | Filled |
| [Database Guidelines](./database-guidelines.md) | N/A — local-first, no database | Filled |

---

## Quick Reference

- **Tech**: Rust, Tauri 2, serde
- **Pattern**: `#[tauri::command]` async functions, `Result<T, String>` errors
- **Plugins**: shell, dialog, fs
- **Menu**: `MenuBuilder` / `SubmenuBuilder` in setup hook
- **Frontend integration**: `invoke('command_name', { args })` from TypeScript

---

**Language**: All documentation is written in **English**.
