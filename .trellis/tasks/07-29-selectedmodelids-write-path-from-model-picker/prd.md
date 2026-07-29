# selectedModelIds Write Path From Model Picker

## Goal

When the user selects a model in the "获取模型" picker, persist the selection to `~/.quill/providers/settings.json`'s `selectedModelIds` field. Currently the picker's `onSelect` only writes `chatModel` (the active model); `selectedModelIds` is never written, so it stays `[]` forever.

## What I already know

- `aiConfigStore.ts` has `providerSettings[id].selectedModelIds` in state but **no setter** for it.
- `ModelServicesSettings.tsx:1375` — picker `onSelect(m.id)` calls `setChatModel(id)` only; no call to write `selectedModelIds`.
- `providerConfigStorage.ts` — `setProviderSettings` writes the full slot (including `selectedModelIds`) to disk; the store just doesn't call it for this field.
- Refactor PRD defines `selectedModelIds` = "subset of models the user has enabled (merged from current manualModels + any selection state)".
- `manualModels` (user-authored entries with displayName/group) stays separate in `storage.json` — not affected by this bug.

## Assumptions (temporary)

- The picker is the only UX flow that should write `selectedModelIds` (vs. some future multi-select toggle).
- Selecting a model = also marking it as "enabled" (add to selectedModelIds if not present).

## Open Questions

- Resolved (Q1): adopt option (a) — append-on-select.

## Decision (ADR-lite)

**Context**: `selectedModelIds` is never written; picker `onSelect` only sets `chatModel`. Need a semantics for `selectedModelIds`.

**Decision**: Option (a) — append-on-select. When the user picks a model in the picker, append its id to `selectedModelIds[providerId]` (dedup; preserve order). `chatModel` stays the active model. No new UI; single-select picker unchanged.

**Consequences**:
- Pro: zero UI change, smallest diff, matches PRD "subset of models the user has enabled".
- Pro: forward-compatible — a future multi-select toggle can swap the setter for a toggle.
- Con: no deselect flow in this PR (acceptable — explicit Out of Scope).
- Con: append-on-select means the list grows unbounded over time; in practice the user only sees models they've used, so the noise is bounded.

## Requirements

### Write path (shipped)

- `addSelectedModelId(providerId, modelId)` setter — append (dedup, preserve order) + persist via `providerConfigStorage.setProviderSettings`.
- Picker `onSelect` calls it alongside `setChatModel`.

### Picker multi-select (new)

- Picker `onSelect` **does not** close the modal — user can pick multiple models in one session. Close via X / ESC / click-outside (all already exist).
- Picker accepts `selectedIds: string[]` (derived from `providerSettings[chatProvider].selectedModelIds`); **every** id in the list shows the minus icon, not just the active `chatModel`.
- Toggle semantics: clicking a model not in `selectedModelIds` appends it (dedup, preserve order); clicking a model already in `selectedModelIds` removes it.
- The active `chatModel` keeps its stronger text highlight so the user knows which one is live. Removing the active `chatModel` from `selectedModelIds` does **not** clear `chatModel` — the user is still on that model for chat, just no longer in the "enabled subset" list. Acceptable edge case; user can re-add or switch.

### Read path (new)

- Add a "selected models" list section to `ModelServicesSettings.tsx` (under the active provider's config area, near the manual-models group at ~line 670-750).
- The list reads `providerSettings[chatProvider].selectedModelIds` (already in store state).
- For each id, display model details (display name, group, capabilities) fetched from `~/.quill/providers/{chatProvider}/models.json` via `readUserProviderModels(chatProvider)`.
- Display **all** ids in `selectedModelIds` — not just `chatModel`. The active `chatModel` gets the existing emerald checkmark highlight.
- Empty list → show a small empty-state hint (existing `t('settings:models.fetchModels.empty')` pattern).
- Missing `models.json` or missing id in the file → fall back to id-only row (no crash).

## Acceptance Criteria

- [ ] After picking a model in the picker, `~/.quill/providers/settings.json` has that id in `selectedModelIds[<providerId>]`.
- [ ] Picking the same model twice does not duplicate the id in the list.
- [ ] Picker does NOT auto-close on select — user can pick multiple models; close via X / ESC / click-outside.
- [ ] Picker shows the minus icon on every id in `selectedModelIds[chatProvider]`, not just the active `chatModel`.
- [ ] Clicking the minus icon removes the id from `selectedModelIds[chatProvider]` (disk-persisted); clicking the plus icon appends.
- [ ] Unit test for `removeSelectedModelId` covers: remove middle (order preserved), remove absent id (no-op), cross-provider isolation, disk write.
- [ ] Switching providers, picking a model in the new provider, then switching back: the first provider's `selectedModelIds` still contains the picked id (persisted).
- [ ] Unit test for `addSelectedModelId` covers: append, dedup, cross-provider isolation, disk write via `providerConfigStorage`.
- [ ] Model services page shows ALL ids in `selectedModelIds[chatProvider]`, not just `chatModel`.
- [ ] Each row displays model details from `~/.quill/providers/{chatProvider}/models.json` when present; falls back to id-only when the file or id is missing.
- [ ] Active `chatModel` row is highlighted (emerald checkmark) the same way as the existing manual-models list.

## Definition of Done

- Unit test added to `aiConfigStore.test.ts`.
- Lint / typecheck / CI green.

## Out of Scope

- Migrating `manualModels` into `selectedModelIds` (already decided against in refactor PRD).
- Reconciling `~/.quill/providers/{p}/models.json` capability taxonomy with the bundled catalog (separate task per `userProvidersCatalog.ts:13-16`).

## Technical Notes

Files inspected:
- `apps/desktop/src/store/aiConfigStore.ts` — setters pattern (lines 254-307), no `selectedModelIds` setter.
- `apps/desktop/src/components/settings/ModelServicesSettings.tsx:821-825` — picker `onSelect` handler.
- `apps/desktop/src/services/providers/providerConfigStorage.ts:240-244` — `setProviderSettings` writes slot to disk.
- `apps/desktop/src/store/aiConfigStore.test.ts` — existing setter tests use the pattern `patchSettings` + `void providerConfigStorage.setProviderSettings(pid, next[pid]!)`.

## Post-shipping fixes (2026-07-29)

### Bug: migration re-runs every boot and clobbers `~/.quill/providers/settings.json`

Root cause: `PROVIDER_CONFIG_MIGRATED_KEY` was not in `PERSIST_KEYS_AI_CONFIG`, so `collectPersistedBlob()` stripped the flag on every `schedulePersist` write. Next boot: flag missing → migration re-ran with empty legacy blob → wrote a default-only `anthropic` slot over real on-disk data → user's apiKey/selectedModelIds lost.

Fix: (1) added `PROVIDER_CONFIG_MIGRATED_KEY` to `PERSIST_KEYS_AI_CONFIG`; (2) defensive `hasDiskData` check in `loadFromDisk` migration branch — if disk already has real data, skip `__replaceForMigration` (keep existing data), still set the flag.

Note: already-lost data is not recoverable; fix prevents recurrence.

### Display: selected-models list only reads from `settings.json`

Removed the `readUserProviderModels(chatProvider)` fetch + `providerModelsFile` state + `details?.name ?? mid` lookup. Row now displays `{mid}` directly (avatar works from id alone). Trade-off: no display name/group/capabilities per row — re-introduce a `readUserProviderModels` lookup when richer metadata is needed.
