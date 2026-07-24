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
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

use rig_core::agent::MultiTurnStreamItem;
use rig_core::client::CompletionClient;
use rig_core::completion::message::{ImageMediaType, MimeType, UserContent};
use rig_core::message::{Message, ReasoningContent, Text};
use rig_core::prelude::*; // brings StreamingChat (stream_chat) into scope
use rig_core::providers::{anthropic, openai};
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
    /// `"anthropic" | "openai" | "openai-compatible"`. The last two both use
    /// the OpenAI client flavor; `openai-compatible` (and any custom base_url)
    /// sends the preamble as a system *message* so compatible servers don't
    /// drop it.
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
    if params.api_key.trim().is_empty() {
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
    let history: Vec<Message> = load_history(&app, &params.session_id)?
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
    // ponytail: drain loop is duplicated across the two provider branches
    // because the concrete stream type (`StreamingResult<OpenAIResp>` vs
    // `<AnthropicResp>`) can't share a variable, and naming it for a generic
    // helper hits rig's `pub(crate)` `prompt_request` module. Inference inside
    // each branch sidesteps both. Factor into a trait-object box
    // (`Pin<Box<dyn Stream<Item = Result<Option<String>, String>> + Send>>`)
    // if a 3rd provider lands.
    let full: String = match params.provider.as_str() {
        "anthropic" => {
            let mut b = anthropic::Client::builder().api_key(params.api_key);
            if let Some(url) = params.base_url {
                b = b.base_url(url);
            }
            // ponytail: Anthropic requires max_tokens (no default); 4096 fits most chat turns. Bump to 8192 if a user hits truncation on long responses.
            let agent = b
                .build()
                .map_err(|e| e.to_string())?
                .agent(params.model.as_str())
                .preamble(params.preamble.as_deref().unwrap_or(PREAMBLE))
                .max_tokens(4096)
                .build();
            // `.await` yields the stream directly (no Result wrapper); stream
            // setup/connection errors surface as `Err` items below.
            let mut stream = agent.stream_chat(prompt_msg.clone(), &history).await;
            drain_loop(&mut stream, &on_event).await?
        }
        _ => {
            // "openai" and "openai-compatible". Any non-default base_url needs
            // `with_system_instructions_as_messages()` or the preamble silently
            // vanishes on compatible servers; harmless for real OpenAI.
            // ponytail: ensure baseUrl ends with /v1 so rig appends /chat/completions to .../v1/chat/completions. Ollama/vLLM/LM Studio all use /v1; a server with a non-/v1 version root would still 404 — add an explicit /v1 in that case.
            let mut base = params
                .base_url
                .unwrap_or_else(|| "https://api.openai.com/v1".to_string());
            while base.ends_with('/') {
                base.pop();
            }
            if !base.ends_with("/v1") {
                base.push_str("/v1");
            }
            let client = openai::Client::builder()
                .api_key(params.api_key)
                .base_url(base)
                .build()
                .map_err(|e| e.to_string())?
                .with_system_instructions_as_messages();
            let agent = client
                .agent(params.model.as_str())
                .preamble(params.preamble.as_deref().unwrap_or(PREAMBLE))
                .build();
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
