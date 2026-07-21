# file-preview src autocomplete: duplicates rows and mis-resolves `../`

## Goal

Fix two bugs in the `src` autocomplete of `:::file-preview{src="..."}` directives:

1. Each dropdown row shows file info twice — `label = name`, `detail = full path`, and `path` ends with `name`, so the filename appears at both ends of the row.
2. `../` only resolves one level — nested `../../` makes `findDirChildren` look for a literal `..` directory and return null, so the popup stays empty. Runtime path resolution in `FilePreviewPlugin.tsx` accidentally works because `path.join` normalizes `..`, but the completion source and the plugin should agree.

## What I already know

* Completion source: `apps/desktop/src/editor/extensions/FilePreviewSrcExtension.ts`
  - No-`/` branch: `label: f.name, detail: f.path, apply: f.path` — path includes name → duplicate.
  - Has-`/` branch: same shape — `detail: c.path` includes `c.name` → duplicate.
  - `resolveDirPart` handles single `../` only; `findDirChildren` walks segments literally and cannot handle `..`.
* Runtime resolver: `packages/container-plugins/src/plugins/FilePreviewPlugin.tsx` `resolveVaultPath` — same single-`../` limit; works for nested `../` only because `path.join` (in VaultManager.readFile) normalizes `..` later.
* Only one registration of the completion source (`EditorView.tsx:259`) — no duplicate source.

## Requirements

* Each completion row shows the filename once. `detail` shows complementary info (directory) — no overlap with `label`.
* `../` resolves N levels deep in the completion source, matching what the runtime already does.
* `resolveDirPart` (completion) and `resolveVaultPath` (plugin) share the same resolution semantics so selecting an entry actually opens the file.

## Acceptance Criteria

* [ ] Type `:::file-preview{src="` and pick a file — dropdown row shows filename once, plus its directory once.
* [ ] From `a/b/c.md`, typing `../../` lists the root's children (or the appropriate ancestor's children).
* [ ] Accepting a `../`-resolved entry inserts a path that the preview actually renders (no "读取失败").
* [ ] Single `./` and bare-name behavior unchanged.

## Definition of Done

* Lint / typecheck green.
* Manual check in the editor: dropdown rows, `./`, `../`, `../../`.
* No new tests required (small UI behavior fix) — `ponytail:` per existing convention.

## Technical Approach

Single file edit in `FilePreviewSrcExtension.ts` + parallel edit in `FilePreviewPlugin.tsx`:

1. **Detail = directory only.** For the no-`/` branch: `detail = f.path.slice(0, -('/' + f.name).length)` (parent dir) or omit when at root. For the has-`/` branch: `detail = dirPath` (the resolved directory the children live in) — same for every row, but that's the info that disambiguates.
2. **Loop the `../` segments.** Rewrite `resolveDirPart` to split `dirPart` on `/`, walk segments, for each `..` pop one level off a working dir stack, otherwise descend. Same in `resolveVaultPath` (extract a shared helper or duplicate the 5-line loop — ponytail says duplicate is fine for 5 lines across two packages with different build constraints).

## Decision (ADR-lite)

**Context**: `detail` shows full path → filename appears twice per row (label + end of detail).
**Decision**: `detail` = parent directory only (option 1). Keeps directory context for disambiguating same-name files without filename duplication.
**Consequences**: Has-`/` branch shows the same directory on every row — acceptable, that's the resolved dir the user just typed into.

## Out of Scope

* Fuzzy ranking (still substring-only — existing `ponytail:` deferral).
* Absolute `~/`-style home expansion beyond current null-out.
* Refactoring the two resolvers into a shared package — they live in different packages with different build graphs; 5-line duplication is cheaper than a shared dep.

## Technical Notes

* `FilePreviewSrcExtension.ts:42-47` (no-`/` options), `:79-83` (has-`/` options), `:103-118` (`resolveDirPart`).
* `FilePreviewPlugin.tsx:24-44` (`resolveVaultPath`).
* CodeMirror autocomplete: row renders `label` + `detail` side-by-side — that's where the duplication comes from.
