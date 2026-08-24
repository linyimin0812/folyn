# Version History

## Goal

Add persistent per-file version history to Folyn editors. When a user saves (or closes a tab of) a versionable file, the content is snapshotted; the user can browse snapshots in an in-editor side panel, view a unified diff against the current file, and restore a chosen snapshot. Restoring never loses the current state — it snapshots current first, then overwrites.

## What I already know

* Grilling converged; see `docs/adr/0003-version-history-content-addressable-store.md` for the storage-architecture decision and `CONTEXT.md` (terms: Version Snapshot, Version Index, Versionable File) for the canonical vocabulary.
* Single save seam confirmed: `editorIoService.saveFile(tabId)` at `apps/desktop/src/services/editorIoService.ts:239`. `flushAllAutoSaves` at line 486 funnels autosave through `saveFile` too, so a single hook covers manual + autosave.
* `diff` package `^9.0.0` already in `apps/desktop/package.json` — no new dependency for diff rendering.
* No existing reusable diff-view component in repo (`apps/desktop/src/components/git/` is a sync panel, not a diff view).
* Existing app-data pattern: `~/.folyn/vaults/<vaultId>/` already holds per-vault metadata (sessionStorage etc.).
* File-types-with-editor list (scope): markdown, html, code, plantuml, graphviz, csv, json, svg, web, clip, dbml, drawio, excalidraw, mmap, rich-text.

## Requirements

1. **Snapshot trigger — save**: hook into `editorIoService.saveFile(tabId)`. After the file is written to disk, compute SHA-256 of the UTF-8 bytes and consult the file's last `Version Index` entry; if the hash matches, skip (no-op). Otherwise write a blob to `~/.folyn/vaults/<vaultId>/versions/blobs/{sha256}.{ext}` and append `{hash, ts, size}` to the file's entry in `index.json`.
2. **Snapshot trigger — tab close**: on tab close, perform the same snapshot flow against the on-disk content of the file (not editor dirty state). If the tab's file was never saved or no path is bound, skip.
3. **Atomic index write**: write `index.json` to `index.json.tmp` then rename — single-user desktop, but torn writes corrupt the source of truth. No retry/recovery path in v1.
4. **Blob storage**: content-addressable — filename is `{sha256}.{ext}` where `ext` is the original file's extension (preserved for debuggability). Write is conditional on blob not existing (hash dedup free across files).
5. **Restore flow**: (a) snapshot current on-disk content first (same flow as trigger, including dedup); (b) overwrite the on-disk file with the chosen blob's content; (c) refresh the editor buffer; (d) append a new index entry reflecting the restored content (the restored content's hash). Result: history chain is monotonic — no version ever lost.
6. **UI — in-editor side panel**: an editor toolbar button "History" opens a right-side panel for the active versionable file. Panel shows a time-ordered list of snapshots (timestamp + size). Clicking a snapshot renders a unified diff (chosen → current) in a single pane using the `diff` package's `createPatch`. Each entry has a "Restore" action. Closing the panel or switching files unmounts state.
7. **Scope gate**: only file types with a registered editor participate. Non-editor types (image previews, etc.) show no History button.
8. **Lazy baseline**: no first-launch scan. Files never saved/closed after rollout have no history. First snapshot is taken on the first save or tab-close after rollout.
9. **No retention cap in v1.** Text snapshots are KB-scale; retention policy deferred until blob dir measurably grows.

## Acceptance Criteria

* [ ] Saving a versionable file via Cmd+S creates a snapshot if content changed since the last snapshot; identical-content saves are no-ops (verified by mocking the same content twice).
* [ ] Closing a tab of a versionable file with on-disk content unchanged since last snapshot does NOT create a new snapshot (dedup holds across triggers).
* [ ] Closing a tab whose on-disk content differs from the last snapshot creates a new snapshot.
* [ ] `~/.folyn/vaults/<vaultId>/versions/blobs/{sha256}.{ext}` exists for each snapshot; `index.json` lists entries in time order with correct `{hash, ts, size}` for each file path.
* [ ] `index.json` is never observed in a torn state during a simulated crash between blob-write and index-rename (test: write blob, kill before rename, restart — index either reflects pre-snapshot state or post-snapshot state, never partial).
* [ ] History panel lists snapshots for the active file; switching active file re-renders the list.
* [ ] Clicking a snapshot shows a unified diff against current on-disk content (additions / deletions visible).
* [ ] Restore: current on-disk content is snapshotted first; then file is overwritten with chosen blob's content; editor buffer refreshes; new index entry appended for the restored content.
* [ ] Files with no editor (image preview) show no History button.
* [ ] A vault with zero saves since rollout has an empty `versions/` dir (or no dir at all) — no first-launch scan ran.

## Definition of Done

* Unit tests for the snapshot service (hash dedup, atomic index write, restore chain) — pure functions, no Tauri FS mocking required where a FS shim is injected.
* Integration test for the save → snapshot → restore round-trip via a FS shim.
* Lint / typecheck / CI green.
* `CONTEXT.md` and `docs/adr/0003-...md` already updated (done in grilling phase).
* Manual smoke: open markdown file → save → edit → save → open History → see 2 snapshots → restore first → editor shows first content → save → third snapshot exists in index (current content preserved by restore).

## Technical Approach

### Module shape

A new `versionHistoryService.ts` in `apps/desktop/src/services/` exposing:

* `snapshotOnSave(vaultId, filePath): Promise<void>` — read on-disk content, hash, dedup vs last entry, write blob + append index. Idempotent.
* `snapshotOnClose(vaultId, filePath): Promise<void>` — same as above; the distinction is only call-site semantics. May collapse to one function `snapshot(vaultId, filePath)`.
* `listSnapshots(vaultId, filePath): Promise<Snapshot[]>` — read index.json, return entries for that file.
* `readBlob(vaultId, hash, ext): Promise<string>` — for diff/restore.
* `restore(vaultId, filePath, targetHash): Promise<void>` — snapshot-current-first, overwrite file, return new hash for editor refresh.

Internals:

* `sha256(s: string): string` — Node crypto via Tauri shell or a pure-JS impl; prefer pure-JS (`node:crypto` is not available in browser context — check Tauri's allowed APIs; use `js-sha256` if needed, but check deps policy).
* `readIndex(vaultId): Promise<Index>` / `writeIndex(vaultId, index): Promise<void>` — atomic temp-rename.
* Vault-root resolution — reuse `resolveBasePath` from `@/utils/pathResolver` and the vault-id-to-path lookup already used by `sessionStorage.ts`.

### Hook points

* `editorIoService.saveFile(tabId)` — after the existing file-write succeeds, call `versionHistoryService.snapshot(vaultId, filePath)`. Skip if `tabId` has no bound path or is not a versionable type.
* Tab close handler — locate the close-tab seam (likely in work-area / editor store); after any unsaved-changes save, call `versionHistoryService.snapshot(vaultId, filePath)`.

### UI

* New component `apps/desktop/src/components/file-types/shared/VersionHistoryPanel.tsx` (or wherever shared editor chrome lives — verify during implementation).
* Editor toolbar: "History" button visible only when active file is versionable.
* Diff pane uses `import { createPatch } from 'diff'` and renders the patch string in a `<pre>` with simple `+`/`-` line coloring. No syntax highlighting in v1.

### Hash function

Confirm: in Tauri renderer context, `node:crypto` is typically not available; either use the `js-sha256` package (would need dep check) or use Web Crypto `crypto.subtle.digest('SHA-256', ...)` (returns ArrayBuffer, hex-encode). Prefer Web Crypto — zero deps, already available.

## Decision (ADR-lite)

**Context**: Folyn needs per-file version history across sessions for editor-bearing file types. Multi-vault, multi-type (local + GitHub-backed).

**Decision**: Self-built content-addressable store at `~/.folyn/vaults/<vaultId>/versions/{blobs/{sha256}.{ext}, index.json}`. Triggered on save + tab close. Hash dedup against the file's last index entry. No retention cap, no first-launch baseline. UI is an in-editor side panel with unified diff via the existing `diff` package. Restore is snapshot-current-first then overwrite.

**Consequences** (see ADR-0003 for full):
* Snapshots are machine-local; vault export doesn't carry history.
* `index.json` is single source of truth — atomic write required.
* Hash dedup is per-file-last-entry (cross-file dedup is incidental via content-addressable blob naming).
* Future retention / cross-machine sync would need a separate layer; the storage shape doesn't preclude it but doesn't pre-build for it.

## Out of Scope

* Retention policy (cap N, age-based, tiered) — deferred until blob dir measurably grows.
* Cross-machine sync of snapshots.
* Snapshot of binary file types (images, etc.) — only editor-bearing types.
* First-launch bulk baseline scan of existing vault contents.
* Branch / fork semantics (multiple restore chains).
* Snapshot on idle / time-based trigger (only save + close).
* Snapshot deletion UI (user can't manually prune).
* Syntax-highlighted diff view.
* Diff between two arbitrary historical snapshots (only snapshot-vs-current).
* Per-character diff; v1 is line-level via `diff` package's `createPatch`.

## Implementation Plan (small PRs)

* **PR1 — Storage service + tests**: `versionHistoryService.ts` with `snapshot/listSnapshots/readBlob/restore` against an injectable FS shim. Unit tests: hash dedup, atomic index write, restore chain monotonicity. No UI, no hook into `editorIoService` yet.
* **PR2 — Save/close hooks**: wire `snapshot` into `editorIoService.saveFile` and the tab-close handler. Integration test: save → snapshot exists; close-without-change → no new snapshot; close-with-change → new snapshot.
* **PR3 — UI panel + restore**: `VersionHistoryPanel.tsx`, editor toolbar button, list, diff pane via `diff` package, restore action. Manual smoke test per DoD.

## Technical Notes

* Files inspected:
  * `apps/desktop/src/services/editorIoService.ts:239` — `saveFile` (single seam, autosave funnels through).
  * `apps/desktop/src/services/editorIoService.ts:486` — `flushAllAutoSaves` sink is `saveFile`.
  * `apps/desktop/src/utils/sessionStorage.ts` — `~/.folyn/vaults/<vaultId>/` pattern.
  * `apps/desktop/src/utils/pathResolver.ts` — `resolveBasePath`.
  * `apps/desktop/package.json` — `diff: ^9.0.0` already present.
* Hash impl: prefer `crypto.subtle.digest('SHA-256', ...)` (Web Crypto, zero deps) over adding `js-sha256`.
* Tab close seam: needs verification during PR2 — likely in work-area or editor store; do not assume.
* Atomic write: Tauri `writeFile` then `rename` — both available in `@tauri-apps/plugin-fs`.
