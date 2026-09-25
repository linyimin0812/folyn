# Move activity sqlite files out of the vault into ~/.folyn

## Problem
`db.rs::conn()` opens `<vault_root>/activity.sqlite` (WAL mode → also `activity.sqlite-wal` / `activity.sqlite-shm`). These show up in the vault file tree and are app-internal data, not user notes.

## Requirements
1. DB lives under `~/.folyn/activity/<vault-key>/activity.sqlite` (one DB per vault, `~/.folyn` already the app data root convention; `dirs` crate v5 is already a dependency — no AppHandle needed in the stateless activity commands).
2. vault-key = hash of the vault_root path, deterministic across runs.
3. Data preservation: on first open, if a legacy `<vault_root>/activity.sqlite` exists and the new path doesn't, move db + `-wal` + `-shm` there (rename, copy fallback for cross-device vaults) BEFORE opening the connection.
4. No frontend changes — the API surface (commands keyed by vault_root) is unchanged.

## Files
- apps/desktop/src-tauri/src/activity/db.rs only
