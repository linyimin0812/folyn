# Research: manualModels Shape

- **Query**: What is the current shape of `manualModels` in `aiConfigStore.ts`? Does it carry a provider id, or is it a flat list? How would we group into per-provider `selectedModelIds` during migration?
- **Scope**: internal
- **Date**: 2026-07-29

## Findings

### Shape

`apps/desktop/src/store/aiConfigStore.ts:111`:

```ts
manualModels: Record<string, ManualModel[]>;
```

It is **already keyed by provider id** — NOT a flat list. The key is the provider id (catalog id or custom-`<uuid>` id).

`ManualModel` interface (aiConfigStore.ts:46-51):

```ts
export interface ManualModel {
  id: string;          // becomes chatModel value
  displayName: string;
  group: string;
  createdAt: number;
}
```

Persisted under the `manualModels` key in `PERSIST_KEYS_AI_CONFIG` (aiConfigStore.ts:87).

### Setters

- `addManualModel(providerId, model)` — aiConfigStore.ts:435-446. Pushes onto `manualModels[providerId]`, dedup by `model.id` within the same provider.
- `removeManualModel(providerId, modelId)` — aiConfigStore.ts:448-458. Filters the list.

### Hydration guard

`isManualModelsMap` (aiConfigStore.ts:227-233) — validates the persisted blob is `Record<string, ManualModel[]>`. On bad shape, defaults to `{}`.

### Migration to per-provider `selectedModelIds`

Trivial. The new schema wants `settings.json[{id}].selectedModelIds: string[]` — the subset of model ids the user has enabled per provider.

```ts
// legacy: manualModels: Record<providerId, ManualModel[]>
// target: settings[id].selectedModelIds: string[]

for (const [providerId, list] of Object.entries(legacy.manualModels)) {
  settings[providerId] = {
    ...settings[providerId],
    id: providerId,
    selectedModelIds: list.map(m => m.id),
  };
}
```

### Ambiguity re: "selected" vs "manually-added"

The PRD says `selectedModelIds` = "subset of models the user has enabled (merged from current `manualModels` + any selection state)". But `manualModels` is **manually-authored model entries** (custom ids not present in the fetched list), NOT a selection from the fetched list. They're additive catalog entries, not a selection flag.

Looking at how `manualModels` is consumed (`ModelServicesSettings.tsx:196-209`): the per-provider list is merged INTO the fetched model list before display — `manualForCurrent` is unioned with `fetchedModels`. It is NOT a "selected/enabled" flag.

So treating `manualModels` as `selectedModelIds` directly may be semantically wrong — manual model additions are catalog entries, not enable selections. The migration needs to decide:

- Option A (literal id carry): `selectedModelIds` = `manualModels[providerId].map(m => m.id)`. Simple, but conflates "added" with "selected".
- Option B (only `chatModel`): `selectedModelIds[chatProvider] = [chatModel]` (the only "selected" state that exists today is the active `chatModel` for the current `chatProvider`).
- Option C (hybrid): `selectedModelIds[providerId] = [...manualModels[providerId].map(m=>m.id), ...(providerId === chatProvider ? [chatModel] : [])]`.

The PRD's "merged from current `manualModels` + any selection state" phrasing suggests Option C. But there's no per-model "selected" flag anywhere in the store today — `chatModel` is the only single-selection state.

The `manualModels` entries themselves probably need to ALSO live somewhere in the new schema (they're catalog data, not connection settings). The PRD's `~/.quill/providers/{id}/models.json` is the runtime-writable mirror — but that file is for the `refetchAllFromModelsDev` flow (a models.dev cache), not for user-authored entries. **The new schema doesn't obviously have a home for user-authored manual model entries.** Flagging as a gap.

## Files Found

| File Path | Description |
|---|---|
| `apps/desktop/src/store/aiConfigStore.ts:46-51, 111, 435-458` | `ManualModel` type, store field, setters |
| `apps/desktop/src/components/settings/ModelServicesSettings.tsx:196-209, 835-836` | Consumer merges `manualModels[chatProvider]` into the picker; `addManualModel` invoked from a separate "add manual model" modal |

## Caveats / Not Found

- `chatModel` (single active model id, persisted under `chatModel` key) is NOT part of `manualModels`. The current "selection" is the single active `chatModel`/`chatProvider` pair, not a per-provider multi-select. The new `selectedModelIds: string[]` is a richer concept that doesn't have a 1:1 predecessor.
- The new schema's home for user-authored manual model entries (vs fetched catalog entries) is unclear — PRD doesn't explicitly say where they land post-migration. Confirm with PRD author before migration.
