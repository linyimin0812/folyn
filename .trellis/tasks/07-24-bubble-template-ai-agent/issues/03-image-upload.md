# 03 — Image file upload input mode (Rust backend + frontend wiring)

**What to build:** End-to-end image upload: the user picks an image (PNG/JPG/WebP) via the same paperclip from T2. The file is read as base64 via `readAsDataURL`, an image chip with thumbnail preview is shown, and on send the image travels as an image content block in the chat message. The Rust `chat_stream` command (`src-tauri/src/chat.rs`) is extended: `ChatParams` gets `images: Option<Vec<{data: String (base64), media_type: String}>>`; `HistoryMsg` grows an optional `images` field (backward-compatible with existing single-text session files via `Option`); provider-side serialization branches — Anthropic uses `{"type":"image","source":{"type":"base64","media_type":...,"data":...}}`, OpenAI/openai-compatible uses `{"type":"image_url","image_url":{"url":"data:...;base64,..."}}`. TS-side `runRigChat` accepts an optional `images` param and forwards it. On backends without vision (e.g., some Ollama models), the provider returns an error surfaced via the existing `ChatChunk::Error` path.

**Blocked by:** 02 — extends the paperclip dispatch logic from T2.

**Status:** ready-for-agent

- [ ] Paperclip dispatch: `file.type.startsWith('image/')` → `readAsDataURL` → base64 + media_type → `PendingAttachment(type='image', previewUrl)` chip with thumbnail
- [ ] On send, `runRigChat` called with `images: [{data: base64, mediaType}]` (in addition to the text prompt)
- [ ] `runRigChat` TS signature extended with optional `images` param; passed through to `invoke('chat_stream', {params: {..., images}})`
- [ ] `chat.rs` `ChatParams` extended with `images: Option<Vec<ImageInput>>`; `HistoryMsg` gains optional `images` field; old session files (no `images`) still deserialize cleanly
- [ ] Anthropic provider: image serialized as `{"type":"image","source":{"type":"base64","media_type":...,"data":...}}` content block alongside `Text`
- [ ] OpenAI / openai-compatible: image serialized as `{"type":"image_url","image_url":{"url":"data:...;base64,..."}}`
- [ ] Provider returns error on non-vision backends → `ChatChunk::Error` → user sees message in modal
- [ ] `rigChat.test.ts` extended: passing `images` to `runRigChat` results in `invoke` receiving `params.images` in the expected shape
- [ ] Modal component test extended: image-pick path attaches image chip; send invokes `runRigChat` with images
- [ ] User can complete a real image→template flow with a vision-capable model (manual verification, since automated vision tests are out of scope)
