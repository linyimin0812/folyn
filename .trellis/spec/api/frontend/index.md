# API Frontend

> This spec layer is not applicable.

---

## Overview

The "api/frontend" layer does not correspond to a separate code area. Tauri command invocations from the frontend are part of the desktop app.

For guidelines on calling Tauri commands from TypeScript, see:

- [Desktop Frontend Quality Guidelines](../../desktop/frontend/quality-guidelines.md) — Tauri integration patterns, `invoke()`, `isTauri()` guards
- [Desktop Frontend State Management](../../desktop/frontend/state-management.md) — how vault operations flow through stores to Tauri commands
