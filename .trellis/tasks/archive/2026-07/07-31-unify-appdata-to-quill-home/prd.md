# Unify appDataDir writes to ~/.folyn/

## Goal

Stop writing runtime files to macOS `~/Library/Application Support/com.folyn.editor/`
(appDataDir). Move every remaining appDataDir write site under `~/.folyn/`
so all user-state lives in one inspectable, backupable location. Config
(`~/.folyn/storage/`) and provider config (`~/.folyn/providers/`) already
live there — this task finishes the job.

## What I already know

Remaining appDataDir write/read sites (TS only — Rust side uses `home_dir`
in `chat.rs:284` and `plugin_commands.rs:77`, both unrelated to appDataDir):

- `apps/desktop/src/components/settings/PetSettings.tsx:104,143,190`
  — custom pet icon copy → `appDataDir/pet-icon-<ts>.<ext>`; "恢复默认"
  button deletes matching files; ACL deps `$APPDATA/**`.
- `apps/desktop/src/services/petChatService.ts:103`
  — `appData = await appDataDir()` then `mkdir appData/pet-chat-tmp`
  as CLI adapter working dir.
- `apps/desktop/src/services/scriptRunner/scriptRunnerService.ts:111`
  — `dir = await appDataDir()` for script runner temp dir.
- `apps/desktop/src/utils/sessionStorage.ts:8`
  — `base = await appDataDir()`; per-vault session files at
  `appDataDir/vaults/<vaultId>/<sessionId>.json` + `_meta.json`.
- `apps/desktop/src/hooks/usePetHostBridge.ts:50-87`
  — startup orphan sweep reads `appDataDir` for `pet-icon*` files.

ACL coverage (capabilities/default.json): `fs:scope-home-recursive` with
`$HOME/**/.*` and `$HOME/**/.*/**` — already covers `~/.folyn/**`. No
capability file changes needed.

Precedent: `~/.folyn/storage/` (storageClient) and `~/.folyn/providers/`
(providerConfigStorage + userProvidersCatalog) already use `homeDir() +
join(home, '.folyn', <sub>)` pattern. Reuse it.

## Requirements

- New `~/.folyn/pet-icon/` — custom pet icon files (`pet-icon-<ts>.<ext>`).
- New `~/.folyn/pet-chat-tmp/` — CLI adapter working dir for pet chat.
- New `~/.folyn/scripts-tmp/` — script runner temp dir.
- New `~/.folyn/vaults/<vaultId>/` — per-vault session files.
- `PetSettings.tsx` (custom icon copy + 默认按钮 sweep) retargets `~/.folyn/pet-icon/`.
- `usePetHostBridge.ts` orphan sweep retargets `~/.folyn/pet-icon/`.
- `petChatService.ts` working dir retargets `~/.folyn/pet-chat-tmp/`.
- `scriptRunnerService.ts` temp dir retargets `~/.folyn/scripts-tmp/`.
- `sessionStorage.ts` per-vault dir retargets `~/.folyn/vaults/<vaultId>/`.
- No new appDataDir imports introduced; existing `appDataDir` imports in
  these 5 files removed (or replaced with `homeDir`).
- Old appDataDir files (pet-icon, vaults/, pet-chat-tmp) NOT migrated —
  user accepts reset on first launch with new code.

## Acceptance Criteria

- [ ] `grep -rn appDataDir apps/desktop/src` returns matches only in
      test mocks (`*.test.ts`) — none in production code.
- [ ] Custom pet icon flow writes under `~/.folyn/pet-icon/`.
- [ ] Pet chat CLI working dir resolves to `~/.folyn/pet-chat-tmp/`.
- [ ] Script runner temp dir resolves to `~/.folyn/scripts-tmp/`.
- [ ] Vault sessions write to `~/.folyn/vaults/<vaultId>/`.
- [ ] `pnpm typecheck` (tsc) green.
- [ ] Existing tests green (or updated for new paths).
- [ ] No new Tauri capability file changes required.

## Out of Scope

- Migration of legacy appDataDir files (explicitly declined — first
  launch resets custom pet icon + vault sessions).
- Rust-side `home_dir` usages in `chat.rs` / `plugin_commands.rs` —
  unrelated, already `~/.folyn`-aware.
- Any new abstraction layer over `~/.folyn/<sub>` — each site continues
  to resolve its own path; no shared helper. (`storageClient` /
  `providerConfigStorage` / `userProvidersCatalog` already do this
  ad-hoc and that's fine.)
- Refactoring the existing `~/.folyn/storage/` or `~/.folyn/providers/`
  paths — they stay as-is.

## Technical Approach

Each call site replaces `await appDataDir()` with `await homeDir()` +
`join(home, '.folyn', '<sub>')`, mirroring the `getUserProvidersDir()`
pattern at `userProvidersCatalog.ts:28-33`. The 5 sites:

```
PetSettings.tsx (custom icon):  ~/.folyn/pet-icon/pet-icon-<ts>.<ext>
usePetHostBridge.ts (sweep):    ~/.folyn/pet-icon/
petChatService.ts (workdir):    ~/.folyn/pet-chat-tmp/
scriptRunnerService.ts (tmp):   ~/.folyn/scripts-tmp/
sessionStorage.ts (sessions):   ~/.folyn/vaults/<vaultId>/
```

No shared helper — each site already has its own path resolution + dir
ensure logic; replacing `appDataDir()` → `homeDir() + join(..., '.folyn',
<sub>)` is a 2-line change per file. A shared helper would be premature
abstraction (5 callers, 5 different sub-paths, no shared lifecycle).

## Decision (ADR-lite)

**Context**: User state scattered across two roots (appDataDir for
runtime files, `~/.folyn` for config/providers). Inspecting/backing up
user state requires looking in two places; appDataDir is platform-
specific (`~/Library/Application Support/com.folyn.editor` on macOS,
`%APPDATA%\com.folyn.editor` on Windows) which obscures it further.

**Decision**: Move all remaining appDataDir writes under `~/.folyn/`
with per-use flat sub-dirs. No migration, no shared path helper.

**Consequences**: First launch after upgrade loses custom pet icon +
vault sessions (accepted). All user state now under `~/.folyn/` —
single backup target, platform-agnostic. Slightly less "standard" macOS
convention (appDataDir is the platform default), but consistency with
the existing `~/.folyn/storage/` + `~/.folyn/providers/` layout wins.

## Definition of Done

- typecheck green
- existing tests green (or updated)
- `grep appDataDir apps/desktop/src` matches only test mocks
- manual smoke (if feasible): set custom pet icon → file lands in
  `~/.folyn/pet-icon/`; open vault → session files land in
  `~/.folyn/vaults/<vaultId>/`

## Technical Notes

- `homeDir()` is in `@tauri-apps/api/path`. Already imported by
  `userProvidersCatalog.ts:19` and `providerConfigStorage.ts:15`.
- Test mocks at `test/mocks/@tauri-apps/api/path.ts` already mock
  `homeDir` → `/mock/home`. Existing tests that assert appDataDir paths
  need updating to assert `~/.folyn/<sub>` paths instead.
- `scriptRunnerService.test.ts:30` mocks `appDataDir` — switch to
  `homeDir` mock.
- `sessionStorage.test.ts:62-80` asserts `/mock/appdata/vaults/vault-1/`
  paths — switch to `/mock/home/.folyn/vaults/vault-1/`.
- `petChatService.test.ts:128` mocks `appDataDir` → `/mock/appdata` —
  switch to `homeDir` → `/mock/home`, update expected path.
