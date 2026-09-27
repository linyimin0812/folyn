//! Phase 2 of `chat_stream`: build the rig client/agent for the resolved
//! adapter family and stream one turn. Pure move from `chat.rs` — no arm
//! logic, routing, or error handling changed.

use rig_core::client::Nothing;
use rig_core::message::Message;
use rig_core::prelude::*;
use rig_core::providers::{
    anthropic, azure, cohere, deepseek, gemini, groq, huggingface, hyperbolic, mira, moonshot,
    ollama, openai, openrouter, perplexity, together, xai,
};
use tauri::ipc::Channel;

use crate::errors::AppError;

use super::drain::drain_loop;
use super::params::{
    ensure_v1_segment, resolve_adapter_family, with_thinking, ChatParams, PREAMBLE,
};
use super::{AssistantImage, ChatChunk};

/// Borrows `params` (Phase 3 still needs `params.prompt` / `images` /
/// `session_id` after this returns), `prompt_msg` (each arm clones it),
/// `history`, and `on_event` — all already consumed by reference inside
/// the arms. The one semantic-equivalent rewrite: arms that moved
/// `params.api_key` (owned `String`) now `params.api_key.clone()` because
/// `params` is borrowed for the call's lifetime.
pub(super) async fn run_provider_stream(
    params: &ChatParams,
    prompt_msg: &Message,
    history: &[Message],
    on_event: &Channel<ChatChunk>,
) -> Result<(String, Vec<AssistantImage>), AppError> {
    // ponytail: rebuild the client per turn. A pooled client keyed by
    // (provider, key, base_url) in a managed `AppState` would keep reqwest's
    // connection pool warm across turns, but settings can change between calls
    // and cache invalidation adds more complexity than the saved TLS handshake
    // is worth at chat cadence. Add the cache if latency shows up.
    // ponytail: drain_loop is duplicated across the 7 native arms (anthropic,
    // anthropic-compatible, gemini, azure-openai, cohere, huggingface, ollama)
    // + the openai-compat fallback. The concrete stream type
    // (`StreamingResult<OpenAIResp>` vs `<AnthropicResp>` vs ...) can't share
    // a variable, and the original plan was to box into
    // `Pin<Box<dyn Stream<Item = Result<Option<String>, String>> + Send>>`
    // once a 3rd provider landed. We didn't — the box would flatten
    // MultiTurnStreamItem variants to a single `Option<String>`, losing the
    // Delta vs Thinking distinction that drain_loop relies on. Keeping the
    // ~5-line duplication per arm is cheaper than a boxed enum + 7 mapping
    // closures. Re-evaluate if provider count doubles.
    // PR2e/Phase 3: collapse the enum indirection — custom providers
    // declare their adapter family directly (same value space as bundled
    // ids). `adapter_family` overrides `provider` for custom; absent →
    // fall back to `provider.as_str()` (bundled providers). Custom and
    // bundled now route through the same line.
    let resolved: &str = resolve_adapter_family(params);
    let (full, assistant_images): (String, Vec<AssistantImage>) = match resolved {
        "anthropic" | "anthropic-compatible" => {
            let mut b = anthropic::Client::builder().api_key(params.api_key.clone());
            if let Some(url) = &params.base_url {
                b = b.base_url(url.clone());
            }
            // ponytail: Anthropic requires max_tokens (no default); 4096 fits most chat turns. Bump to 8192 if a user hits truncation on long responses.
            let agent = with_thinking(
                b.build()
                    .map_err(|e| e.to_string())?
                    .agent(params.model.as_str())
                    .preamble(params.preamble.as_deref().unwrap_or(PREAMBLE))
                    .max_tokens(4096),
                "anthropic",
                params.thinking_budget,
            ).build();
            // `.await` yields the stream directly (no Result wrapper); stream
            // setup/connection errors surface as `Err` items below.
            let mut stream = agent.stream_chat(prompt_msg.clone(), history).await;
            drain_loop(&mut stream, on_event).await?
        }
        "gemini" => {
            let mut b = gemini::Client::builder().api_key(params.api_key.clone());
            if let Some(url) = &params.base_url {
                b = b.base_url(url.clone());
            }
            let agent = with_thinking(
                b.build()
                    .map_err(|e| e.to_string())?
                    .agent(params.model.as_str())
                    .preamble(params.preamble.as_deref().unwrap_or(PREAMBLE)),
                "gemini",
                params.thinking_budget,
            ).build();
            let mut stream = agent.stream_chat(prompt_msg.clone(), history).await;
            drain_loop(&mut stream, on_event).await?
        }
        "moonshot" => {
            // rig's built-in moonshot client — knows the Chat Completions
            // contract natively (vs. the `_` arm's `openai::Client` which
            // defaults to the Responses API and 404s on moonshot's server).
            // Default base is rig's `https://api.moonshot.ai/v1`; the China
            // endpoint `https://api.moonshot.cn/v1` is set via user-supplied
            // base_url (catalog default is the China host without /v1, so
            // `ensure_v1_segment` adds it).
            let mut b = moonshot::Client::builder().api_key(params.api_key.clone());
            if let Some(url) = &params.base_url {
                b = b.base_url(ensure_v1_segment(url));
            }
            let agent = with_thinking(
                b.build()
                    .map_err(|e| e.to_string())?
                    .agent(params.model.as_str())
                    .preamble(params.preamble.as_deref().unwrap_or(PREAMBLE)),
                "moonshot",
                params.thinking_budget,
            ).build();
            let mut stream = agent.stream_chat(prompt_msg.clone(), history).await;
            drain_loop(&mut stream, on_event).await?
        }
        // 8 rig-native OpenAI-compat providers — same pattern as `moonshot`
        // above. Each rig module knows its provider's Chat Completions
        // contract natively; routing through them avoids the `_` arm's
        // `openai::Client` default (Responses API → `/responses` 404 on
        // servers that only expose `/chat/completions`). galadriel /
        // eternalai have no rig module — they route through the
        // `openai-completions` arm below.
        "deepseek" => {
            let mut b = deepseek::Client::builder().api_key(params.api_key.clone());
            if let Some(url) = &params.base_url { b = b.base_url(ensure_v1_segment(url)); }
            let agent = with_thinking(
                b.build().map_err(|e| e.to_string())?
                    .agent(params.model.as_str())
                    .preamble(params.preamble.as_deref().unwrap_or(PREAMBLE)),
                "deepseek", params.thinking_budget,
            ).build();
            let mut stream = agent.stream_chat(prompt_msg.clone(), history).await;
            drain_loop(&mut stream, on_event).await?
        }
        "groq" => {
            let mut b = groq::Client::builder().api_key(params.api_key.clone());
            if let Some(url) = &params.base_url { b = b.base_url(ensure_v1_segment(url)); }
            let agent = with_thinking(
                b.build().map_err(|e| e.to_string())?
                    .agent(params.model.as_str())
                    .preamble(params.preamble.as_deref().unwrap_or(PREAMBLE)),
                "groq", params.thinking_budget,
            ).build();
            let mut stream = agent.stream_chat(prompt_msg.clone(), history).await;
            drain_loop(&mut stream, on_event).await?
        }
        "hyperbolic" => {
            let mut b = hyperbolic::Client::builder().api_key(params.api_key.clone());
            if let Some(url) = &params.base_url { b = b.base_url(ensure_v1_segment(url)); }
            let agent = with_thinking(
                b.build().map_err(|e| e.to_string())?
                    .agent(params.model.as_str())
                    .preamble(params.preamble.as_deref().unwrap_or(PREAMBLE)),
                "hyperbolic", params.thinking_budget,
            ).build();
            let mut stream = agent.stream_chat(prompt_msg.clone(), history).await;
            drain_loop(&mut stream, on_event).await?
        }
        "mira" => {
            let mut b = mira::Client::builder().api_key(params.api_key.clone());
            if let Some(url) = &params.base_url { b = b.base_url(ensure_v1_segment(url)); }
            let agent = with_thinking(
                b.build().map_err(|e| e.to_string())?
                    .agent(params.model.as_str())
                    .preamble(params.preamble.as_deref().unwrap_or(PREAMBLE)),
                "mira", params.thinking_budget,
            ).build();
            let mut stream = agent.stream_chat(prompt_msg.clone(), history).await;
            drain_loop(&mut stream, on_event).await?
        }
        "openrouter" => {
            let mut b = openrouter::Client::builder().api_key(params.api_key.clone());
            if let Some(url) = &params.base_url { b = b.base_url(ensure_v1_segment(url)); }
            let agent = with_thinking(
                b.build().map_err(|e| e.to_string())?
                    .agent(params.model.as_str())
                    .preamble(params.preamble.as_deref().unwrap_or(PREAMBLE)),
                "openrouter", params.thinking_budget,
            ).build();
            let mut stream = agent.stream_chat(prompt_msg.clone(), history).await;
            drain_loop(&mut stream, on_event).await?
        }
        "perplexity" => {
            let mut b = perplexity::Client::builder().api_key(params.api_key.clone());
            if let Some(url) = &params.base_url { b = b.base_url(ensure_v1_segment(url)); }
            let agent = with_thinking(
                b.build().map_err(|e| e.to_string())?
                    .agent(params.model.as_str())
                    .preamble(params.preamble.as_deref().unwrap_or(PREAMBLE)),
                "perplexity", params.thinking_budget,
            ).build();
            let mut stream = agent.stream_chat(prompt_msg.clone(), history).await;
            drain_loop(&mut stream, on_event).await?
        }
        "together" => {
            let mut b = together::Client::builder().api_key(params.api_key.clone());
            if let Some(url) = &params.base_url { b = b.base_url(ensure_v1_segment(url)); }
            let agent = with_thinking(
                b.build().map_err(|e| e.to_string())?
                    .agent(params.model.as_str())
                    .preamble(params.preamble.as_deref().unwrap_or(PREAMBLE)),
                "together", params.thinking_budget,
            ).build();
            let mut stream = agent.stream_chat(prompt_msg.clone(), history).await;
            drain_loop(&mut stream, on_event).await?
        }
        "xai" => {
            let mut b = xai::Client::builder().api_key(params.api_key.clone());
            if let Some(url) = &params.base_url { b = b.base_url(ensure_v1_segment(url)); }
            let agent = with_thinking(
                b.build().map_err(|e| e.to_string())?
                    .agent(params.model.as_str())
                    .preamble(params.preamble.as_deref().unwrap_or(PREAMBLE)),
                "xai", params.thinking_budget,
            ).build();
            let mut stream = agent.stream_chat(prompt_msg.clone(), history).await;
            drain_loop(&mut stream, on_event).await?
        }
        "azure-openai" => {
            // Azure uses deployment_id in the URL, not the model name. rig's
            // azure::Client::agent(deployment_id) treats the string as the
            // deployment id. Fall back to `model` if the user didn't fill the
            // dedicated deployment_id field.
            let endpoint = params
                .base_url
                .clone()
                .ok_or_else(|| "base_url (Azure endpoint) required".to_string())?;
            let api_version = params
                .azure_api_version
                .clone()
                .ok_or_else(|| "azure_api_version required".to_string())?;
            let deployment_id = params
                .azure_deployment_id
                .clone()
                .unwrap_or_else(|| params.model.clone());
            let client = azure::Client::builder()
                .api_key(params.api_key.clone())
                .azure_endpoint(endpoint)
                .api_version(&api_version)
                .build()
                .map_err(|e| e.to_string())?;
            let agent = with_thinking(
                client
                    .agent(deployment_id.as_str())
                    .preamble(params.preamble.as_deref().unwrap_or(PREAMBLE)),
                "azure-openai",
                params.thinking_budget,
            ).build();
            let mut stream = agent.stream_chat(prompt_msg.clone(), history).await;
            drain_loop(&mut stream, on_event).await?
        }
        "cohere" => {
            let mut b = cohere::Client::builder().api_key(params.api_key.clone());
            if let Some(url) = &params.base_url {
                b = b.base_url(url.clone());
            }
            // ponytail: cohere doesn't support reasoning — with_thinking is a
            // no-op (thinking_params returns None). Kept in the chain for
            // symmetry + future-compat if cohere adds reasoning later.
            let agent = with_thinking(
                b.build()
                    .map_err(|e| e.to_string())?
                    .agent(params.model.as_str())
                    .preamble(params.preamble.as_deref().unwrap_or(PREAMBLE)),
                "cohere",
                params.thinking_budget,
            ).build();
            let mut stream = agent.stream_chat(prompt_msg.clone(), history).await;
            drain_loop(&mut stream, on_event).await?
        }
        "huggingface" => {
            let mut b = huggingface::Client::builder().api_key(params.api_key.clone());
            if let Some(url) = &params.base_url {
                b = b.base_url(url.clone());
            }
            let agent = with_thinking(
                b.build()
                    .map_err(|e| e.to_string())?
                    .agent(params.model.as_str())
                    .preamble(params.preamble.as_deref().unwrap_or(PREAMBLE)),
                "huggingface",
                params.thinking_budget,
            ).build();
            let mut stream = agent.stream_chat(prompt_msg.clone(), history).await;
            drain_loop(&mut stream, on_event).await?
        }
        "ollama" => {
            let base = params
                .base_url
                .clone()
                .unwrap_or_else(|| "http://localhost:11434/v1".to_string());
            // ponytail: ollama has no api_key — `Nothing` is rig's marker for
            // "no auth". Skipping the empty-key guard above lets this arm run.
            let client = ollama::Client::builder()
                .api_key(Nothing)
                .base_url(base)
                .build()
                .map_err(|e| e.to_string())?;
            let agent = with_thinking(
                client
                    .agent(params.model.as_str())
                    .preamble(params.preamble.as_deref().unwrap_or(PREAMBLE)),
                "ollama",
                params.thinking_budget,
            ).build();
            let mut stream = agent.stream_chat(prompt_msg.clone(), history).await;
            drain_loop(&mut stream, on_event).await?
        }
        "openai-completions" | "galadriel" | "eternalai" | "openai-compatible" => {
            // Custom provider picked `openai-chat-completions`, or a bundled
            // OpenAI-compat id with no rig-native module (galadriel /
            // eternalai), or the `openai-compatible` escape hatch — use
            // rig's Completions API client so requests hit
            // `/v1/chat/completions` instead of the default `/v1/responses`.
            // Required for OpenAI-compat gateways (one-api / new-api /
            // fastgpt / etc.) that don't expose the Responses API. Same
            // agent/stream contract as the `_` arm below — split to avoid a
            // type clash between `Client` and `CompletionsClient` in the
            // same variable.
            // the Responses API. Same agent/stream contract as the `_` arm
            // below — split to avoid a type clash between `Client` and
            // `CompletionsClient` in the same variable.
            let base_raw = params
                .base_url
                .clone()
                .unwrap_or_else(|| "https://api.openai.com/v1".to_string());
            let base = ensure_v1_segment(&base_raw);
            let client = openai::Client::builder()
                .api_key(params.api_key.clone())
                .base_url(base)
                .build()
                .map_err(|e| e.to_string())?
                .with_system_instructions_as_messages()
                .completions_api();
            let agent = with_thinking(
                client
                    .agent(params.model.as_str())
                    .preamble(params.preamble.as_deref().unwrap_or(PREAMBLE)),
                params.provider.as_str(),
                params.thinking_budget,
            ).build();
            let mut stream = agent.stream_chat(prompt_msg.clone(), history).await;
            drain_loop(&mut stream, on_event).await?
        }
        _ => {
            // Only real `"openai"` lands here after the reroute — every
            // OpenAI-compat family member now has a dedicated arm above
            // (moonshot/deepseek/groq/hyperbolic/mira/openrouter/perplexity/
            // together/xai) or routes through `openai-completions`
            // (galadriel/eternalai/openai-compatible). Unknown ids also
            // fall through here as a last-resort OpenAI-shape attempt.
            // `with_system_instructions_as_messages()` is harmless for real
            // OpenAI and keeps preambles working if an unknown id happens
            // to be a compat gateway.
            let base = ensure_v1_segment(
                params.base_url.as_deref().unwrap_or("https://api.openai.com/v1"),
            );
            let client = openai::Client::builder()
                .api_key(params.api_key.clone())
                .base_url(base)
                .build()
                .map_err(|e| e.to_string())?
                .with_system_instructions_as_messages();
            // T07: pass the actual provider id so thinking_params dispatches
            // correctly. Only `"openai"` reaches this arm after the reroute
            // (returns reasoning_effort). Unknown ids also fall through here
            // and return None — silently skipped.
            let agent = with_thinking(
                client
                    .agent(params.model.as_str())
                    .preamble(params.preamble.as_deref().unwrap_or(PREAMBLE)),
                params.provider.as_str(),
                params.thinking_budget,
            ).build();
            let mut stream = agent.stream_chat(prompt_msg.clone(), history).await;
            drain_loop(&mut stream, on_event).await?
        }
    };
    Ok((full, assistant_images))
}
