# Copy an opened external file into the current vault

## Goal

The app already opens external files (absolute / `~/` / `$HOME` paths picked via
the OS file dialog, drag-drop, or "Open With") as vault-independent `ext:` tabs.
Add the ability to copy the *currently open* external file into a directory the
user picks inside the current vault. After copying, open the new vault copy as a
tab and reveal + select it in the sidebar file tree.

This is the external-path counterpart to the existing sidebar "复制文件" action
(`vaultStore.copyPath`), which only works for vault-internal sources because it
reads via the vault manager (which `join(basePath, path)`s). External sources must
be read via `externalFileProvider` (direct Tauri fs, `$HOME`-scoped) and written
into the vault through the manager.

## Design decisions (confirmed with user)

1. **Target dir is picked each time** — reuse the existing `MoveDialog` in
   `mode="copy"` (consistent with the sidebar copy flow). No pre-configured
   default directory.
2. **Entry point** — a button in the Topbar, next to `ExportMenu`, shown **only
   when the active tab is an external file** (`isExternalPath(activeTab.path)`).
3. **Post-copy behavior** — open the new vault copy as a tab and reveal + select
   it in the sidebar tree. The original external tab stays open.
4. **Scope** — files only (OS "Open With" hands over files, never directories).

## Requirements

- New `vaultStore` action `copyExternalFileToVault(srcExternalPath, targetDir): Promise<string>`:
  - Reads the external file via `externalFileProvider.readFile` (asserts within
    `$HOME`, resolves `~`/`$HOME`).
  - Derives `baseName` from the external path's last segment.
  - Resolves a non-colliding target name in `targetDir` via the existing
    `resolveCopyName(manager, targetDir, baseName, false)` (same-dir=false →
    original name first, ` 副本` suffix on collision — matches cross-dir copy
    semantics).
  - Writes via `manager.writeFile(targetPath, content)`, then `refreshFileTree()`.
  - Returns the new vault-relative path so the caller can open + reveal it.
- Topbar "复制到仓库" button:
  - Visible only when `activeTab` is an external file (`isExternalPath(path)` and
    `fileType !== 'web'`).
  - Click → opens `MoveDialog` in `mode="copy"` with `source = { path, type:'file', name }`.
  - `onConfirm(targetDir)` → `copyExternalFileToVault` → `editorIoService.openFile(newPath, name)` → close dialog.
- Reveal + select in the sidebar tree:
  - New `revealPathBridge.ts` (mirror of `newItemBridge.ts`) with
    `setRevealPathStarter(fn|null)` and `requestRevealPath(path)`.
  - `FilesPanel` registers a starter on mount that, given a vault-relative path:
    expands all parent dirs, scrolls the file element into view, and sets
    `selectedPaths` to `{path}` (blue highlight).
  - Refactor `locateActiveFile` to share the expand+scroll logic with the bridge
    starter (extract a `revealPath(path)` helper).
- i18n: add `topbar:copyToVault` (button label/tooltip) and reuse existing
  `sidebar:sidebarActions.copyDialog.*` keys for the dialog. zh + en, identical
  key trees.

## Acceptance Criteria

- [ ] Opening an external `.md` file (e.g. `~/Desktop/notes.md`) → Topbar shows the "复制到仓库" button; the button is hidden for vault-internal files and web tabs.
- [ ] Click the button → `MoveDialog` ("复制到") appears, listing current vault directories.
- [ ] Pick a target dir with no name collision → file appears there under its original name; original external tab stays open; new vault copy opens as the active tab; its parent dirs expand and the row is selected + scrolled into view in the sidebar.
- [ ] Pick a target dir where the name already exists → writes `name 副本.ext` (or `name 副本 2.ext` on further collision).
- [ ] Copying fails gracefully (e.g. external file outside `$HOME`) → error logged, no half-written vault file (the write is a single `writeFile`, so no partial state).
- [ ] `tsc` / `eslint` pass; `pnpm test` green; zh/en i18n key trees identical.

## Definition of Done

- `vaultStore.copyExternalFileToVault` + unit tests (no-collision, ` 副本` on
  collision, returns the new path, reads via `externalFileProvider`, writes via
  manager). External read is mocked at the module level
  (`vi.mock('@/services/externalFileProvider')`), mirroring the existing
  `vi.mock('@/utils/fileWatcher')` pattern.
- `revealPathBridge.ts` + FilesPanel registration.
- Topbar button wired + i18n (zh/en).
- No new Tauri capability/scope needed (external read already permitted under
  `$HOME/**`; vault write uses existing manager).

## Out of Scope

- External **directories** (only files arrive via "Open With").
- A pre-configured/default target directory (decision 1: pick each time).
- Preserving mtime / file metadata (`writeFile` updates mtime).
- Batch/multi-file copy (one active external file at a time).
- Copying to a different vault (current vault only).

## Technical Notes

- Reuse `MoveDialog` (`SidebarActions.tsx:228`), `resolveCopyName` +
  `copyNameCandidates` (module-private in `vaultStore.ts`), `editorIoService.openFile`
  (opens a vault-relative path as a `${vaultId}:${path}` tab), and the `ext:`-tab
  detection via `isExternalPath` (`@/utils/isExternalPath`).
- Static-import `externalFileProvider` at the top of `vaultStore.ts` (no dynamic
  import) so the store action is a plain await — keeps the unit test's module mock
  simple. `externalFileProvider` only imports `@/utils/isExternalPath` statically
  and `@tauri-apps/plugin-fs` dynamically inside its methods, so a static import
  does not touch Tauri fs at module load.
