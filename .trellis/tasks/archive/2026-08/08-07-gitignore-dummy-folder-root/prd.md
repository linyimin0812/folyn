# gitignore dummy-non-existing-folder at repo root

## Goal

`@file-viewer/vite-plugin` (registered in `apps/desktop/vite.config.ts:49` with `copyAssets: true`) writes renderer assets to a placeholder dir `dummy-non-existing-folder/` when vitest runs without a determined outDir. The folder is created at the **repo root**, but `.gitignore:38` only ignores `apps/desktop/dummy-non-existing-folder/` — wrong path, so a root-level `dummy-non-existing-folder/` could show up as untracked.

## Requirements

- Add `dummy-non-existing-folder/` (root-level) to `.gitignore`.

## Acceptance Criteria

- [ ] `git status` shows no untracked `dummy-non-existing-folder/` after running vitest.

## Out of Scope

- Stopping the plugin from writing the folder at all (config tweak to `fileViewerRenderers`).

## Technical Notes

- Existing entry `.gitignore:38` is `apps/desktop/dummy-non-existing-folder/` — leave it; root entry is broader.
