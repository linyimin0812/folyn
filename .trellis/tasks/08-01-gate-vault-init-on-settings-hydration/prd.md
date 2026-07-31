# Gate vault init on settings hydration

## Goal

Fix the race where `App.tsx` `initializeVault` calls `initVault()` →
`switchVault()` → `refreshFileTree()` BEFORE `loadSettings()` has
hydrated `appearanceStore.excludePatterns`. The file tree is built
against default `excludePatterns`, so user-hidden folders (e.g.
`.voice_input`) reappear on restart even though they ARE persisted in
`~/.quill/storage/appearance.json`.

## What I already know

- `~/.quill/storage/appearance.json` contains `excludePatterns` with the
  user's `.voice_input` appended — persistence works.
- `vaultStore.refreshFileTree` (line 354) reads
  `useAppearanceStore.getState().excludePatterns` to filter the tree.
- `App.tsx:163` `initializeVault` calls `initVault()` without awaiting
  `settingsLoadDone`. `settingsPersistence.ts:146` exports
  `settingsLoadDone` as the single hydration-await point.
- `usePetHostBridge.ts:47` already `await settingsLoadDone` before
  reading petStore — established pattern.
- The per-slice refactor widened `loadSettings` from 1 disk read
  (`storage.json`) to 10 sequential per-slice reads + provider
  `loadFromDisk`, widening the race window. The race existed before
  but is now reliably reproducible.

## Requirements

- `initializeVault` awaits `settingsLoadDone` before `initVault()`.
- Other init steps (loadAiSessionsForVault, editorIoService.restoreOpenTabs,
  wiki init, first-file-open) keep their existing order — they run
  after vault init as today.

## Acceptance Criteria

- [ ] Hide a folder via sidebar context menu → restart app → folder
      stays hidden.
- [ ] `pnpm typecheck` green.
- [ ] `pnpm test` — no new failures.

## Out of Scope

- Parallelizing / speeding up `loadSettings` (separate concern).
- Migrating `refreshFileTree` to subscribe to appearanceStore changes
  instead of one-shot read (separate concern).
- Reordering other init steps.

## Technical Approach

One-line change in `App.tsx`:

```ts
const initializeVault = async () => {
  registerEditorFileChangeApplier();
  await settingsLoadDone;              // ← new
  await useVaultStore.getState().initVault();
  ...
};
```

Import `settingsLoadDone` from `@/store/settingsPersistence`.

## Decision (ADR-lite)

**Context**: `refreshFileTree` reads `excludePatterns` synchronously
from the store; if hydration hasn't landed, it sees defaults.

**Decision**: Gate `initializeVault` on `settingsLoadDone` before
`initVault`. Matches the `usePetHostBridge` pattern.

**Consequences**: Vault init is delayed by hydration time (10 disk
reads, ~10-50ms on SSD). Acceptable — the user-visible effect of a
non-hydrated tree (hidden folders reappearing) is worse than a
~50ms startup delay.

## Definition of Done

- typecheck green
- manual smoke: hide folder → restart → stays hidden
- commit + push
