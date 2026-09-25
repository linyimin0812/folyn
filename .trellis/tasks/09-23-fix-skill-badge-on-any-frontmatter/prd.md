# Fix: any note with frontmatter gets the "SKILL" badge

## Goal

Render the frontmatter meta card for ALL notes with frontmatter, but reserve the "SKILL" badge for notes that are actually skills (frontmatter with `name` + `description`, the skill-file convention). Ordinary notes with frontmatter (`title`, `date`, `tags`, …) must show the meta card without a "SKILL" badge.

## What I already know

* `apps/desktop/src/components/file-types/markdown/MarkdownPreview.tsx:1579` renders `<SkillMetaCard meta={meta} />` for ANY parsed frontmatter (`{meta && ...}`).
* `parseFrontmatter` (same file, line 188) strips the frontmatter block from the rendered body and returns the key/value map.
* `SkillMetaCard` (line 222) hardcodes the "SKILL" badge and displays `name`, `description`, and every other key.
* There is no filename-based skill detection in the codebase (no `SKILL.md` references anywhere).
* The skill-file convention (Claude-style) requires `name` and `description` in frontmatter.

## Open Questions

(none)

## Requirements

* Any note with frontmatter → meta card rendered (key/value rows for all keys).
* A note whose frontmatter contains both `name` and `description` → meta card WITH the "SKILL" badge.
* A note with any other frontmatter (e.g. only `title`/`date`) → meta card WITHOUT the badge. Body renders as today (frontmatter stays stripped, unchanged behavior).

## Acceptance Criteria

* [ ] Note with `title: foo` frontmatter shows the meta card but no "SKILL" badge.
* [ ] Note with `name` + `description` frontmatter shows the card with the "SKILL" badge.
* [ ] No other preview behavior changes.

## Definition of Done

* Unit test for the gating predicate.
* Typecheck/lint green.

## Technical Approach

Badge-level gate inside `SkillMetaCard`: `isSkillMeta(meta) = Boolean(meta.name && meta.description)` — render the card for any parsed frontmatter, but the "SKILL" badge span only when true.

## Out of Scope

* Any filename-based skill detection.
