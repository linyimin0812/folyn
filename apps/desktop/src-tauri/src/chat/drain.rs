//! Drain a rig streaming chat into accumulated text + frontend chunks.
//! Pure move from `chat.rs` — no logic changed.

use futures::StreamExt;

use rig_core::agent::MultiTurnStreamItem;
use rig_core::message::{ReasoningContent, Text};
use rig_core::streaming::StreamedAssistantContent;
use tauri::ipc::Channel;

use super::image_scanner::{ImageScanner, ScanEvent};
use super::{AssistantImage, ChatChunk};

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
pub(super) async fn drain_loop<S, R, E>(
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
