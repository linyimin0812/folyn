# Version history uses a self-built content-addressable store under `~/.quill/vaults/<vaultId>/versions/`, not git or in-vault storage

Quill's per-file text version history lives in app-owned data — `~/.quill/vaults/<vaultId>/versions/blobs/{sha256}.{ext}` for content (SHA-256 of UTF-8 bytes, cross-file dedup free) + `~/.quill/vaults/<vaultId>/versions/index.json` mapping each vault-relative file path to a time-ordered `[{hash, ts, size}]` array. Snapshots fire on `editorIoService.saveFile` and on tab close; writes whose hash matches the file's last entry are skipped. Restore snapshots the current state first, then overwrites with the chosen blob's content.

## Considered Options

- **(a) Self-built content-addressable store under `~/.quill/vaults/<vaultId>/versions/`** (accepted) — works for every vault type (local + GitHub-backed), keeps user content directories clean, dedup is automatic (blob name = hash), diff is read-two-blobs-and-`diff`. Single index file per vault is small and atomically replaceable. Matches the existing `~/.quill/vaults/<vaultId>/` metadata-directory pattern.
- **(b) Piggyback on git per vault** (rejected) — would force every local vault into `git init`, polluting the user's content directory with `.git/` and forcing `.gitignore` rules for `.quill/` paths. GitHub-backed vaults already use git for sync via `gitService.ts`, but conflating sync with local history would couple two independent concerns and break non-git vaults.
- **(c) In-vault `.quill/versions/`** (rejected) — pollutes user-visible content directories, requires per-vault-type `.gitignore` logic for GitHub-backed vaults, and risks collision with a real user `.quill/` directory. Snapshots are app-derivative data, not user content; they belong in app data, not the vault.
- **(d) SQLite table per vault** (rejected) — adds a query layer and a binary format for data that is already tiny (KB-scale text blobs) and naturally file-shaped. `index.json` + blob files are readable, debuggable, and atomically replaceable in a few lines of code; SQLite is the wrong abstraction here.

## Consequences

- **Storage location is non-obvious.** Future readers looking for "where are this file's versions" will check the vault content directory first and find nothing. This ADR and the `Version Index` glossary entry in `CONTEXT.md` are the map.
- **Snapshots are machine-local, not portable.** A vault moved or exported to another machine does not carry its history. This is deliberate — snapshots are local UI affordance, not user data.
- **Index file is the single source of truth for the version list.** A corrupted or hand-edited `index.json` desyncs from blob files on disk. Write path must be atomic (write temp → rename); a self-healing "rescan blobs/" recovery path is out of scope for v1 — when it matters, add it.
- **No retention cap in v1.** Text snapshots are KB-scale; a vault with tens of thousands of saves is still MB-scale. When blob dir measurably grows, add a retention policy driven by real data — not preemptively.
- **Hash dedup is per-file-last-entry, not global.** `index.json` check is "does this file's most recent entry have this hash?" Cross-file dedup happens for free at the blob layer (same content → same filename → written once), but the index-level decision to skip a snapshot only consults the file's own last entry. This is intentional — checking "has this exact content ever been snapshotted under any file" would couple unrelated files' histories.
- **First snapshot is lazy.** Files never saved or opened after feature rollout have no history. This is correct — they have no versions. A bulk baseline scan was rejected as one-time IO waste and index pollution.

## Status

Accepted.
