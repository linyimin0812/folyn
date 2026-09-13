# rich-text settings page icon (richtext.svg)

## Goal

Wire the rich-text extension's Settings → Extensions display card icon to use `richtext.svg`. Currently the manifest has no `icon` field; the Settings card shows a default/blank icon. dbml mirrors the same pattern with `"icon": "sql.svg"` in its manifest + a build-time copy of the SVG to `dist/`.

## Requirements

- Add `"icon": "richtext.svg"` to `extensions/rich-text/src/manifest.json` (top-level field, mirrors dbml manifest).
- Update `extensions/rich-text/build.mjs` to copy `src/icons/richtext.svg` → `dist/richtext.svg` (mirrors `extensions/dbml/build.mjs:28`). The SVG already exists at `extensions/rich-text/src/icons/richtext.svg` (copied in the previous task).
- Build + reinstall so the Settings card shows the icon.

## Acceptance Criteria

- [ ] `extensions/rich-text/src/manifest.json` has `"icon": "richtext.svg"`.
- [ ] `extensions/rich-text/build.mjs` copies the SVG to `dist/richtext.svg`.
- [ ] `pnpm build` succeeds; `dist/richtext.svg` exists.
- [ ] Installed copy at `~/.folyn/extensions/folyn-rich-text/` includes `richtext.svg`.
- [ ] Settings → Extensions card shows the icon after reload.

## Definition of Done

- Build + typecheck green.
- Commit pushed.
- Manual reload confirms Settings card icon.

## Technical Approach

Mirror `extensions/dbml/build.mjs:28` (`await copyFile(path.join(root, 'src/icons/sql.svg'), path.join(root, 'dist/sql.svg'))`). The manifest `icon` field is resolved by the host via `read_extension_file` relative to the extension's installed `dist/` dir (per research `extension-file-type-icon.md`).

## Out of Scope

- File-tree icon (already wired via `FileTypeProvider.icon` in the previous task).
- Manifest schema changes.
- Other extensions.

## Technical Notes

- Reference: `extensions/dbml/src/manifest.json` line `"icon": "sql.svg"`.
- Reference: `extensions/dbml/build.mjs:25-28` (copy block + comment).
- SVG source: `extensions/rich-text/src/icons/richtext.svg` (already present).
- No host source changes.
