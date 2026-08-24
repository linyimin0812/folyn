# Fix external-file-open cold-launch not shown (cross-platform)

## Goal

When the OS launches Mochi via "Open With" / file association on a file, Mochi opens but the file is not displayed. Fix the cold-launch race on macOS and add Windows support (cold + warm launch).

## Requirements

* **macOS cold launch** (Mochi not running, Open With): file opens as an `ext:` tab — no race.
* **macOS warm launch** (Mochi running, Open With): file opens (currently works; must not regress).
* **Windows cold launch**: file path from `std::env::args_os()` is opened as an `ext:` tab.
* **Windows warm launch**: add `tauri-plugin-single-instance`; the second instance forwards its argv to the running instance, which opens the file as an `ext:` tab.
* If main window is hidden (pet-mode close-to-hide), it is restored + focused when an external file arrives.
* Existing in-app Open External File… command (`commandRegistry.ts:167`) keeps working unchanged.
* Multiple files selected → Open With Mochi: each path opens as its own `ext:` tab (loop already exists in `App.tsx:586`).

## Acceptance Criteria

* [ ] macOS cold launch with a `.md` file → file opens as `ext:` tab; main window focused.
* [ ] macOS warm launch with a `.md` file (Mochi already running) → file opens; no second instance.
* [ ] Windows cold launch with a `.md` file → file opens as `ext:` tab; main window focused.
* [ ] Windows warm launch with a `.md` file (Mochi already running) → file opens in the existing instance; second process exits without showing a second window.
* [ ] macOS cold launch with multiple `.md` files → all open as separate `ext:` tabs.
* [ ] `mochi-startup.log` records the pending-paths drain path on cold launch (one log line per drained path or a single summary).
* [ ] In-app Open External File… command still opens the picker and the chosen file.
* [ ] No regression in `editorIoService.openFile` unit tests (existing snapshots pass).

## Definition of Done

* [x] Unit test for `PendingOpenFiles` buffer: push → drain returns + clears; push multiple → drain returns all.
* [x] Unit test for Windows argv filter: skips exe path and `-`/`--` flags, keeps file paths.
* Manual e2e checklist (not automated — OS-launch paths): cold + warm on macOS + Windows × single + multi file.
* Lint / typecheck / CI green.
* [x] `tauri.conf.json` `fileAssociations` and macOS `Info.plist` document which extensions Mochi claims (verified state listed in Technical Notes).
* Rollback: revert commit; no migration.

## Technical Approach

### Single backend pending buffer + drain command

**State**: `commands::PendingOpenFiles(std::sync::Mutex<Vec<String>>)`, registered on the Builder chain (same pattern as `PetSizeState` etc., see `lib.rs:644-677`).

**Populate paths**:
* macOS `RunEvent::Opened { urls }` (`lib.rs:882`): convert urls → paths, push into buffer.
* Windows cold launch in `setup`: parse `std::env::args_os()` skipping `args[0]` (exe) and any arg starting with `-`/`--`, push remaining as file paths.
* Windows warm launch: `tauri-plugin-single-instance` handler receives `argv: Vec<String>`; push file paths (same skip rule) into the buffer.

**Emit signal**: after pushing, emit `app://open-external-file` with the pushed paths payload (one event per push, or one event after setup with all buffered paths — TBD at impl time; the frontend handles either).

**Drain command**: `drain_pending_open_files() -> Vec<String>` returns the buffer contents and clears it.

**Frontend** (`App.tsx:577-603`): on mount, FIRST `invoke('drain_pending_open_files')` → open returned paths (same loop as today), THEN `listen('app://open-external-file')` for subsequent warm-launch events. This closes the cold-launch race: any path buffered before the listener registered is drained after it registers.

**Window restore**: existing `main.show(); main.set_focus()` in `RunEvent::Opened` stays; mirror it in the single-instance handler and on Windows cold launch in `setup`.

### Why this approach (vs alternatives)

* **Alternative A — backend re-emits on a timer until frontend acks**: adds polling complexity, harder to reason about. Rejected.
* **Alternative B — frontend polls a `get_pending` command every N ms**: wasteful, latency. Rejected.
* **Chosen — drain-once + listen**: one IPC roundtrip on mount, zero polling, matches existing emit/listen flow.

## Decision (ADR-lite)

* **Context**: macOS cold-launch race drops Open-With file paths because the Rust event fires before the React listener registers. Windows has no path at all (no single-instance, no argv handling, no `RunEvent::Opened`).
* **Decision**: Backend-side pending buffer + `drain_pending_open_files` command + `tauri-plugin-single-instance` for Windows warm-launch. Frontend drains on mount before listening.
* **Consequences**: One new Rust dep (`tauri-plugin-single-instance`) — widely used, maintained, low risk. Adds ~50 lines of Rust + ~10 lines of TS. Closes both cold + warm races on both platforms. Future Linux support only needs to wire `std::env::args_os()` parsing into the same buffer.

## Out of Scope

* Linux desktop launch (deferred; `tauri-plugin-single-instance` supports Linux too, wiring is mechanical when needed).
* Auto-association installer / "set Mochi as default" UI — separate UX work.
* File-type handler registration beyond what's already declared in `tauri.conf.json` / `Info.plist`.
* Path canonicalization / symlink resolution beyond what `editorIoService.openFile` already does.
* Files opened via drag-and-drop into an already-running Mochi window — already handled by existing `drop` listener (`App.tsx:560`).

## Technical Notes

### Files touched

* `apps/desktop/src-tauri/src/lib.rs` — register `PendingOpenFiles` state; push paths in `RunEvent::Opened`; push paths in `setup` on Windows from `args_os`; init `tauri-plugin-single-instance` on Windows.
* `apps/desktop/src-tauri/src/commands.rs` — `PendingOpenFiles` struct + `drain_pending_open_files` command; argv-filter helper (extracted, unit-testable).
* `apps/desktop/src-tauri/Cargo.toml` — `tauri-plugin-single-instance` dep (Windows-only or all-platforms — plugin is cross-platform; gate init to Windows).
* `apps/desktop/src-tauri/tauri.conf.json` — verify `fileAssociations` covers `.md`/`.markdown`; record current extensions in this PRD.
* `apps/desktop/src/App.tsx` — `useEffect` (`App.tsx:577`): drain on mount, then listen.
* `apps/desktop/src/services/editorIoService.test.ts` — confirm no break to existing `openFile` external tests.

### Reference code in repo

* macOS `RunEvent::Opened` emit: `lib.rs:882-896`.
* macOS `RunEvent::Reopen` (dock-click) window restore: `lib.rs:902-907` (same show+focus pattern to mirror in single-instance handler).
* Frontend listener: `App.tsx:584-595`.
* `editorIoService.openFile` external-path handling: `editorIoService.ts:86-185`.
* Existing managed-state-on-Builder pattern: `lib.rs:644-677`.

## Implementation Record (2026-08-16)

### Verified current state

* `apps/desktop/src-tauri/tauri.conf.json` → `bundle.fileAssociations` declares two groups:
  * `Mochi Markdown` (role Editor, mime `text/markdown`): `md`, `markdown`, `mdx`, `mdown`, `mkd`
  * `Mochi Text` (role Viewer, mime `text/plain`): `txt`, `text`, `log`, `csv`, `tsv`, `json`, `json5`, `yaml`, `yml`, `xml`, `html`, `htm`, `css`, `js`, `ts`, `toml`, `ini`, `rst`, `tex`
* `apps/desktop/src-tauri/Info.plist` carries only usage-description strings (mic / accessibility / AppleEvents / speech). No explicit `CFBundleDocumentTypes` — Tauri generates document types from `fileAssociations` at bundle time (the `Info.plist` in the repo is the custom-info override that Tauri merges). So `fileAssociations` is the single source of truth for claimed extensions; no edit needed.

### Deviations from the original plan (and why)

* State lives in `commands/file_commands.rs` (`PendingOpenFiles`, `filter_argv_paths`, `drain_pending_open_files`), not a new top-level `commands.rs` — the repo's commands are split by domain under `commands/` and `file_commands.rs` is re-exported via `commands/mod.rs` (`pub use file_commands::*`).
* Windows argv is captured in `run()` BEFORE `tauri::Builder::default()` (not in `setup`): Tauri 2 starts loading structurally-declared webviews during `Builder::build()`, and the frontend's mount-time drain invoke can fire before the `.setup()` body runs — pushing in `setup` would lose the same cold-launch race we are fixing (the flash-quit timing documented at `lib.rs` managed-state block). Pre-populating the managed state before build makes the mount drain race-free by construction.
* The single-instance plugin is registered via a `let builder = builder.plugin(...)` shadow gated to Windows (`#[cfg(target_os = "windows")]`), not an inline mid-chain `.plugin(...)` — a cfg attribute cannot be attached to a mid-chain method call (parses as a new statement, `expected ';'`). macOS keeps its native multi-instance + Launch Services behavior.
* `startup_log` was widened to `pub(crate)` so `drain_pending_open_files` / `from_process_args` can write the required `mochi-startup.log` drain record (single summary line per drain).

### Follow-up (2026-08-16, warm-launch report)

User reported the failure is NOT cold-launch-only: with Mochi already running,
"Open With" also fails to show the file. Root-cause analysis of the Tauri stack:

* macOS warm launch depends ENTIRELY on `RunEvent::Opened` (tao 0.35.3
  implements `application:openURLs:` → `Event::Opened`; it does NOT implement
  `application:openFiles:`). If the running instance is not registered as the
  document handler via Launch Services, macOS launches a SECOND process
  instead of routing to the running one — and the original design had no
  handler for that second process on macOS.
* macOS cold launch also relied on `RunEvent::Opened` timing; but Launch
  Services ALWAYS passes the opened file path(s) as positional argv on cold
  launch — a deterministic channel the original plan only used for Windows.

Revised design (this supersedes the earlier deviations):

1. `PendingOpenFiles::from_process_args()` now runs on macOS AND Windows in
   `run()` before `Builder::build()` — cold-launch drain is deterministic on
   both platforms, independent of `RunEvent::Opened` timing. `-psn_...` /
   `--flag` args are filtered out.
2. `tauri-plugin-single-instance` is now registered on macOS AND Windows
   (gated `#[cfg(not(target_os = "linux"))]`; Linux stays deferred per PRD).
   The callback forwards the second instance's argv → buffer + emit +
   show/focus main. This covers macOS warm launch whether macOS routes to
   the running instance (`RunEvent::Opened`) or spawns a second process
   (single-instance callback).
3. Frontend order changed to LISTEN FIRST, THEN DRAIN, in two independent
   async blocks: a warm-launch emit can never be missed (no drain↔listen
   gap), and a `drain_pending_open_files` failure (e.g. stale backend) no
   longer kills the warm-launch listener. `openFile` is idempotent on the
   tab id, so a path delivered both ways just re-activates the tab.
4. `startup_log` now records every delivery channel (`argv captured`,
   `RunEvent::Opened`, `single-instance callback`, `drained N pending
   path(s)`) so `mochi-startup.log` shows which path a launch took.

### Verified

* `cargo check -p mochi` (macOS): clean for this diff (0 new warnings; the only remaining warnings are pre-existing unused re-exports).
* `cargo test -p mochi --lib pending_open_files` and `... filter_argv_paths`: 4/4 new tests pass.
* `vitest run src/services/editorIoService.test.ts`: 4/4 pass (no regression in `openFile` external path).
* Windows `x86_64-pc-windows-msvc`/`-gnu` cross-checks cannot complete on this Mac (no Windows C toolchain for `bzip2-sys`/`aws-lc-sys` — pre-existing env limitation, covered by CI). The cfg-gated Windows code was verified by reading against `tauri-plugin-single-instance@2.4.3`'s published `init` signature (`FnMut(&AppHandle<R>, Vec<String>, String)`, second instance auto-exits).
* `commandRegistry.test.ts` fails to collect on this machine with or without this diff (`open-color.json` needs `type: json` import attribute under the current Node toolchain) — pre-existing, unrelated.
