# External file modification auto-refresh

## Goal

When a file opened from outside the vault (OS dialog / drag-drop / Open With, read via `externalFileProvider`, tab id `ext:<path>`) is modified by another program, the open tab should refresh automatically — same behavior vault-internal files already have.

## What I already know

* Vault files already auto-refresh: `apps/desktop/src/utils/fileWatcher.ts` listens to `app://vault-watcher-event` from Rust `start_vault_watcher` (project_commands.rs), matches `changedPath.startsWith(currentBasePath)`, re-reads, and calls `diffReviewStore.setContentExternal(tabId, disk)` when content differs and tab isn't dirty.
* The Rust watcher only watches ONE root (the vault base path), single global instance, `stop` + `start` replaces it.
* External tabs bypass all of this: tabId is `ext:${filePath}` (editorIoService.ts:75), never matched by the watcher's `${vaultId}:${relativePath}` lookup, and their absolute paths fail the `startsWith(currentBasePath)` filter.
* External files are constrained to `$HOME` (`isWithinHome`), and their read/write already goes through `externalFileProvider` (direct Tauri fs).
* Existing refresh path is dirty-guarded and suppressed during own writes (`suppressWatcherFor` + `tab.isDirty` check).

## Open Questions

(none — approach decided)

## Requirements (evolving)

* Open external tab (non-dirty) updates its content when the file changes on disk.
* Dirty tabs are NOT overwritten (existing behavior for vault files).
* Suppression during own saves applies to external tabs too.

## Acceptance Criteria (evolving)

* [ ] Open an external file, modify it externally → tab content refreshes without reopening.
* [ ] Dirty external tab stays untouched.
* [ ] Vault watcher behavior unchanged.

## Definition of Done

* Unit test for the new refresh logic (mock externalFileProvider + stores).
* Lint / typecheck green.

## Technical Approach

**Chosen: A — fs-plugin per-file watch.** `@tauri-apps/plugin-fs` (already installed) exposes `watchImmediate(paths, cb)`. When an external tab opens, start a single-file watch; on tab close, unwatch. In the callback, apply the same guards as the vault path (paused / suppressed / dirty / handler.needsFileContent), re-read via `externalFileProvider.readFile`, deserialize via the file-type handler, and `diffReviewStore.setContentExternal('ext:<path>', diskContent)` when content differs.

## Decision (ADR-lite)

**Context**: External files bypass the vault-root Rust watcher, so external modifications never reach the open tab.
**Decision**: Per-file watch with `@tauri-apps/plugin-fs` `watchImmediate`; no Rust changes; reuse existing dirty/suppress guards and `setContentExternal` refresh path.
**Consequences**: Small watch bookkeeping (add on open / remove on close); event-driven with no polling overhead.

## Out of Scope (explicit)

* Watching arbitrary directories outside $HOME.
* Conflict resolution UI for dirty tabs.

## Technical Notes

* Files: `apps/desktop/src/utils/fileWatcher.ts`, `apps/desktop/src/services/editorIoService.ts`, `apps/desktop/src/services/externalFileProvider.ts`, `apps/desktop/src-tauri/src/commands/project_commands.rs`.

## Feasible approaches

**A. JS-side polling (Recommended)** — interval (e.g. 2s) in fileWatcher.ts that, for each open non-dirty `ext:` tab, reads via `externalFileProvider.readFile` and calls `setContentExternal` if content differs. Zero Rust changes, reuses all existing dirty/suppress guards.

**B. Rust per-file watcher** — new command `start_external_file_watcher(paths)` using notify NonRecursive single-file watches, emit on the same event channel; JS needs path add/remove bookkeeping as tabs open/close. More moving parts, event-driven but more code.

**C. JS `@tauri-apps/plugin-fs` watch** — if the fs plugin exposes `watch` for arbitrary paths, could watch per-file without Rust changes. Need to verify plugin capability.
