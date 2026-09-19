# pet panel search: all file types

## Goal

The pet panel search's Files group only lists `.md` files
(`flattenMarkdownFiles`). Support ALL file types — the vault tree
(`scan_file_tree`) already contains every file; the .md filter is a
display-side artifact inherited from `fileCommands.ts`.

## What I already know

* Rust `scan_file_tree` scans all files (hidden/excluded filtered) — the tree
  is complete; only `flattenMarkdownFiles` narrows to `.md`.
* `flattenFileTree` (treeUtils) flattens all files and is the established
  all-files helper (AiPanel / ChatInput @-mention use it).
* Panel file activation: `emitNavigateFile` → `pet://bubble-action` →
  petHostRouter 'file' case → `editorIoService.openFile(path, name)` —
  handles ANY type via `detectFileType` + handler registry (file viewers;
  unknown types open as unsupported/text views; never throws).
* `FileIcon` (components/icons/FileIcon.tsx) maps filename → per-type icon
  (ext map + registry handler icons + fallbacks) — the same component the
  sidebar FileTreeItem uses.

## Requirements

* Pet panel search Files group: all file types (not just .md).
* Per-type icons via `FileIcon` (replaces the hardcoded `ThemeIcon
  name="markdown"`).

## Acceptance Criteria

* [x] Searching matches and lists non-.md files (e.g. images, .csv).
* [x] Rows render a per-type icon.
* [x] Picking a file opens it in the main window (all types).
* [x] Targeted tests pass (PetPanelApp 28/28, tsc exit 0).

## Out of Scope (explicit)

* Main command palette (⌘P) file commands stay `.md`-scoped
  (`buildFileCommands`) — the request is about the pet popup only.
* Global (content) search unchanged.

## Technical Notes

* File: `apps/desktop/src/components/pet/PetPanelSearchResults.tsx`
  (+ its test coverage in PetPanelApp.test.tsx).
