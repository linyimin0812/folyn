# Bootstrap: Refresh Trellis Specs for Extension Packages

## Goal

Bring `.trellis/spec/` and the `.trellis/config.yaml` package registry in line with the current codebase after the extension-system migration, so that spec context injection actually routes for every real package. Full analysis in [research/repository-analysis.md](./research/repository-analysis.md).

## Background (confirmed facts)

- The spec tree is solid for: `desktop/frontend`, `api/backend` (content describes `apps/desktop/src-tauri`), `api/frontend` (N/A redirects), `cli-adapter`, `vault-provider`, `guides/`.
- `.trellis/config.yaml` is stale: `api → apps/api` (dead dir), `container-plugins → packages/container-plugins` (dead dir, replaced by `container-extensions`), `default_package: api` (dead path). Five real packages have no registry entry and no specs: `container-extensions`, `extension-sdk`, `extension-host`, `create-folyn-extension`, `extension-dev-skill`.
- `.trellis/spec/container-plugins/` describes the old ContainerPlugin system; the package was replaced (interface now lives in `folyn-extension-sdk` contracts; package is `@folyn/container-extensions` with `registerBuiltinExtensions()`).
- Four desktop spec files carry stale `@folyn/container-plugins` references (paths + symbol names).
- Authoritative docs exist at repo root: `extension-system.SPEC.md` (197 lines) and `Folyn-Extension-System-Refactor-Technical-Design.md` (3296 lines, cited by host source §numbers).

## Requirements

1. `config.yaml` packages registry matches reality: dead keys removed, five new packages added, `default_package: desktop`.
2. `api` spec layer is retired: `api/backend` content moves to `desktop/backend` (it already documents `apps/desktop/src-tauri`), `api/frontend` N/A redirects deleted, `api` spec dir removed.
3. `container-plugins` spec replaced by `container-extensions` spec written from the real package source, carrying over still-valid patterns (registry singleton, one-file-per-extension, inline-styles styling, slash menu) and documenting new contracts (`hidesInactiveChildren`, VaultContext, editor-languages, SDK re-exports).
4. New spec layers for `extension-sdk` (contracts conventions, runtime-free rule, manifest validation) and `extension-host` (lifecycle state machine, transactional activation, Tauri-free/React-free, testing with fakes).
5. Minimal spec for `create-folyn-extension` (CLI conventions); `extension-dev-skill` gets a pointer-only index (it is a skill package whose SKILL.md is its documentation).
6. The four stale desktop spec references are updated to current package/symbol names.
7. English documentation (matches all existing specs). Layer name `frontend` for the new TS packages (consistent with cli-adapter/vault-provider routing).

## Out of Scope

- Rewriting filled specs beyond the four stale references.
- Modifying product source code.
- New specs for Rust backend beyond the moved `api/backend` content.

## Acceptance Criteria

- [ ] `grep -R "To be filled\|TODO: fill" .trellis/spec` returns nothing
- [ ] `python3 ./.trellis/scripts/get_context.py --mode packages` lists every real package with correct paths; no dead entries
- [ ] Every package key in config.yaml has a matching spec dir; every spec dir matches a package key (except `guides`)
- [ ] `grep -rn "spec/api/\|spec/container-plugins" .trellis/spec/` returns nothing (after desktop refs updated)
- [ ] No desktop spec file references `@folyn/container-plugins` or `registerBuiltinPlugins`
- [ ] Each new spec contains real file paths that exist and patterns backed by source (spot-check via research file)
- [ ] Index files match the final spec file set in each directory

## Key Decisions

- Move `api/backend` → `desktop/backend` rather than keeping a fake `api` key pointing at `src-tauri`: the key name must not lie (evidence: api/backend content self-describes as the Tauri layer).
- Replace (delete + rewrite) rather than edit-in-place the container-plugins spec: spec dir name must equal the config package key for routing to work.
- `extension-dev-skill` pointer-only: its SKILL.md is the documentation; duplicating in spec would repeat the same rule.
- Don't force the 6-file hook/state/component template on new packages: write the file set each package actually needs (spec-writing reference: adapt to the codebase).

## Risks / Deferred

- `.trellis/.template-hashes.json` is dirty; a future `trellis update` may rewrite parts of `.trellis/` — config.yaml `packages` section is user-owned data, not template-managed, so this is acceptable.
- Old archived tasks' jsonl files still reference `spec/api/...` — historical records, not fixed (archived, read-only context).
