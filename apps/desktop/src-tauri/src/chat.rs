//! chat mode: LLM via `rig-core` (rig 0.40). ask/agent modes still shell out to
//! the `claude` CLI — this is the ONLY AI path that does not touch that binary.
//!
//! `chat_stream` is one Tauri command: it streams assistant text deltas to the
//! frontend over a `tauri::ipc::Channel<ChatChunk>`, and persists multi-turn
//! history to `~/.folyn/chat-sessions/<session_id>.json` so a session survives
//! app restarts. Provider/key/model/baseUrl come from the frontend settings
//! store (resolved per call, not env) — see PR2.
//!
//! Submodules: `params` (request params + pure helpers), `session_store`
//! (history persistence), `stream` (per-provider client/agent dispatch),
//! `drain` (stream-to-chunk loop), `image_scanner` (inline data-URL scan).

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::AppHandle;

use rig_core::message::Message;

use crate::errors::AppError;

mod drain;
mod image_scanner;
mod params;
mod session_store;
mod stream;

use params::{build_user_message, history_flags, ChatParams, HistoryMode};
use session_store::{load_history, save_history, HistoryMsg};
use stream::run_provider_stream;

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

    let prompt_msg = build_user_message(
        params.prompt.as_str(),
        params.images.as_deref(),
        &on_event,
    );
    let (full, assistant_images) =
        run_provider_stream(&params, &prompt_msg, &history, &on_event).await?;

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

#[cfg(test)]
mod tests {
    use super::image_scanner::{
        could_start_data_url, find_data_url_prefix, partial_data_url_prefix_len, ImageScanner,
        ScanEvent,
    };

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
