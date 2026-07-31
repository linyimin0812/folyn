# Route OpenAI-compat providers via rig native clients to avoid Responses API 404

## Goal

Eliminate the latent `/responses` 404 bug across the 10 OpenAI-compat providers that currently fall into the `_` arm in `apps/desktop/src-tauri/src/chat.rs`. The `_` arm uses rig's generic `openai::Client`, which defaults to the **Responses API** (`/responses`). Any OpenAI-compat provider whose server only exposes Chat Completions will 404. Moonshot was the first reported; the same defect is dormant for the rest. Use rig's built-in provider modules where available, and route the stragglers through the existing `openai-completions` arm (which calls `.completions_api()` → `/chat/completions`).

## What I already know

- Root cause confirmed during the moonshot fix (see commit history): `chat.rs:24` only imports `{anthropic, azure, cohere, gemini, huggingface, moonshot, ollama, openai}`. The `_` arm at `chat.rs:541` lists 11 OpenAI-compat family providers — moonshot now has its own arm, leaving 10 in the `_` arm.
- rig 0.40.0 ships native modules for 8 of the remaining 10: `deepseek`, `groq`, `hyperbolic`, `mira`, `openrouter`, `perplexity`, `together`, `xai` (see `~/.cargo/registry/src/.../rig-core-0.40.0/src/providers/mod.rs:96-120`).
- No rig module for: `galadriel`, `eternalai`. These two need the `openai-completions` arm route (use `.completions_api()` → `/chat/completions`).
- The `openai-completions` arm at `chat.rs:494` already exists for custom providers that pick `openai-chat-completions`. It auto-appends `/v1` if the base URL has no version segment, then calls `openai::Client::builder()...completions_api()`.
- `list_models.rs:43-53` has per-provider `list_openai_shape` arms that already work (hitting `/v1/models` etc.) — not in scope.
- ADR-0002 (`docs/adr/0002-custom-provider-adapter-family-direct.md`) documents the `adapter_family` dispatch design — the `adapter_family` field on `ChatParams` overrides `provider` for custom providers, falls back to `provider.as_str()` for bundled.

## Assumptions (temporary)

- rig's native OpenAI-compat modules (deepseek/groq/hyperbolic/mira/openrouter/perplexity/together/xai) all follow the same `Client::builder().api_key(...).base_url(...).build()` shape as `moonshot` and `anthropic` — confirmed by sampling `deepseek.rs`, `groq.rs` headers.
- Catalog base URLs for these 8 providers will work with rig's native clients (each module may have a default base; user-supplied `base_url` overrides).
- `galadriel` and `eternalai` are still in the codebase as accepted provider ids (referenced in `chat.rs:1058` test loop and `sync-model-catalog.mjs:40-42`) even though they're absent from `providers.json` — users may register them as custom providers.

## Open Questions

1. ~~Scope of the sweep~~ — **Decided: Approach C**. 8 rig-native providers get dedicated arms; `galadriel` + `eternalai` reuse the `openai-completions` arm.
2. ~~`openai-compatible` escape hatch~~ — **Decided: B**. Move to `openai-completions` arm. Same-disease-same-cure: it points at OpenAI-compat gateways that only support Chat Completions. Inherits `.with_system_instructions_as_messages()` + `.completions_api()` from that arm.
3. ~~`with_system_instructions_as_messages()` on native arms~~ — **Resolved by investigation**. The method is defined only on `openai::Client` (`providers/openai/client.rs:185`), not on rig-native OpenAI-compat client types (`moonshot::Client`, `deepseek::Client`, etc.). The 8 new native arms **cannot** call it. They inherit rig's default system-instruction placement via the generic `client::Client` machinery. Risk: if a native compat server silently drops top-level `instructions`, the preamble vanishes — same latent risk as the current moonshot arm. Mitigation: smoke-test preamble delivery for at least one native rerouted provider; if broken, fall back to routing that provider through `openai-completions` instead.

## Requirements

- No OpenAI-compat bundled provider in the `chat.rs` `_` arm may hit `/responses` by default. Providers without a Responses-API endpoint must route to `/chat/completions`.
- `chat_stream` must continue to work for real OpenAI (`"openai"` provider id) via the Responses API — the `_` arm covers only `"openai"` after the change.
- Each of the 8 rig-native providers (deepseek/groq/hyperbolic/mira/openrouter/perplexity/together/xai) gets a dedicated match arm using its rig-native `Client`, identical pattern to the existing `"moonshot"` arm.
- `galadriel`, `eternalai`, and `openai-compatible` route through the `openai-completions` arm (they share the match arm with the existing custom-provider case).
- `cargo check`, `cargo test`, `pnpm build`, and existing chat tests must pass.
- No frontend behavior changes — the `adapterFamily` contract from `RigChatParams` is unchanged.

## Acceptance Criteria

- [ ] `_` arm in `chat.rs` covers only `"openai"` after the change (plus truly unknown ids as a fallback).
- [ ] Each of the 8 rig-native providers has a dedicated match arm using its rig-native `Client`.
- [ ] `galadriel`, `eternalai`, and `openai-compatible` are routed via the `openai-completions` arm (either added to its match list or via a shared arm).
- [ ] `cargo check` passes.
- [ ] `cargo test` passes (existing `thinking_params_*` tests at `chat.rs:1058` updated if the provider list semantics change).
- [ ] Manual smoke: test-chat connection for at least one rerouted native provider (e.g. deepseek or groq) succeeds — no `/responses` 404.
- [ ] Manual smoke: preamble visible in a reply from at least one rerouted native provider (validates system-instruction placement doesn't silently drop).

## Definition of Done

- Tests added/updated where appropriate (the `thinking_params` test at `chat.rs:1058` may need its provider list updated to reflect the new routing).
- Lint / typecheck / CI green.
- Comments in `chat.rs` updated — the `_` arm provider list and counts need to match the new reality.
- No regression for real OpenAI (Responses API path) — verified by smoke test or reasoning.

## Out of Scope (explicit)

- Embedding / transcription / image-generation endpoints — only chat completion routing.
- Refactoring `list_models.rs` — it already works per-provider; leave alone.
- Migrating `defaultChatEndpoint` from `providers.json` into Rust routing (the larger "Rust reads catalog" idea) — separate effort; this task uses hardcoded match arms, consistent with the existing anthropic/gemini/ollama/moonshot pattern.
- Any new provider not in the original 10.

## Technical Notes

- Files touched: `apps/desktop/src-tauri/src/chat.rs` (primary). Possibly `chat.rs:1058` test loop if provider list semantics change.
- rig module inventory (`providers/mod.rs:96-120`): `anthropic, azure, chatgpt, cohere, copilot, deepseek, gemini, groq, huggingface, hyperbolic, llamafile, minimax, mira, mistral, moonshot, ollama, openai, openrouter, perplexity, together, voyageai, xai, xiaomimimo, zai`.
- Pattern reference (moonshot arm at `chat.rs` post-fix): `Client::builder().api_key(...).base_url(url?).build()?.agent(model).preamble(...)` wrapped in `with_thinking(...).build()` → `stream_chat(...)` → `drain_loop(...)`.
- `openai-completions` arm auto-appends `/v1` to base URLs lacking a version segment — relevant for `galadriel`/`eternalai` if their catalog default bases are bare hosts.
