# Wiki ingest write-and-lint is code-driven; agent only does semantic generation

The wiki feature agent (`__wiki__/.claude/agents/wiki.md`) is reduced from four actions (ingest / generate / lint / query) to **semantic-only** actions: `ingest` (extract entities/concepts as JSON), `overview` (rewrite the overview summary), and `lint_semantic` (the S1 "two entity pages describe the same concept, suggest merge" check). All deterministic writes and checks move into desktop code:

- **`generate` is deleted.** Writing `entities/` `concepts/` `sources/` pages, appending to `index.md` / `log.md`, and the frontmatter merge rules (C2.b union + body `## Update` section + contradiction→ReviewItem) live in a code-side `wikiPageWriter`. The agent no longer touches the file system except for `overview.md`.
- **`lint` (structural) is deleted.** Missing pages, orphans, stale hash, schema drift, kebab collision, confidence rule violations, asymmetric `related`, invalid `sources:` paths, `index.md`/`log.md` missing entries — all 13 structural checks run as code in `wikiLintService`, no agent call. The agent keeps only `lint_semantic` (S1) for cross-page duplicate detection that needs LLM judgment.

## Considered Options

- **(a) Agent-driven (status quo)** — agent writes pages and runs all lint checks; code parses its JSON output. Rejected: frontmatter/kebab/sources-path drift across agent runs; merge semantics left to LLM judgment; lint cost = full LLM call per scan with regex-tolerant output parsing. The grilling surfaced that every "agent freedom" in `generate`/`lint` was producing a C/B/D failure mode.
- **(b) Fully code-driven** — code does everything, including `overview.md` summaries and S1 duplicate detection. Rejected: `overview.md` is "AI-maintained 简短摘要" — templates can't synthesize across pages meaningfully. S1 requires reading two pages and judging semantic overlap, which is genuinely a semantic task. Two narrow agent roles survive.
- **(c) Hybrid — code writes and validates; agent only generates semantics** (accepted) — code is the source of truth for schema, merge, kebab, sources, hash, and structural lint. Agent does three things only: extract entities/concepts from a source (ingest), summarize across pages (overview), judge cross-page semantic duplication (S1). Agent's write radius is restricted to `overview.md` plus the merge body rewrite under D5; everything else is code.

## Consequences

- **Schema and merge rules are deterministic.** `WikiFrontmatter` (TS) is the source of truth; `schema.md` is user-maintained vault-side documentation; lint flags drift between them (B2 check #7). Merge = union `sources/tags/related`, min `confidence`, bump `updated`, body appends `## Update <date> (from <source>)`.
- **`wiki.md` (canonical agent prompt) is rewritten.** `generate` action deleted; new `overview` action added (input: current overview + index + purpose + this batch's changes; output: only overview.md). `lint` action deleted; agent-side `lint_semantic` action added. `ingest` and `query` unchanged.
- **Confidence is rule-based, not LLM-judged.** Multi-source = high, single = medium, contradiction flagged = low; merge takes the min; forced low on contradiction. Documented in C5.a.
- **Lint performance: full-scan, no cache (B5.a).** Acceptable for single-vault few-hundred-page scale; cache to be added only when measurably slow.
- **Write atomicity (B5.y).** Review accept/merge/reject actions batch into `<vault>/__wiki__/.staging/` then atomic rename on the same volume. Tauri fs rename is atomic intra-volume; cross-volume renames are NOT — `.staging/` must live inside `__wiki__/`.
- **Agent failure radius.** Agent can only corrupt `overview.md` (one file) on bad output; structural pages are safe. `overview.md` is also regenerable — the next batch ingest rewrites it.
- **Downstream effects.** D (review closed loop) gets deterministic ReviewItem `checkId`s (e.g. `missing_page`, `kebab_collision`, `schema_drift`, `confidence_violation`) instead of agent-emitted prose titles, so handler dispatch is a `Map<checkId, ActionHandler>`. A (query recall) gets clean pages to BM25-search and graph-expand without lint noise.

## Status

Accepted following the wiki grilling session (C→B→D→A→E). Closes C1.c + B1.c. Implementation tracked as a Trellis task.
