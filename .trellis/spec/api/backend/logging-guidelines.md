# Logging Guidelines

> How logging is done in the Tauri backend.

---

## Overview

The Tauri backend currently has **minimal logging**. There is no structured logging framework (no `tracing`, `log`, or `slog`).

---

## Rust Side

- No explicit log statements in commands or setup
- Debug builds open browser DevTools for frontend debugging: `window.open_devtools()`
- Tauri's internal logging (from the framework itself) goes to stderr

---

## Frontend Side (Relevant to Backend Operations)

The TypeScript frontend logs backend-related operations with bracket-prefixed console messages:

```ts
console.warn('[VaultStore] Failed to start file watcher:', err);
console.warn('[App] Wiki init failed:', err);
console.error('[Editor] Failed to open file:', err);
```

Convention: `[<StoreOrModule>] <message>` — makes it easy to filter in DevTools.

---

## What to Log (If Adding Logging)

- Vault connection/disconnection events
- File operation failures
- CLI adapter spawn/kill events
- Webview creation/destruction

---

## What NOT to Log

- File contents (privacy — this is a local-first editor)
- API keys, sync credentials, or CLI paths
- Full CLI output streams (too verbose — log summary events instead)
