# Pet panel saved size should not override default bump

## Goal

When the pet-panel default size changes (e.g., 380×520 → 440×620), users who
opened the panel before the change have the **old default** saved in
`settingsStore.petPanelWidth/Height`. The open gesture restores the saved
size, so the new default never applies — the user has to manually reload /
clear the saved value to see the new size. This is a UX bug: default-size
bumps should auto-apply on next open.

## What I already know

- `petPanelWidth/Height` in `settingsStore.ts:274-275` default to `-1` (unset).
- First-ever open: `-1` → `PetApp.tsx` open gesture uses `PET_PANEL_WIDTH/HEIGHT`
  (default 440×620). The 800ms persist poll in `PetPanelApp.tsx:218-261`
  then saves the actual size → `petPanelWidth/Height` becomes 440×620.
- Subsequent opens: saved size restored via `clampPanelSize` + `pet_panel_set_size`
  (`PetApp.tsx:119-126`, `PetPanelApp.tsx:148-166`).
- Problem: a user who opened the panel when the default was 380×520 has
  380×520 saved. After the default bumps to 440×620, the saved value still
  takes precedence → panel stays 380×520 until the saved value is cleared.
- Persist poll: `PetPanelApp.tsx:218-261`, fires every 800ms, saves whenever
  the size changes.

## Approach (version-gate)

Add a `petPanelSizeVersion` field to settingsStore + a `PET_PANEL_SIZE_VERSION`
constant in `petPosition.ts`. On open (both `PetApp.tsx` open gesture and
`PetPanelApp.tsx` mount restore), if the saved version doesn't match the
current constant, ignore the saved size and use the new default. After
applying the new default, persist the new version + size so subsequent opens
are stable.

This is the standard "config-version migration" pattern: bump the version
whenever the default changes, and the saved value is auto-invalidated.

## Requirements

- New constant `PET_PANEL_SIZE_VERSION = 1` in `petPosition.ts` (next to
  `PET_PANEL_WIDTH/HEIGHT`). Bump this whenever the default size changes.
- New field `petPanelSizeVersion: number` in `settingsStore` (default `0`,
  meaning "unset / pre-versioning").
- `PetApp.tsx` open gesture: if `petPanelSizeVersion !== PET_PANEL_SIZE_VERSION`,
  ignore saved `petPanelWidth/Height` and use `PET_PANEL_WIDTH/HEIGHT`. After
  `pet_panel_set_size`, persist the new size + version via `setPetPanelSize`
  and a new `setPetPanelSizeVersion` setter.
- `PetPanelApp.tsx` mount restore: same version-gate check before restoring
  the saved size.
- Persist poll: when saving the size, also save the current version (so the
  version stays in sync with the saved size).
- Existing saved positions (`petPanelX/Y`) are NOT affected — only size is
  version-gated. Position is recomputed every open via `computePanelPosition`,
  so it's not stale.

## Acceptance Criteria

- [ ] `PET_PANEL_SIZE_VERSION` constant exists in `petPosition.ts`.
- [ ] `petPanelSizeVersion` field + setter in `settingsStore`.
- [ ] Open gesture ignores saved size when version mismatches, uses new default.
- [ ] After applying new default, version + size are persisted.
- [ ] Mount restore (`PetPanelApp.tsx`) also version-gates.
- [ ] Unit test: version mismatch → new default applied; version match →
  saved size restored.
- [ ] Manual: user with old default saved sees new default on next open
  after rebuild (no reload needed).

## Out of Scope

- Position versioning — position is recomputed every open, not stale.
- Migration of other saved fields (pet position, pet-panel position).
- Multi-monitor size handling.

## Technical Notes

- `apps/desktop/src/store/settingsStore.ts:104-105, 274-275, 378-379` —
  `petPanelWidth/Height` + `setPetPanelSize`.
- `apps/desktop/src/components/pet/PetApp.tsx:119-126` — open gesture saved-size
  restore.
- `apps/desktop/src/components/pet/PetPanelApp.tsx:148-166` — mount restore.
- `apps/desktop/src/components/pet/PetPanelApp.tsx:218-261` — persist poll.
- `apps/desktop/src/components/pet/petPosition.ts:133-134` — `PET_PANEL_WIDTH/HEIGHT`.

## Decision (ADR-lite)

**Context**: Default size bumps don't reach users who have an old default
saved. Need a way to invalidate the saved size when the default changes.

**Decision**: Version-gate via `PET_PANEL_SIZE_VERSION` constant +
`petPanelSizeVersion` persisted field. Saved size is ignored when the version
mismatches; the new default is applied and the version is bumped in storage.

**Consequences**:
- Must remember to bump `PET_PANEL_SIZE_VERSION` when changing the default
  size. Forgetting means users keep the old default (same as today's bug).
- The persist poll saves the version alongside the size, so they stay in sync.
- Existing users with `petPanelSizeVersion=0` (or missing) get the migration
  on next open — one-time flip to the new default.
