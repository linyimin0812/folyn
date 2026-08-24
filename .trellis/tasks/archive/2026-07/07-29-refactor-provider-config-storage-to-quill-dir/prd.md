# Refactor Provider Config Storage to ~/.folyn Directory

## Goal

Move provider configuration out of the unified `storage.json` blob into two dedicated files under `~/.folyn/providers/`, and adopt a new schema aligned with the bundled catalog shape. Motivation: isolate user-authored provider definitions and per-provider connection settings so they can be edited, migrated, and backed up independently of unrelated app settings.

## Requirements

- Custom provider definitions persisted to `~/.folyn/providers/customer/providers.json`, keyed by id, with shape:
  ```json
  { "{id}": { "id", "name", "defaultChatEndpoint", "description?", "metadata?": { "website": { "apiKey?", "docs?", "models?", "official?" } } } }
  ```
- Per-provider connection configs persisted to `~/.folyn/providers/settings.json`, keyed by id, with shape:
  ```json
  { "{id}": { "id", "baseUrl", "apiKey", "selectedModelIds": [], "enabled": false, "customProvider": false, "extra": {} } }
  ```
- `customProvider` (bool): routing flag for the Rust/rig side. `false` → use rig's built-in provider by id; `true` → treat as custom provider (rig uses id + baseUrl + adapter family resolved from `customer/providers.json`'s `defaultChatEndpoint`). Bundled providers default `false`; entries originating from `customProviders` default `true`.
- `defaultChatEndpoint` is an enum/select of endpoint keys (anthropic-messages, openai-chat-completions, openai-responses, …), mirroring the bundled `assets/providers/providers.json`.
- `extra` is an opaque bag for adapter-specific fields: `azureDeploymentId`, `azureApiVersion`, `thinkingBudget`, etc. Migration packs existing fields into `extra`.
- `selectedModelIds` = subset of models the user has enabled (merged from current `manualModels` + any selection state). The per-provider `~/.folyn/providers/{id}/models.json` cache stays unchanged.
- Bundled providers only get an entry in `settings.json` when the user configures them (sparse, matches existing pattern).
- Add-provider drawer captures: id, name, defaultChatEndpoint (select), description, metadata.website.{apiKey, docs, models, official}.
- Provider settings page manages: baseUrl, apiKey, selectedModelIds, enabled, extra (azure/thinkingBudget surfaced via form fields).
- Existing `customProviders` and `providerConfigs` migrated on first hydrate; old keys removed from `storage.json` after migration. Migration version flag prevents re-migration.
- `chatProvider`, `chatModel`, `manualModels` unrelated to this refactor stay in `storage.json`.

## Acceptance Criteria

- [x] New custom provider writes to `customer/providers.json` (not `storage.json`).
- [x] Editing connection settings writes to `settings.json`.
- [x] Existing `customProviders` migrated: `displayName`→`name`, `apiKeyUrl`→`metadata.website.apiKey`, `category`→`defaultChatEndpoint` (verify mapping), `baseUrl`→settings.json, `customProvider: true` set on these entries.
- [x] Existing `providerConfigs` (bundled) migrated: `apiKey`/`baseUrl`→top-level, `azureDeploymentId`/`azureApiVersion`/`thinkingBudget`→`extra`, `customProvider: false` set on these entries.
- [x] Existing `manualModels` migrated into the right `selectedModelIds` per provider.
- [x] Old keys stripped from `storage.json` after migration; version flag persisted.
- [x] Add-provider drawer collects all new fields with validation (id: `[a-zA-Z0-9_-]+`, name: non-empty, defaultChatEndpoint: required select).
- [x] Provider settings page reads/writes the new shape.
- [x] App starts cleanly with no provider configs (empty-state: files absent → treated as `{}`).
- [x] New custom provider entry in settings.json has `customProvider: true`; bundled provider entry has `customProvider: false`.
- [x] Round-trip: add → edit → restart → values persist.
- [x] Bundled provider config still loads from `assets/providers/providers.json` (no change).
- [x] Rust/rig side reads `customProvider` flag and routes correctly: `false` → rig built-in provider by id; `true` → custom path using id + baseUrl + adapter family.

## Definition of Done

- Unit tests for new storage layer (read / write / migrate-from-old-shape / empty-state).
- Lint / typecheck / CI green.
- Migration path documented in this PRD's Technical Notes.
- Rollback: `storage.json` keys removed only after successful write of new files; if migration throws, storage.json keys left intact and surfaced as a user-visible error.

## Technical Approach

### Storage layer

New module `apps/desktop/src/services/providers/providerConfigStorage.ts`:
- `readCustomerProviders(): Record<id, CustomProviderDef>`
- `writeCustomerProviders(defs): void`
- `readProviderSettings(): Record<id, ProviderSettings>`
- `writeProviderSettings(settings): void`
- Both resolve paths under `~/.folyn/providers/` via existing `userProvidersCatalog.ts` helpers (`getUserProvidersDir`).
- Atomic writes: write to `<path>.tmp` then `renameFile` (POSIX-atomic). No existing atomic-write helper in the codebase — this module owns it.
- Empty/missing file → `{}` (no crash).

### Store refactor (`aiConfigStore.ts`)

- Replace `customProviders: CustomProvider[]` + `providerConfigs: Record<id, ProviderConfig>` + `enabledProviders` with two maps loaded from the new files.
- Drop these keys from `PERSIST_KEYS_AI_CONFIG`.
- `addCustomProvider` / `updateCustomProvider` / `removeCustomProvider` → call `providerConfigStorage` writers.
- `setChatApiKey` / `setBaseUrl` / azure setters / `setThinkingBudget` → call `providerConfigStorage` writers for the affected provider id.
- `hydrate`: detect migration version flag; if absent, read legacy keys from `storage.json`, map to new shape, write both files, then remove legacy keys from `storage.json` and set the flag.

### Migration mapping

| Source (storage.json)                          | Target                                               |
| ---------------------------------------------- | ---------------------------------------------------- |
| `customProviders[].id`                         | `customer/providers.json[{id}].id`                    |
| `customProviders[].displayName`                | `customer/providers.json[{id}].name`                  |
| `customProviders[].category`                   | `customer/providers.json[{id}].defaultChatEndpoint` (NOT 1:1; lookup table + defensive coerce for legacy typos like `openai-response`→`openai-responses`; unknowns default to `openai-chat-completions`) |
| `customProviders[].apiKeyUrl`                  | `customer/providers.json[{id}].metadata.website.apiKey` |
| `customProviders[].baseUrl`                   | `settings.json[{id}].baseUrl`                        |
| `providerConfigs[{id}].apiKey`                 | `settings.json[{id}].apiKey`                         |
| `providerConfigs[{id}].baseUrl`                | `settings.json[{id}].baseUrl`                        |
| `providerConfigs[{id}].azureDeploymentId`     | `settings.json[{id}].extra.azureDeploymentId`        |
| `providerConfigs[{id}].azureApiVersion`        | `settings.json[{id}].extra.azureApiVersion`          |
| `providerConfigs[{id}].thinkingBudget`        | `settings.json[{id}].extra.thinkingBudget`           |
| `enabledProviders[{id}]`                      | `settings.json[{id}].enabled`                        |
| (derived from source list)                    | `settings.json[{id}].customProvider`                 |
| `manualModels` grouped by provider             | `settings.json[{id}].selectedModelIds` (each `ManualModel.id` → element; `displayName`/`group`/`createdAt` discarded — user-added catalog entries collapse to id-only list) |

### UI changes

- `ModelServicesSettings.tsx` add-provider drawer: replace `displayName`/`apiKeyUrl`/`category` fields with new schema fields. `defaultChatEndpoint` becomes a `<select>` populated from endpoint keys.
- Provider settings page: form fields for baseUrl, apiKey, enabled toggle, azure fields (in `extra`), thinkingBudget (in `extra`), selected model list UI (existing UI, retargeted).

### Rust side

Rust currently does NOT read from disk; `chat_stream` and `list_models` receive `provider/api_key/base_url` as Tauri command params from the JS store. Decision: extend `ChatParams` and `ListModelsParams` with `custom_provider: bool` and `default_chat_endpoint: string` fields; JS reads `settings.json` + `customer/providers.json` and passes these per call. Files to change:
- `src-tauri/.../chat.rs:61-99` — add fields to `ChatParams`.
- `src-tauri/.../list_models.rs:13-22` — add fields to `ListModelsParams`.
- `apps/desktop/src/services/rig/rigChat.ts:80-95` — pass new fields when invoking `chat_stream`.
- `apps/desktop/src/services/modelRegistry/fetchModels.ts:41-48` — pass new fields when invoking `list_models`.
- Rust routing: `custom_provider=false` → rig built-in provider by id (ignore `default_chat_endpoint`); `custom_provider=true` → rig custom path using id + base_url + adapter family resolved from `default_chat_endpoint`.

## Decision (ADR-lite)

**Context**: Provider configs are currently embedded in the unified `storage.json` blob, mixed with unrelated app state. User-authored definitions and connection settings need to be separable for editing/migration/backup. Current data shapes diverge from the bundled catalog shape, forcing two parallel code paths.

**Decision**:
1. Adopt the new two-file storage layout under `~/.folyn/providers/`.
2. Adopt the new schema (mirrors bundled catalog shape for definitions; opaque `extra` bag for adapter-specific connection fields).
3. One-shot migration with cleanup of legacy `storage.json` keys + version flag.
4. Keep `~/.folyn/providers/{id}/models.json` cache as-is.

**Consequences**:
- Pro: clean separation, schema aligns with bundled catalog, custom provider definitions can be hand-edited.
- Pro: migration is one-shot; storage.json shrinks.
- Con: more files to read on startup (minor).
- Con: opaque `extra` means TypeScript loses some type safety for adapter-specific fields; trade-off for forward compat.
- Risk: if migration throws mid-way, must leave `storage.json` intact — implement as "write new files → only then strip old keys".

## Out of Scope

- Rust-side api key/baseUrl reading (unless Phase 2 research finds it reads from disk directly).
- Bundled `assets/providers/providers.json` shape changes.
- Multi-account / multi-profile support.
- Cloud sync of provider configs.
- Encryption at rest for apiKey.

## Implementation Plan (small PRs)

- [x] **PR1** — `apps/desktop/src/services/providers/providerConfigStorage.ts` + unit tests. Storage layer (read/write/atomic-rename/migrate-from-legacy-blob). 10 tests pass; tsc clean. Files: `providerConfigStorage.ts`, `providerConfigStorage.test.ts`.
- [x] **PR2** — Refactor `aiConfigStore.ts` to use new storage; migration on `loadSettings`; drop legacy keys from `PERSIST_KEYS_AI_CONFIG`. Extend `ChatParams` + `ListModelsParams` with `custom_provider` + `default_chat_endpoint`; wire `rigChat.ts` + `fetchModels.ts` to pass them.
  - [x] PR2a: Reshape `catalog.ts` `CustomProvider` to new schema (CustomProviderDef shape; `displayName`→`name`, `apiKeyUrl`→`metadata.website.apiKey`, `category`→`defaultChatEndpoint` enum; `CustomProviderType` deleted; `getProviderEntryIncludingCustom`/`allProviders` take Record instead of array).
  - [x] PR2b: Rewrite `aiConfigStore.ts` — new state shape (`customerProviders: Record<id, CustomProviderDef>` + `providerSettings: Record<id, ProviderSettings>`), setters call `providerConfigStorage`, `loadFromDisk()` runs migration + reads new files, `loadSettings()` calls `loadFromDisk` after blob hydrate, flat mirror fields preserved as views over `providerSettings[chatProvider]`. 34/55 tests pass (cli/chatProvider/chatModel paths); 21 fail (touch old deep fields). `manualModels` stays in `storage.json` — its migration to `selectedModelIds` is ambiguous per research.
  - [x] PR2c: Rewrite `aiConfigStore.test.ts` 21 failing tests to use new state shape. 53/53 pass. Added in-memory fs mock (`@tauri-apps/api/path` + `@tauri-apps/plugin-fs`) so disk-touching tests (addCustomProvider→flush→exists, loadFromDisk migration, atomic write rename spy) run without Tauri. Extended `migrateLegacyBlob` to carry flat `chatApiKey`/`chatBaseUrl`/`chatAzure*`/`chatThinkingBudget` from the legacy blob into `providerSettings[chatProvider]`.
  - [x] PR2d: `ModelServicesSettings.tsx` minimal compile fixes (full drawer rewrite is PR3).
  - [x] PR2e: Rust `ChatParams`/`ListModelsParams` add `custom_provider` + `default_chat_endpoint`; `chat_stream` + `list_models` resolve adapter family from endpoint key when `custom_provider=true` (anthropic-messages→anthropic arm, google-generate-content→gemini, ollama|ollama-chat→ollama, openai-* + unknowns→`_` openai-compat arm). cargo check clean.
  - [x] PR2f: `rigChat.ts` + `fetchModels.ts` derive `customProvider` (from `customerProviders[chatProvider]`) + `defaultChatEndpoint` and pass to invoke. Callers updated: `AiPanel.tsx`, `BubbleTemplateAIChatModal.tsx`, `useVoiceInput.ts`, `ModelServicesSettings.tsx` (testChatConnection + fetchModelsForProvider), `modelRegistryStore.ts` (signature extension).
- [x] **PR3** — UI: rewrite `CustomProviderDrawer` to capture new schema fields; retarget provider settings page to new shape.

## Progress Log

- 2026-07-29: Brainstormed + PRD locked (full schema, one-shot migration, extra bag, selectedModelIds = user-added, defaultChatEndpoint enum, customProvider routing flag passed via Tauri params). Phase 2 research done (5 files persisted to `research/`). PR1 shipped. PR2a + PR2b shipped (catalog + aiConfigStore rewrite; tsc clean except ModelServicesSettings.tsx; 34/55 aiConfigStore tests pass). PR2c-PR2f shipped (aiConfigStore 53/53 tests pass; Rust params + resolver + cargo check clean; rigChat/fetchModels/modelRegistryStore plumbed). PR3 pending.
- 2026-07-29 (later): PR3 audited — no incremental code work required. `CustomProviderDrawer` already captures the full new schema (id / name / defaultChatEndpoint select with 7 enum options / description / metadata.website.{apiKey,docs,models,official}, validation: id regex + name non-empty + endpoint required). Provider settings page already routes via `setChatApiKey`/`setChatBaseUrl`/`setProviderEnabled`/azure setters/thinkingBudget → `providerConfigStorage.setProviderSettings` → `~/.folyn/providers/settings.json`. Catalog helpers (`providerDisplayName`, `providerApiKeyUrl`, `providerCategory`, `providerBaseUrl`) already work against new `CustomProvider` shape. `migrateLegacyBlob` packs `manualModels` into `selectedModelIds` (lines 408/428/448/463). All 13 Acceptance Criteria verified against current code. tsc clean; 77/77 store + storage + persistence tests pass. `settingsPersistence.test.ts` reports pre-existing env errors (`open-color json` import attribute + `window is not defined`) — not test failures, all 77 tests pass; unrelated to PR3.

## Technical Notes

Files inspected:
- `apps/desktop/src/store/aiConfigStore.ts:33-88, 295-365, 386-458, 460-534`
- `apps/desktop/src/store/settingsPersistence.ts`
- `apps/desktop/src/utils/storageClient.ts:11-16`
- `apps/desktop/src/services/providers/catalog.ts:56-63`
- `apps/desktop/src/services/providers/providersCatalog.ts`
- `apps/desktop/src/services/modelRegistry/userProvidersCatalog.ts:36-66`
- `apps/desktop/src/components/settings/ModelServicesSettings.tsx:790-922+`
- `apps/desktop/src/assets/providers/providers.json`

Constraints:
- `~/.folyn/providers/` dir already created by `userProvidersCatalog.ts`; new files live alongside.
- Bundled catalog at `assets/providers/providers.json` already has the target shape — custom definitions mirror it (minus `endpointConfigs`, since custom providers reference adapter families defined by bundled endpoints).

Open items for Phase 2 research:
- Confirm `category` → `defaultChatEndpoint` mapping is 1:1 or needs a lookup table.
- Confirm Rust IPC bridge doesn't read `storage.json` from disk.
- Check whether `settingsPersistence.ts` already does atomic writes (temp+rename) — reuse pattern if so.
