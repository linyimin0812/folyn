# Config storage: split per-slice files

## Goal

Stop writing all persisted settings as one flat blob inside a single
`storage.json`. Write one file per registered slice under `~/.folyn/storage/`.
Existing `storage.json` (in appDataDir) is abandoned in place — no migration,
user accepts pref reset on first load with new code.

## What I already know

- `apps/desktop/src/utils/storageClient.ts` — generic key→JSON-string map,
  single cache object, single `storage.json` in appDataDir, 300ms debounced
  flush writes the whole cache.
- `apps/desktop/src/store/settingsPersistence.ts` — `registerPersistSlice`
  (no name today), `collectPersistedBlob` merges all slices' keys into one
  flat blob, `debouncedPersist` calls `storageClient.set('settings:all', blob)`
  + emits `pet://settings-updated` with the whole blob. `loadSettings` reads
  the single blob, dispatches to each slice's `hydrate`, then re-emits.
- 10 slices registered: prefs, editorPrefs, appearance, vaultConfig, sync,
  pet, schedule, voice, modelRegistry, aiConfig.
- Provider configs already live as per-file storage at `~/.folyn/providers/*.json`
  via `aiConfigStore.loadFromDisk()` — precedent for user-level per-file storage.
- Secondary Tauri windows (pet-bubble / pet-corner / pet-panel) listen on
  `pet://settings-updated` and hydrate from the payload — they lack fs-plugin
  ACL to read storage files themselves. Whole-blob emit MUST stay.

## Requirements

- `storageClient` writes each key to its own file at
  `~/.folyn/storage/<key>.json`. No more shared `storage.json`.
- Per-key in-memory cache; per-flush dirty set; same 300ms debounce; same
  single-writer contract.
- `registerPersistSlice` gains a `name: string` field (slice identifier used
  as the on-disk filename stem).
- `debouncedPersist` writes each slice to its own file via
  `storageClient.set(slice.name, sliceData)`, then assembles the whole blob
  and emits `pet://settings-updated` (payload shape unchanged — secondary
  windows still hydrate from one blob).
- `loadSettings` reads each slice's file and hydrates that slice only;
  assembles the blob for the `pet://settings-updated` emit.
- Every registered store passes its `name` at `registerPersistSlice` call.
- `storageClient.__resetForTesting` still resets cache + dirty set.

## Acceptance Criteria

- [ ] New directory `~/.folyn/storage/` created on first write.
- [ ] Each slice writes a separate file (`prefs.json`, `editorPrefs.json`,
      `appearance.json`, `vault.json`, `sync.json`, `pet.json`,
      `schedule.json`, `voice.json`, `modelRegistry.json`, `aiConfig.json`).
- [ ] Old `appDataDir/storage.json` is NOT read and NOT written by new code.
- [ ] `pet://settings-updated` payload is still the whole merged blob
      (secondary windows' hydrate path unchanged).
- [ ] `pnpm typecheck` green; `pnpm lint` green.
- [ ] Existing settings-persistence tests still pass (or are updated to
      assert per-file behavior).

## Out of Scope

- Migration of legacy `storage.json` → new per-slice files (explicitly
  declined by user; first launch with new code resets prefs).
- Splitting `aiConfigStore.loadFromDisk()` provider-file storage — already
  per-file, untouched.
- Changing the `pet://settings-updated` wire format.
- Adding new slices / refactoring slice contents.

## Technical Approach

```
storageClient.set(key, data):
  cache[key] = data
  dirty.add(key)
  scheduleFlush()  // 300ms

flushImpl():
  for key in dirty:
    writeTextFile(`~/.folyn/storage/${key}.json`, JSON.stringify(cache[key]))
  dirty.clear()

debouncedPersist():
  blob = collectPersistedBlob()  // for emit only
  for slice in SLICES:
    sliceData = pick slice.keys from slice.getState()
    storageClient.set(slice.name, sliceData)
  emit('pet://settings-updated', blob)

loadSettings():
  blob = {}
  for slice in SLICES:
    data = await storageClient.get(slice.name)
    if (data) { slice.hydrate?.(data); Object.assign(blob, data) }
  await aiConfigStore.loadFromDisk()  // unchanged
  emit('pet://settings-updated', blob)
```

## Decision (ADR-lite)

**Context**: Single-file `storage.json` mixes 10 unrelated stores; any
corruption or partial-write risks all prefs; human inspection is opaque.

**Decision**: Per-slice files at `~/.folyn/storage/<name>.json`, no migration,
no shared `storage.json`. Whole-blob `pet://settings-updated` emit preserved.

**Consequences**: First launch after upgrade resets all prefs (accepted).
Per-slice files isolate corruption. Slightly more I/O (N small writes vs 1
big write) — negligible at 300ms debounce cadence.

## Definition of Done

- typecheck / lint green
- existing tests green (or updated)
- manual smoke: change a pref, restart app, pref persists
- old `storage.json` no longer touched

## Technical Notes

- Path: use `@tauri-apps/api/path` `homeDir()` + `'.folyn/storage'` (matches
  providers' `~/.folyn/providers/` convention). Verify the exact call used by
  `aiConfigStore.loadFromDisk()` and reuse the same path helper.
- `persistSlice.name` must be a valid filename stem (no slashes, no `.json`
  suffix — storageClient adds it).
- Keep `collectPersistedBlob` for emit; don't rip it out.
- Don't touch `aiConfigStore.loadFromDisk()` provider-file path.
