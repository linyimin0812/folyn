# Refactor AI Settings: Split CLI Tools and Model Services

## Goal

Split the current single "AI 工具" settings tab (inlined in `SettingsPage.tsx:393-749`) into two separate, sibling-component tabs:

- **CLI 工具** (CLI adapter: `cliAdapter` selection + `cliPath` detection/test)
- **模型服务** (Chat / LLM providers: `chatProvider`, `chatModel`, `providerConfigs`, refetch-all, test-connection)

Follows the existing pattern of `PluginsSettings` / `VoiceSettings` / `SkillsSettings` — extract each section into its own `components/settings/*Settings.tsx` component, register new tab IDs in `NAV_GROUPS`, update `SettingsTab` union, and add i18n keys for both locales.

## What I already know

- Current `ai` tab is inlined in `apps/desktop/src/components/pages/SettingsPage.tsx:393-749` (~356 lines)
- Two logical sections already exist, separated by `border-t` at line 477:
  - **Top: CLI adapter** — `listAdapters()` from `@quill/cli-adapter`, `cliAdapter` radio list, `cliPath` input with detect button, `--version` test button, usage info card
  - **Bottom: Chat / model service** — provider `<select>`, model select/fetch, per-provider status dots, refetch-all, apiKey/baseUrl/azure/thinkingBudget inputs, test-connection button
- Tab nav config: `apps/desktop/src/components/settings/primitives.tsx:20-38` — `NAV_GROUPS` with `ai-group` containing `ai`, `voice`, `skills`
- `SettingsTab` union in `apps/desktop/src/store/navStore.ts:7` — `'ai'` is currently the only AI-config tab
- Sibling tab components already extracted in `apps/desktop/src/components/settings/`: `PluginsSettings`, `VoiceSettings`, `FileTemplatesSettings`, `SkillsSettings`, `PetSettings`, `NotificationsSettings`, `ShortcutEditor` — pattern to follow
- Config storage: `apps/desktop/src/store/aiConfigStore.ts` (Zustand) — `cliAdapter`, `cliPath`, `chatProvider`, `chatModel`, `providerConfigs` all in one store; persisted via `settingsPersistence.ts` under `settings:all`
- i18n: `apps/desktop/src/i18n/locales/{en,zh}/settings.json` — current keys nested under `settings.ai.*` (e.g., `settings:ai.title`, `settings:ai.cliAdapter`, `settings:ai.cliPath.label`, `settings:ai.chat.title`, `settings:ai.chat.provider.label`)
- `navStore` does NOT persist (no `registerPersistSlice` call) — no migration concern for stale `'ai'` value

## Decision (ADR-lite)

**Context**: Existing `ai` tab conflates two unrelated configs (CLI adapter vs LLM providers). User wants them split into two separate pages.

**Decision**:
- Two new tab IDs: `cli` + `models` (under existing "AI" group in `NAV_GROUPS`)
- Old `ai` tab ID removed from `SettingsTab` union
- i18n keys reorganized: `settings.ai.*` → split into `settings.cli.*` + `settings.models.*`; `ai.chat.*` subkeys migrate to `settings.models.*`
- `ai.title` / `ai.description` deleted (replaced by per-tab `cli.title` / `cli.description` / `models.title` / `models.description`)

**Consequences**:
- Cleaner component structure matching existing `*Settings.tsx` pattern
- i18n diff is larger but semantic clarity wins
- No store/state migration needed (navStore doesn't persist)
- Old `settings:ai.*` keys will be removed — any external references break (none found in repo grep)

## Assumptions (resolved)

- Tab IDs: `cli` + `models` ✓
- Both new tabs stay under "AI" group label in `NAV_GROUPS` ✓
- `ai` tab ID removed entirely (no alias) ✓
- i18n fully reorganized into `settings.cli.*` + `settings.models.*` ✓
- Default landing tab unchanged (`appearance`) ✓
- No URL/router involved ✓

## Requirements (evolving)

- Extract CLI adapter section into a `CliSettings` component (file: `apps/desktop/src/components/settings/CliSettings.tsx`)
- Extract chat/model service section into a `ModelServicesSettings` component (file: `apps/desktop/src/components/settings/ModelServicesSettings.tsx`)
- Remove the inlined `ai` tab block from `SettingsPage.tsx`
- Add two new tab IDs to `SettingsTab` union in `navStore.ts`
- Add two new entries in `NAV_GROUPS` (primitives.tsx) under the "AI" group; remove old `ai` entry
- Add i18n keys for both locales (en + zh) for new tab labels, descriptions, group entries
- Existing `cliAdapter` / `cliPath` / `chatProvider` / `chatModel` / `providerConfigs` storage behavior unchanged — only UI restructure
- Existing test-connection / detect-path / refetch-all behavior preserved verbatim

## Acceptance Criteria (evolving)

- [ ] Two separate tabs visible in settings sidebar (CLI 工具 + 模型服务)
- [ ] CLI adapter section renders correctly in its own tab; selecting adapter / detecting path / running `--version` test all work
- [ ] Model service section renders correctly in its own tab; provider select, model fetch, api-key/baseUrl/azure/thinkingBudget inputs, refetch-all, test-connection all work
- [ ] Old `ai` tab ID no longer in `SettingsTab` union
- [ ] No stale references to `settingsTab === 'ai'` in `SettingsPage.tsx`
- [ ] i18n keys present for both en + zh
- [ ] Type-check / lint / build green

## Definition of Done

- Tests added/updated where appropriate (UI smoke check sufficient — no behavior change)
- Lint / typecheck / build green
- i18n keys added for both en + zh locales
- No behavior change to underlying config storage or CLI/provider logic

## Out of Scope (explicit)

- Renaming the underlying store fields (`cliAdapter`, `chatProvider`, `providerConfigs`) — only UI changes
- Merging or splitting `aiConfigStore` itself
- Changes to `voice` / `skills` tabs
- Persisted-state migration logic (navStore doesn't persist)
- Any new functionality beyond the reorganization

## Technical Notes

- Files to modify:
  - `apps/desktop/src/components/pages/SettingsPage.tsx` (remove inlined block, import new components)
  - `apps/desktop/src/components/settings/primitives.tsx` (NAV_GROUPS update)
  - `apps/desktop/src/store/navStore.ts` (SettingsTab union update)
  - `apps/desktop/src/i18n/locales/en/settings.json` (new keys)
  - `apps/desktop/src/i18n/locales/zh/settings.json` (new keys)
- Files to create:
  - `apps/desktop/src/components/settings/CliSettings.tsx`
  - `apps/desktop/src/components/settings/ModelServicesSettings.tsx`
- Pattern reference: `apps/desktop/src/components/settings/PluginsSettings.tsx` for sibling component structure
- State hooks: `useAiConfigStore` for both new components (no store split)
