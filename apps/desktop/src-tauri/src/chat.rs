//! chat mode: LLM via `rig-core` (rig 0.40). ask/agent modes still shell out to
//! the `claude` CLI — this is the ONLY AI path that does not touch that binary.
//!
//! `chat_stream` is one Tauri command: it streams assistant text deltas to the
//! frontend over a `tauri::ipc::Channel<ChatChunk>`, and persists multi-turn
//! history to `~/.quill/chat-sessions/<session_id>.json` so a session survives
//! app restarts. Provider/key/model/baseUrl come from the frontend settings
//! store (resolved per call, not env) — see PR2.

use std::fs;

use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

use rig_core::agent::MultiTurnStreamItem;
use rig_core::client::CompletionClient;
use rig_core::completion::message::{ImageMediaType, MimeType, UserContent};
use rig_core::message::{Message, ReasoningContent, Text};
use rig_core::prelude::*;
use rig_core::agent::AgentBuilder;
use rig_core::providers::{anthropic, azure, cohere, gemini, huggingface, ollama, openai};
use rig_core::client::Nothing;
use rig_core::streaming::StreamedAssistantContent;

use crate::errors::AppError;

const PREAMBLE: &str = "You are Quill's writing assistant. Reply concisely and helpfully.";

/// One chunk pushed down the frontend `Channel`. Tagged so the JS side can
/// `switch (msg.type)`; `rename_all = "camelCase"` matches the TS shape.
#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChatChunk {
    Delta {
        text: String,
    },
    /// Reasoning / thinking text from Claude (Reasoning block) or
    /// OpenAI reasoning models (ReasoningDelta). Ephemeral — NOT persisted
    /// to history (see `drain_loop`).
    Thinking {
        text: String,
    },
    Done,
    Error {
        message: String,
    },
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImageInput {
    /// Base64-encoded image bytes (no `data:` URL prefix).
    pub data: String,
    /// MIME type, e.g. `"image/png"`, `"image/jpeg"`.
    pub media_type: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatParams {
    pub session_id: String,
    /// 20 catalog ids. Routes to the correct rig provider client via the
    /// `match params.provider.as_str()` below. Unknown ids fall through to
    /// the openai-compat arm.
    pub provider: String,
    /// Optional preamble override. When `None`, the default `PREAMBLE` is
    /// used. The bubble-template AI Agent passes a feature-specific preamble
    /// (schema + syntax + sanitization + id constraint + size guidance).
    pub preamble: Option<String>,
    pub model: String,
    pub api_key: String,
    pub base_url: Option<String>,
    pub prompt: String,
    /// Optional image content blocks attached to this user turn. Rig's
    /// `UserContent::Image` is provider-agnostic — Anthropic and OpenAI
    /// serialization is handled inside rig. Empty vec / None means text-only.
    pub images: Option<Vec<ImageInput>>,
    /// Azure-only: deployment id (Azure uses this in the URL, not the model
    /// name). Falls back to `model` if absent.
    #[serde(default)]
    pub azure_deployment_id: Option<String>,
    /// Azure-only: e.g. "2024-10-21". Required when provider = azure-openai.
    #[serde(default)]
    pub azure_api_version: Option<String>,
    /// T07: reasoning token budget for reasoning-capable models. Applied
    /// per-provider via `AgentBuilder::additional_params()`:
    ///   Anthropic → `{"thinking": {"type": "enabled", "budget_tokens": N}}`
    ///   OpenAI / Azure → `{"reasoning_effort": "low"|"medium"|"high"}`
    ///     (budget < 2000 → "low", < 8000 → "medium", else "high")
    ///   Gemini → `{"generationConfig": {"thinkingConfig": {"thinkingBudget": N}}}`
    ///   xAI → `{"reasoning": true}` (on/off, no budget concept)
    ///   Cohere / HuggingFace / Ollama / OpenAI-compat family → not applied
    ///     (provider doesn't support reasoning, silently skipped)
    #[serde(default)]
    pub thinking_budget: Option<u32>,
    /// Phase 3: bundled adapter family id (e.g. 'anthropic', 'openai-completions',
    /// 'ollama', 'gemini', 'openai'). Same value space as `provider` for
    /// bundled providers; absent → fall back to `provider.as_str()`.
    /// Replaces the old endpoint-key enum indirection.
    #[serde(default)]
    pub adapter_family: Option<String>,
    /// Per-turn history handling. Absent → `LoadSave` (load before, save
    /// after) — the chat-mode default. `None` skips both: used by
    /// `testChatConnection` so repeated 检测连接 clicks don't accumulate
    /// turns in `__connection_test__.json` and blow the upstream context
    /// window. `LoadOnly` / `SaveOnly` reserved for future callers.
    #[serde(default)]
    pub history_mode: Option<HistoryMode>,
}

/// How `chat_stream` handles the on-disk session history for one call.
/// Serialized as camelCase to match the TS-side string literal union
/// ('loadSave' | 'none' | 'loadOnly' | 'saveOnly').
#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum HistoryMode {
    LoadSave,
    None,
    LoadOnly,
    SaveOnly,
}

/// Pure helper for `chat_stream`: map a `HistoryMode` to (should_load,
/// should_save). Extracted so the gate logic is unit-testable without
/// spinning up a provider. `None` mode (no load, no save) is the
/// connection-test path.
fn history_flags(mode: HistoryMode) -> (bool, bool) {
    match mode {
        HistoryMode::LoadSave => (true, true),
        HistoryMode::None => (false, false),
        HistoryMode::LoadOnly => (true, false),
        HistoryMode::SaveOnly => (false, true),
    }
}

/// Phase 3: pick the rig adapter family id a chat turn routes to.
/// Custom providers declare it directly via `adapter_family`; bundled
/// providers carry it via `provider`. Absent `adapter_family` falls back
/// to `provider.as_str()` (bundled or custom-without-family). Pure — unit
/// tested below.
fn resolve_adapter_family(params: &ChatParams) -> &str {
    params.adapter_family.as_deref().unwrap_or(params.provider.as_str())
}

/// Build the provider-specific additional_params JSON for reasoning. Returns
/// None when the provider doesn't support reasoning (silently skip per the
/// ticket's "non-reasoning silently ignores" rule). Pure function — unit
/// tested below.
fn thinking_params(provider: &str, thinking_budget: Option<u32>) -> Option<serde_json::Value> {
    let budget = thinking_budget?;
    match provider {
        "anthropic" | "anthropic-compatible" => Some(json!({
            "thinking": {"type": "enabled", "budget_tokens": budget}
        })),
        "openai" | "azure-openai" => {
            let effort = if budget < 2000 { "low" } else if budget < 8000 { "medium" } else { "high" };
            Some(json!({"reasoning_effort": effort}))
        },
        "gemini" => Some(json!({
            "generationConfig": {"thinkingConfig": {"thinkingBudget": budget}}
        })),
        "xai" => Some(json!({"reasoning": true})),
        _ => None,
    }
}

/// Apply thinking_params to an agent builder if the provider supports it.
/// Generic over M (completion model) and S (tool state) — the AgentBuilder
/// is the same concrete struct across providers, just with different M.
/// ponytail: helper avoids 5× duplicated `if let Some(p) = ...` blocks.
fn with_thinking<M, S>(
    b: AgentBuilder<M, S>,
    provider: &str,
    budget: Option<u32>,
) -> AgentBuilder<M, S>
where
    M: rig_core::completion::CompletionModel,
{
    match thinking_params(provider, budget) {
        Some(p) => b.additional_params(p),
        None => b,
    }
}

/// One turn on disk. Decoupled from rig's `Message` so the on-disk format
/// stays stable if rig's enums shift between versions. `images` is optional
/// so pre-image session files (just `{role, content}`) deserialize cleanly.
#[derive(Serialize, Deserialize, Clone)]
struct HistoryMsg {
    role: String,
    content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    images: Option<Vec<ImageInput>>,
}

/// Build a rig `Message::User` carrying text + (optional) image content
/// blocks. Used for both the live prompt and history reconstruction so the
/// provider sees the same shape either way. Unknown MIME types are skipped
/// (logged via `ChatChunk::Error` so the user knows).
fn build_user_message(
    prompt: &str,
    images: Option<&[ImageInput]>,
    on_event: &Channel<ChatChunk>,
) -> Message {
    let mut content = rig_core::one_or_many::OneOrMany::one(UserContent::text(prompt));
    if let Some(imgs) = images {
        for img in imgs {
            match ImageMediaType::from_mime_type(&img.media_type) {
                Some(mt) => content.push(UserContent::image_base64(
                    &img.data,
                    Some(mt),
                    None,
                )),
                None => {
                    on_event
                        .send(ChatChunk::Error {
                            message: format!("unsupported image media type: {}", img.media_type),
                        })
                        .ok();
                }
            }
        }
    }
    Message::User { content }
}

/// `~/.quill/chat-sessions/`, created if missing. Mirrors `plugins_dir` in
/// `plugin_commands.rs` — same data-root convention.
fn sessions_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let dir = home.join(".quill").join("chat-sessions");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn session_path(app: &AppHandle, session_id: &str) -> Result<std::path::PathBuf, String> {
    // ponytail: session_id is trusted (app-generated), not a user path input,
    // so a plain filename join is fine — no sanitization needed. If it ever
    // becomes user-editable, reject `..`/separators here first.
    let mut p = sessions_dir(app)?;
    p.push(format!("{session_id}.json"));
    Ok(p)
}

fn load_history(app: &AppHandle, session_id: &str) -> Result<Vec<HistoryMsg>, String> {
    let path = session_path(app, session_id)?;
    match fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(e.to_string()),
    }
}

fn save_history(app: &AppHandle, session_id: &str, hist: &[HistoryMsg]) -> Result<(), String> {
    let path = session_path(app, session_id)?;
    let bytes = serde_json::to_vec(hist).map_err(|e| e.to_string())?;
    fs::write(&path, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn chat_stream(
    app: AppHandle,
    params: ChatParams,
    on_event: Channel<ChatChunk>,
) -> Result<(), AppError> {
    // ponytail: Ollama runs locally without auth; skip the empty-key guard.
    // The frontend also gates on `requiresApiKey`, so this is defense-in-depth.
    let requires_key = params.provider != "ollama";
    if requires_key && params.api_key.trim().is_empty() {
        on_event
            .send(ChatChunk::Error {
                message: "Missing API key".into(),
            })
            .ok();
        return Err("Missing API key".into());
    }

    // Build the rig history from disk: user/assistant turns only. The system
    // preamble is set on the agent, not stored per-session. User turns carry
    // their original image content blocks so multi-turn visual context
    // survives across reopens.
    //
    // history_mode gates this: None / SaveOnly skip the load (send only the
    // live prompt). Default LoadSave + LoadOnly load.
    let history_mode = params.history_mode.unwrap_or(HistoryMode::LoadSave);
    let (should_load, should_save) = history_flags(history_mode);
    let loaded: Vec<HistoryMsg> = if should_load {
        load_history(&app, &params.session_id)?
    } else {
        Vec::new()
    };
    let history: Vec<Message> = loaded
        .into_iter()
        .filter_map(|m| match m.role.as_str() {
            "user" => Some(build_user_message(&m.content, m.images.as_deref(), &on_event)),
            "assistant" => Some(Message::assistant(m.content)),
            _ => None,
        })
        .collect();

    // ponytail: rebuild the client per turn. A pooled client keyed by
    // (provider, key, base_url) in a managed `AppState` would keep reqwest's
    // connection pool warm across turns, but settings can change between calls
    // and cache invalidation adds more complexity than the saved TLS handshake
    // is worth at chat cadence. Add the cache if latency shows up.
    let prompt_str = params.prompt.as_str();
    let prompt_msg = build_user_message(
        prompt_str,
        params.images.as_deref(),
        &on_event,
    );
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
    let resolved: &str = resolve_adapter_family(&params);
    let full: String = match resolved {
        "anthropic" | "anthropic-compatible" => {
            let mut b = anthropic::Client::builder().api_key(params.api_key);
            if let Some(url) = params.base_url {
                b = b.base_url(url);
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
            let mut stream = agent.stream_chat(prompt_msg.clone(), &history).await;
            drain_loop(&mut stream, &on_event).await?
        }
        "gemini" => {
            let mut b = gemini::Client::builder().api_key(params.api_key);
            if let Some(url) = params.base_url {
                b = b.base_url(url);
            }
            let agent = with_thinking(
                b.build()
                    .map_err(|e| e.to_string())?
                    .agent(params.model.as_str())
                    .preamble(params.preamble.as_deref().unwrap_or(PREAMBLE)),
                "gemini",
                params.thinking_budget,
            ).build();
            let mut stream = agent.stream_chat(prompt_msg.clone(), &history).await;
            drain_loop(&mut stream, &on_event).await?
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
                .api_key(params.api_key)
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
            let mut stream = agent.stream_chat(prompt_msg.clone(), &history).await;
            drain_loop(&mut stream, &on_event).await?
        }
        "cohere" => {
            let mut b = cohere::Client::builder().api_key(params.api_key);
            if let Some(url) = params.base_url {
                b = b.base_url(url);
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
            let mut stream = agent.stream_chat(prompt_msg.clone(), &history).await;
            drain_loop(&mut stream, &on_event).await?
        }
        "huggingface" => {
            let mut b = huggingface::Client::builder().api_key(params.api_key);
            if let Some(url) = params.base_url {
                b = b.base_url(url);
            }
            let agent = with_thinking(
                b.build()
                    .map_err(|e| e.to_string())?
                    .agent(params.model.as_str())
                    .preamble(params.preamble.as_deref().unwrap_or(PREAMBLE)),
                "huggingface",
                params.thinking_budget,
            ).build();
            let mut stream = agent.stream_chat(prompt_msg.clone(), &history).await;
            drain_loop(&mut stream, &on_event).await?
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
            let mut stream = agent.stream_chat(prompt_msg.clone(), &history).await;
            drain_loop(&mut stream, &on_event).await?
        }
        "openai-completions" => {
            // Custom provider picked `openai-chat-completions` — use rig's
            // Completions API client so requests hit `/v1/chat/completions`
            // instead of the default `/v1/responses`. Required for OpenAI-compat
            // gateways (one-api / new-api / fastgpt / etc.) that don't expose
            // the Responses API. Same agent/stream contract as the `_` arm
            // below — split to avoid a type clash between `Client` and
            // `CompletionsClient` in the same variable.
            let base_raw = params
                .base_url
                .clone()
                .unwrap_or_else(|| "https://api.openai.com/v1".to_string());
            // ponytail: auto-append /v1 if base ends without a version
            // segment. OpenAI-compat gateways (one-api / new-api / fastgpt)
            // conventionally serve at /v1/...; users often type just the
            // host. Leaves /vN (e.g. /v1, /v2, /v1beta) alone. Mirrored in
            // Quill's ProviderDetailSection preview so the displayed URL
            // matches what rig actually hits. Upgrade path: if a gateway
            // uses a non-/v1 versionless URL scheme, surface that as a
            // separate match arm rather than extending this heuristic.
            let base = {
                let trimmed = base_raw.trim_end_matches('/');
                let last_seg = trimmed.rsplit('/').next().unwrap_or("");
                let has_version = last_seg.starts_with('v')
                    && last_seg.len() > 1
                    && last_seg.as_bytes()[1].is_ascii_digit();
                if has_version { base_raw } else { format!("{}/v1", trimmed) }
            };
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
            let mut stream = agent.stream_chat(prompt_msg.clone(), &history).await;
            drain_loop(&mut stream, &on_event).await?
        }
        _ => {
            // "openai" + "openai-compatible" + 11 OpenAI-compat family
            // (deepseek/groq/hyperbolic/mira/moonshot/openrouter/perplexity/
            // together/xai/galadriel/eternalai). Any non-default base_url needs
            // `with_system_instructions_as_messages()` or the preamble silently
            // vanishes on compatible servers; harmless for real OpenAI.
            let base = params
                .base_url
                .unwrap_or_else(|| "https://api.openai.com/v1".to_string());
            // ponytail: /v1 auto-append dropped — catalog defaultBaseUrl values
            // already include the correct path (e.g. https://api.groq.com/openai/v1).
            // User-supplied base_url is used as-is; if a user types a bare host
            // without /v1, the request will 404 — better to surface that than to
            // silently mutate their input.
            let client = openai::Client::builder()
                .api_key(params.api_key)
                .base_url(base)
                .build()
                .map_err(|e| e.to_string())?
                .with_system_instructions_as_messages();
            // T07: pass the actual provider id (openai / xai / etc.) so
            // thinking_params dispatches correctly. 11 OpenAI-compat family
            // providers (deepseek/groq/hyperbolic/mira/moonshot/openrouter/
            // perplexity/together/galadriel/eternalai + openai-compatible
            // escape hatch) return None — silently skipped.
            let agent = with_thinking(
                client
                    .agent(params.model.as_str())
                    .preamble(params.preamble.as_deref().unwrap_or(PREAMBLE)),
                params.provider.as_str(),
                params.thinking_budget,
            ).build();
            let mut stream = agent.stream_chat(prompt_msg.clone(), &history).await;
            drain_loop(&mut stream, &on_event).await?
        }
    };

    // Persist the turn. We reconstruct history from accumulated text (not
    // FinalResponse.messages(), which the loop discards) — simpler and
    // decoupled from provider-specific response types.
    // ponytail: thinking is NOT persisted to history — reasoning is
    // ephemeral by nature (Anthropic signatures are one-shot, OpenAI
    // reasoning is not resumable across turns) and the on-disk
    // `HistoryMsg` shape stays `{role, content}` only. Re-running a turn
    // regenerates reasoning fresh.
    //
    // history_mode gates this: None / LoadOnly skip the save. Default
    // LoadSave + SaveOnly persist.
    if should_save {
        let mut hist = load_history(&app, &params.session_id)?;
        hist.push(HistoryMsg {
            role: "user".into(),
            content: params.prompt,
            images: params.images.clone(),
        });
        hist.push(HistoryMsg {
            role: "assistant".into(),
            content: full,
            images: None,
        });
        save_history(&app, &params.session_id, &hist)?;
    }

    Ok(())
}

/// Drain a rig streaming chat stream into `full` text + frontend chunks.
/// Generic over the stream `S`, the provider response type `R`, and the
/// error type `E` — none of which we name concretely (rig's `prompt_request`
/// module is `pub(crate)`, so `StreamingResult<R>` can't be referenced by
/// path; the concrete types are inferred at each call site). Only `Text`
/// deltas, `FinalResponse`, and `Err` are matched — none depend on `R`.
async fn drain_loop<S, R, E>(
    stream: &mut S,
    on_event: &Channel<ChatChunk>,
) -> Result<String, String>
where
    S: futures::Stream<Item = Result<MultiTurnStreamItem<R>, E>> + Unpin,
    E: std::fmt::Debug,
{
    let mut full = String::new();
    while let Some(item) = stream.next().await {
        match item {
            Ok(MultiTurnStreamItem::StreamAssistantItem(StreamedAssistantContent::Text(
                Text { text, .. },
            ))) => {
                full.push_str(&text);
                on_event.send(ChatChunk::Delta { text }).ok();
            }
            // Reasoning block (full): iterate its content parts, emit each
            // Text part as a Thinking chunk. Encrypted/Redacted/Summary
            // variants are ignored — pet chat has no UI for them and they
            // are not useful as plain text.
            Ok(MultiTurnStreamItem::StreamAssistantItem(StreamedAssistantContent::Reasoning(r))) => {
                for part in r.content {
                    if let ReasoningContent::Text { text, .. } = part {
                        on_event.send(ChatChunk::Thinking { text }).ok();
                    }
                }
            }
            // Partial reasoning text (incremental): emit as-is.
            Ok(MultiTurnStreamItem::StreamAssistantItem(
                StreamedAssistantContent::ReasoningDelta { reasoning, .. },
            )) => {
                on_event.send(ChatChunk::Thinking { text: reasoning }).ok();
            }
            Ok(MultiTurnStreamItem::FinalResponse(_)) => {
                on_event.send(ChatChunk::Done).ok();
                // ponytail: return (not break) — the trailing `Done` below is
                // only for streams that exhausted without a FinalResponse.
                return Ok(full);
            }
            Ok(_) => {}
            Err(e) => {
                on_event
                    .send(ChatChunk::Error {
                        message: format!("{e:?}"),
                    })
                    .ok();
                return Err(format!("{e:?}"));
            }
        }
    }
    // Stream exhausted without a FinalResponse (e.g. provider dropped the SSE).
    // Send Done so the frontend still terminates the turn cleanly.
    on_event.send(ChatChunk::Done).ok();
    Ok(full)
}

#[cfg(test)]
mod tests {
    use super::*;

    // T07: thinking_params pure function — provider dispatch + JSON shape.
    #[test]
    fn thinking_params_anthropic() {
        let p = thinking_params("anthropic", Some(2048)).unwrap();
        assert_eq!(p["thinking"]["type"], "enabled");
        assert_eq!(p["thinking"]["budget_tokens"], 2048);
    }

    #[test]
    fn thinking_params_anthropic_compatible_alias() {
        // anthropic-compatible uses the same arm — its reasoning API is shared.
        let p = thinking_params("anthropic-compatible", Some(1024)).unwrap();
        assert_eq!(p["thinking"]["type"], "enabled");
    }

    #[test]
    fn thinking_params_openai_effort_buckets() {
        assert_eq!(thinking_params("openai", Some(0)).unwrap()["reasoning_effort"], "low");
        assert_eq!(thinking_params("openai", Some(1999)).unwrap()["reasoning_effort"], "low");
        assert_eq!(thinking_params("openai", Some(2000)).unwrap()["reasoning_effort"], "medium");
        assert_eq!(thinking_params("openai", Some(7999)).unwrap()["reasoning_effort"], "medium");
        assert_eq!(thinking_params("openai", Some(8000)).unwrap()["reasoning_effort"], "high");
        assert_eq!(thinking_params("openai", Some(99999)).unwrap()["reasoning_effort"], "high");
    }

    #[test]
    fn thinking_params_azure_uses_openai_effort() {
        assert_eq!(thinking_params("azure-openai", Some(5000)).unwrap()["reasoning_effort"], "medium");
    }

    #[test]
    fn thinking_params_gemini_budget() {
        let p = thinking_params("gemini", Some(8192)).unwrap();
        assert_eq!(p["generationConfig"]["thinkingConfig"]["thinkingBudget"], 8192);
    }

    #[test]
    fn thinking_params_xai_toggle() {
        let p = thinking_params("xai", Some(1)).unwrap();
        assert_eq!(p["reasoning"], true);
    }

    #[test]
    fn thinking_params_none_for_unsupported_providers() {
        // Cohere / HuggingFace / Ollama don't support reasoning — None.
        assert!(thinking_params("cohere", Some(1024)).is_none());
        assert!(thinking_params("huggingface", Some(1024)).is_none());
        assert!(thinking_params("ollama", Some(1024)).is_none());
        // OpenAI-compat family (11) — None.
        for pid in ["deepseek", "groq", "hyperbolic", "mira", "moonshot", "openrouter", "perplexity", "together", "galadriel", "eternalai", "openai-compatible"] {
            assert!(thinking_params(pid, Some(1024)).is_none(), "{} should return None", pid);
        }
    }

    #[test]
    fn thinking_params_none_when_budget_is_none() {
        assert!(thinking_params("anthropic", None).is_none());
        assert!(thinking_params("openai", None).is_none());
    }

    // Phase 3: resolve_adapter_family collapses the old endpoint-key enum.
    // Custom providers declare a bundled id directly; bundled providers carry
    // it via `provider`. The downstream `match resolved` arm then dispatches.
    fn mk_params(provider: &str, adapter_family: Option<&str>) -> ChatParams {
        ChatParams {
            session_id: "test".into(),
            provider: provider.into(),
            preamble: None,
            model: "m".into(),
            api_key: "k".into(),
            base_url: None,
            prompt: "p".into(),
            images: None,
            azure_deployment_id: None,
            azure_api_version: None,
            thinking_budget: None,
            adapter_family: adapter_family.map(|s| s.to_string()),
            history_mode: None,
        }
    }

    #[test]
    fn resolve_adapter_family_custom_uses_adapter_family() {
        // Custom provider: adapterFamily="openai-completions" routes through
        // the openai-completions match arm (Completions API). The custom id
        // "my-oneapi" is NOT a bundled id — without adapter_family it would
        // fall to the `_` (openai Responses) arm.
        let params = mk_params("my-oneapi", Some("openai-completions"));
        assert_eq!(resolve_adapter_family(&params), "openai-completions");
    }

    #[test]
    fn resolve_adapter_family_bundled_uses_provider() {
        // Bundled provider: no adapter_family — fall back to provider id.
        let params = mk_params("anthropic", None);
        assert_eq!(resolve_adapter_family(&params), "anthropic");
    }

    #[test]
    fn resolve_adapter_family_custom_without_family_falls_back() {
        // Custom provider flag set but no adapter_family supplied (legacy
        // def missing the field) — fall back to provider id, which for a
        // custom id lands in the `_` openai-compat arm.
        let params = mk_params("my-oneapi", None);
        assert_eq!(resolve_adapter_family(&params), "my-oneapi");
    }

    // HistoryMode: connection-test path. The gate is a pure fn so we can
    // unit-test the (load, save) mapping without spinning up a provider.
    #[test]
    fn history_flags_mapping() {
        assert_eq!(history_flags(HistoryMode::LoadSave), (true, true));
        assert_eq!(history_flags(HistoryMode::None), (false, false));
        assert_eq!(history_flags(HistoryMode::LoadOnly), (true, false));
        assert_eq!(history_flags(HistoryMode::SaveOnly), (false, true));
    }

    #[test]
    fn history_mode_serde_camel_case() {
        // TS side sends string literals; Rust must accept the camelCase
        // form. Verifies the serde rename on the enum.
        let load_save: HistoryMode = serde_json::from_str("\"loadSave\"").unwrap();
        assert_eq!(load_save, HistoryMode::LoadSave);
        let none: HistoryMode = serde_json::from_str("\"none\"").unwrap();
        assert_eq!(none, HistoryMode::None);
        let load_only: HistoryMode = serde_json::from_str("\"loadOnly\"").unwrap();
        assert_eq!(load_only, HistoryMode::LoadOnly);
        let save_only: HistoryMode = serde_json::from_str("\"saveOnly\"").unwrap();
        assert_eq!(save_only, HistoryMode::SaveOnly);
    }

    #[test]
    fn chatparams_history_mode_absent_defaults_to_none_option() {
        // Absent field deserializes to Option::None — the chat_stream
        // default (LoadSave) is applied at the call site via unwrap_or.
        let json = r#"{"sessionId":"s","provider":"openai","model":"m","apiKey":"k","prompt":"p"}"#;
        let params: ChatParams = serde_json::from_str(json).unwrap();
        assert!(params.history_mode.is_none());
    }
}
