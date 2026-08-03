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
use rig_core::providers::{anthropic, azure, cohere, deepseek, gemini, groq, huggingface, hyperbolic, mira, moonshot, ollama, openai, openrouter, perplexity, together, xai};
use rig_core::client::Nothing;
use rig_core::streaming::StreamedAssistantContent;

use crate::errors::AppError;

const PREAMBLE: &str = "You are Quill's writing assistant. Reply concisely and helpfully.";

/// One chunk pushed down the frontend `Channel`. Tagged so the JS side can
/// `switch (msg.type)`; `rename_all` renames the variant tag (e.g. `Image` →
/// `"image"`), `rename_all_fields` renames fields *within* variants
/// (e.g. `media_type` → `mediaType`) to match the TS shape.
#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
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
    /// A complete `data:image/<mt>;base64,<...>` run extracted from a Text
    /// delta. Emitted by the `ImageScanner` state machine in `drain_loop`:
    /// image-generation models return the rendered image inline as a data
    /// URL text delta, so we scan the delta stream and emit structured
    /// Image chunks instead of dumping raw base64 into the text pipeline.
    /// `data` carries the full `data:image/...;base64,...` URL (decoded by
    /// the frontend); `media_type` is the parsed MIME (e.g. `image/png`).
    Image {
        data: String,
        media_type: String,
    },
    Done,
    Error {
        message: String,
    },
}

/// One assistant image emitted inline in a streamed assistant turn. The
/// `at_offset` is the character position in the accumulated assistant text
/// where the image sits — the frontend interleaves text and images by this
/// offset. Persisted to `HistoryMsg.images` so reopening a session restores
/// the image at its original position.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AssistantImage {
    pub data: String,
    pub media_type: String,
    pub at_offset: usize,
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
///
/// `ensure_v1_segment`: append `/v1` to a bare OpenAI-compat base URL that
/// lacks a version segment. Catalog `baseUrl` values for OpenAI-compat
/// providers are often bare hosts (e.g. `https://api.moonshot.cn`); rig's
/// native modules use the base as-is and append `/chat/completions` → 404
/// if `/v1` is missing. Leaves `/vN` (e.g. `/v1`, `/v2`, `/v1beta`) alone.
/// Mirrored in the frontend `normalizeOpenAIBase` (`providersCatalog.ts`).
fn ensure_v1_segment(base_raw: &str) -> String {
    let trimmed = base_raw.trim_end_matches('/');
    let last_seg = trimmed.rsplit('/').next().unwrap_or("");
    let has_version = last_seg.starts_with('v')
        && last_seg.len() > 1
        && last_seg.as_bytes()[1].is_ascii_digit();
    if has_version { base_raw.to_string() } else { format!("{}/v1", trimmed) }
}

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
/// For user turns, `images` carries the multimodal input images fed to the
/// provider. For assistant turns, `images` carries the inline image data
/// URLs the model emitted (image-generation models); these are NOT fed
/// back into the provider on history reload — they are display-only.
#[derive(Serialize, Deserialize, Clone)]
struct HistoryMsg {
    role: String,
    content: String,
    /// User-turn multimodal input images (fed to provider on reload).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    images: Option<Vec<ImageInput>>,
    /// Assistant-turn inline images emitted by image-generation models
    /// (display-only; NOT fed back to the provider).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    assistant_images: Option<Vec<AssistantImage>>,
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
    let (full, assistant_images): (String, Vec<AssistantImage>) = match resolved {
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
        "moonshot" => {
            // rig's built-in moonshot client — knows the Chat Completions
            // contract natively (vs. the `_` arm's `openai::Client` which
            // defaults to the Responses API and 404s on moonshot's server).
            // Default base is rig's `https://api.moonshot.ai/v1`; the China
            // endpoint `https://api.moonshot.cn/v1` is set via user-supplied
            // base_url (catalog default is the China host without /v1, so
            // `ensure_v1_segment` adds it).
            let mut b = moonshot::Client::builder().api_key(params.api_key);
            if let Some(url) = params.base_url {
                b = b.base_url(ensure_v1_segment(&url));
            }
            let agent = with_thinking(
                b.build()
                    .map_err(|e| e.to_string())?
                    .agent(params.model.as_str())
                    .preamble(params.preamble.as_deref().unwrap_or(PREAMBLE)),
                "moonshot",
                params.thinking_budget,
            ).build();
            let mut stream = agent.stream_chat(prompt_msg.clone(), &history).await;
            drain_loop(&mut stream, &on_event).await?
        }
        // 8 rig-native OpenAI-compat providers — same pattern as `moonshot`
        // above. Each rig module knows its provider's Chat Completions
        // contract natively; routing through them avoids the `_` arm's
        // `openai::Client` default (Responses API → `/responses` 404 on
        // servers that only expose `/chat/completions`). galadriel /
        // eternalai have no rig module — they route through the
        // `openai-completions` arm below.
        "deepseek" => {
            let mut b = deepseek::Client::builder().api_key(params.api_key);
            if let Some(url) = params.base_url { b = b.base_url(ensure_v1_segment(&url)); }
            let agent = with_thinking(
                b.build().map_err(|e| e.to_string())?
                    .agent(params.model.as_str())
                    .preamble(params.preamble.as_deref().unwrap_or(PREAMBLE)),
                "deepseek", params.thinking_budget,
            ).build();
            let mut stream = agent.stream_chat(prompt_msg.clone(), &history).await;
            drain_loop(&mut stream, &on_event).await?
        }
        "groq" => {
            let mut b = groq::Client::builder().api_key(params.api_key);
            if let Some(url) = params.base_url { b = b.base_url(ensure_v1_segment(&url)); }
            let agent = with_thinking(
                b.build().map_err(|e| e.to_string())?
                    .agent(params.model.as_str())
                    .preamble(params.preamble.as_deref().unwrap_or(PREAMBLE)),
                "groq", params.thinking_budget,
            ).build();
            let mut stream = agent.stream_chat(prompt_msg.clone(), &history).await;
            drain_loop(&mut stream, &on_event).await?
        }
        "hyperbolic" => {
            let mut b = hyperbolic::Client::builder().api_key(params.api_key);
            if let Some(url) = params.base_url { b = b.base_url(ensure_v1_segment(&url)); }
            let agent = with_thinking(
                b.build().map_err(|e| e.to_string())?
                    .agent(params.model.as_str())
                    .preamble(params.preamble.as_deref().unwrap_or(PREAMBLE)),
                "hyperbolic", params.thinking_budget,
            ).build();
            let mut stream = agent.stream_chat(prompt_msg.clone(), &history).await;
            drain_loop(&mut stream, &on_event).await?
        }
        "mira" => {
            let mut b = mira::Client::builder().api_key(params.api_key);
            if let Some(url) = params.base_url { b = b.base_url(ensure_v1_segment(&url)); }
            let agent = with_thinking(
                b.build().map_err(|e| e.to_string())?
                    .agent(params.model.as_str())
                    .preamble(params.preamble.as_deref().unwrap_or(PREAMBLE)),
                "mira", params.thinking_budget,
            ).build();
            let mut stream = agent.stream_chat(prompt_msg.clone(), &history).await;
            drain_loop(&mut stream, &on_event).await?
        }
        "openrouter" => {
            let mut b = openrouter::Client::builder().api_key(params.api_key);
            if let Some(url) = params.base_url { b = b.base_url(ensure_v1_segment(&url)); }
            let agent = with_thinking(
                b.build().map_err(|e| e.to_string())?
                    .agent(params.model.as_str())
                    .preamble(params.preamble.as_deref().unwrap_or(PREAMBLE)),
                "openrouter", params.thinking_budget,
            ).build();
            let mut stream = agent.stream_chat(prompt_msg.clone(), &history).await;
            drain_loop(&mut stream, &on_event).await?
        }
        "perplexity" => {
            let mut b = perplexity::Client::builder().api_key(params.api_key);
            if let Some(url) = params.base_url { b = b.base_url(ensure_v1_segment(&url)); }
            let agent = with_thinking(
                b.build().map_err(|e| e.to_string())?
                    .agent(params.model.as_str())
                    .preamble(params.preamble.as_deref().unwrap_or(PREAMBLE)),
                "perplexity", params.thinking_budget,
            ).build();
            let mut stream = agent.stream_chat(prompt_msg.clone(), &history).await;
            drain_loop(&mut stream, &on_event).await?
        }
        "together" => {
            let mut b = together::Client::builder().api_key(params.api_key);
            if let Some(url) = params.base_url { b = b.base_url(ensure_v1_segment(&url)); }
            let agent = with_thinking(
                b.build().map_err(|e| e.to_string())?
                    .agent(params.model.as_str())
                    .preamble(params.preamble.as_deref().unwrap_or(PREAMBLE)),
                "together", params.thinking_budget,
            ).build();
            let mut stream = agent.stream_chat(prompt_msg.clone(), &history).await;
            drain_loop(&mut stream, &on_event).await?
        }
        "xai" => {
            let mut b = xai::Client::builder().api_key(params.api_key);
            if let Some(url) = params.base_url { b = b.base_url(ensure_v1_segment(&url)); }
            let agent = with_thinking(
                b.build().map_err(|e| e.to_string())?
                    .agent(params.model.as_str())
                    .preamble(params.preamble.as_deref().unwrap_or(PREAMBLE)),
                "xai", params.thinking_budget,
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
            let mut stream = agent.stream_chat(prompt_msg.clone(), &history).await;
            drain_loop(&mut stream, &on_event).await?
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
                .api_key(params.api_key)
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
            assistant_images: None,
        });
        hist.push(HistoryMsg {
            role: "assistant".into(),
            content: full,
            images: None,
            // ponytail: `None` when no inline images emitted; `Some(vec)` when
            // the scanner picked up at least one Image event. Skip-serialize
            // keeps the on-disk shape clean for text-only turns.
            assistant_images: if assistant_images.is_empty() {
                None
            } else {
                Some(assistant_images)
            },
        });
        save_history(&app, &params.session_id, &hist)?;
    }

    Ok(())
}

/// State machine that scans an incoming stream of Text deltas for inline
/// `data:image/<mt>;base64,<...>` data URLs and emits them as `ScanEvent::Image`
/// instead of letting raw base64 flow through as `ScanEvent::Delta`. Outside
/// the data URL, text passes through as Delta unchanged.
///
/// Why a state machine: image-generation models return the rendered image as
/// a single text delta (or a continuous run of deltas) containing a data URL.
/// Without scanning, the frontend's markdown pipeline renders the base64 as a
/// giant opaque text blob. The scanner emits a structured `Image` event per
/// complete data URL, so the frontend renders `<img>` directly. Partial data
/// URL prefixes that span delta boundaries are held back until they complete
/// or are disproven.
///
/// ponytail: scanning happens in Rust, not TS, so the frontend stays dumb
/// (render events as they arrive). The cost is one state machine here, but
/// it replaces an O(n²) per-delta rescan on the TS side. The lazy shortcut
/// would be a regex-per-delta over the accumulated text; the state machine
/// avoids the O(n²) reparse without giving up cross-delta prefix detection.
#[derive(Default)]
struct ImageScanner {
    state: ScanState,
    /// Text held back in `ScanState::Text` because it could be the start of a
    /// data URL prefix (e.g. trailing `"data:im"` awaiting the next delta to
    /// complete `"data:image/..."`). Emitted as Delta once disproven.
    pending_text: String,
}

#[derive(Default)]
enum ScanState {
    #[default]
    Text,
    /// Inside a data URL, accumulating base64 chars until a non-base64 char
    /// terminates the run. `buf` holds the full `data:image/<mt>;base64,<...>`
    /// string so far; `media_type` is the parsed MIME.
    Image { buf: String, media_type: String },
}

#[derive(Debug, PartialEq, Eq)]
enum ScanEvent {
    Delta(String),
    Image { data: String, media_type: String },
}

/// Base64 alphabet (RFC 4648): `A-Z`, `a-z`, `0-9`, `+`, `/`, and `=` padding.
/// Anything else terminates a data URL run.
fn is_base64_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '='
}

struct DataUrlPrefixMatch {
    prefix_start: usize,
    prefix_end: usize,
    media_type: String,
}

/// Find the first `data:image/<mt>;base64,` prefix in `s`. Returns its
/// byte range and the parsed media type (e.g. `"image/png"`). The media type
/// must be at least one char; `+`/`-`/`.`/alnum are accepted (covers png,
/// jpeg, webp, svg+xml, etc.). Returns `None` on no match.
fn find_data_url_prefix(s: &str) -> Option<DataUrlPrefixMatch> {
    let mut cursor = 0;
    loop {
        let start = match s[cursor..].find("data:image/") {
            Some(i) => cursor + i,
            None => return None,
        };
        let after = &s[start + "data:image/".len()..];
        let mt_end = after
            .find(|c: char| !c.is_ascii_alphanumeric() && c != '.' && c != '+' && c != '-')?;
        let mt = &after[..mt_end];
        if mt.is_empty() {
            // `data:image/;base64,` — not a valid data URL. Advance past this
            // false positive and keep scanning.
            cursor = start + "data:image/".len();
            continue;
        }
        let after_mt = &after[mt_end..];
        if !after_mt.starts_with(";base64,") {
            // `data:image/<mt>` not followed by `;base64,` — false positive.
            cursor = start + "data:image/".len();
            continue;
        }
        let prefix_end = start + "data:image/".len() + mt_end + ";base64,".len();
        return Some(DataUrlPrefixMatch {
            prefix_start: start,
            prefix_end,
            media_type: format!("image/{}", mt),
        });
    }
}

/// Length of the longest suffix of `s` that could be the start of a
/// `data:image/<mt>;base64,` data URL prefix (strict prefix — `s` ends mid-
/// prefix). Used to hold back trailing text that might complete into a full
/// prefix on the next delta. Returns 0 when the suffix can't be a prefix
/// start.
///
/// ponytail: iterate char boundary positions so suffix slices stay on UTF-8
/// boundaries — byte-indexed `&s[s.len()-n..]` panics on CJK chars (3 bytes
/// each). Capped at 30 bytes; 4-byte floor still skips spurious single letters.
fn partial_data_url_prefix_len(s: &str) -> usize {
    let mut best = 0;
    for (i, _) in s.char_indices() {
        let suffix_len = s.len() - i;
        if suffix_len < 4 || suffix_len > 30 {
            continue;
        }
        if could_start_data_url(&s[i..]) {
            best = best.max(suffix_len);
        }
    }
    best
}

/// True if `s` could be the start of a `data:image/<mt>;base64,<base64>` URL.
/// `s` is a strict prefix of `"data:image/"`, OR matches the partial pattern
/// `data:image/<mt>[;base64[,]]` shape. The empty string returns false —
/// holding back zero-length "prefixes" serves no purpose.
fn could_start_data_url(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    // Strict prefix of the literal "data:image/" (e.g. "data", "data:", "data:im").
    if s.len() < "data:image/".len() && "data:image/".starts_with(s) {
        return true;
    }
    if !s.starts_with("data:image/") {
        return false;
    }
    let after = &s["data:image/".len()..];
    let mt_end = after
        .find(|c: char| !c.is_ascii_alphanumeric() && c != '.' && c != '+' && c != '-')
        .unwrap_or(after.len());
    let after_mt = &after[mt_end..];
    if after_mt.is_empty() {
        return true; // just "data:image/" + media-type chars so far
    }
    if !after_mt.starts_with(';') {
        return false;
    }
    let after_semi = &after_mt[1..];
    if after_semi.is_empty() {
        return true; // "data:image/<mt>;"
    }
    // Should be a strict prefix of "base64,".
    if after_semi.len() < "base64,".len() && "base64,".starts_with(after_semi) {
        return true;
    }
    false
}

impl ImageScanner {
    fn new() -> Self {
        Self::default()
    }

    /// Process one Text delta. Returns the events to emit: zero or more
    /// `Delta` (text outside a data URL) and zero or more `Image` (complete
    /// data URLs). The scanner may hold back text as `pending_text` if it
    /// could be a partial data URL prefix; call `flush` at stream end.
    fn process_chunk(&mut self, chunk: &str) -> Vec<ScanEvent> {
        let mut events = Vec::new();
        let mut input: String = chunk.to_string();
        loop {
            // Take ownership of state to avoid borrow conflicts when reassigning.
            let state = std::mem::replace(&mut self.state, ScanState::Text);
            match state {
                ScanState::Text => {
                    self.pending_text.push_str(&input);
                    input.clear();
                    if let Some(p) = find_data_url_prefix(&self.pending_text) {
                        if p.prefix_start > 0 {
                            events.push(ScanEvent::Delta(
                                self.pending_text[..p.prefix_start].to_string(),
                            ));
                        }
                        // Split: prefix goes into the Image buf; post-prefix
                        // remainder stays in `input` for the Image state to
                        // consume on the next iteration.
                        let prefix = self.pending_text[p.prefix_start..p.prefix_end].to_string();
                        let post_prefix = self.pending_text[p.prefix_end..].to_string();
                        self.pending_text.clear();
                        self.state = ScanState::Image { buf: prefix, media_type: p.media_type };
                        input = post_prefix;
                        // Continue loop: Image state consumes `input` next.
                    } else {
                        // Hold back the longest partial-prefix suffix; emit
                        // the rest as Delta.
                        let hold = partial_data_url_prefix_len(&self.pending_text);
                        let emit_len = self.pending_text.len() - hold;
                        if emit_len > 0 {
                            events.push(ScanEvent::Delta(
                                self.pending_text[..emit_len].to_string(),
                            ));
                            self.pending_text = self.pending_text[emit_len..].to_string();
                        }
                        self.state = ScanState::Text;
                        break;
                    }
                }
                ScanState::Image { mut buf, media_type } => {
                    let end = input
                        .find(|c: char| !is_base64_char(c))
                        .unwrap_or(input.len());
                    if end > 0 {
                        buf.push_str(&input[..end]);
                    }
                    let prefix_len = format!("data:{};base64,", media_type).len();
                    let has_data = buf.len() > prefix_len;
                    if end < input.len() {
                        // Non-base64 char terminates the data URL run.
                        if has_data {
                            events.push(ScanEvent::Image { data: buf, media_type });
                        } else {
                            // ponytail: malformed data URL (no base64 data
                            // after prefix). Emit the prefix as plain text
                            // so the user sees something — better than a
                            // silent drop.
                            events.push(ScanEvent::Delta(buf));
                        }
                        self.state = ScanState::Text;
                        input = input[end..].to_string();
                        // Continue loop: Text state consumes `input` next.
                    } else {
                        // All of `input` was base64 (or input was empty);
                        // stay in Image state, wait for more deltas.
                        self.state = ScanState::Image { buf, media_type };
                        break;
                    }
                }
            }
        }
        events
    }

    /// Flush at stream end. Emits any buffered text as Delta and any buffered
    /// image data as Image (best-effort — partial base64 at end of stream is
    /// emitted as if complete).
    fn flush(&mut self) -> Vec<ScanEvent> {
        let mut events = Vec::new();
        let state = std::mem::replace(&mut self.state, ScanState::Text);
        match state {
            ScanState::Text => {
                if !self.pending_text.is_empty() {
                    events.push(ScanEvent::Delta(std::mem::take(&mut self.pending_text)));
                }
            }
            ScanState::Image { buf, media_type } => {
                let prefix_len = format!("data:{};base64,", media_type).len();
                if buf.len() > prefix_len {
                    events.push(ScanEvent::Image { data: buf, media_type });
                } else if !buf.is_empty() {
                    // ponytail: malformed at stream end — emit as text.
                    events.push(ScanEvent::Delta(buf));
                }
            }
        }
        events
    }
}

/// Drain a rig streaming chat stream into `full` text + frontend chunks.
/// Generic over the stream `S`, the provider response type `R`, and the
/// error type `E` — none of which we name concretely (rig's `prompt_request`
/// module is `pub(crate)`, so `StreamingResult<R>` can't be referenced by
/// path; the concrete types are inferred at each call site). Only `Text`
/// deltas, `FinalResponse`, and `Err` are matched — none depend on `R`.
///
/// Returns `(full, images)` where `images` is the list of inline images
/// emitted by the model (with their character offsets into `full`). The
/// caller persists these on the assistant `HistoryMsg` so reopening the
/// session restores them at their original positions.
async fn drain_loop<S, R, E>(
    stream: &mut S,
    on_event: &Channel<ChatChunk>,
) -> Result<(String, Vec<AssistantImage>), String>
where
    S: futures::Stream<Item = Result<MultiTurnStreamItem<R>, E>> + Unpin,
    E: std::fmt::Debug,
{
    let mut full = String::new();
    let mut images: Vec<AssistantImage> = Vec::new();
    let mut scanner = ImageScanner::new();

    /// Emit a `ScanEvent` to the frontend channel and update `full` /
    /// `images` accordingly. Local closure (can't capture `&mut` refs in a
    /// `fn`), so written as a macro to avoid the indirection.
    macro_rules! emit {
        ($ev:expr) => {
            match $ev {
                ScanEvent::Delta(t) => {
                    full.push_str(&t);
                    on_event.send(ChatChunk::Delta { text: t }).ok();
                }
                ScanEvent::Image { data, media_type } => {
                    images.push(AssistantImage {
                        data: data.clone(),
                        media_type: media_type.clone(),
                        at_offset: full.len(),
                    });
                    on_event
                        .send(ChatChunk::Image { data, media_type })
                        .ok();
                }
            }
        };
    }

    while let Some(item) = stream.next().await {
        match item {
            Ok(MultiTurnStreamItem::StreamAssistantItem(StreamedAssistantContent::Text(
                Text { text, .. },
            ))) => {
                for ev in scanner.process_chunk(&text) {
                    emit!(ev);
                }
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
                for ev in scanner.flush() {
                    emit!(ev);
                }
                on_event.send(ChatChunk::Done).ok();
                // ponytail: return (not break) — the trailing `Done` below is
                // only for streams that exhausted without a FinalResponse.
                return Ok((full, images));
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
    // Flush any buffered scanner state, then send Done so the frontend still
    // terminates the turn cleanly.
    for ev in scanner.flush() {
        emit!(ev);
    }
    on_event.send(ChatChunk::Done).ok();
    Ok((full, images))
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

    #[test]
    fn ensure_v1_segment_appends_v1_to_bare_host() {
        // Bare host → /v1 appended.
        assert_eq!(ensure_v1_segment("https://api.moonshot.cn"), "https://api.moonshot.cn/v1");
        assert_eq!(ensure_v1_segment("https://api.deepseek.com"), "https://api.deepseek.com/v1");
        // Trailing slash trimmed before append.
        assert_eq!(ensure_v1_segment("https://api.perplexity.ai/"), "https://api.perplexity.ai/v1");
        // Path with no version segment → /v1 appended.
        assert_eq!(ensure_v1_segment("https://api.groq.com/openai"), "https://api.groq.com/openai/v1");
    }

    #[test]
    fn ensure_v1_segment_leaves_versioned_base_alone() {
        // /v1, /v2, /v1beta preserved as-is.
        assert_eq!(ensure_v1_segment("https://api.openai.com/v1"), "https://api.openai.com/v1");
        assert_eq!(ensure_v1_segment("https://openrouter.ai/api/v1/"), "https://openrouter.ai/api/v1/");
        assert_eq!(ensure_v1_segment("https://api.x.ai/v1"), "https://api.x.ai/v1");
    }

    #[test]
    fn ensure_v1_segment_handles_edge_cases() {
        // Bare /v1 with nothing else stays /v1.
        assert_eq!(ensure_v1_segment("https://example.com/v1"), "https://example.com/v1");
        // 'v' alone (len 1, no digit) is NOT a version segment → append.
        assert_eq!(ensure_v1_segment("https://example.com/v"), "https://example.com/v/v1");
        // 'vx' (no digit after v) → append.
        assert_eq!(ensure_v1_segment("https://example.com/vx"), "https://example.com/vx/v1");
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

    // ── ImageScanner ──

    /// Drive an `ImageScanner` through a sequence of text chunks, returning
    /// the events emitted across all chunks plus the flush at end-of-stream.
    fn drive_scanner(chunks: &[&str]) -> Vec<ScanEvent> {
        let mut s = ImageScanner::new();
        let mut events = Vec::new();
        for c in chunks {
            events.extend(s.process_chunk(c));
        }
        events.extend(s.flush());
        events
    }

    #[test]
    fn scanner_text_only_passes_through_as_delta() {
        let events = drive_scanner(&["hello", " world"]);
        assert_eq!(
            events,
            vec![
                ScanEvent::Delta("hello".into()),
                ScanEvent::Delta(" world".into()),
            ]
        );
    }

    #[test]
    fn scanner_single_complete_data_url_emits_image() {
        let chunk = "data:image/png;base64,iVBORw0KGgo=";
        let events = drive_scanner(&[chunk]);
        assert_eq!(
            events,
            vec![ScanEvent::Image {
                data: chunk.to_string(),
                media_type: "image/png".into(),
            }]
        );
    }

    #[test]
    fn scanner_text_image_text_emits_three_events() {
        let chunk = "before data:image/png;base64,iVBORw0KG= after";
        let events = drive_scanner(&[chunk]);
        assert_eq!(
            events,
            vec![
                ScanEvent::Delta("before ".into()),
                ScanEvent::Image {
                    data: "data:image/png;base64,iVBORw0KG=".into(),
                    media_type: "image/png".into(),
                },
                ScanEvent::Delta(" after".into()),
            ]
        );
    }

    #[test]
    fn scanner_image_split_across_chunks() {
        // Base64 run arrives across multiple deltas — the scanner stays in
        // Image state until a non-base64 char (or stream end) terminates it.
        let events = drive_scanner(&[
            "data:image/png;base64,iVBOR",
            "w0KGgo=",
            " tail text",
        ]);
        assert_eq!(
            events,
            vec![
                ScanEvent::Image {
                    data: "data:image/png;base64,iVBORw0KGgo=".into(),
                    media_type: "image/png".into(),
                },
                ScanEvent::Delta(" tail text".into()),
            ]
        );
    }

    #[test]
    fn scanner_prefix_split_across_chunks() {
        // The literal `data:image/` arrives split across two chunks. The
        // scanner holds back the partial prefix and re-evaluates on the
        // next chunk — without this buffering, "data:im" would emit as Delta
        // and the image would be missed.
        let events = drive_scanner(&["data:im", "age/png;base64,iVBOR=", " end"]);
        assert_eq!(
            events,
            vec![
                ScanEvent::Image {
                    data: "data:image/png;base64,iVBOR=".into(),
                    media_type: "image/png".into(),
                },
                ScanEvent::Delta(" end".into()),
            ]
        );
    }

    #[test]
    fn scanner_two_images_in_one_chunk() {
        // Two data URLs in one chunk, separated by a non-base64 char (space).
        // (`=` would be consumed as base64 padding and merge the runs.)
        let chunk = "data:image/png;base64,aaa data:image/jpeg;base64,bbb";
        let events = drive_scanner(&[chunk]);
        assert_eq!(
            events,
            vec![
                ScanEvent::Image {
                    data: "data:image/png;base64,aaa".into(),
                    media_type: "image/png".into(),
                },
                ScanEvent::Delta(" ".into()),
                ScanEvent::Image {
                    data: "data:image/jpeg;base64,bbb".into(),
                    media_type: "image/jpeg".into(),
                },
            ]
        );
    }

    #[test]
    fn scanner_partial_prefix_at_end_held_back_then_completed() {
        // "data:image" at end of chunk is a partial prefix; held back. The
        // next chunk completes it into a real data URL.
        let events = drive_scanner(&["pre data:image", "/png;base64,abc", " post"]);
        assert_eq!(
            events,
            vec![
                ScanEvent::Delta("pre ".into()),
                ScanEvent::Image {
                    data: "data:image/png;base64,abc".into(),
                    media_type: "image/png".into(),
                },
                ScanEvent::Delta(" post".into()),
            ]
        );
    }

    #[test]
    fn scanner_partial_prefix_disproven_emits_as_delta() {
        // "data:image/" followed by something that doesn't complete to a
        // data URL prefix — held back, then appended to the next chunk,
        // disproven, and emitted as one merged Delta.
        let events = drive_scanner(&["see data:image/", "xyz not a url"]);
        assert_eq!(
            events,
            vec![
                ScanEvent::Delta("see ".into()),
                ScanEvent::Delta("data:image/xyz not a url".into()),
            ]
        );
    }

    #[test]
    fn scanner_malformed_data_url_no_base64_data_emits_as_text() {
        // Prefix immediately followed by a non-base64 char (no image data).
        // ponytail: emit the prefix as Delta text rather than dropping it.
        let events = drive_scanner(&["data:image/png;base64,"]);
        assert_eq!(
            events,
            vec![ScanEvent::Delta("data:image/png;base64,".into())]
        );
    }

    #[test]
    fn scanner_malformed_data_url_no_semicolon_base64_passes_through() {
        // "data:image/png;base64" without trailing comma is held back as a
        // potential partial prefix; on the next chunk the prefix is
        // disproven and the merged text emits as one Delta.
        let events = drive_scanner(&["data:image/png;base64", " rest"]);
        assert_eq!(
            events,
            vec![ScanEvent::Delta("data:image/png;base64 rest".into())]
        );
    }

    #[test]
    fn scanner_media_type_with_svg_xml() {
        let chunk = "data:image/svg+xml;base64,PHN2ZyB4bWxu";
        let events = drive_scanner(&[chunk]);
        assert_eq!(
            events,
            vec![ScanEvent::Image {
                data: chunk.to_string(),
                media_type: "image/svg+xml".into(),
            }]
        );
    }

    #[test]
    fn scanner_empty_input_no_events() {
        let events = drive_scanner(&["", "", ""]);
        assert!(events.is_empty(), "expected no events, got {:?}", events);
    }

    // ── find_data_url_prefix + could_start_data_url ──

    #[test]
    fn find_prefix_basic_png() {
        let m = find_data_url_prefix("data:image/png;base64,abc").unwrap();
        assert_eq!(m.prefix_start, 0);
        assert_eq!(m.prefix_end, "data:image/png;base64,".len());
        assert_eq!(m.media_type, "image/png");
    }

    #[test]
    fn find_prefix_with_text_before() {
        let m = find_data_url_prefix("hello data:image/jpeg;base64,xxx").unwrap();
        assert_eq!(m.prefix_start, 6);
        assert_eq!(m.media_type, "image/jpeg");
    }

    #[test]
    fn find_prefix_no_match_returns_none() {
        assert!(find_data_url_prefix("just text").is_none());
        assert!(find_data_url_prefix("data:image/").is_none());
        assert!(find_data_url_prefix("data:image/png").is_none());
        assert!(find_data_url_prefix("data:image/png;base64").is_none());
        // No media type chars.
        assert!(find_data_url_prefix("data:image/;base64,abc").is_none());
        // Media type but no `;base64,`.
        assert!(find_data_url_prefix("data:image/png;foo,abc").is_none());
    }

    #[test]
    fn find_prefix_skips_false_positive_data_image_literal() {
        // `data:image/foo` without `;base64,` is a false positive; find
        // should skip it and find the real prefix later.
        let m = find_data_url_prefix("data:image/foo data:image/png;base64,abc").unwrap();
        assert_eq!(m.prefix_start, 15);
        assert_eq!(m.media_type, "image/png");
    }

    #[test]
    fn could_start_data_url_strict_prefix_of_literal() {
        assert!(could_start_data_url("d"));
        assert!(could_start_data_url("data"));
        assert!(could_start_data_url("data:"));
        assert!(could_start_data_url("data:i"));
        assert!(could_start_data_url("data:image/"));
    }

    #[test]
    fn could_start_data_url_with_media_type_chars() {
        assert!(could_start_data_url("data:image/p"));
        assert!(could_start_data_url("data:image/png"));
        assert!(could_start_data_url("data:image/svg+xml"));
    }

    #[test]
    fn could_start_data_url_with_partial_base64_suffix() {
        assert!(could_start_data_url("data:image/png;"));
        assert!(could_start_data_url("data:image/png;b"));
        assert!(could_start_data_url("data:image/png;base64"));
        // `data:image/png;base64,` is the FULL prefix, not a partial —
        // could_start_data_url returns false (it's no longer a strict
        // prefix). The caller handles full prefixes via find_data_url_prefix.
        assert!(!could_start_data_url("data:image/png;base64,"));
        // Trailing data after a full prefix is also not a partial.
        assert!(!could_start_data_url("data:image/png;base64,x"));
    }

    #[test]
    fn could_start_data_url_rejects_non_prefixes() {
        assert!(!could_start_data_url(""));
        assert!(!could_start_data_url("hello"));
        assert!(!could_start_data_url("xyzdata:"));
        assert!(!could_start_data_url("data:image/png;foo"));
        assert!(!could_start_data_url("data:image/png;base64,x"));
    }

    #[test]
    fn partial_prefix_len_returns_longest_match() {
        assert_eq!(partial_data_url_prefix_len("hello"), 0);
        assert_eq!(partial_data_url_prefix_len("data"), 4);
        assert_eq!(partial_data_url_prefix_len("hello data"), 4);
        assert_eq!(partial_data_url_prefix_len("data:image/png;base64"), 21);
        // A complete prefix — not a *partial* prefix, so len is 0.
        assert_eq!(partial_data_url_prefix_len("data:image/png;base64,"), 0);
        // Below the 4-char minimum — not held back.
        assert_eq!(partial_data_url_prefix_len("dat"), 0);
        assert_eq!(partial_data_url_prefix_len("d"), 0);
        // CJK suffix — must not panic on multibyte char boundaries.
        assert_eq!(partial_data_url_prefix_len("您好"), 0);
        assert_eq!(partial_data_url_prefix_len("您好dat"), 0);
        assert_eq!(partial_data_url_prefix_len("您好data"), 4);
    }
}
