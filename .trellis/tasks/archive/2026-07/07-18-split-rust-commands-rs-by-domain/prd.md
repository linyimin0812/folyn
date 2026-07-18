# Split Rust commands.rs by domain

## Goal

`apps/desktop/src-tauri/src/commands.rs` is 1412 lines holding 37 Tauri commands spanning file/webview/git/pet concerns + shared state structs + pet helpers + menu constants. The only sibling that follows the per-domain convention is `plugin_commands.rs` (1762 lines, but single-concern). Split `commands.rs` into a `commands/` module directory with one submodule per domain, so each concern is navigable on its own. The pet block (~980 lines, lines 429-1412) is the bulk and the main win.

## What I already know (verified from repo)

`lib.rs` depends on `commands::` symbols:
- 37 commands in `generate_handler!` (lib.rs:516-549), all referenced as `commands::<name>`.
- `PET_CTX_MENU_*` string constants (defined commands.rs:409-415), used in lib.rs menu handler (lib.rs:36-43, 61-63, 391).
- `PetSizeState` managed state — defined in commands.rs:15 with an explicit comment that it lives there (not lib.rs) so `commands.rs` + `lib.rs` share the SAME type; used in lib.rs:379 (`app.state::<commands::PetSizeState>()`), 443-444 (`app.manage(commands::PetSizeState(...))`).
- `PetShortcutState` managed state (commands.rs:958), managed in lib.rs:451.

No other module imports `commands::` — `voice.rs`/`pet_panel_macos.rs` only mention these types in doc comments, not real `use` imports.

Domain inventory (commands.rs):
- **file** (lines 37-56): `open_file`, `save_file`, `check_url` + `UrlCheckResult` struct (48).
- **webview** (lines 88-305): `create_webview`, `navigate_webview`, `close_webview`, `hide_webview`, `show_webview`, `set_webview_position`, `on_webview_url_changed`, `hide_all_webviews` — 8 commands.
- **project/fs** (lines 307-428): `git_clone`, `remove_dir`, `get_project_overview` — 3 commands operating on project directories.
- **pet** (lines 429-1412, ~980 lines): 16 commands (`set_pet_size`, `toggle_pet_mode`, `set_pet_position`, `get_pet_position`, `pet_cursor_probe`, `pet_get_work_area`, `pet_set_cursor`, `pet_show_context_menu`, `pet_panel_show/hide/set_shortcut/set_position/get_position/set_size/get_size/is_visible`, `pet_bubble_show/hide/set_position`, `pet_set_topmost_level`, `pet_make_transparent`) + `PetSizeState`, `PetPosition`, `PetCursorProbe`, `PetWorkArea`, `PetShortcutState`, `PetPanelSize` structs + `PET_CTX_MENU_*` consts + private helpers `pet_size_to_px`, `current_pet_size_level`, `pet_cursor_pos_relative`.

Cross-domain helper calls: **none**. The 3 pet private helpers are defined AND used entirely within the pet block (lines ≥429); zero usage outside it. Each domain is self-contained → clean extraction, no inter-submodule `use` needed.

`pet_set_topmost_level` (1199/1274) and `pet_make_transparent` (1315/1405) are `#[cfg(target_os = "macos")]` / `#[cfg(not(...))]` platform pairs — one logical command each, both halves move together to `pet_commands.rs`.

## Requirements

1. Convert `commands.rs` → `commands/` module directory: create `commands/mod.rs` + 4 submodules.
2. Submodules (naming follows the `plugin_commands.rs` sibling convention — `_commands` suffix):
   - `commands/file_commands.rs` — `open_file`, `save_file`, `check_url`, `UrlCheckResult`.
   - `commands/webview_commands.rs` — the 8 webview commands.
   - `commands/project_commands.rs` — `git_clone`, `remove_dir`, `get_project_overview` (honest name: these are project-dir fs ops, not purely git; `project_commands` beats a misleading `git_commands`).
   - `commands/pet_commands.rs` — all 16 pet commands + `PetSizeState`, `PetShortcutState`, `PetPosition`, `PetCursorProbe`, `PetWorkArea`, `PetPanelSize` structs + `PET_CTX_MENU_*` consts + the 3 private pet helpers.
3. `commands/mod.rs` declares `mod file_commands; mod webview_commands; mod project_commands; mod pet_commands;` and re-exports via `pub use {file_commands, webview_commands, project_commands, pet_commands}::*;` (glob — lowest maintenance; only `pub` items re-export).
4. **lib.rs is untouched** — `mod commands;` resolves to `commands/mod.rs`, all `commands::<symbol>` references continue to resolve via the glob re-exports.
5. Delete the old `commands.rs`.
6. Each submodule's `use` imports: copy the needed `use` lines from the current `commands.rs` top (`std::fs`, `std::sync::Mutex`, `serde::Serialize`, `tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize}`) into whichever submodules actually use them — cargo check will flag unused/missing imports.

## Acceptance Criteria

- [ ] `commands.rs` no longer exists; `commands/mod.rs` + 4 submodules exist.
- [ ] `lib.rs` unchanged (diff = empty).
- [ ] `cargo check` (in `apps/desktop/src-tauri`) passes — zero new errors/warnings beyond baseline.
- [ ] `grep -rn "commands::" apps/desktop/src-tauri/src/lib.rs` shows the same symbols resolving.
- [ ] No `use crate::commands::` added anywhere (submodules are self-contained; if one is needed, that's a cross-domain coupling to flag).
- [ ] `pnpm test` (TS) still passes the same set (Rust change shouldn't affect TS, but confirm no breakage).

## Definition of Done

- `cargo check` green.
- TS test suite: same as baseline (modulo the 21 known pre-existing failures).
- No behavior change — pure module reorganization; `generate_handler!` registration order is preserved (lib.rs unchanged → handler order identical).
- Spec sync: if `.trellis/spec/desktop` has a Rust-side note on command organization, update; otherwise no spec doc covers Rust here (the frontend specs don't), so no spec sync required.

## Decision (ADR-lite)

**Context**: `commands.rs` (1412 lines, 37 commands, 4 concerns) is the Rust-side god file. `lib.rs` depends on its symbols (commands + managed-state structs + menu consts). The pet block is ~70% of the file and fully self-contained.

**Decision**: Convert to a `commands/` module dir with 4 per-domain submodules (`file_commands`, `webview_commands`, `project_commands`, `pet_commands`) and a `mod.rs` that glob-re-exports everything. lib.rs untouched (glob re-exports keep `commands::<symbol>` resolving). Full 4-way split rather than pet-only — same mechanical operation, and a half-split (pet extracted, 3 small blocks left in mod.rs) leaves mod.rs as an awkward residue. `project_commands` (not `git_commands`) because remove_dir/get_project_overview aren't git.

**Consequences**:
- lib.rs diff = 0 (lowest-risk path; the registration order in `generate_handler!` is literally untouched).
- `commands/mod.rs` is pure re-export plumbing (~6 lines).
- The big cognitive win is `pet_commands.rs` being its own navigable file.
- Risk: cargo check catches any missed `use` or visibility issue immediately; pet self-containment (verified) means no cross-submodule coupling to invent.
- `PetSizeState`'s "defined in commands.rs so lib.rs shares the type" comment stays true — it now lives in `pet_commands.rs` and is re-exported as `commands::PetSizeState`, so `app.state::<commands::PetSizeState>()` still resolves to the same type.

## Out of Scope

- `plugin_commands.rs` (1762 lines) — single-concern (plugins), not a god file by the multi-concern definition; leave it.
- `voice.rs` (927 lines) — single-concern (voice); leave.
- Refactoring command *bodies* — only file/module reorganization, no logic change.
- The `vault-provider` single-impl abstraction (separate task).
- Any Tauri command signature or capability/ACL change.

## Technical Notes

- `cargo check` is the verifier (cargo 1.95.0 present in this env). Run from `apps/desktop/src-tauri`.
- First run `cargo check` on the CURRENT tree to capture baseline warnings/errors, then compare after the split — only newly-introduced issues count.
- `mod commands;` in lib.rs resolves to either `commands.rs` or `commands/mod.rs`; once `commands/mod.rs` exists and `commands.rs` is deleted, resolution is automatic.
- Glob re-export (`pub use submodule::*;`) re-exports only `pub` items — the pet private helpers (`fn`, not `pub fn`) stay module-private inside `pet_commands.rs`, which is correct (they were file-private before).
- `PetSizeState`'s doc comment explicitly warns against moving it to a different module without keeping the shared type — the glob re-export preserves the single type identity, so the warning's constraint is respected.
