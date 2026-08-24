# chat-streaming-render-mixed-text-image-save-to-vault

## Goal

Enhance the chat rendering pipeline so assistant messages that mix text and
inline image data (image-generation models returning base64) render correctly
*while streaming*, support multi-segment text+image+text output, and let the
user save generated images into the active vault under `__attachments__/`.

## What I already know

* Chat mode = `rigChat.ts` (TS) → `chat_stream` Tauri command (Rust, `chat.rs`).
  Deltas arrive as `CliStreamEvent` `{ type: 'text', content }`. Rust
  `drain_loop` only matches `StreamedAssistantContent::Text` /
  `Reasoning` — image models emit the rendered image as a `data:image/...;base64,...`
  text delta, no native Image variant on the rig stream side.
* `MessageContent.tsx` has a one-line regex that short-circuits to `<img>` ONLY
  when the entire content blob is a single data URL. Partial mid-stream base64
  or interleaved text+image+text falls through to markdown as a base64 blob.
* `MessageContent` `useMemo(processSync(content))` re-parses the entire
  markdown pipeline on every delta → O(n²) for long streamed messages.
* `ChatMessageList` has `onSaveToWiki` for text; no image-save hook.
* `saveToWiki` (wikiQueryService.ts:103) writes a markdown file into the vault;
  mirror its pattern for image binary writes.
* `vaultStore` exposes file-write APIs.
* Chat history (`~/.mochi/chat-sessions/<id>.json`) stores `{role, content}`
  for assistant turns; no image field.

## Requirements

* **Rust**: `drain_loop` becomes a state machine that detects `data:image/...;base64,...`
  runs inside incoming Text deltas. Text outside runs emits as `ChatChunk::Delta`;
  completed data URLs emit as a new `ChatChunk::Image { data, media_type }` chunk.
  Trailing partial base64 at stream end is emitted as a final Image (best-effort).
* **TS**: `ChatChunk` and `CliStreamEvent` gain an `image` variant carrying
  `{ data: string; mediaType: string }`. `rigChat.ts` translates the new chunk
  to the new event. `CliMessage` gains optional `images?: { data; mediaType; atOffset: number }[]`
  (offset = character position in `content` where the image was emitted;
  pure-text `content` is preserved for copy/wiki/legacy).
* **Streaming render**: `MessageContent` splits `content` at image offsets into
  ordered text/image segments, memoizing each text segment by its content so
  prior segments don't re-parse when new deltas arrive. Only the trailing
  (growing) text segment re-parses on each delta.
* **Save to vault**: each image segment renders an `<img>` plus a "保存到 vault"
  button. The button calls a new `saveImageToVault(data, mediaType)` that
  writes `<vault>/__attachments__/img-<YYYYMMDD-HHMMSS>-<short>.<ext>` via
  `vaultStore`. Success/failure shows inline feedback. No active vault →
  button disabled with a tooltip.
* **Surface**: both AiPanel and Pet chat (shared `ChatMessageList` /
  `MessageContent` carry the change). Pet chat wires the active vault id into
  the save handler.
* **History**: assistant `HistoryMsg` gains optional `images` field; on reload,
  images re-render at their persisted offsets. Images are NOT fed back into
  the rig provider request (assistant images aren't valid provider history).

## Acceptance Criteria

* [ ] Streaming an assistant message that emits `text → image → text` renders
  all three segments in order at every delta; no base64 blob is ever visible.
* [ ] "保存到 vault" button on an image segment writes the decoded bytes to
  `<active-vault>/__attachments__/img-<ts>-<short>.<ext>` and shows "已保存"
  feedback (or error tooltip on failure).
* [ ] No active vault → save button disabled with tooltip "未激活 vault".
* [ ] A 5k-token streamed text message does not visibly stutter compared to
  the pre-change baseline (loose perf gate; backed by per-segment memoization).
* [ ] Reopening a chat session renders previously-saved assistant images inline
  at their original positions.
* [ ] Existing `MessageContent.test.tsx` + `ChatMessageList.test.tsx` cases
  pass; new tests cover segment-splitting, image-save, and the streaming
  state machine (`drain_loop`).

## Definition of Done

* Tests added/updated (Rust unit tests for the state machine; TS unit tests
  for segment-splitting + save; integration test for save path).
* `cargo test` + `pnpm test` + lint/typecheck green.
* No regression in existing chat rendering.
* `ponytail:` comments on deliberate simplifications.

## Technical Approach

### Rust side (`apps/desktop/src-tauri/src/chat.rs`)

Add `ChatChunk::Image { data: String, media_type: String }`. Replace
`drain_loop` with a stateful scanner:

```
state = Text
buf = String  // image buffer when in Image state
for each Text delta:
    cursor = 0
    while cursor < len(delta):
        if state == Text:
            scan delta[cursor..] for `data:image/<mt>;base64,` prefix
            if found at p:
                emit Delta(delta[cursor..p])
                state = Image
                buf = matched_prefix
                cursor = p + len(matched_prefix)
                # remember media_type for the Image chunk
            else:
                emit Delta(delta[cursor..])
                break
        else: # Image
            # consume base64 chars [A-Za-z0-9+/=] until non-base64 or end
            scan delta[cursor..] for first non-base64 char at q
            if q == cursor:  # delta starts with non-base64 → image complete
                emit Image { data: buf, media_type }
                state = Text
                buf.clear()
                # don't advance cursor; re-process delta[cursor..] as Text
            else:
                buf.push_str(delta[cursor..q])
                if q < len(delta):
                    # non-base64 char terminates the run
                    emit Image { data: buf, media_type }
                    state = Text
                    buf.clear()
                    cursor = q
                else:
                    break  # entire delta consumed as base64, stay in Image
on stream end:
    if state == Image and !buf.is_empty():
        emit Image { data: buf, media_type }  # best-effort final flush
```

Persist assistant images in `HistoryMsg`:
```rust
struct HistoryMsg {
    role: String,
    content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    images: Option<Vec<AssistantImage>>,
}
struct AssistantImage { data: String, media_type: String, at_offset: usize }
```
On save: `images: Some(vec![...])` for assistant turns that emitted Image chunks.
On load: pass through to frontend; NOT fed back into rig `Message::assistant`.

### TS side

`packages/cli-adapter/src/types.ts`:
```ts
export type CliStreamEventType =
  | 'text' | 'thinking' | 'tool_start' | 'tool_end'
  | 'file_change' | 'session_id' | 'error' | 'done'
  | 'image';
export interface CliStreamEvent {
  // ...
  imageData?: { data: string; mediaType: string };  // present when type === 'image'
}
export interface AssistantImage {
  data: string;
  mediaType: string;
  atOffset: number;
}
export interface CliMessage {
  // ...
  images?: AssistantImage[];  // assistant messages only
}
```

`apps/desktop/src/services/rigChat.ts`: handle new `image` ChatChunk → emit
`CliStreamEvent { type: 'image', imageData: { data, mediaType } }`.

`aiStore` + `petChatStore`: on `image` event, push
`{ data, mediaType, atOffset: currentMsg.content.length }` to the streaming
assistant message's `images[]`. (Image events never extend `content`; the
offset is where the image sits in the rendered output.)

`MessageContent.tsx`:
```ts
type Segment = { type: 'text'; value: string } | { type: 'image'; value: AssistantImage };
function splitSegments(content: string, images?: AssistantImage[]): Segment[] {
  if (!images || images.length === 0) return [{ type: 'text', value: content }];
  // sort by offset, interleave
  const sorted = [...images].sort((a, b) => a.atOffset - b.atOffset);
  const segs: Segment[] = [];
  let cursor = 0;
  for (const img of sorted) {
    if (img.atOffset > cursor) segs.push({ type: 'text', value: content.slice(cursor, img.atOffset) });
    segs.push({ type: 'image', value: img });
    cursor = img.atOffset;
  }
  if (cursor < content.length) segs.push({ type: 'text', value: content.slice(cursor) });
  return segs;
}
```
Render: each text segment memoized via `useMemo` keyed on its value (stable
across deltas once a new image arrives). Image segment renders `<img src={dataUrl}>`
+ a "保存到 vault" button.

`saveImageToVault(data: string, mediaType: string): Promise<string>`:
- decode base64 → Uint8Array
- ext from mediaType (`image/png` → `png`, etc.)
- name: `img-${ts YYYYMMDD-HHMMSS}-${shortId}.${ext}`
- path: `<active-vault-root>/__attachments__/<name>`
- write via vaultStore; create `__attachments__/` if missing
- return the path or throw

`ChatMessageList`: add `onSaveImage?: (img: AssistantImage) => Promise<void> | void`
prop. AiPanel passes a bound `saveImageToVault`; Pet chat passes the same
with the active vault id resolved from `vaultConfigStore`.

## Decision (ADR-lite)

**Context**: Image-generation models return base64 image data as text deltas.
Frontend-only detection (Option A) would scan accumulated text per delta —
correct but spreads parsing logic across TS and re-introduces the O(n²) reparse
problem we're trying to fix.

**Decision**: Implement a native `ChatChunk::Image` variant. Rust runs a
stateful scanner over Text deltas and emits structured Image events; TS renders
without scanning. Persisted history carries assistant images as a separate
field, not fed back to the provider.

**Consequences**: +1 to the cross-stack surface (Rust + TS types + two stores
+ two components), but the data flow is cleaner and the per-delta frontend
cost drops to O(delta size) instead of O(accumulated size). The Rust scanner
is ~30 lines of state machine, unit-testable in isolation. Risk: state
machine bugs (e.g. stuck in Image state) → mitigate with the end-of-stream
flush + unit tests.

## Out of Scope

* Native rig image stream variant (rig 0.40 has no uniform image API; we
  detect via text scan in Rust, which is the same result with less upstream
  coupling).
* Image *input* (multimodal user attachments) — already plumbed via
  `RigChatParams.images`; not changing here.
* Generating image into wiki page (markdown wrapper) — direct file only.
* Image variant for the CLI adapter path (Claude Code / ask mode) — those
  paths don't return inline images today.

## Implementation Plan (small PRs)

* **PR1 — Rust state machine + types**:
  `ChatChunk::Image`, `drain_loop` rewrite, `HistoryMsg.images`, unit tests
  for the scanner (text-only, single image, image+text+image, partial-at-end,
  multi-delta-image). No frontend wiring yet.
* **PR2 — TS types + event plumbing**:
  `CliStreamEvent` image variant, `CliMessage.images`, `rigChat.ts`
  translation, `aiStore` + `petChatStore` event handlers. No UI changes.
* **PR3 — Render + save UI**:
  `MessageContent` segment splitter + memoization, save button, new tests.
* **PR4 — Vault save + integration**:
  `saveImageToVault`, wire `onSaveImage` in AiPanel + Pet chat, integration
  test for the round-trip (stream → render → save → file exists).

## Technical Notes

* `apps/desktop/src/components/chat/MessageContent.tsx`
* `apps/desktop/src/components/chat/ChatMessageList.tsx`
* `apps/desktop/src/services/rigChat.ts`
* `apps/desktop/src-tauri/src/chat.rs` (`drain_loop`)
* `apps/desktop/src/services/wikiQueryService.ts` (saveToWiki pattern)
* `apps/desktop/src/store/vaultStore.ts`, `vaultConfigStore.ts`
* `apps/desktop/src/store/aiStore.ts`, `petChatStore.ts`
* `packages/cli-adapter/src/types.ts`
