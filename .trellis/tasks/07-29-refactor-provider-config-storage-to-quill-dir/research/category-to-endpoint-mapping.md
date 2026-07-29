# Research: CustomProviderType → defaultChatEndpoint Mapping

- **Query**: In `apps/desktop/src/services/providers/catalog.ts`, what is `CustomProviderType` / `category`? Map each value to `defaultChatEndpoint` keys in `assets/providers/providers.json`. 1:1 or lookup table?
- **Scope**: internal
- **Date**: 2026-07-29

## Findings

### CustomProviderType definition

`apps/desktop/src/services/providers/catalog.ts:42-49`

```ts
export type CustomProviderType =
  | 'openai'
  | 'openai-responses'
  | 'gemini'
  | 'anthropic'
  | 'azure-openai'
  | 'new-api'
  | 'ollama';
```

It's a *label/preset* enum for the add-provider drawer, **NOT** a wire-format switch. `catalog.ts:36-40` comment: "Drives the label shown in the add-provider drawer; backend routing still falls through chat.rs `_` arm (OpenAI-compat) regardless of this value." The `CustomProvider` interface (`catalog.ts:56-63`) carries `category: CustomProviderType`.

### defaultChatEndpoint keys in bundled catalog

`apps/desktop/src/assets/providers/providers.json` — endpoint keys actually present across all `endpointConfigs`:

- `anthropic-messages`
- `google-generate-content`
- `ollama`
- `ollama-chat`
- `openai-chat-completions`
- `openai-image-generation`
- `openai-responses`

Per-provider `defaultChatEndpoint` values:

| Provider        | defaultChatEndpoint        |
| --------------- | -------------------------- |
| anthropic       | `anthropic-messages`       |
| azure           | `openai-chat-completions`  |
| cohere          | `anthropic-messages`       |
| deepseek        | `openai-chat-completions`  |
| google          | `google-generate-content`  |
| groq            | `openai-chat-completions`  |
| huggingface     | `openai-responses`         |
| moonshotai      | `openai-chat-completions`  |
| ollama          | `ollama`                   |
| openai          | `openai-responses`         |
| openrouter      | `openai-chat-completions`  |
| perplexity      | `openai-chat-completions`  |
| togetherai      | `openai-chat-completions`  |
| xai             | `openai-responses`          |
| new-api         | `openai-chat-completions`  |

`apps/desktop/src/services/providers/providersCatalog.ts:14-22` also has an `ENDPOINT_PATH` map that lists `cohere` and `new-api` as keys — but these are **path-only** convenience entries, NOT endpoint keys present in `providers.json`'s `endpointConfigs`. They should not be treated as endpoint enum values.

### Existing UI mismatch (bug)

`apps/desktop/src/components/settings/ModelServicesSettings.tsx:994` renders the `<select>` options as:

```tsx
{(['openai-chat-completions', 'openai-response', 'anthropic-messages', 'new-api', 'ollama'] as const).map(...)}
```

Note: `openai-response` (singular, typo), `new-api` (not an endpoint key), and the value is cast to `CustomProviderType` which actually expects `'openai' | 'openai-responses' | ...`. The current code is already type-incorrect — options don't match `CustomProviderType`. This makes migration mapping ambiguous.

### Mapping CustomProviderType → defaultChatEndpoint

**NOT 1:1.** A small lookup table is required. Recommended mapping (covers all 7 `CustomProviderType` values; aligns with the bundled-catalog endpoint keys):

| CustomProviderType | defaultChatEndpoint (target)        |
| ----------------- | ----------------------------------- |
| `openai`          | `openai-chat-completions`           |
| `openai-responses`| `openai-responses`                  |
| `gemini`          | `google-generate-content`           |
| `anthropic`       | `anthropic-messages`                |
| `azure-openai`    | `openai-chat-completions`           |
| `new-api`         | `openai-chat-completions`           |
| `ollama`          | `ollama`                            |

`new-api` does NOT map to an endpoint key called `new-api` (the bundled `new-api` provider uses `openai-chat-completions` as its `defaultChatEndpoint`; `newapi` is an `adapterFamily`, not an endpoint key).

### Reverse mapping (for populating the drawer's select)

The drawer should be populated from the **endpoint keys** list above (the 7 actual endpoint keys in bundled catalog), NOT from `CustomProviderType`. The new schema drops `CustomProviderType` entirely — `defaultChatEndpoint` becomes the select's direct value.

## Caveats / Not Found

- The existing drawer select is already buggy (typo `openai-response`, `new-api` as endpoint key). Migration of legacy entries saved with these values must defensively coerce unknown strings to `openai-chat-completions` (the chat.rs `_` fallback arm).
- `cohere` and `new-api` appear as keys in `ENDPOINT_PATH` but not in any provider's `endpointConfigs`. Don't add them to the endpoint select.
