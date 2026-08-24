# Bubble Template AI Agent uses multi-turn chat, not an agent loop

The "AI Agent" button in `BubbleTemplateBlock` (settings → notifications) is backed by `runRigChat` — a multi-turn, tool-free LLM chat — not by `runFeatureAgent` (the `claude-cli` sidecar agent loop with file tools). The label "AI Agent" is user-facing; the mechanism is chat.

## Considered Options

- **(a) Multi-turn chat via `runRigChat`** (accepted) — the task is "clarify intent, draft a `BubbleTemplate` JSON, emit it"; no tools, no file access, no self-sanitization needed. Multi-turn lets the AI ask clarifying questions and iterate. History persisted by the rig backend keyed by `sessionId`.
- **(b) Full agent loop via `runFeatureAgent`** (rejected) — `claude-cli` sidecar with Read/Write/Bash tools. Overkill: generating ~200 lines of HTML/CSS doesn't need file-system access or multi-step tool reasoning. Adds process-startup latency + CLI binary dependency for a settings-page button.
- **(c) Plugin-provided agent via `buildPluginAi.agent`** (rejected) — same underlying mechanism as (b) plus a plugin-manifest permission layer. But the bubble-template generator is a desktop-internal settings UI, not a plugin context, so there's no manifest to carry the `permissions.ai.agents` declaration. (b) and (c) share the same backend; the distinction was a red herring during grilling.

## Consequences

- **UI label vs. mechanism mismatch.** "AI Agent" suggests an agent loop to anyone reading the UI; the code underneath is chat. This is recorded explicitly in `CONTEXT.md` to prevent future readers from "fixing" the chat path into an agent loop thinking it was a mistake.
- **System prompt is load-bearing.** With no tools and no file access, the AI must be told the `BubbleTemplate` schema, the mustache-like template syntax, the DOMPurify sanitization constraints, the `id='default'` collision rule, and the expected `\`\`\`json` output format. See Q4 of the grilling session.
- **Image upload requires extending the rig backend.** `chat.rs` currently accepts `prompt: String` only. Supporting image content blocks needs `ChatParams.images`, `HistoryMsg` as an enum, and provider-specific serialization (Anthropic image block vs OpenAI `image_url`). HTML upload needs no backend change — HTML is text, injected into the prompt.
- **Handoff protocol.** The chat does not call `addTemplate` directly. AI emits a `\`\`\`json` fenced `BubbleTemplate` JSON in its final reply; the modal scans for the last fence, shows an "导入此模板" button, and on click runs the existing `tryImport` validator — same path as user-pasted JSON. Sanitization (DOMPurify + CSP) is enforced at render time regardless of where the HTML came from.
- **Session lifecycle.** `sessionId` persists across modal reopens (Q7=c); a "清空" button resets it. Orphaned session files in `~/.folyn/chat-sessions/` are harmless.

## Status

Accepted.
