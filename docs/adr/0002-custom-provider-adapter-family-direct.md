# Custom providers declare `adapterFamily` directly, no endpoint enum

Custom provider definitions carry an `adapterFamily: string` field whose value is a bundled adapter family id (`"anthropic"` / `"openai-completions"` / `"ollama"` / `"gemini"` / `"openai"`). The previous `defaultChatEndpoint: DefaultChatEndpoint` enum — with values like `"anthropic-messages"` / `"openai-chat-completions"` — was deleted. `chat.rs`'s `if params.custom_provider { match default_chat_endpoint ... } else { provider }` block collapsed to `resolve_adapter_family(&params).unwrap_or(params.provider.as_str())`; custom and bundled now route through the same line. The same collapse was applied to `list_models.rs` (root-cause fix — same 1:1 indirection lived there).

## Considered Options

- **(a) Custom providers declare `adapterFamily` directly (accepted)** — value is the bundled id; one routing line on the Rust side; the enum, `KNOWN_ENDPOINTS`, `LEGACY_CATEGORY_TO_ENDPOINT`, and `coerceEndpoint` are deleted as pure indirection. `providersCatalog.ts`'s `ProviderConfig.defaultChatEndpoint` (bundled providers' data-file concept, mapping endpoint keys to `endpointConfigs` entries) is left alone — it's a different abstraction.
- **(b) Keep the enum but codegen the TS type from Rust's match arms** (rejected) — would prevent drift between the enum and the Rust match, at the cost of a codegen step in the build. Drift wasn't the actual problem; the 1:1 mapping itself was the leak. Codegen addresses a symptom, not the cause.
- **(c) Leave the enum as-is** (rejected) — the 1:1 mapping from `"anthropic-messages"` → `"anthropic"` (and so on for 5 values) was a pure rename in a `match` block. Two namespaces for one concept. The Ponytail rule "deletion over addition" applied: the enum was the leak.

## Consequences

- **Type system narrows honestly.** `ChatProvider` widened from a 20-id literal union to `string` in the same phase, so `entry.id as ChatProvider` casts in `PairSelector` and `firstEnabledPair` disappeared. Custom provider ids persist through `aiConfigStore.hydrate` even before `customerProviders` loads (previously the `isChatProvider` guard rejected them on every boot).
- **`custom_provider` Rust field is dead.** After the collapse, routing no longer branches on the `custom_provider` flag — `adapter_family.unwrap_or(provider)` covers both paths. The field was dropped from `ChatParams` (Tauri's default serde ignores the frontend's `customProvider` flag). The TS-side `ResolvedPairConfig.customProvider` is retained because callers use it for the `cfg.customProvider ? { customProvider: true, adapterFamily: ... } : {}` conditional spread.
- **`list_models.rs` had the same indirection.** The fix was applied to both Rust files together — leaving `list_models.rs` on the old enum would have silently misrouted every custom provider to the `_` (openai-shape) arm after the value space changed.
- **Migration is a one-time re-enter, not code.** Pre-launch, no users: persisted custom-provider defs that carried the legacy `defaultChatEndpoint: "anthropic-messages"` field have that field silently dropped by hydrate's unknown-key guard, and `adapterFamily` is seeded with a defensive default of `"openai-completions"` (the most common OpenAI-compat gateway case). Users with a non-OpenAI-compat custom provider re-enter the family once from the Custom Provider drawer. This is recorded so a future explorer doesn't try to add a migration pass.
- **`ModelServicesSettings` path preview for custom providers** was initially dropped in Phase 3 (adapterFamily is a bundled id, not an endpoint key, so the existing `getEndpointPath` returned null). Restored soon after by deriving the path from `adapterFamily` via a small `ADAPTER_FAMILY_PATH` map in `ModelServicesSettings.tsx` — keys mirror rig's `completion_path` emits. The map is separate from `providersCatalog`'s `ENDPOINT_PATH` (which is keyed by endpoint name, a different abstraction); they don't share a lookup.
- **`providersCatalog.ts` retains its own `ProviderConfig.defaultChatEndpoint` field.** That concept — "which endpoint does this bundled provider use by default, as a key into `endpointConfigs`" — is distinct from the custom-provider `adapterFamily`. Same name was a coincidence; the rename diverges them on purpose. Don't try to "unify" them — they answer different questions.

## Status

Accepted.
