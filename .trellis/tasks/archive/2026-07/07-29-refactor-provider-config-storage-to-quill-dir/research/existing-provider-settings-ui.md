# Research: Existing Provider Settings UI (ModelServicesSettings.tsx + CustomProviderDrawer)

- **Query**: Document current form fields and setters in `ModelServicesSettings.tsx` + `CustomProviderDrawer`. List exact file:line locations that need to change to capture the new schema fields (id, name, defaultChatEndpoint select, description, metadata.website.{apiKey,docs,models,official}).
- **Scope**: internal
- **Date**: 2026-07-29

## Findings

### ModelServicesSettings.tsx — store reads

`apps/desktop/src/components/settings/ModelServicesSettings.tsx:172-192`:

```ts
const chatProvider = useAiConfigStore((s) => s.chatProvider);
const chatModel = useAiConfigStore((s) => s.chatModel);
const chatApiKey = useAiConfigStore((s) => s.chatApiKey);
const chatBaseUrl = useAiConfigStore((s) => s.chatBaseUrl);
const chatAzureDeploymentId = useAiConfigStore((s) => s.chatAzureDeploymentId);
const chatAzureApiVersion = useAiConfigStore((s) => s.chatAzureApiVersion);
const setChatProvider = useAiConfigStore((s) => s.setChatProvider);
const setChatModel = useAiConfigStore((s) => s.setChatModel);
const setChatApiKey = useAiConfigStore((s) => s.setChatApiKey);
const setChatBaseUrl = useAiConfigStore((s) => s.setChatBaseUrl);
const setChatAzureApiVersion = useAiConfigStore((s) => s.setChatAzureApiVersion);

const customProviders = useAiConfigStore((s) => s.customProviders);
const enabledProviders = useAiConfigStore((s) => s.enabledProviders);
const manualModelsMap = useAiConfigStore((s) => s.manualModels);
const addCustomProvider = useAiConfigStore((s) => s.addCustomProvider);
const updateCustomProvider = useAiConfigStore((s) => s.updateCustomProvider);
const removeCustomProvider = useAiConfigStore((s) => s.removeCustomProvider);
const setProviderEnabled = useAiConfigStore((s) => s.setProviderEnabled);
```

`chatAzureDeploymentId` is read (line 176) but the corresponding setter is NOT pulled from the store — `setChatAzureDeploymentId` is missing from the reads. Verify whether the Azure deployment input is wired; line 538–540 area shows `setChatAzureApiVersion` only. (Possibly an existing bug.)

### ModelServicesSettings.tsx — provider detail panel (right pane)

Per-provider form fields, keyed off the currently-selected `chatProvider` (line 272: `entry = getProviderEntryIncludingCustom(chatProvider, customProviders)`):

- **Provider enable toggle** — `ModelServicesSettings.tsx:413-416`. `Toggle value={entryEnabled} onChange={(v) => setProviderEnabled(entry.id, v)}`.
- **API Key input** — `ModelServicesSettings.tsx:419-497`. `value={chatApiKey} onChange={(e) => setChatApiKey(e.target.value)}`. "Get key" link uses `apiKeyUrl` (line 486-495), derived via `providerApiKeyUrl(entry)` (line 275). Test button at 454-479 invokes `testChatConnection({ provider: chatProvider, model, apiKey, baseUrl, azureDeploymentId, azureApiVersion })`.
- **Base URL input** — `ModelServicesSettings.tsx:500-530`. `value={chatBaseUrl} onChange={(e) => setChatBaseUrl(e.target.value)}`. Placeholder = `providersJsonBaseUrl ?? t('...')`, reset button clears `chatBaseUrl`.
- **Azure fields** — `ModelServicesSettings.tsx:532-...`. `requiresAzureFields` gates visibility; `value={chatAzureApiVersion} onChange={(e) => setChatAzureApiVersion(e.target.value)}`. (Azure deployment id field referenced in state but setter not wired — see above.)

### ModelServicesSettings.tsx — drawer dispatch

`ModelServicesSettings.tsx:789-806`:

```tsx
{drawer && (
  <CustomProviderDrawer
    state={drawer}
    initial={drawer.mode === 'edit' ? customProviders.find((p) => p.id === drawer.id) ?? null : null}
    onClose={() => setDrawer(null)}
    onSave={(data) => {
      if (drawer.mode === 'add') {
        const id = addCustomProvider(data);
        // (likely sets chatProvider to `id` here — verify in lines after 800)
      } else {
        updateCustomProvider(drawer.id, data);
      }
      setDrawer(null);
    }}
  />
)}
```

`onSave` payload shape: `{ displayName, baseUrl, apiKeyUrl, category }` — matches `CustomProvider` minus id/createdAt.

### CustomProviderDrawer — current fields

`ModelServicesSettings.tsx:922-1024`:

- `state: DrawerState` (line 928) — `{ mode: 'add' } | { mode: 'edit'; id: string }`.
- `initial: CustomProvider | null` (line 929).
- `onSave` signature (line 931-936): `{ displayName, baseUrl, apiKeyUrl, category } => void`.
- State (line 939-940): `const [displayName, setDisplayName] = useState(initial?.displayName ?? ''); const [category, setCategory] = useState<CustomProviderType>(initial?.category ?? 'openai');`
- Validity (line 942): `displayName.trim().length > 0`.
- Fields rendered (961-998):
  - **Preview avatar** (962-969) — first char of `displayName`.
  - **displayName input** (971-983) — text input, maxLength 32.
  - **category `<select>`** (985-998) — `value={category} onChange={(e) => setCategory(e.target.value as CustomProviderType)}`. Options listed (line 994): `['openai-chat-completions', 'openai-response', 'anthropic-messages', 'new-api', 'ollama']` — already mis-typed (see category-to-endpoint-mapping.md).
- Save button (1006-1019) — calls `onSave({ displayName, baseUrl: '', apiKeyUrl: null, category })`. Note: `baseUrl` is hardwired to `''`, `apiKeyUrl` to `null` — they're not captured in the drawer at all; the user is expected to set them via the provider detail panel after save.

### Manual model add modal (separate)

`ModelServicesSettings.tsx:835-836`:

```tsx
onSave={({ id, displayName, group }) => {
  addManualModel(chatProvider, { id, displayName, group });
}}
```

`ManualModelModal` component at line 1316+, fields: `displayName`, `id`, `group`. Unrelated to the provider-config drawer, but its persistence path will be touched by migration (see manual-models-shape.md).

### Locations that need to change for new schema

Add-provider drawer (CustomProviderDrawer, `ModelServicesSettings.tsx:922-1024`) — replace the `displayName` + `category` two-field form with:

| New field | Setter state | UI element | Lines to replace |
|---|---|---|---|
| `id` (new, `[a-zA-Z0-9_-]+`, required, must be unique across catalog+custom) | new `useState` | text input, regex-validate | add inside `922-1024`, plus pre-flight uniqueness check against `customProviders` + `PROVIDER_CATALOG` |
| `name` (was `displayName`) | rename existing `displayName` state | text input, non-empty | `939`, `971-983`, `1011` |
| `defaultChatEndpoint` (select, replaces `category`) | rename `category` state, change options | `<select>` populated from the 7 endpoint keys: `anthropic-messages`, `google-generate-content`, `ollama`, `openai-chat-completions`, `openai-responses`, `ollama-chat`, `openai-image-generation` | `940`, `985-998`, `1014` |
| `description` (optional) | new `useState` | text input or textarea | add field block |
| `metadata.website.apiKey` (optional URL) | new `useState` | text input (URL) — replaces the hardwired `apiKeyUrl: null` | `1013` and new field block |
| `metadata.website.docs` (optional URL) | new `useState` | text input (URL) | new field block |
| `metadata.website.models` (optional URL) | new `useState` | text input (URL) | new field block |
| `metadata.website.official` (optional URL) | new `useState` | text input (URL) | new field block |

The `onSave` payload shape (line 931-936) must change to match the new `CustomProviderDef`:

```ts
{
  id: string;
  name: string;
  defaultChatEndpoint: string;
  description?: string;
  metadata?: { website: { apiKey?, docs?, models?, official? } };
}
```

`baseUrl` is no longer part of the drawer payload (it lives in `settings.json` now, edited via the provider detail panel). `apiKeyUrl` is replaced by `metadata.website.apiKey`.

### Provider detail panel — connection settings (separate concern, same file)

The detail panel (lines 419-540+) already reads/writes the per-provider connection settings via `chatApiKey` / `chatBaseUrl` / azure setters. The store refactor (aiConfigStore) retargets these setters to call `providerConfigStorage` writers; the component itself mostly needs:
- New `extra` form fields (azureDeploymentId, azureApiVersion, thinkingBudget) — currently flat fields, will move into the `extra` bag. Setters `setChatAzureDeploymentId` / `setChatAzureApiVersion` / `setChatThinkingBudget` (aiConfigStore.ts:339-365) need to be repointed.
- `selectedModelIds` UI — the existing model picker modal (line 1037+) and manual model add modal (line 1316+) cover model discovery; the new `selectedModelIds` is a multi-select overlay on top. Verify whether the existing picker already tracks a multi-select or only the single `chatModel`. Reading lines 1095-1095+ (picker `onSelect`): the picker calls `onSelect(id)` which sets `chatModel` (single). Multi-select UI is a new addition.

## Files Found

| File Path | Description |
|---|---|
| `apps/desktop/src/components/settings/ModelServicesSettings.tsx:172-192` | Store reads — all setters used by the page |
| `apps/desktop/src/components/settings/ModelServicesSettings.tsx:272-282` | `entry` derivation + provider helpers (apiKeyUrl, baseUrl, docs, models, placeholder) |
| `apps/desktop/src/components/settings/ModelServicesSettings.tsx:413-540` | Per-provider form: enable toggle, API key, base URL, Azure fields |
| `apps/desktop/src/components/settings/ModelServicesSettings.tsx:789-806` | Drawer dispatch — `addCustomProvider` / `updateCustomProvider` |
| `apps/desktop/src/components/settings/ModelServicesSettings.tsx:922-1024` | `CustomProviderDrawer` component — fields: displayName, category only |
| `apps/desktop/src/components/settings/ModelServicesSettings.tsx:994` | Buggy `<select>` options (typo `openai-response`, `new-api` not an endpoint key) |
| `apps/desktop/src/components/settings/ModelServicesSettings.tsx:1037-1095` | Model picker modal — single-select via `onSelect(id)` → `setChatModel` |
| `apps/desktop/src/components/settings/ModelServicesSettings.tsx:1316+` | `ManualModelModal` component — fields: id, displayName, group |

## Caveats / Not Found

- `setChatAzureDeploymentId` is not pulled from the store in the reads section (only `setChatAzureApiVersion` is at line 182). If the Azure deployment id field in the panel is editable, that's an existing wiring gap. Verify before refactoring.
- The exact line where `setChatAzureDeploymentId` might be referenced was not searched — only the reads block was inspected (172-192). A grep for `setChatAzureDeploymentId` in the file would confirm.
- The new-schema `selectedModelIds` multi-select UI does not exist in the current page — the picker is single-select only. This is a UI addition, not a retargeting.
- The `addCustomProvider` return id is captured at line 800 but what's done with it (e.g., auto-select as `chatProvider`?) was not traced past line 800. Confirm before refactoring drawer flow.
