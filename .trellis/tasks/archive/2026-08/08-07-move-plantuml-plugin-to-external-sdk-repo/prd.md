# Move quill-plugin-plantuml out of monorepo

## Goal
Relocate `plugins/quill-plugin-plantuml/` to `/Users/yiminlin/project/quill-plugin-sdk/quill-plugin-plantuml/` as an external plugin, and remove stale references inside the Quill monorepo.

## Background
Plugin currently lives as a pnpm workspace member (`plugins/*`) of the Quill repo. It depends on `quill-plugin-sdk` (workspace package at `packages/plugin-sdk`). Moving it out establishes a separate external home — the Quill repo no longer ships a sample plugin in-tree.

## Requirements

### Must
- Physically move `plugins/quill-plugin-plantuml/` (source contents minus `node_modules` / `dist` regenerable artifacts) to `/Users/yiminlin/project/quill-plugin-sdk/quill-plugin-plantuml/`.
- Update in-repo textual references to the old path:
  - `packages/create-quill-plugin/src/index.ts` (CLI output line)
  - `packages/create-quill-plugin/template/src/index.ts` (template comment)
  - `packages/create-quill-plugin/template/README.md` (template doc)
  - `docs/plugin-development.md` (3 lines)
  - `docs/plugin-development.zh.md` (3 lines)
  - `docs/plugin-sdk-reference.md` (2 lines)
- Update `pnpm-lock.yaml` (run `pnpm install`) so workspace entries for the moved plugin are dropped.
- Leave `apps/desktop/src/main.tsx:21` comment as-is — references the plugin by manifest id (`quill-plugin-plantuml`), not by path; id unchanged.

### Out of scope (explicit non-goals)
- Fixing the moved plugin's own `package.json` (`"quill-plugin-sdk": "workspace:*"` will break at the new location). User to resolve separately — could be `link:` to local SDK, a published version, or a local path. Flag in completion notes.
- Updating archived PRDs under `.trellis/tasks/archive/**` — historical, frozen.
- Initializing a git repo at the new location.

## Verification
- `git status` shows only the expected deletions + reference edits.
- `pnpm install` succeeds; lockfile no longer references `@quill/plugin-plantuml`.
- `pnpm -r typecheck` and `pnpm test` still pass (no in-repo code references the moved plugin path).

## Risks
- The moved plugin won't build as-is at the new location until `workspace:*` is fixed. Documented above as out-of-scope.
- `pnpm-lock.yaml` churn: any workspace deps the plugin pulled in (e.g. `plantuml-encoder`, `@codemirror/language`) may be pruned if no other workspace member uses them.
