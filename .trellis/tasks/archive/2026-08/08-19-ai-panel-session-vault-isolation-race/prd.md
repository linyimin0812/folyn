# AI Panel Session Vault Isolation Race

## Goal

Fix a race in the AI panel's session persistence: when the user switches vaults A → B, B's in-memory sessions can be written to A's vault directory (and vice versa on subsequent switches), so vault A ends up containing B's sessions on disk. The AI panel's sessions should remain strictly isolated per vault.

## What I already know

- Storage layer is correct: `sessionStorage` (apps/desktop/src/utils/sessionStorage.ts) roots sessions at `~/.folyn/vaults/<vaultId>/<sessionId>.json` + `_meta.json`. No cross-vault I/O at this layer.
- Boot path is correct: `loadAiSessionsForVault` (aiSessionPersistence.ts:120) runs after `initVault` sets `activeVaultId` (App.tsx:205→207), so the loaded vault id and the in-memory sessions agree.
- Switch path has the race:
  1. `vaultStore.switchVault` (vaultStore.ts:326) calls `useAiStore.getState().switchVaultSessions(config.id)`.
  2. `switchVaultSessions` (aiStore.ts:511-522): `saveAllSessions(currentVaultId)` ✓ → `setSuppressPersist(true)` → `loadSessionsFromDisk(newVaultId)` (replaces in-memory sessions with the new vault's, fires the persist subscription → schedules `debouncedPersist` 500ms trailing timer) → `setSuppressPersist(false)`.
  3. Back in `switchVault`: `stopVaultWatcher`, `manager.switchVault`, `seedAgentFiles`, `migrateSpecialDirs`, `refreshFileTree` all await before `set({ currentVault: config, activeVaultId: config.id })` (vaultStore.ts:333).
  4. If the 500ms timer fires in that window: `persistAiState` (aiSessionPersistence.ts:87-99) sees `suppressPersist=false`, reads `activeVaultId` (still the OLD vault), and `saveAllSessions(OLD)` writes the NEW vault's in-memory sessions to the OLD vault's directory. Leak.
- `debouncedPersist` is trailing-edge 500ms (apps/desktop/src/utils/debounce.ts).
- pet-chat (`~/.folyn/pet-chat/`, petChatSessions.ts) is intentionally vault-free — NOT in scope for this bug.

## Root cause

`persistAiState` resolves the target vault from `useVaultStore.getState().activeVaultId`, but `activeVaultId` is updated by the caller AFTER the in-memory sessions have already been swapped. The two pieces of state ("which sessions are in memory" vs "which vault is active") drift apart for the duration of the switch flow, and the debounce can land in that gap.

## Proposed fix (minimal)

Track the vault id that the in-memory sessions belong to directly on `aiStore`, instead of inferring it from `activeVaultId`:

1. Add `loadedVaultId: string | null` to `AiState`, default `null`.
2. `loadSessionsFromDisk(vaultId)` sets `loadedVaultId: vaultId` alongside `sessions`/`activeSessionId` in every `setState` branch.
3. `loadAiSessionsForVault()` sets `loadedVaultId` in the empty-session branches too.
4. `persistAiState` reads `useAiStore.getState().loadedVaultId` instead of `useVaultStore.getState().activeVaultId` (and bails when null, same as the current `if (!vaultId) return`).
5. `saveAllSessions(vaultId)` keeps its explicit arg — the only caller that passes the OLD vault id is `switchVaultSessions:515`, where `loadedVaultId` still equals the OLD vault anyway, so the value passed matches `loadedVaultId`.

After the fix, the 500ms timer firing anywhere in the switch window writes the in-memory sessions to `loadedVaultId` (always the vault those sessions belong to), so no leakage regardless of timing. The existing `suppressPersist` window becomes belt-and-suspenders rather than load-bearing.

## Requirements

- Switching vault A → B must never write B's sessions into A's vault directory.
- Switching back B → A must not show B's sessions in A's session list.
- Boot path behavior unchanged (sessions load for the active vault on startup).
- pet-chat vault-free behavior unchanged.

## Acceptance Criteria

- [ ] After A → B switch, `~/.folyn/vaults/<A>/` contains only sessions that existed there before the switch (no new files, no overwritten _meta.json pointing at B's active session).
- [ ] After B → A switch, the AI panel's session list shows only A's sessions.
- [ ] Adding a message in vault B's session does not create or modify files under `~/.folyn/vaults/<A>/`.
- [ ] `persistAiState` reads `loadedVaultId` from `aiStore`, not `activeVaultId` from `vaultStore`.

## Definition of Done

- Lint / typecheck clean (user runs compile per their workflow — we only ensure syntax/types correct).
- The race is impossible by construction (no timing-dependent fix).
- No new tests required for a 4-line state-binding fix, but a brief inline assertion or comment explaining the invariant is appropriate.

## Decision (ADR-lite)

**Context**: `persistAiState` infers the target vault from `useVaultStore.activeVaultId`, which the caller updates only AFTER swapping the in-memory sessions to the new vault. The 500ms trailing debounce can land in that gap and write the new vault's sessions to the old vault's directory.

**Decision**: Track `loadedVaultId` on `aiStore` itself, set atomically with every session swap, read from `persistAiState`. This mirrors `wikiQueryStore.vaultId` (wikiQueryStore.ts:102/117), which already uses the same pattern and has no race.

**Consequences**: Persist always writes to the vault whose sessions are in memory, regardless of when the debounce fires. `suppressPersist` becomes redundant for this race but is left in place (harmless, smaller diff). Adds one field to `AiState`. No new files, no new dependencies.

## Out of Scope

- pet-chat vault isolation (intentionally vault-free per design).
- Auditing other stores (wikiQueryStore already mirrors the same pattern — separate concern).
- Migrating or deleting legacy `storageClient` keys.
- Refactoring `suppressPersist` away entirely (becomes redundant but harmless; leave it).

## Technical Notes

Files touched:
- apps/desktop/src/store/aiStore.ts — add `loadedVaultId` field to `AiState` interface + initial state.
- apps/desktop/src/store/aiSessionPersistence.ts — set `loadedVaultId` in `loadSessionsFromDisk` + `loadAiSessionsForVault`; read it in `persistAiState`.

No new files, no new dependencies.
