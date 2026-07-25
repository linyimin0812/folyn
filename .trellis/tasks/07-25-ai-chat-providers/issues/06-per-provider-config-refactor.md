# 06 — aiConfigStore per-provider config refactor

**What to build:** Refactor `aiConfigStore` so the per-provider config(api_key / base_url / azure_deployment_id / azure_api_version / thinking_budget)is stored in a `providerConfigs: Record<providerId, ProviderConfig>` map keyed by provider id, instead of the current single-provider flat fields that get overwritten when the user switches provider. The current `chatApiKey` / `chatBaseUrl` / etc. become **derived getters** that read from `providerConfigs[chatProvider]` — 9 existing call sites keep working unchanged. Persisted as a single `providerConfigs` key in `PERSIST_KEYS_AI_CONFIG`, with a one-time migration path on hydrate that reads old flat keys and writes them under the legacy `chatProvider` id.

After the refactor, T04's "重新拉取全部" button can finally iterate **all** configured providers(those with non-empty api_key, or providers that don't require an api_key)in parallel. The single FetchStatusDot becomes a per-provider grid of dots, one per configured provider.

The refactor touches 9 callers of `chatApiKey` / `chatBaseUrl` / `chatAzureDeploymentId` / `chatAzureApiVersion`:

- `apps/desktop/src/components/pages/SettingsPage.tsx` — form fields read/write per-provider; refetch button iterates all
- `apps/desktop/src/components/settings/BubbleTemplateAIChatModal.tsx` — `readChatConfig()` reads current provider's config
- `apps/desktop/src/components/pet/PetChat.tsx`
- `apps/desktop/src/components/ai/AiPanel.tsx`
- `apps/desktop/src/hooks/useVoiceInput.ts`
- `apps/desktop/src/services/plugin-host/aiCapability.ts`
- `apps/desktop/src/services/plugin-host/rpcBridge.ts`
- `apps/desktop/src/services/petChatService.ts`
- `apps/desktop/src/services/rigChat.ts` — `testChatConnection` + `RigChatParams` unchanged(derived getters mean callers don't change)

The derived-getter approach means **the only file that semantically changes is SettingsPage**(form fields now write to the current provider's slot, switching provider preserves the previous provider's slot, the form re-populates with the new provider's slot). The other 8 callers continue to call `useAiConfigStore.getState().chatApiKey` and get the current provider's value — no edits needed there.

**Blocked by:** None — can start immediately. Independent of T07(reasoning application). T04's minimal version is the current state; T06 is the upgrade.

**Status:** ready-for-agent

- [ ] `aiConfigStore.ts`: replace flat `chatApiKey` / `chatBaseUrl` / `chatAzureDeploymentId` / `chatAzureApiVersion` / `chatThinkingBudget` with a single `providerConfigs: Record<string, ProviderConfig>` field. `ProviderConfig = { apiKey: string; baseUrl: string; azureDeploymentId: string; azureApiVersion: string; thinkingBudget: number | null }`.
- [ ] Derived getters on the store interface keep the old field names(`chatApiKey` etc.)so callers reading them via `useAiConfigStore.getState().chatApiKey` keep working — they return `providerConfigs[chatProvider]?.apiKey ?? ''`.
- [ ] Setters `setChatApiKey(v)` etc. now write into `providerConfigs[chatProvider]` — create the slot on first write. Same for the other 4 fields.
- [ ] `PERSIST_KEYS_AI_CONFIG`: drop the 5 flat keys, add `providerConfigs`. Old blobs still hydrate — `hydrate()` reads flat keys if present and writes them into `providerConfigs[legacy chatProvider]`, then drops the flat keys from the blob on next persist.
- [ ] New helper `configuredProviderIds(): string[]` — returns provider ids where `requiresApiKey` is false(Ollama)OR `providerConfigs[id]?.apiKey` is non-empty. Used by the refetch button.
- [ ] SettingsPage form fields: bind to current provider's slot via the derived getters/setters(no JSX changes — derived getters handle it transparently). Verify by switching provider, filling key, switching away, switching back — key persists.
- [ ] SettingsPage "重新拉取全部" button: iterate `configuredProviderIds()`, build the `configured[]` array for `refetchAll`, fire it. Per-provider FetchStatusDot grid replaces the single dot — one dot per configured provider, hover tooltip shows provider id + status.
- [ ] `aiConfigStore.test.ts`: extend — old flat-key blob hydrates into `providerConfigs[legacyId]`; new per-provider blob hydrates directly; switching provider preserves each slot's config; `configuredProviderIds()` returns the right set.
- [ ] Verify all 9 caller files compile without changes(derived getters mean call sites unchanged). If any caller breaks, it was reading a flat key directly off state instead of via the getter — fix it to use the derived getter.
- [ ] End-to-end: configure Anthropic key + base_url, switch to OpenAI, configure OpenAI key, switch back to Anthropic — both configs preserved. Click "重新拉取全部" — both providers fetch in parallel, two status dots appear.
- [ ] Ollama(no api_key)appears in `configuredProviderIds()` automatically — `requiresApiKey: false` check.
