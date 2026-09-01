# Enrich GitHub Release Notes

## Goal
On tag push, auto-generate release notes with two sections — **New Features** (feat:) and **Fixed** (fix:) — from commits between the previous tag and the pushed tag, deduped/merged by description, and display them on the GitHub release page.

## Requirements
1. Trigger: push of a tag matching `v*`. Keep `workflow_dispatch` as manual override.
2. Read commits in range `(previous tag)..(pushed tag)`; if no previous tag, use all history up to the pushed tag.
3. Categorize by conventional-commit prefix: `feat:` → New Features, `fix:` → Fixed. Non-conventional commits are skipped (add a prefix to include).
4. Dedup / merge similar commits: match by normalized description (text after the optional `type(scope)!:` prefix), case-insensitive; keep first occurrence.
5. Output markdown with `## New Features` and `## Fixed` as h2 headers, unordered bullet lists.
6. Create the GitHub release with the generated notes as the body (idempotent: create-or-edit).
7. Build job (existing Tauri matrix) depends on the release job and uploads artifacts to the pre-created release.

## Out of scope
- Auto-categorization of non-conventional commits.
- Fuzzy matching beyond exact normalized description.
- Multi-language / i18n of section headers.
