# Paste external files with folder picker

## Goal

When the user copies a file in the OS file manager (Finder/Explorer) and pastes
(Cmd/Ctrl+V) anywhere in Folyn, pop up a folder picker restricted to the current
vault, then import (copy) the file(s) into the picked folder. This is the paste
counterpart to the existing drag-drop-opens-file flow (commit 22aba65c) — but
instead of opening, it imports into the vault.

## Requirements

- **Trigger**: window-level `keydown` Cmd/Ctrl+V listener in `App.tsx`. Calls the
  Rust `read_clipboard_files` command; if it returns ≥1 path, `preventDefault()`
  and open the folder picker. If it returns 0 paths, fall through to the existing
  paste (text → editor, image → `ImagePasteDialog`).
- **Conflict rule (file wins)**: any paste where the clipboard holds a file ref
  opens the folder picker, even if the editor is focused. Text/filename paste
  into a note is no longer possible once a file is on the clipboard — the user
  can Esc the picker to abort. (Deliberate, per user decision 2026-08-30.)
- **Folder picker**: native `@tauri-apps/plugin-dialog` `open({ directory: true,
  defaultPath: <vaultRoot> })`. After pick, validate the path starts with
  `vaultRoot`; if not, toast "target must be inside the current vault" and reopen.
  - `ponytail:` native dialog can't cap navigation to vaultRoot, so we
    validate-and-reopen on violation. Upgrade path: custom in-app vault tree
    picker if the rejection UX proves janky in real use.
- **Import**: read each source file via `externalFileProvider.readFileBytes`
  (binary-safe; UTF-8 path would corrupt docx/xlsx/png), write into the target
  folder via the vault provider so the sidebar tree refreshes. Files outside
  `$HOME` are rejected with the existing `isWithinHome` error.
- **Multi-file**: support all paths from `file_list()`. One picker for the batch.
- **Conflict resolution**: per-file prompt `[Overwrite] [Skip] [Rename]` with an
  `[x] Apply to all` checkbox for batch. Rename auto-suffixes `report.md` →
  `report (1).md` → `report (2).md`.
- **Platform**: macOS + Windows in MVP (arboard covers Linux too; verify later).
- **i18n**: new keys under `paste` namespace in en/zh/ja/fr/de/es.

## Acceptance Criteria

- [ ] Copy a `.md`/`.png`/`.docx` file in Finder → Cmd+V in Folyn → folder picker
  opens at vault root → pick a subfolder → file appears in sidebar tree and is
  openable from Folyn.
- [ ] Copy 3 files (incl. a `.docx`) in Finder → Cmd+V → pick folder → all 3
  land in the folder, binary files uncorrupted (open the `.docx` in Folyn's
  office viewer to verify).
- [ ] Pick a folder outside the vault → toast "target must be inside the current
  vault" → picker reopens.
- [ ] Paste when one of the 3 files already exists → per-file prompt with
  Overwrite/Skip/Rename; checking "Apply to all" applies the choice to remaining
  conflicts without re-prompting.
- [ ] Copy a file outside `$HOME` (e.g. `/etc/hosts`) → paste → clear error
  toast "Cannot open file outside your home directory" (matches existing
  `externalFileProvider` boundary).
- [ ] Plain text paste (no file ref) still inserts text in the editor unchanged.
- [ ] Image paste into the editor (clipboard has image bytes, no file ref) still
  opens `ImagePasteDialog` unchanged.

## Definition of Done

- Rust command `read_clipboard_files` added with `arboard`, capability entry,
  and a small unit-level check (or a `demo()` self-check if a unit test is hard
  to wire for clipboard state).
- Frontend paste listener, folder picker, import path, conflict prompt wired up.
- Lint / typecheck / CI green; `pnpm test` green.
- i18n keys added to all 6 locales (en/zh/ja/fr/de/es).
- Manual smoke test on macOS (Cmd+C in Finder → Cmd+V in Folyn).

## Technical Approach

**Clipboard read (Rust side):**
- Add `arboard = "3"` to `apps/desktop/src-tauri/Cargo.toml` (already a transitive
  dep via `tauri-plugin-clipboard-manager 2.3.2` — no new download).
- New `#[command] read_clipboard_files` in `apps/desktop/src-tauri/src/lib.rs`
  (or a sibling `commands/clipboard_files.rs`): `spawn_blocking` + `arboard::
  Clipboard::new()?.get().file_list()`, returns `Vec<String>` (file paths).
  Mirrors the `voice.rs:1011` `spawn_blocking` pattern.
- Capability entry in `capabilities/default.json` mirroring the existing
  custom-command entries (e.g. the `win-detect` pattern at line 122-125).

**Paste trigger (frontend):**
- `App.tsx`: window-level `keydown` listener for `Cmd/Ctrl+KeyV`. On match,
  `await readClipboardFiles()`; if non-empty, `preventDefault()` + open folder
  picker; else fall through (do nothing — browser default fires).
- Must run in capture phase or coexist with the existing drag-drop capture-phase
  listener (no overlap — different events).

**Import path (frontend):**
- After picker returns target dir + user resolves conflicts, for each source
  path: `externalFileProvider.readFileBytes(src)` → write to
  `<targetDir>/<filename>` via the vault provider (so the tree refreshes).
  Compute vault-relative target by stripping `vaultRoot` prefix from the picked
  absolute path.

**Conflict prompt:**
- Small modal (reuse `ImagePasteDialog` overlay styling) listing conflicting
  files with per-row Overwrite/Skip/Rename + a global `[x] Apply to all`.

## Decision (ADR-lite)

**Context**: Need to import externally-copied files via paste, with a folder
picker. Two technical unknowns: (1) reading file paths from the clipboard in a
Tauri webview, (2) constraining the folder picker to the vault.

**Decision**:
- (1) Use `arboard` (already transitive dep) via a ~15-line custom Rust command;
  the stock `tauri-plugin-clipboard-manager` doesn't expose file reads.
- (2) Native dialog + post-pick validation (lazy); upgrade to custom in-app tree
  picker only if rejection UX proves janky.
- Scope: vault-restricted target, file-wins-on-conflict, multi-file supported,
  per-file conflict prompt with apply-to-all.

**Consequences**:
- "Paste filename as text into a note" breaks when a file is on the clipboard
  (user must Esc the picker). Traded for import predictability.
- Rejection-on-outside-vault is a minor UX dead-end; acceptable for MVP.
- Linux unverified in MVP (arboard supports it; deferred).

## Out of Scope

- Cut (Cmd+X) semantics — paste still copies; source is never deleted.
- Drag-drop import (drag-drop currently opens; changing that is a separate task).
- Pasting file *content text* as a new vault note (text paste stays as-is).
- Custom in-app vault tree picker (deferred; native dialog + validation first).
- Linux clipboard verification (arboard supports it; not in MVP smoke test).

## Research References

- [`research/clipboard-file-read.md`](research/clipboard-file-read.md) — arboard
  3.6.1 reads file paths from clipboard on macOS/Windows/Linux via
  `Clipboard::get().file_list()`; already a transitive dep; ~15-line Rust
  command. `tauri-plugin-clipboard-manager` v2.3.2 has no file-read API. `pastey`
  is a red herring (proc-macro, not clipboard).

## Technical Notes

- Finder writes both `public.file-url` AND `public.tiff` preview when copying
  an image file → the existing image-paste handler may also see `image/png` via
  `navigator.clipboard.read()`. The new paste listener calls
  `read_clipboard_files` FIRST and `preventDefault()`s on hit, so the image
  paste path never fires when a real file ref is present.
- Source path constraint: `isWithinHome` from `utils/isExternalPath.ts` already
  enforces `$HOME` boundary for `externalFileProvider.readFileBytes` — reuse,
  don't reimplement.
- Binary safety: must use `readFileBytes`/`writeFileBytes`, NOT the UTF-8 text
  path — see `externalFileProvider.ts:60-69` for the rationale (the existing
  `openDroppedFiles` staging uses bytes for the same reason).

## Implementation Plan (small PRs)

- **PR1**: Rust `read_clipboard_files` command + `arboard` dep + capability
  entry + frontend shim (`services/clipboardFiles.ts`). Smoke test: call from
  devtools, verify returns Finder-copied file paths.
- **PR2**: Paste listener in `App.tsx` + native folder picker + binary-safe
  import into vault. Smoke test: single-file import lands in tree.
- **PR3**: Conflict prompt (Overwrite/Skip/Rename + Apply-to-all) + multi-file
  batch + i18n + tests. Smoke test: 3-file batch with one conflict.
