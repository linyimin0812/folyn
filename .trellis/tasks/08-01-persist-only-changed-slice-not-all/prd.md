# persist only changed slice not all

## Goal

`schedulePersist()` (settingsPersistence.ts:76) writes every registered slice's file on every setter call — changing `theme` re-writes prefs/editorPrefs/pet/vault/schedule/modelRegistry/aiConfig/voice too. Make each slice persist only its own file when its own setter fires. Quit-flush (`persistNow`) still writes all slices.

## What I already know

- 9 persisted slices: prefs, editorPrefs, pet, appearance, voice, vault, schedule, modelRegistry, aiConfig (settingsPersistence.ts:32-35).
- `schedulePersist()` loops all SLICES, calls `storageClient.set(slice.name, ...)` per slice (settingsPersistence.ts:76-80).
- `storageClient` owns 300ms trailing-edge debounce — so currently 9 separate debounced writes fire per setter, not 1.
- `persistNow()` (settingsPersistence.ts:87) is the quit-flush path; must keep writing all slices.
- `hydrate` is only called from `loadSettings` startup loop, not from setters.
- Call sites of `schedulePersist()`: ~all 9 store files (prefs, editorPrefs, pet, appearance, voice, vault, schedule, modelRegistry, aiConfig).

## Assumptions (temporary)

- `registerPersistSlice` can return a closure bound to its slice; stores capture it and call it in setters.
- `persistNow` keeps iterating all SLICES (no per-slice dirty tracking needed for quit path).
- No external caller imports `schedulePersist` outside `apps/desktop/src/store/`. (To verify in research phase.)

## Open Questions

- (resolved) Approach: bound closure from `registerPersistSlice`. See Decision.

## Requirements (evolving)

- A setter in slice X writes only slice X's storage file.
- `persistNow()` (quit flush) still writes every registered slice.
- No regression in `settingsPersistence.test.ts`.
- Migration: mechanical rename in 9 store files; no behavior change to hydration or broadcast.

## Acceptance Criteria (evolving)

- [ ] Changing one appearance field (e.g. `setTheme`) writes exactly one storage file (`appearance`), not 9.
- [ ] `persistNow()` still writes all 9 slice files on quit.
- [ ] `settingsPersistence.test.ts` passes unchanged or with mechanical updates.
- [ ] No new exports leak from settingsPersistence beyond what stores need.

## Definition of Done

- Tests added/updated (a test asserting only the changed slice's file is written).
- Lint / typecheck / CI green.
- `ponytail:` comment in settingsPersistence naming the design (bound closure, no global dispatch).

## Technical Approach

`registerPersistSlice` returns a `() => void` bound to its slice (calls `storageClient.set(slice.name, ...)`). Each store captures the returned `persist` fn at registration, replaces `schedulePersist()` calls in its setters with `persist()`. `schedulePersist` global export removed; `persistNow` and `loadSettings` keep iterating all SLICES (no per-slice dirty tracking). `collectPersistedBlob` unchanged — quit broadcast still merges all slices for secondary windows.

## Decision (ADR-lite)

**Context**: `schedulePersist()` writes every registered slice's file on every setter — change `theme`, write 9 files. Wasteful, and surfaces a wrong mental model ("the persist path is per-app, not per-slice").

**Decision**: `registerPersistSlice` returns a bound closure; stores call their own `persist()` in setters. Global `schedulePersist` removed. `persistNow` (quit flush) still writes all slices — it's the safety net, not the hot path.

**Consequences**: + Per-setter writes only the changed slice's file. + Clean contract: a slice is self-contained (register, persist, hydrate). + No global dispatch / no name string to mistype. − Touches 9 store files mechanically (acceptable: mechanical rename, no logic change). − `persistNow` still writes all slices on quit — kept on purpose (safety flush), documented with a `ponytail:` comment.

## Out of Scope (explicit)

- Per-key dirty tracking beyond what bound-closure gives (YAGNI — debounce already coalesces bursts within a slice).
- Re-architecting the slice registration model.
- Changing `storageClient` debounce behavior.

## Technical Notes

- `settingsPersistence.ts:76-99` — `schedulePersist` + `persistNow`.
- `settingsPersistence.ts:41-43` — `registerPersistSlice`.
- Slice files: `apps/desktop/src/store/{prefs,editorPrefs,pet,appearance,voice,vault,schedule,modelRegistry,aiConfig}Store.ts`.
- Test: `apps/desktop/src/store/settingsPersistence.test.ts`.
- Spec: `.trellis/spec/desktop/frontend/state-management.md`.
