# Bubble Template AI Agent

## Problem Statement

As a Quill user, I want AI to help me generate custom bubble templates for notifications, because writing `BubbleTemplate` HTML/CSS by hand is tedious and error-prone — I have to know the mustache-like syntax, the available payload fields, the DOMPurify sanitization constraints, the `id='default'` collision rule, and the size conventions. Hand-editing JSON also invites schema mistakes. I want to describe what I want in natural language (or supply an HTML file / design image), iterate with the AI on the draft, and import the final template into the same `BubbleTemplateBlock` flow that already handles user-pasted JSON.

## Solution

Add an "AI 生成" entry point inside `BubbleTemplateBlock` (settings → notifications). Clicking it opens a modal chat dialog backed by `runRigChat` (multi-turn, tool-free LLM chat — the same rig backend path used by PetChat's chat mode). The AI clarifies the user's intent over multiple turns, drafts a `BubbleTemplate`, and emits the final JSON in a `\`\`json` fenced code block. The modal scans the assistant's last reply for that fence, renders an "导入此模板" button, and on click runs the existing `tryImport` validator — so the AI-generated template enters the same path as user-pasted JSON, including id-collision detection and DOMPurify sanitization at render time.

Input modes:
- **Free text** — the user types a description or refinement.
- **HTML upload** — the user picks a `.html`/`.htm` file; it is read as text and injected into the user's chat message as a transformation request.
- **Image upload** — the user picks an image file (PNG/JPG/WebP); it is sent as an image content block in the chat message. Requires extending the rig backend (`chat_stream` Rust command) to accept image content blocks and serialize them per-provider (Anthropic image block vs OpenAI `image_url`).

The "AI Agent" label is user-facing; the mechanism is chat, not an agent loop. See ADR-0001.

## User Stories

1. As a Quill user, I want an "AI 生成" button below my bubble template list in settings, so that I can draft a new template without writing HTML/CSS by hand.
2. As a Quill user, when I click "AI 生成", I want a modal chat dialog to open, so that I can converse with the AI without leaving the settings page.
3. As a Quill user, I want to type a natural-language description of the template I want (e.g., "birthday reminder card with a cake icon and a primary '查看' button"), so that the AI can draft a `BubbleTemplate` matching my description.
4. As a Quill user, I want the AI to ask me clarifying questions when my request is vague, so that the resulting template matches what I actually want (e.g., "Should this card have an image? What actions?").
5. As a Quill user, I want to iterate — type, get a draft, refine, get another draft — so that I can converge on a template I'm happy with.
6. As a Quill user, I want the AI's final draft to appear as a `\`\`json` code block in its reply, so that the modal can detect it and offer an "导入此模板" button.
7. As a Quill user, I want an "导入此模板" button to appear next to the AI's JSON draft, so that I can accept the draft and add the template to my user templates list with one click.
8. As a Quill user, when I click "导入此模板", I want the template to be validated and added via the same flow as pasted JSON, so that id collisions and schema errors are caught the same way regardless of where the template came from.
9. As a Quill user, if the AI's JSON is malformed or missing required fields, I want to see the same error message that pasting bad JSON would produce, so that I can tell the AI to fix it in the next turn.
10. As a Quill user, when I successfully import a template, I want the modal to close and the new template to appear in my template grid, so that I can immediately activate or preview it.
11. As a Quill user, I want to upload a `.html`/`.htm` file via a paperclip button in the chat input, so that I can hand the AI an existing HTML design to adapt into a `BubbleTemplate` that passes DOMPurify sanitization.
12. As a Quill user, I want to upload an image file (PNG/JPG/WebP) via the same paperclip button, so that the AI can generate a `BubbleTemplate` that visually matches the image (image-to-code).
13. As a Quill user, when I upload multiple files in one turn, I want each to be attached as a chip above the chat input, so that I can review what's pending before sending.
14. As a Quill user, when I upload an image, I want a thumbnail preview in the attachment chip, so that I can confirm I picked the right file.
15. As a Quill user, when I upload an HTML file, I want a file-name chip (not a thumbnail), so that the attachment is distinguishable from images.
16. As a Quill user, I want the modal to remember my chat session across closes/reopens, so that I don't lose an in-progress draft when I accidentally close the modal.
17. As a Quill user, I want a "清空" (clear) button in the modal, so that I can start a fresh conversation when my current direction is wrong.
18. As a Quill user, I want streaming responses from the AI, so that I see progress instead of waiting for a long pause.
19. As a Quill user, I want a loading state on the send button while the AI is responding, so that I don't double-send.
20. As a Quill user, if the API call fails (network error, auth error, rate limit), I want to see the error message inline, so that I can fix my config and retry.
21. As a Quill user, if I haven't configured an AI provider/key in settings yet, I want a clear message pointing me to the AI settings, so that I'm not stuck guessing why the chat doesn't work.
22. As a Quill user, I want the AI to know the `BubbleTemplate` schema, the template syntax, the sanitization constraints, the available payload fields, and the `id='default'` collision rule, so that its drafts are valid on the first try.
23. As a Quill user, I want the AI to be shown the built-in Cloudia template as a concrete example, so that its drafts match the project's style and conventions.
24. As a Quill user, I want the AI to know I might upload HTML or images, so that it doesn't need me to explain what each uploaded input means.
25. As a Quill user, I want my AI-generated template to be sanitized by DOMPurify at render time just like every other template, so that I'm protected from any unsafe HTML the AI might emit (defense in depth).
26. As a Quill user, when I activate an AI-generated template and trigger a preview notification, I want the bubble to render correctly, so that I can verify the template works end-to-end.

## Implementation Decisions

### Architecture

- **Mechanism**: multi-turn chat via `runRigChat`. NOT `runFeatureAgent`, NOT `buildPluginAi.agent`. See ADR-0001 for the rejected alternatives and rationale.
- **UI**: modal dialog rendered inside the settings page, mounted on demand when "AI 生成" is clicked. Reuses `ChatMessageList` + `ChatInputBox` (the shared chat primitives from `components/chat/`). Does NOT reuse `PetChat` or `petChatService` — those carry vault/mode/attachment machinery that doesn't apply to a settings-page template generator.
- **State**: a small dedicated store (or local React state in the modal) holds sessionId, message list, pending attachments, loading/error state. NOT wired into `petChatStore` or `aiStore`.

### Backend extension (rig chat)

- The `chat_stream` Tauri command (`src-tauri/src/chat.rs`) is extended to accept an optional `images` field on `ChatParams`: an array of `{ data: string (base64), media_type: string }`.
- `HistoryMsg` is changed from a flat `{ role, content: String }` struct to an enum or struct that can carry mixed content (text + images). On-disk format must be migrated or versioned — existing single-text-per-turn entries stay valid; new entries may carry images.
- Provider-side serialization: Anthropic uses `{"type": "image", "source": {"type": "base64", "media_type": "...", "data": "..."}}`; OpenAI uses `{"type": "image_url", "image_url": {"url": "data:...;base64,..."}}`. The `openai-compatible` flavor inherits the OpenAI shape; Ollama and other backends that lack vision support will return an error from the provider, surfaced to the user via the existing `ChatChunk::Error` path.
- rig 0.40 already has an `Image` type (`completion/message.rs`) with `DocumentSourceKind::Base64` + `media_type`; the backend uses it to build `Message::User` with mixed `UserContent::Text` + `UserContent::Image` parts.

### Frontend

- A new modal component (working name `BubbleTemplateAIChatModal`) renders inside `BubbleTemplateBlock`. It owns: the chat session, the file-picker, the JSON-fence-extraction + import button, the sessionId persistence.
- `ChatInputBox`'s `leadingSlot` prop hosts a single paperclip button (`accept=".html,.htm,image/*"`). On file pick, MIME-dispatch: `image/*` → read as base64 + push a `PendingAttachment` with `type='image'`; `text/html` → read as text + push a `PendingAttachment` with `type='file'`, and the text is wrapped into the user's prompt at send time.
- Attachment chips reuse `PendingAttachment` (from `components/chat/attachments.ts`) — image type shows thumbnail via `previewUrl`, HTML type shows file-name icon.
- On send: text prompt + any pending HTML-as-text wrapping + any pending image content blocks are passed to `runRigChat` (which now accepts an optional `images` param).
- On each assistant reply: scan for the last `\`\`json` fenced block. If present, show "导入此模板" button. On click: extract the JSON text, call `tryImport(text)` (the existing validator in `NotificationsSettings`), and on success close the modal. On failure (parse/schema/collision), display the same error path as paste-JSON.
- "清空" button: clears the session — generates a fresh `sessionId` via `crypto.randomUUID()`, resets the in-memory message list. The old `~/.quill/chat-sessions/<old-id>.json` file is left as orphan (harmless).
- sessionId persistence: stored in `localStorage` (or `petStore`'s persistence slice — TBD at implement time) so the modal rehydrates the prior chat on reopen.

### System prompt

- Built at modal-mount time. Static portion (hard-coded): `BubbleTemplate` JSON schema (id, name, html, css, fields?, size?); template syntax (`{{key}}` scalar with dotted paths, `{{#key}}…{{/key}}` block — array iteration / truthy-once / falsy-drop, no nesting, auto HTML-escape of scalars); available payload fields (`text` required, `title?`, `kind?`, `source?`, `actions?: [{id, label, kind?}]`, `data.*`); DOMPurify constraints (forbidden tags: script/style/link/iframe/object/embed/form/input/textarea, `on*` attrs stripped, CSP blocks remote resources so no external CSS/JS/fonts/images); id constraint (must not be `'default'` or any built-in id; suggested `ai-` prefix); size guidance (default 320×120, Cloudia uses 378×224, scale with content); output format (`\`\`json` fenced BubbleTemplate JSON in the final reply).
- Dynamic portion: `JSON.stringify(BUILT_IN_TEMPLATES)` is inlined into the prompt as concrete examples. Auto-stays-in-sync with built-in changes.
- Upload awareness (Q8): the prompt tells the AI the user may upload an HTML file (adapt to BubbleTemplate, strip unsafe tags/attrs) or an image (generate a BubbleTemplate matching the image visually).

### Sanitization

- The AI's HTML is NOT trusted. Defense in depth: AI output flows through the existing `BubbleTemplate` render path, which already HTML-escapes scalar substitutions, runs DOMPurify (`sanitizeBubbleHtml`), and ships a CSP meta on the bubble window. No new sanitization code.
- This is a security boundary, not a design decision — non-negotiable.

### Session lifecycle

- `sessionId` persists across modal reopens. On first open, generate `crypto.randomUUID()`. On reopen, reuse the stored id (rig backend rehydrates history from `~/.quill/chat-sessions/<id>.json`). "清空" generates a new id and updates persistence.
- Orphaned session JSON files (after "清空" or after the user never reopens) are not garbage-collected — they are small (KB) and live under `~/.quill/chat-sessions/`. Acceptable.

### ADR-0001

- The "use multi-turn chat, not agent loop" decision is recorded in `docs/adr/0001-bubble-template-ai-agent-chat-not-loop.md`. The implementation must conform — do not silently switch to `runFeatureAgent` mid-implementation.

## Testing Decisions

### What makes a good test here

Test external behavior, not implementation. The modal should be tested as a black box — "user types X, AI replies Y, the import button appears" — without asserting on internal state shape or prompt text verbatim. The pure JSON-fence extraction logic is small enough to unit-test its edge cases. The `runRigChat` extension is tested at the TS service boundary (mock `invoke`) — the Rust serialization is mechanical and covered by code review.

### Seams (agreed with user)

1. **`extractLastJsonFence(markdownText): string | null`** — pure util, new unit test. Cases: no fence → null; one fence → that fence's content; multiple fences → last fence's content; malformed JSON inside fence → still extracted (parser's job to reject later); code fence inside a code fence (unlikely from LLMs, but the regex should be greedy-non-greedy-correct).
2. **`runRigChat` image params** — extend existing `rigChat.test.ts`. Verify that when called with `images: [{data, mediaType}]`, the `invoke('chat_stream', ...)` call's `params` field carries the images array in the expected shape. Provider-side serialization (Anthropic vs OpenAI) is the Rust backend's job and is NOT tested here — but the TS-side contract is.
3. **`BubbleTemplateAIChatModal` component** — new component test. End-to-end: mount the modal → simulate user typing + clicking send → mock `runRigChat` to stream an assistant reply containing a `\`\`json` fence → assert "导入此模板" button appears → click it → assert `tryImport` (or the equivalent store action) is called with the extracted JSON → assert modal closes. Also: malformed JSON in the fence → error path shows the right message → modal stays open.

### Prior art

- `bubbleTemplate.test.ts` — tests the existing template engine (render, sanitize, blocks). The new tests follow the same Vitest patterns.
- `rigChat.test.ts` — mocks `@tauri-apps/api/core`'s `invoke` and `Channel`. The image-param test extends this pattern directly.
- `PetChat.test.tsx` — component test pattern for a chat surface. Useful as a reference for the modal test setup.

### Rust backend tests

- Not included in V1. `src-tauri/` does not have an existing test framework wired up for chat. The TS-side `runRigChat` test (#2) covers the frontend-Rust contract; provider-specific image serialization in `chat.rs` is mechanical and code-reviewed. If provider-compatibility issues emerge in real use, add Rust integration tests then.

## Out of Scope

- **Editing an existing template via AI** — the AI generates new templates only. Editing is a future enhancement (let the user pick an existing template and ask the AI to revise it).
- **Live preview of the draft template as the AI streams** — the modal shows the AI's text reply; the "导入此模板" button only appears after the AI emits a `\`\`json` fence. A real-time rendered preview of the bubble as the AI drafts is a future enhancement.
- **Streaming structured-output / `response_format: json`** — the AI is asked to emit JSON in a markdown code fence; we do not use provider-specific structured-output features (which Anthropic's native API doesn't support directly, and which would couple us to provider capabilities).
- **Multi-file uploads in one turn** — the paperclip accepts one file per pick. Multiple picks in one turn are supported as multiple chips, but each is a separate attachment; no batched transformation API.
- **Agent loop / tool use** — see ADR-0001. Rejected for this feature.
- **Plugin integration** — the bubble-template generator is desktop-internal, not exposed through `buildPluginAi`. Plugins continue to use the existing `ai.chat` / `ai.agent` capability for their own AI needs.
- **Garbage collection of orphaned chat-session JSON files** — see Implementation Decisions. Acceptable as-is.
- **Drag-and-drop / paste-image in the modal** — PetChat has these; the modal's V1 uses only the paperclip file-picker. Defer.
- **i18n of the AI's replies** — the AI replies in whatever language the user types. We do not force a language.
- **Cost/token tracking** — not surfaced to the user in V1.

## Further Notes

- **Domain glossary updated**: `CONTEXT.md` now defines "Bubble Template AI Agent" with explicit disambiguation from "Feature Agent" (which is `runFeatureAgent`-backed) and "Plugin Agent" (which is `buildPluginAi.agent`-backed). Future contributors reading the UI label "AI Agent" should consult the glossary before assuming the mechanism.
- **ADR-0001** is the authoritative record of the chat-vs-agent-loop decision. If a future contributor pushes to switch to an agent loop, point them at the ADR and require them to supersede it via ADR-0002 with explicit reasoning.
- **Sequencing suggestion for `/to-tickets`** (next step in the main flow): tracer-bullet order should be backend-first — (1) extend `chat.rs` for image content blocks + extend `runRigChat` TS-side; (2) build the modal skeleton with text-only chat working end-to-end; (3) wire `tryImport` + "导入此模板" + `extractLastJsonFence`; (4) wire HTML upload (zero backend, should be quick); (5) wire image upload using the backend from (1); (6) system prompt + sessionId persistence + "清空" button + i18n + tests. This order front-loads the risky backend work so the UI can be built on a validated contract.
