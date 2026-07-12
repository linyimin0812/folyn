# Research: rig-core integration into a Tauri 2 desktop app

- **Query**: How to integrate the Rust `rig-core` LLM library into the Tauri 2 Rust backend of `apps/desktop/src-tauri` — core API, streaming, provider config, chat history, tool-free mode, Tauri Channel streaming, dependency line, pitfalls.
- **Scope**: external (rig-core crate source) + internal (project's existing Tauri commands)
- **Date**: 2026-07-11 (verified against live crates.io index via `cargo info`/`cargo search`)

## Version ground truth (LIVE-VERIFIED 2026-07-11)

- **rig-core = 0.40.0** — confirmed as the **latest published version** on crates.io via `cargo info rig-core` and `cargo search rig-core`, both of which refreshed the crates.io index ("Updating crates.io index") on 2026-07-11. This is no longer a stale-cache guess.
- **Repository: `https://github.com/0xPlaygrounds/rig`** — confirmed via `cargo info` `repository:` field (crates.io metadata, not inferred). The org is **`0xPlaygrounds`** (NOT "0xPlaytime" — that was an earlier unverified guess; the crates.io `repository` field is authoritative).
- **Crate name `rig-core`, lib name `rig_core`** — `Cargo.toml` `[lib] name = "rig_core"`. README and doc examples use `use rig_core::...`. There is also a facade crate `rig = "0.40.0"` (same version, re-exports `rig-core`); the task asks for `rig-core` so we use that directly.
- **Edition: 2024.** docs.rs: `https://docs.rs/rig-core/0.40.0/rig_core/`. Book: `https://docs.rig.rs`. crates.io: `https://crates.io/crates/rig-core/0.40.0`.
- **Features** (from `cargo info`):
  ```
  +default           = [reqwest, derive, rustls]
   derive            = [dep:rig-derive]
   reqwest           = [reqwest/charset, reqwest/http2, reqwest/system-proxy]
   rustls            = [reqwest/rustls, tokio-tungstenite?/rustls-tls-webpki-roots]
   audio, discord-bot, epub, image, native-tls, pdf, rayon,
   reqwest-middleware, reqwest-middleware-native-tls, reqwest-middleware-rustls,
   rmcp, socks, test-utils, wasm, websocket, websocket-native-tls, websocket-rustls
  ```

Source files cited below live under:
`~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rig-core-0.40.0/`
This is the published 0.40.0 artifact (the same bytes crates.io serves), so since 0.40.0 is the latest version, the API below is current.

---

## 1. Core API — client, model, completion call

There are two surfaces: the **low-level completion model** and the **high-level `Agent`**. The README's canonical example (verified verbatim from `README.md`):

```rust
use rig_core::{client::{CompletionClient, ProviderClient}, completion::Prompt, providers::openai};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let openai_client = openai::Client::from_env()?;            // needs OPENAI_API_KEY
    let agent = openai_client.agent(openai::GPT_5_2).build();   // AgentBuilder -> Agent
    let response = agent.prompt("Who are you?").await?;         // Prompt::prompt -> String
    println!("{response}");
    Ok(())
}
```
(README.md L24-50)

**Two traits are needed in scope**:
- `client::ProviderClient` (defined `src/client/mod.rs` L113-129) — provides `from_env()` / `from_val()`.
- `client::CompletionClient` (`src/client/completion.rs` L9) — provides `.agent(model)` (L50, returns `AgentBuilder`), `.completion_model(model)` (L17), `.extractor(model)` (L40).
- `completion::Prompt` (`src/completion/request.rs` L371) — provides `.prompt()`.

### Client construction (OpenAI)
- `openai::Client::new("KEY")` — default base URL `https://api.openai.com/v1`, bearer auth. (`Client::new` in `src/client/mod.rs` L330-341)
- `openai::Client::from_env()` — reads `OPENAI_API_KEY` (required) and `OPENAI_BASE_URL` (optional). (`src/providers/openai/client.rs` L264-275)
- `openai::Client::builder().api_key("KEY").base_url("...").build()` — explicit. (`src/client/mod.rs` L430 `builder()`, L602-613 `api_key`, L644-653 `base_url`, L712/L728 `build`)

### Model constants (OpenAI)
Defined in `src/providers/openai/completion/mod.rs` L42-105:
`GPT_5_5 = "gpt-5.5"`, `GPT_5_2 = "gpt-5.2"`, `GPT_5_1`, `GPT_5`, `GPT_5_MINI`, `GPT_5_NANO`, `GPT_4_5_PREVIEW`, `GPT_4O`, `GPT_4O_MINI`, `GPT_4_TURBO`, `O4_MINI`, `O3`, `O3_MINI`, `O1`, `O1_PRO`, etc. Any `&str` model id also works via `impl Into<String>`.

### Two OpenAI client flavors
- `openai::Client` (default) targets the **Responses API**. `.completions_api()` (L191) switches to the **Chat Completions API** flavor (`CompletionsClient`). (`src/providers/openai/client.rs` L49-56, L185-196, L251-257)
- For OpenAI-compatible local providers (Ollama, llamafile, LM Studio, vLLM), prefer `openai::Client::builder().api_key(k).base_url(url).build()` **and** call `.with_system_instructions_as_messages()` (L185-187) so the system prompt is sent as `system` messages instead of top-level `instructions` (which some compatible servers reject).

### Other providers (same shape)
- **Anthropic**: `providers::anthropic::Client::from_env()` reads `ANTHROPIC_API_KEY` + optional `ANTHROPIC_BASE_URL` (default `https://api.anthropic.com`). Constants in `src/providers/anthropic/completion.rs` L25-37: `CLAUDE_OPUS_4_6 = "claude-opus-4-6"`, `CLAUDE_OPUS_4_7`, `CLAUDE_OPUS_4_8 = "claude-opus-4-8"`, `CLAUDE_SONNET_4_6 = "claude-sonnet-4-6"`, `CLAUDE_HAIKU_4_5 = "claude-haiku-4-5"`. (`from_env` at `src/providers/anthropic/client.rs` L111-122)
- **Gemini**: `providers::gemini::Client::from_env()` reads `GEMINI_API_KEY`. (`src/providers/gemini/client.rs` L184-186)
- Other built-ins in `src/providers/`: azure, deepseek, groq, mistral, ollama, openrouter, together, xai, huggingface, hyperbolic, llamafile, minimax, mira, moonshot, perplexity, voyage, cohere, etc. (README L46-74 lists 20+.)

### High-level Agent + `Prompt`
- `client.agent(model)` returns `AgentBuilder` (`src/client/completion.rs` L50-52). `.preamble(&str)` (L153), `.temperature(f64)` (L206), `.tool_choice(ToolChoice)` (L193), `.tool(...)` (L354), `.tools(...)` (L385), `.build()` (L553). All in `src/agent/builder.rs`.
- `Prompt::prompt(&self, prompt)` returns a `PromptRequest` that is `IntoFuture` → `Result<String, PromptError>`. (`src/completion/request.rs` L371-384; impl for `Agent` at `src/agent/completion.rs` L743-752)

### Minimal chat completion (non-streaming)
```rust
let agent = openai::Client::from_env()?
    .agent(openai::GPT_5_2)
    .preamble("You are a helpful assistant.")
    .temperature(0.0)
    .build();
let answer: String = agent.prompt("Explain async Rust").await?;
```

---

## 2. Streaming

**Yes — first-class streaming**, both per-model (low-level) and per-agent (high-level, multi-turn aware).

### High-level: `StreamingPrompt` / `StreamingChat` (recommended for our use)

The method names are **`stream_prompt`** and **`stream_chat`** (NOT `stream_chat` / `prompt_stream` / etc.). Verified at:
- `src/streaming.rs` L563-577: `pub trait StreamingPrompt<M, R>` with `fn stream_prompt(...)`.
- `src/streaming.rs` L584-622: `pub trait StreamingChat<M, R>` with `fn stream_chat(...)`.
- Impl for `Agent`: `src/agent/completion.rs` L817 (`stream_prompt`), L830 (`stream_chat`).

```rust
use rig_core::prelude::*; // StreamingPrompt (and Prompt, Chat, StreamingChat)
use rig_core::agent::prompt_request::streaming::{MultiTurnStreamItem, StreamingResult};
use rig_core::streaming::StreamedAssistantContent;
use rig_core::message::Text;
use futures::StreamExt;

// stream_prompt returns a StreamingPromptRequest<M> which is IntoFuture.
// `.await` yields a StreamingResult<R> = Pin<Box<dyn Stream<Item = Result<MultiTurnStreamItem<R>, StreamingError>> + Send>>.
let mut stream: StreamingResult<_> = agent.stream_prompt("Explain async Rust").await?;

while let Some(item) = stream.next().await {
    match item {
        Ok(MultiTurnStreamItem::StreamAssistantItem(
            StreamedAssistantContent::Text(Text { text, .. })
        )) => {
            // text delta — emit to frontend here
        }
        Ok(MultiTurnStreamItem::StreamAssistantItem(
            StreamedAssistantContent::Final(_resp)
        )) => { /* final provider response object, carries token usage */ }
        Ok(MultiTurnStreamItem::FinalResponse(resp)) => {
            // PromptResponse with full text + usage + accumulated messages
        }
        Ok(_) => { /* reasoning deltas, tool-call deltas, CompletionCall, ... */ }
        Err(e) => { eprintln!("{e:?}"); break; }
    }
}
```
The `StreamingPromptRequest` `IntoFuture` impl is at `src/agent/prompt_request/streaming.rs` L1444-1456 — **`.await` returns the stream, not the final string**. A `stream_to_stdout` helper at L1464-1495 is a copy-pasteable consumer template.

Key types (verified):
- `StreamingResult<R>` (agent-level) = `Pin<Box<dyn Stream<Item = Result<MultiTurnStreamItem<R>, StreamingError>> + Send>>` (`src/agent/prompt_request/streaming.rs` L37-41)
- `MultiTurnStreamItem<R>` (L47) variants: `StreamAssistantItem(StreamedAssistantContent<R>)`, `FinalResponse(PromptResponse)`, `CompletionCall`, `ToolExecutionStart`, `StreamUserItem`.
- `StreamedAssistantContent<R>` (`src/streaming.rs` L1042-1078) variants: `Text(Text)`, `ToolCall { tool_call, internal_call_id }`, `ToolCallDelta { id, content }`, `Reasoning(Reasoning)`, `ReasoningDelta { ... }`, `Final(R)`, `Unknown(serde_json::Value)`.

### Low-level per-model stream
`StreamingCompletionResponse<R>` implements `futures::Stream<Item = Result<StreamedAssistantContent<R>, CompletionError>>`. It also has `.cancel()`, `.pause()`, `.resume()` and aggregates `choice: OneOrMany<AssistantContent>` + `response: Option<R>` (token usage) as it drains. (`src/streaming.rs` L232-237 type alias, L243-383 `StreamingCompletionResponse`, L428-556, L563-622 traits)

### Multi-turn streaming
```rust
let history: Vec<Message> = vec![];
let mut stream = agent.stream_chat("follow-up question", &history).await?;
// drain, collect MultiTurnStreamItem::FinalResponse(resp).messages() into history
```
`stream_chat` passes history through `.history(chat_history)` on the request (`src/agent/completion.rs` L830-840). **You must manage history yourself**: drain the stream, take `PromptResponse::messages()` from the `FinalResponse` item, and extend your `Vec<Message>` (doc example `src/streaming.rs` L594-613; `PromptResponse::messages()` at `src/agent/prompt_request/mod.rs`).

### Non-streaming fallback
`agent.prompt(prompt).await -> Result<String, PromptError>` and `agent.chat(prompt, &mut history).await -> Result<String, PromptError>` (`src/completion/request.rs` L371-406). Use if streaming-over-Channel proves awkward; the frontend would just wait on the invoke promise.

---

## 3. Provider config / API keys / custom base URL

- **Env var**: each provider's `from_env()` reads its documented variable. OpenAI: `OPENAI_API_KEY` (required), `OPENAI_BASE_URL` (optional). Anthropic: `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`. Gemini: `GEMINI_API_KEY`. (`src/providers/openai/client.rs` L264-275; `src/providers/anthropic/client.rs` L111-122; `src/providers/gemini/client.rs` L184-186)
- **Explicit `ClientBuilder`**: `Client::builder().api_key("K").base_url("https://...").build()` — works for any provider. (`src/client/mod.rs` L430, L602-613, L644-653, L712)
- **Custom OpenAI-compatible base URL**: fully supported. Pattern:
  ```rust
  let client = openai::Client::builder()
      .api_key("dummy")
      .base_url("http://localhost:11434/v1") // Ollama, vLLM, LM Studio, etc.
      .build()?
      .with_system_instructions_as_messages(); // compat: send system as messages, not instructions
  ```
  `with_system_instructions_as_messages` is at `src/providers/openai/client.rs` L185-187. Anthropic normalizes its base URL (`normalize_anthropic_base_url`, `src/providers/anthropic/client.rs` L178-200).

For our Tauri app, prefer the **explicit builder** over `from_env()` — the API key should come from the app's settings store (or a user-supplied field), not from a process env var that the desktop user may not have set. Resolve the key at runtime, pass it to `Client::builder().api_key(...)`.

---

## 4. Chat history / multi-turn

`Message` is a provider-agnostic role-tagged enum (`src/completion/message.rs` L22-35):

```rust
pub enum Message {
    System { content: String },
    User { content: OneOrMany<UserContent> },
    Assistant { id: Option<String>, content: OneOrMany<AssistantContent> },
}
```
Constructors (L587-665): `Message::system("...")`, `Message::user("...")`, `Message::assistant("...")`. Roles are **the enum variants** — there is no separate `Role` field.

Multi-turn API:
- **Non-streaming**: `Chat::chat(&self, prompt, &mut Vec<Message>) -> Result<String, PromptError>`. The method appends the user prompt + assistant/tool messages to `chat_history` for you — do **not** push the user prompt yourself before calling. (`src/completion/request.rs` L387-406; impl `src/agent/completion.rs` L770-791)
- **Streaming**: `agent.stream_chat(prompt, &history)` returns a `StreamingPromptRequest`; drain it and extend history from `FinalResponse(resp).messages()`. (`src/agent/completion.rs` L830-840; doc example `src/streaming.rs` L594-613)
- **System preamble**: set once on the Agent via `.preamble("You are ...")` (`src/agent/builder.rs` L153). It is prepended to every request; you do **not** re-add it to history per turn.

A minimal rolling history:
```rust
let mut history: Vec<Message> = Vec::new();
let ans1 = agent.chat("What is Rust?", &mut history).await?;       // history now has user+assistant
let ans2 = agent.chat("and async?",   &mut history).await?;        // context carries forward
```

---

## 5. Opt OUT of tools (plain chat)

**Tools are opt-IN.** `AgentBuilder<M, ToolState = NoToolConfig>` defaults to `NoToolConfig` (`src/agent/builder.rs` L50 `pub struct NoToolConfig`, L96 `AgentBuilder`). You only get function-calling if you call `.tool(...)` (L354, moves to `AgentBuilder<M, WithBuilderTools>`) / `.tools(...)` (L385). A plain `agent.prompt(...)` / `agent.chat(...)` / `agent.stream_prompt(...)` issues a **tool-free completion** — no tool schema is sent, the model cannot request tool calls, and there is no file access (rig has no filesystem tool unless you wire one). This is exactly our "plain chat, no function-calling, no file access" requirement — we simply never call `.tool(...)`.

If a provider ever returns a stray tool-call anyway, `Prompt`/`Chat` surface it as a `PromptError` ("tool does not exist") rather than silently executing (`src/completion/request.rs` L375-379, L392-395). For belt-and-suspenders you can set `ToolChoice::None` via `.tool_choice(ToolChoice::None)` on the builder (`src/agent/builder.rs` L193), but for a tool-less agent this is a no-op.

---

## 6. Tauri 2 streaming pattern (`#[tauri::command]` + `ipc::Channel`)

The idiomatic Tauri 2 way to stream a long-running Rust stream to JS is **`tauri::ipc::Channel<T>` as a command argument** — the frontend constructs a `Channel`, passes it to `invoke`, and Rust pushes messages down it. The project uses Tauri 2 (pinned `tauri = { version = "2", ... }` in `apps/desktop/src-tauri/Cargo.toml` L16; the resolved crate is `tauri-2.11.2`) and async commands (`src/commands.rs` has many `#[tauri::command] pub async fn ...` at L37, L42, L56, L88, ...).

### Rust side skeleton
```rust
use tauri::ipc::Channel;
use serde::Serialize;
use futures::StreamExt;
use rig_core::{client::{CompletionClient, ProviderClient}, completion::Prompt,
              providers::openai, prelude::StreamingPrompt,
              agent::prompt_request::streaming::{MultiTurnStreamItem, StreamingResult},
              streaming::StreamedAssistantContent, message::Text};

#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChatChunk {
    Delta { text: String },
    Done { usage: Option<u32> },
    Error { message: String },
}

#[tauri::command]
pub async fn chat_stream(
    prompt: String,
    on_event: Channel<ChatChunk>,
    state: tauri::State<'_, AppState>, // holds the rig client/model id
) -> Result<(), String> {
    let agent = state.agent.clone(); // Agent is Clone-ish via Arc; see pitfalls
    let mut stream: StreamingResult<_> = agent
        .stream_prompt(prompt)
        .await
        .map_err(|e| e.to_string())?;

    while let Some(item) = stream.next().await {
        match item {
            Ok(MultiTurnStreamItem::StreamAssistantItem(
                StreamedAssistantContent::Text(Text { text, .. })
            )) => {
                on_event.send(ChatChunk::Delta { text }).map_err(|e| e.to_string())?;
            }
            Ok(MultiTurnStreamItem::FinalResponse(resp)) => {
                on_event.send(ChatChunk::Done {
                    usage: Some(resp.usage().total_tokens),
                }).ok();
                break;
            }
            Err(e) => {
                on_event.send(ChatChunk::Error { message: e.to_string() }).ok();
                break;
            }
            _ => {}
        }
    }
    Ok(())
}
```
`Channel<TSend = InvokeResponseBody>` (tauri-2.11.2 `src/ipc/channel.rs` L49). `Channel::send` signature: `pub fn send(&self, data: TSend) -> crate::Result<()>` where `TSend: IpcResponse` (L292). There is a blanket `impl<T: Serialize> IpcResponse for T` (`src/ipc/mod.rs` L181), so any `Serialize` struct works. `Channel` is a `CommandArg` (L300) so it can be a `#[tauri::command]` parameter directly.

### JS side skeleton (frontend)
```ts
import { Channel, invoke } from "@tauri-apps/api/core";

const onEvent = new Channel<{ type: "delta" | "done" | "error"; text?: string; usage?: number; message?: string }>();
onEvent.onmessage = (msg) => {
  if (msg.type === "delta")  appendToUi(msg.text!);
  if (msg.type === "done")   finalize(msg.usage);
  if (msg.type === "error") showError(msg.message!);
};
await invoke("chat_stream", { prompt: "Explain async Rust", onEvent });
```
JS `Channel` class: `node_modules/.pnpm/@tauri-apps+api@2.11.0/.../core.d.ts` — `constructor(onmessage?)`, settable `onmessage`, serializes to an IPC callback id.

### Alternatives considered
- **`app.emit("chat://delta", payload)` + `listen()`**: works but is global/broadcast and requires the frontend to filter by a session id. `Channel` is per-call, typed, and the recommended Tauri 2 streaming primitive.
- **Returning a `Stream` from the command**: Tauri commands resolve to a single `InvokeResponseBody`; they cannot return a `futures::Stream`. You must either push via `Channel` or `emit` events.
- **`spawn`ing a background task and returning immediately**: viable with `tauri::async_runtime::spawn`, but `Channel` already lets the command stay alive for the duration of the stream and the frontend just awaits `invoke`. Cleanest is the skeleton above.

---

## 7. Cargo.toml dependency line

```toml
[dependencies]
rig-core = { version = "0.40", default-features = false, features = ["reqwest", "derive", "rustls"] }
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
futures = "0.3"
```
Notes:
- `default-features = false` + the three listed features are exactly the `default = [reqwest, derive, rustls]` set (confirmed via `cargo info`) — this re-selects the default set explicitly so a future default change can't silently pull `native-tls` or extras. Using `rustls` (not `native-tls`) matches the project's existing `reqwest = { version = "0.13", default-features = false, features = ["rustls", "charset", "http2", "system-proxy"] }` choice in `apps/desktop/src-tauri/Cargo.toml` L55 (no system OpenSSL on Linux CI).
- **No extra feature flags are needed for OpenAI/Anthropic/Gemini** — all providers are unconditionally compiled. Feature flags only gate *transports* (`reqwest`/`rustls`/`native-tls`/`socks`/`wasm`), *extras* (`pdf`, `epub`, `image`, `audio`, `rayon`, `rmcp`, `websocket`), and `derive`.
- The project already pins `reqwest 0.13` with `rustls`; rig-core 0.40 also uses `reqwest 0.13`, so versions align.
- If the facade is preferred: `rig = { version = "0.40", features = ["reqwest","derive","rustls"] }` and `use rig::...`. The task asked for `rig-core`; either works, `rig-core` is the lower-level choice.

---

## 8. Pitfalls

- **Tokio runtime**: rig-core is fully async on `tokio` + `reqwest`. Tauri 2's `#[tauri::command] async fn` runs on `tauri::async_runtime` (a tokio multi-thread runtime by default), so `agent.stream_prompt(...).await` inside a command works without spawning your own runtime. Do **not** call `.blocking_recv()`/`Handle::current().block_on()` inside a command — it deadlocks the Tauri runtime thread. (Project pattern: all commands in `src/commands.rs` are `async fn`, e.g. L37-45.)
- **`Agent` sharing across requests**: `Agent<M>` is `Clone` (it wraps an `Arc` internally) but the cheap clone is the client+config; you typically build one `Agent` at startup and store it in `tauri::Manager::manage(AppState { agent })`. Do **not** reconstruct the client per request — TLS handshake + connection pool setup is expensive.
- **API key source**: `from_env()` reads process env at call time. Desktop users won't have `OPENAI_API_KEY` set. Resolve the key from the app's settings/state and use `Client::builder().api_key(key)`.
- **System-instructions placement for compatible servers**: if you point the OpenAI client at a non-OpenAI base URL, call `.with_system_instructions_as_messages()` or the server may ignore the top-level `instructions` field and your preamble silently vanishes (`src/providers/openai/client.rs` L177-187).
- **Streaming `IntoFuture` quirk**: `agent.stream_prompt(prompt)` is **not** `async` — it returns `StreamingPromptRequest`, and `.await` on that yields the *stream* (`StreamingResult`), not the final text. A common mistake is to write `let s: String = agent.stream_prompt(p).await?;` which won't compile. Drain `stream.next().await` in a loop and accumulate `Text` deltas, or collect `MultiTurnStreamItem::FinalResponse(resp).output()`.
- **History ownership in streaming**: `stream_chat(prompt, &history)` borrows history immutably and does **not** mutate it for you (unlike non-streaming `chat`). You must drain the stream and extend history from the `FinalResponse` `messages()`. Forget this and multi-turn context is lost.
- **`Send` bounds**: `StreamingResult<R>` is `Send` on non-wasm, so it can cross the Tauri command boundary. Keep the agent behind a `Clone`-able `AppState`. The stream itself is consumed in-loop inside the command — don't try to return it.
- **Error type translation**: rig errors are `rig_core::completion::PromptError` / `CompletionError` / `agent::prompt_request::streaming::StreamingError`; Tauri commands want `String` (or a `Serialize` error). Use `.map_err(|e| e.to_string())`. `PromptError` integrates `Display`.
- **`rustls` vs `native-tls`**: do not enable both. The project uses `rustls`; keep `default-features = false` + `rustls` to avoid pulling `native-tls` (and system OpenSSL on Linux).
- **Cancellation**: `StreamingCompletionResponse::cancel()` and the `Drop` of the agent-level stream will terminate the underlying HTTP/SSE connection. If the user closes the chat mid-stream, the `on_event` `Channel` `Drop` fires `on_drop`; rig's stream will be dropped shortly after, aborting the SSE body.

---

## Recommendation for our setup

**Minimal rig call (streaming, tool-free, OpenAI-compatible):**
```rust
let client = openai::Client::builder()
    .api_key(state.api_key)                  // from settings, not env
    .base_url(state.base_url)               // "https://api.openai.com/v1" or compatible
    .build()?
    .with_system_instructions_as_messages(); // compat for non-OpenAI servers; harmless for real OpenAI
let agent = client
    .agent("gpt-5.2")                        // or openai::GPT_5_2
    .preamble("You are Quill's writing assistant.")
    .temperature(0.4)
    .build();
let mut stream = agent.stream_prompt(user_prompt).await?;
```

**Stream it over a Tauri Channel** to the frontend using the `chat_stream` command skeleton in section 6: define a `#[serde(tag="type")] ChatChunk` enum, take `on_event: Channel<ChatChunk>`, drain `stream.next().await`, map `StreamedAssistantContent::Text` to `ChatChunk::Delta { text }` and `MultiTurnStreamItem::FinalResponse` to `ChatChunk::Done`. Register it in `tauri::generate_handler![..., chat_stream]` (`apps/desktop/src-tauri/src/lib.rs` L435).

**Cargo.toml line** (add to `apps/desktop/src-tauri/Cargo.toml` `[dependencies]`):
```toml
rig-core = { version = "0.40", default-features = false, features = ["reqwest", "derive", "rustls"] }
```
Plus `futures = "0.3"` (for `StreamExt::next`) if not already present; `tokio` is already provided by Tauri's runtime.

For multi-turn, keep a `Vec<Message>` in frontend state (or Rust-side session map) and use `agent.stream_chat(prompt, &history)`, extending history from `FinalResponse.messages()` after each turn.

---

## Source URLs / file citations

- **Live crates.io verification (2026-07-11)**:
  - `cargo info rig-core` → version 0.40.0, repository `https://github.com/0xPlaygrounds/rig`, features list, docs `https://docs.rs/rig-core/0.40.0`, crates.io `https://crates.io/crates/rig-core/0.40.0`
  - `cargo search rig-core` → `rig-core = "0.40.0"` (latest)
  - `cargo info rig` → facade crate also 0.40.0, same repository
- rig-core 0.40.0 source (published artifact): `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/rig-core-0.40.0/`
  - README: `README.md` (L24-50 canonical example — imports `client::{CompletionClient, ProviderClient}`)
  - Cargo.toml features: confirmed via `cargo info` (`default = [reqwest, derive, rustls]`, `[lib] name = "rig_core"`)
  - Client traits: `src/client/mod.rs` (L113-129 `ProviderClient` with `from_env`/`from_val`, L330-341 `new`, L430 `builder`, L602-613 `api_key`, L644-653 `base_url`, L712/L728 `build`); `src/client/completion.rs` (L9 `CompletionClient`, L50 `agent`)
  - OpenAI provider: `src/providers/openai/mod.rs`, `src/providers/openai/client.rs` (L49-56 client flavors, L185-187 `with_system_instructions_as_messages`, L264-275 `from_env`), `src/providers/openai/completion/mod.rs` (L42-105 model consts)
  - Anthropic: `src/providers/anthropic/client.rs` (L111-122 `from_env`), `src/providers/anthropic/completion.rs` (L25-37 consts: `CLAUDE_OPUS_4_6/4_7/4_8`, `CLAUDE_SONNET_4_6`, `CLAUDE_HAIKU_4_5`)
  - Gemini: `src/providers/gemini/client.rs` (L184-186 `from_env`)
  - Streaming: `src/streaming.rs` (L232-237 `StreamingResult` type alias, L243-383 `StreamingCompletionResponse`, L563-577 `StreamingPrompt::stream_prompt`, L584-622 `StreamingChat::stream_chat`, L1042-1078 `StreamedAssistantContent`), `src/agent/prompt_request/streaming.rs` (L37-41 `StreamingResult`, L47 `MultiTurnStreamItem`, L1444-1456 `IntoFuture`, L1464-1495 `stream_to_stdout`), `src/agent/completion.rs` (L817 `stream_prompt` impl, L830 `stream_chat` impl, L743-752 `Prompt` impl)
  - Message: `src/completion/message.rs` (L22-35 `Message`, L587-665 constructors)
  - Agent: `src/agent/builder.rs` (L50 `NoToolConfig`, L96 `AgentBuilder<M, ToolState = NoToolConfig>`, L153 `preamble`, L193 `tool_choice`, L206 `temperature`, L354 `tool` -> `WithBuilderTools`, L385 `tools`, L553 `build`)
  - Prompt/Chat traits: `src/completion/request.rs` (L371-384 `Prompt::prompt`, L387-406 `Chat::chat`)
- Docs (external): https://docs.rs/rig-core/0.40.0/rig_core/ ; book: https://docs.rig.rs ; repo: https://github.com/0xPlaygrounds/rig
- Tauri 2.11.2 source: `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-2.11.2/`
  - `src/ipc/channel.rs` (L49 `Channel<TSend>`, L292 `send`, L300 `CommandArg`)
  - `src/ipc/mod.rs` (L181 `impl<T: Serialize> IpcResponse for T`)
- Tauri JS: `node_modules/.pnpm/@tauri-apps+api@2.11.0/.../core.d.ts` (`class Channel`)
- Project files: `apps/desktop/src-tauri/Cargo.toml` (L16 tauri, L55 reqwest+rustls), `apps/desktop/src-tauri/src/commands.rs` (L37+ async command pattern), `apps/desktop/src-tauri/src/lib.rs` (L435 `generate_handler!`)

## Caveats / not found

- **exa MCP tools (`mcp__exa__web_search_exa`, `mcp__exa__get_code_context_exa`) were NOT available** in this environment (not in the tool list). `curl` and `gh` were denied/unavailable. Live verification was done via **`cargo info rig-core` / `cargo search rig-core`**, which query the live crates.io index (output showed "Updating crates.io index") and are authoritative for: version number, repository URL, features, and crate/lib name.
- The **GitHub repo HEAD** (main branch) may have commits past the 0.40.0 tag, but the **published crate on crates.io is 0.40.0**, and that is what the dependency line resolves to. All API method/type names and line numbers cited above are from the published 0.40.0 crate source, which is the authoritative artifact for the version the project will depend on. If you depend on a git branch instead of the published crate, re-verify against that ref.
- The repo-level `examples/` directory was not downloadable (no `gh`/`curl`); the README's canonical example and the in-crate doc examples (`src/client/completion.rs` L17-55, `src/streaming.rs` L594-613) are used instead and are part of the published crate.
- The `rig` facade crate is also at 0.40.0 (confirmed via `cargo info rig`); the recommendation uses `rig-core` directly per the task.
