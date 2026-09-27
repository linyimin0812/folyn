//! Chat request params, history-mode gating, and the pure helpers that map
//! them to rig call inputs (thinking params, base-URL normalization, user
//! message construction). Pure move from `chat.rs` — no logic changed.

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::ipc::Channel;

use rig_core::agent::AgentBuilder;
use rig_core::completion::message::{
    Document, DocumentMediaType, DocumentSourceKind, ImageMediaType, MimeType, UserContent,
};
use rig_core::message::Message;

use super::ChatChunk;

pub(super) const PREAMBLE: &str =
    "You are Folyn's writing assistant. Reply concisely and helpfully.";

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImageInput {
    /// Base64-encoded bytes (no `data:` URL prefix) — an image, or a PDF
    /// (`media_type = "application/pdf"`, mapped to a rig Document block).
    pub data: String,
    /// MIME type, e.g. `"image/png"`, `"image/jpeg"`, `"application/pdf"`.
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
pub(super) fn history_flags(mode: HistoryMode) -> (bool, bool) {
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
pub(super) fn ensure_v1_segment(base_raw: &str) -> String {
    let trimmed = base_raw.trim_end_matches('/');
    let last_seg = trimmed.rsplit('/').next().unwrap_or("");
    let has_version = last_seg.starts_with('v')
        && last_seg.len() > 1
        && last_seg.as_bytes()[1].is_ascii_digit();
    if has_version { base_raw.to_string() } else { format!("{}/v1", trimmed) }
}

pub(super) fn resolve_adapter_family(params: &ChatParams) -> &str {
    params.adapter_family.as_deref().unwrap_or(params.provider.as_str())
}

/// Build the provider-specific additional_params JSON for reasoning. Returns
/// None when the provider doesn't support reasoning (silently skip per the
/// ticket's "non-reasoning silently ignores" rule). Pure function — unit
/// tested below.
pub(super) fn thinking_params(
    provider: &str,
    thinking_budget: Option<u32>,
) -> Option<serde_json::Value> {
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
pub(super) fn with_thinking<M, S>(
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

/// Build a rig `Message::User` carrying text + (optional) image content
/// blocks. Used for both the live prompt and history reconstruction so the
/// provider sees the same shape either way. Unknown MIME types are skipped
/// (logged via `ChatChunk::Error` so the user knows).
pub(super) fn build_user_message(
    prompt: &str,
    images: Option<&[ImageInput]>,
    on_event: &Channel<ChatChunk>,
) -> Message {
    let mut content = rig_core::one_or_many::OneOrMany::one(UserContent::text(prompt));
    if let Some(imgs) = images {
        for img in imgs {
            if img.media_type == "application/pdf" {
                // PDFs are documents, not images — rig serializes
                // `UserContent::Document` as Anthropic document blocks /
                // OpenAI file inputs. Supported by rig 0.40's anthropic,
                // openai and openrouter providers.
                content.push(UserContent::Document(Document {
                    data: DocumentSourceKind::Base64(img.data.clone()),
                    media_type: Some(DocumentMediaType::PDF),
                    additional_params: None,
                }));
                continue;
            }
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
}
