# 07 — Per-provider reasoning application

**What to build:** Apply `ChatParams.thinking_budget` to the rig agent in each native chat arm of `chat.rs`. T05 plumbed the field end-to-end(TS → invoke → Rust)but marked it `#[allow(dead_code)]` because rig 0.40's `AgentBuilder` has no uniform `.reasoning()` method — each provider exposes reasoning through a different API. T07 closes that gap by adding per-arm provider-specific reasoning logic.

**Provider-specific reasoning APIs** (research rig 0.40 source):

| Provider | Reasoning API | Field/Param | Notes |
|---|---|---|---|
| **Anthropic** | Extended thinking via `thinking` field on request | `{ type: "enabled", budget_tokens: u32 }` | rig's `anthropic::Client` may expose this via a custom request field or an agent-builder extension; check `rig-core-0.40.0/src/providers/anthropic/` |
| **OpenAI** | `reasoning_effort` parameter | `"low" \| "medium" \| "high"` | Map `thinking_budget: u32` → effort level (e.g. <2000 → "low", <8000 → "medium", else "high"). OpenAI doesn't accept a token budget directly. |
| **xAI** | `reasoning` field on request | bool or `{ include`: true } | Toggle on/off only — no budget. Apply as enabled when thinking_budget > 0. |
| **Gemini** | `thinkingBudget` on `generationConfig` | `u32` | Direct token budget. |
| **Azure OpenAI** | Same as OpenAI | `reasoning_effort` | Mirror OpenAI's mapping. |
| **Cohere / HuggingFace / Ollama** | Not supported | — | Silently skip(per the ticket's "non-reasoning silently ignores" rule). |
| **OpenAI-compat family(11 providers)** | Provider-specific | — | Most don't support reasoning; skip. OpenRouter passes through to underlying model — could forward `reasoning_effort` for OpenAI-compatible models, but minimum-viable is to skip. |
| **Anthropic-compatible / OpenAI-compatible escape hatches** | Same as their parent | — | Mirror the parent provider's reasoning logic. |

Implementation approach: each match arm in `chat.rs` checks `params.thinking_budget` and, if the model is reasoning-capable(rust side doesn't have the catalog — derive from a small inline check or trust the frontend to only send when `isReasoningModel(selectedModel)` is true),applies the provider-specific parameter to the rig agent.

The cleanest rig pattern: check if the provider's `AgentBuilder` exposes a reasoning-related method (`.additional_request_fields()` / `.thinking()` / `.reasoning_effort()` / etc.). If yes, use it. If no, post-process the `CompletionRequest` before sending — rig's `stream_chat` accepts a request override in some flavors.

**Blocked by:** None — can start immediately. Independent of T06(per-provider config). T05's plumbing is already in place; T07 just adds the application logic.

**Status:** ready-for-agent

- [ ] Research rig 0.40's per-provider reasoning API: `rg "thinking|reasoning_effort|reasoning\b|thinkingBudget" /Users/yiminlin/.cargo/registry/src/index.crates.io-*/rig-core-0.40.0/src/providers/` — find the exact method/field for each of the 5 natives that support reasoning(anthropic, openai, xai, gemini, azure-openai).
- [ ] `chat.rs` Anthropic arm: if `thinking_budget.is_some()`, apply extended thinking via the rig API (likely `.thinking(Thinking::Enabled { budget_tokens: n })` or per-request field override).
- [ ] `chat.rs` OpenAI arm: map `thinking_budget` → `reasoning_effort`(<2000 "low", <8000 "medium", else "high"), apply via rig API or request field override.
- [ ] `chat.rs` Azure arm: same as OpenAI (Azure uses same `reasoning_effort` shape).
- [ ] `chat.rs` xAI arm: if `thinking_budget > 0`, enable `reasoning` field (no budget concept — just on/off).
- [ ] `chat.rs` Gemini arm: apply `thinkingBudget` directly to the generation config.
- [ ] `chat.rs` Cohere / HuggingFace / Ollama arms: silently skip(`thinking_budget` accepted but unused — already the behavior).
- [ ] `chat.rs` OpenAI-compat fallback arm: skip(11 family + 2 compat escape hatches; reasoning_effort isn't reliably supported across compatible servers).
- [ ] Remove `#[allow(dead_code)]` from `ChatParams.thinking_budget` — the field is now actually read.
- [ ] Frontend plumbing: pass `chatThinkingBudget` through `runRigChat` callers (BubbleTemplateAIChatModal `readChatConfig`, PetChat, AiPanel, useVoiceInput, plugin-host aiCapability/rpcBridge, petChatService). All these callers read `chatThinkingBudget` from `aiConfigStore.getState()` and forward it to `RigChatParams.thinkingBudget`. The T05-plumbed `RigChatParams.thinkingBudget` field already exists; this step wires it through every caller.
- [ ] Tests: per-arm reasoning application verified via fixture-based Rust tests. For each provider, mock a reasoning-capable model and verify the request payload includes the reasoning field with the right value. Use rig's test_utils if it has a mock client, or `mockito` (acceptable new dep here — reasoning application is complex enough to warrant HTTP-level verification). Alternative: extract per-provider reasoning-parameter-builder pure functions and unit-test those without HTTP.
- [ ] End-to-end: pick Claude Sonnet(reasoning)in SettingsPage → set thinking budget 4096 → chat → verify reasoning trace appears with the configured budget. Switch to GPT-4o(non-reasoning)→ thinking budget hidden, not applied(no reasoning trace in response).
- [ ] `chat.rs` ponytail comment updated: remove the "ACCEPTED but NOT YET APPLIED" note; replace with a brief per-provider reasoning API summary table.
