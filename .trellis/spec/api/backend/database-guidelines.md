# Database Guidelines

> Database patterns and conventions for this project.

---

## Overview

**Not applicable.** Quill is a local-first Markdown editor with no database.

All persistence is handled by:
- **Filesystem** — Markdown files stored in the vault directory (via `@quill/vault-provider`)
- **Local storage** — settings and session state persisted via `storageClient` (Tauri fs or localStorage fallback)
- **Tauri commands** — `open_file` and `save_file` for direct file I/O from the Rust side

There is no ORM, no SQL, no migrations.
