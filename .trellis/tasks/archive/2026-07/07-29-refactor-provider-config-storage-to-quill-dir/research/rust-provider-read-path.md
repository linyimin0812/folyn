# Research: Rust Provider Read Path (chat.rs / list_models.rs / fetchModels.ts)

- **Query**: How does Rust read provider api keys / baseUrls / adapter family? Does it call a Tauri command backed by the JS store, read `storage.json` from disk, or something else? Does the refactor need Rust changes or is it JS-only?
- **Scope**: internal
- **Date**: 2026-07-29

## Findings

### Rust NEVER reads provider config from disk

Both Rust commands (`chat_stream`, `list_models`) receive provider / api_key / base_url as **Tauri command parameters** from the frontend. There is no `storage.json` read on the Rust side. `grep storage.json|storageClient|appDataDir` over `apps/desktop/src-tauri/src` returned ZERO matches for storage-related reads.

### chat.rs — `ChatParams` struct

`apps/desktop/src-tauri/src/chat.rs:61-99`:

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatParams {
    pub provider: String,           // catalog id (routes the 20-arm match)
    pub model: String,
    pub api_key: String,
    pub base_url: Option<String>,
    pub prompt: String,
    pub images: Option<Vec<ImageInput>>,
    pub azure_deployment_id: Option<String>,
    pub azure_api_version: Option<String>,
    pub thinking_budget: Option<u32>,
    pub preamble: Option<String>,
}
```

`chat_stream` (chat.rs:217-455) builds the rig client per-call from these params. Provider routing is the 20-arm `match params.provider.as_str()` at chat.rs:269 — native arms for `anthropic | anthropic-compatible | gemini | azure-openai | cohere | huggingface | ollama`, with `_` fallback (openai-compat) covering `openai + openai-compatible + deepseek/groq/moonshot/openrouter/perplexity/together/xai` + any unknown id (i.e. all custom providers today).

### list_models.rs — `ListModelsParams`

`apps/desktop/src-tauri/src/list_models.rs:13-22`:

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListModelsParams {
    pub provider: String,
    pub api_key: String,
    pub base_url: Option<String>,
}
```

Same pattern: per-provider raw HTTP, dispatched by `match params.provider.as_str()` at list_models.rs:31. Unknown ids fall through to `list_openai_shape` (`_` arm).

### Frontend bridges that pass params to Rust

- `apps/desktop/src/services/rigChat.ts:80-95` — `invoke('chat_stream', { params: { sessionId, provider, model, apiKey, baseUrl, azureDeploymentId, azureApiVersion, thinkingBudget, prompt, preamble, images }, onEvent: channel })`. Values come from the caller (the React component reads them out of `useAiConfigStore`).
- `apps/desktop/src/services/modelRegistry/fetchModels.ts:41-48` — `invoke<ModelDto[]>('list_models', { params: { provider, apiKey, baseUrl, azureApiVersion } })`. The SettingsPage passes these explicitly.

The Tauri command registration is at `apps/desktop/src-tauri/src/lib.rs:677-678`:

```rust
chat::chat_stream,
list_models::list_models,
```

### Where the values come from (caller side)

`apps/desktop/src/components/settings/ModelServicesSettings.tsx:462-469` (test button) and similar fetchModels calls pull `chatProvider`, `chatApiKey`, `chatBaseUrl`, `chatAzureDeploymentId`, `chatAzureApiVersion` straight from `useAiConfigStore`. The store is the single source of truth — Rust is stateless.

### Implication for the refactor

**The refactor is JS-only as far as the existing data path is concerned.** Rust already gets `provider / api_key / base_url` per call. The new `customProvider` flag in `settings.json` is a routing signal that the **frontend** must consume before invoking Rust:

- `customProvider: false` → invoke with the catalog id as `provider` (current behavior, routes through rig's built-in arm).
- `customProvider: true` → routes through chat.rs `_` arm (openai-compat) today. The PRD says Rust should resolve adapter family from `customer/providers.json`'s `defaultChatEndpoint` — but that resolution is currently **implicit**: any unknown id falls through to openai-compat. To make `customProvider: true` route to `anthropic` / `gemini` / `ollama` arms based on `defaultChatEndpoint`, Rust would need to learn about `defaultChatEndpoint`.

### Files that need to learn about `customProvider`

If scope is "JS-only, preserve current behavior":
- `apps/desktop/src/store/aiConfigStore.ts` — store the flag, plumb through `chatProvider`-resolution.
- `apps/desktop/src/services/rigChat.ts` — no change (still passes `provider` string).
- `apps/desktop/src/services/modelRegistry/fetchModels.ts` — no change.
- No Rust changes.

If scope is "Rust routes by `defaultChatEndpoint` for custom providers" (PRD AC: "Rust/rig side reads `customProvider` flag and routes correctly"):
- `apps/desktop/src-tauri/src/chat.rs` — `ChatParams` must carry a new field (e.g. `custom_provider: bool` and/or `default_chat_endpoint: Option<String>`); the `match` arms need a new branch for "custom provider, route by endpoint".
- `apps/desktop/src-tauri/src/list_models.rs` — same; `ListModelsParams` would need to know the endpoint/adapter family to pick the right parser (anthropic-shape vs openai-shape vs google-shape vs ollama-shape).
- `apps/desktop/src/services/rigChat.ts:80-95` — pass the new fields.
- `apps/desktop/src/services/modelRegistry/fetchModels.ts:41-48` — pass the new fields.

PRD §Out of Scope explicitly defers Rust-side apiKey/baseUrl reading, but AC line 41 says Rust must read `customProvider` and route correctly. **The two are in tension**: keeping Rust stateless (params-only) means the flag must be passed AS a param — there's no way for Rust to "read" the flag without either (a) adding it to ChatParams/ListModelsParams, or (b) Rust reading `settings.json` from disk.

## Caveats / Not Found

- No existing Tauri command reads `storage.json` or `~/.folyn/providers/settings.json` from Rust. Confirmed by grep over `apps/desktop/src-tauri/src` for `storage|appDataDir|home_dir|providers.json` — only `chat.rs` uses `home_dir()` and only for `~/.folyn/chat-sessions/` (chat history, unrelated).
- The bundled `assets/providers/providers.json` is a TS asset imported via `import providersJson from '@/assets/providers/providers.json'` (`providersCatalog.ts:12`) — it's bundled into the JS frontend, NOT readable by Rust directly. If Rust needs to resolve `defaultChatEndpoint → adapterFamily`, either (a) the frontend passes `adapterFamily` as a param, or (b) Rust gets its own copy of the catalog (e.g. embedded via `include_str!`).
- `chat.rs:24` imports `rig_core::providers::{anthropic, azure, cohere, gemini, huggingface, ollama, openai}` — no `rig_core::providers::OpenAICompat` or generic "by adapter family" rig builder; the per-arm construction is hand-written. Adding a `defaultChatEndpoint`-routed arm means writing more arms.
