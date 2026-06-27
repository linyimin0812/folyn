# Rename special dirs with __ prefix/suffix and hide from file panel

## Goal

Wrap the four "special" directory names (clips / daily / reports / wiki) with `__` prefix and suffix (e.g. `__daily__`) so they are visually identifiable as built-in/managed dirs, and ensure they stay hidden from the left file panel. The four panels (Clips, Calendar/Daily, Analysis, Wiki) keep working against the new names. Existing user vaults are auto-migrated on startup.

## Requirements

* New built-in dir names: `__clips__`, `__daily__`, `__reports__`, `__wiki__`.
* `WIKI_DIR` constant renamed `'quill-wiki'` → `'__wiki__'`. `WIKI_PREFIX = 'wiki://'` is unchanged (virtual URL scheme, not on-disk).
* `dailyNotesDir` default becomes `'__daily__'`; the setting stays user-configurable in SettingsPage.
* All path-prefix checks and dir constructions updated to new names (editorStore, clipStore, clipService, githubAnalysisService).
* Default `excludePatterns` lists `__wiki__`, `__clips__`, `__reports__`, `__daily__` (replaces old `quill-wiki`, `clips`, `reports`).
* Backfill in `settingsStore` start-up loader:
  * Appends the four new patterns to persisted `excludePatterns` if missing.
  * Rewrites persisted `dailyNotesDir` from `'daily'` → `'__daily__'` (only if it equals the old default `'daily'`).
* Disk migration on vault activation (in `vaultStore`):
  * Pairs: `quill-wiki → __wiki__`, `clips → __clips__`, `reports → __reports__`, `daily → __daily__`.
  * Daily pair only migrates if persisted `dailyNotesDir === 'daily'`.
  * If old exists and new does not → `fs.rename(old, new)`.
  * If both exist → skip + log warning (do not clobber).
  * If old missing → no-op.
* Open tab path rewrite (after successful disk migration, in `editorStore`):
  * For each open tab whose `path` starts with `old/`, rewrite to `new/`.
  * `wiki://`-prefixed tabs are untouched (virtual path unchanged).
* Tests updated to new paths.

## Acceptance Criteria

* [ ] `grep -rn "quill-wiki\|'clips/'\|'reports/'\|'daily'" apps/desktop/src` returns no production-code references to old names (test fixtures updated to new names).
* [ ] Default `excludePatterns` contains `__wiki__`, `__clips__`, `__reports__`, `__daily__`.
* [ ] Backfill appends new patterns to an existing persisted `excludePatterns` that lacks them.
* [ ] Backfill rewrites persisted `dailyNotesDir: 'daily'` → `'__daily__'`.
* [ ] On vault activation with old dirs on disk, migration renames them; with both old+new present, migration skips and logs.
* [ ] Open tabs with old `clips/…` / `reports/…` / `quill-wiki/…` paths have their paths rewritten to new prefixes after migration.
* [ ] Wiki / Clips / Analysis / Calendar panels still locate and read their files correctly after migration.
* [ ] `npx tsc --noEmit` and `npx vitest run` pass in `apps/desktop`.

## Definition of Done

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered: migration is idempotent and skip-on-conflict, so a failed run can be re-run safely.

## Technical Approach

### 1. Constants & path strings
* `apps/desktop/src/types/wiki.ts:79` — `WIKI_DIR = '__wiki__'`.
* `apps/desktop/src/store/settingsStore.ts:168` — `dailyNotesDir: '__daily__'`.
* `apps/desktop/src/store/editorStore.ts:29, 59, 61` — prefix checks use `'__clips__/'` and `'__reports__/'`.
* `apps/desktop/src/store/clipStore.ts:331, 338` — `\`__clips__/${tag}\``.
* `apps/desktop/src/services/clipService.ts:158` — `\`__clips__/${primaryTag}\``.
* `apps/desktop/src/services/githubAnalysisService.ts:168` — `\`__reports__/${fileName}\``.

### 2. Default excludePatterns + backfill
* `apps/desktop/src/store/settingsStore.ts:132` — replace `quill-wiki\nclips\nreports` with `__wiki__\n__clips__\n__reports__\n__daily__`.
* `apps/desktop/src/store/settingsStore.ts:245-249` — backfill:
  * If `saved.excludePatterns` lacks `__wiki__` → append the four new patterns.
  * If `saved.dailyNotesDir === 'daily'` → set to `'__daily__'`.
  * Keep idempotent: re-running the loader doesn't append duplicates.

### 3. Disk migration (vaultStore)
* Add a `migrateSpecialDirs()` action invoked from `switchVault` and from app startup (when a vault is already active).
* Use `vault.basePath` + Tauri `rename` API. Pairs as above. For each pair:
  * `exists(old)` && `!exists(new)` → `rename(old, new)`.
  * `exists(old)` && `exists(new)` → `console.warn` and skip.
* Run before `refreshFileTree()` so the tree reflects the migrated state.

### 4. Open tab path rewrite (editorStore)
* Expose an action `rewriteTabPrefixes(mapping: {old: string, new: string}[])`.
* After `migrateSpecialDirs()` succeeds, call it with the four pairs.
* For each tab in `tabs`, if `path.startsWith(old + '/')`, replace prefix.
* Also update `activeTabId` if it matches a rewritten tab.

### 5. Tests
* `store/editorStore.test.ts` — update path fixtures (`clips/foo.md` → `__clips__/foo.md`, etc.).
* `services/wikiQueryService.test.ts` — `${VAULT_BASE}/quill-wiki` → `${VAULT_BASE}/__wiki__`.
* Add a unit test for `migrateSpecialDirs` (mock Tauri fs) and for `rewriteTabPrefixes`.

## Decision (ADR-lite)

**Context**: Built-in managed dirs (`quill-wiki`, `clips`, `reports`, `daily`) need to be visually distinguishable from user content and hidden from the file panel. Existing user vaults already have the old names on disk.

**Decision**:
* Rename to `__name__` form (English short names) for cross-platform safety.
* Auto-migrate on disk at vault activation; skip on conflict; rewrite open tab paths.
* Keep `dailyNotesDir` user-configurable; only migrate disk + setting if user is on the old default.

**Consequences**:
* Pros: zero-touch upgrade for existing users; panels keep working; file panel stays clean.
* Cons: more moving parts (migration + tab rewrite). Risk: rename failure mid-way leaves mixed state — mitigated by skip-on-conflict and idempotency.
* Future: if more special dirs are added later, follow the same `__name__` convention.

## Out of Scope

* Migrating user-customized `dailyNotesDir` values (e.g. `'journal'`) — only the old default `'daily'` is migrated.
* Auto-hiding user-customized `dailyNotesDir` from the file panel — only the default `__daily__` is in `excludePatterns`.
* Renaming the `wiki://` virtual URL scheme.
* Migrating references inside note content (e.g. `[[clips/foo]]` wikilinks) — note content is left untouched; users can update manually if needed.

## Technical Notes

* `wiki://` is a virtual URL prefix, not an on-disk path — leave it.
* `matchesAnyPattern` matches by entry name at every tree level, so `__clips__` etc. will be hidden recursively.
* Migration must run before `refreshFileTree` so the tree reflects the post-migration state.
* Tauri `fs.rename` is atomic on same-volume renames; vault subdirs are on the same volume as the vault root, so this is safe.

## Implementation Plan (small PRs)

* PR1: Rename constants + path strings + default `excludePatterns` + backfill + test fixture updates.
* PR2: Disk migration in `vaultStore` + tab path rewrite in `editorStore` + unit tests for both.
* PR3: Verify type-check + full test suite green; update `.trellis` spec if a new convention emerged.
