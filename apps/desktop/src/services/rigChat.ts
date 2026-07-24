import { invoke, Channel } from '@tauri-apps/api/core';
import type { CliStreamEvent } from '@quill/cli-adapter';

/**
 * chat mode frontend bridge: invoke the Rust `chat_stream` command and
 * translate its `ChatChunk` stream into the same `CliStreamEvent` shape the
 * CLI adapter emits, so AiPanel / PetChat render chat with zero UI changes.
 *
 * chat is multi-turn, tool-free, served by rig in the Rust backend (see
 * `apps/desktop/src-tauri/src/chat.rs`). History is persisted on disk by the
 * backend keyed by `sessionId` — the frontend does not manage chat history.
 */

// Mirrors the `#[serde(tag = "type", rename_all = "camelCase")] ChatChunk` in
// chat.rs. Keep in sync if the Rust enum changes.
interface ChatChunk {
  type: 'delta' | 'thinking' | 'done' | 'error';
  text?: string;
  message?: string;
}

export interface RigChatImage {
  /** Base64 image bytes (no `data:` URL prefix). */
  data: string;
  /** MIME type, e.g. `"image/png"`. */
  mediaType: string;
}

export interface RigChatParams {
  /** App session id — rig persists history to `~/.quill/chat-sessions/<id>.json`. */
  sessionId: string;
  prompt: string;
  provider: string;
  model: string;
  apiKey: string;
  /** Empty/undefined => provider default base URL. */
  baseUrl?: string;
  /** Optional preamble (system prompt) override. When omitted, the rig
   *  backend uses its built-in default. The Bubble Template AI Agent
   *  passes its feature-specific preamble here. */
  preamble?: string;
  /** Optional image content blocks attached to this user turn. Rig's
   *  image content is provider-agnostic — Anthropic and OpenAI
   *  serialization is handled inside rig. */
  images?: RigChatImage[];
  /** Receives `text` / `done` / `error` events, same as a CLI adapter handler. */
  onEvent: (event: CliStreamEvent) => void;
}

/**
 * Stream a chat turn. Resolves on `done`; rejects with the error message on
 * `error` or if the invoke itself fails. Each delta is delivered as a
 * `text` event to `onEvent`.
 */
export async function runRigChat(p: RigChatParams): Promise<void> {
  const channel = new Channel<ChatChunk>();
  channel.onmessage = (chunk: ChatChunk) => {
    if (chunk.type === 'delta' && chunk.text) {
      p.onEvent({ type: 'text', content: chunk.text });
    } else if (chunk.type === 'thinking' && chunk.text) {
      p.onEvent({ type: 'thinking', content: chunk.text });
    } else if (chunk.type === 'error') {
      p.onEvent({ type: 'error', content: chunk.message ?? 'chat error' });
    } else if (chunk.type === 'done') {
      p.onEvent({ type: 'done' });
    }
  };
  // Tauri converts the camelCase JS arg names to the snake_case Rust params
  // (`params`, `on_event`). `ChatParams` fields are camelCase on both sides.
  await invoke('chat_stream', {
    params: {
      sessionId: p.sessionId,
      provider: p.provider,
      model: p.model,
      apiKey: p.apiKey,
      baseUrl: p.baseUrl ? p.baseUrl : null,
      prompt: p.prompt,
      preamble: p.preamble ?? null,
      images: p.images && p.images.length > 0 ? p.images : null,
    },
    onEvent: channel,
  });
}

export interface ChatTestResult {
  success: boolean;
  message: string;
}

/**
 * Verify chat-mode provider/key/baseUrl by sending a short ping through
 * `chat_stream`. Resolves with `{ success, message }` on `done`/`error`/invoke
 * failure, or auto-fails after `timeoutMs` (default 10s). Uses a fixed
 * sessionId `__connection_test__` so at most one test session file lingers in
 * ~/.quill/chat-sessions/ (overwritten each test).
 *
 * ponytail: thin wrapper over runRigChat — keeps the Promise-race + timeout
 * logic testable without rendering SettingsPage.
 */
export async function testChatConnection(params: {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
}): Promise<ChatTestResult> {
  const { provider, model, apiKey, baseUrl, timeoutMs = 10000 } = params;
  let settled = false;
  return new Promise<ChatTestResult>((resolve) => {
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({ success: false, message: `${timeoutMs / 1000} 秒超时` });
      }
    }, timeoutMs);
    void runRigChat({
      sessionId: '__connection_test__',
      prompt: 'ping',
      provider,
      model,
      apiKey,
      baseUrl,
      onEvent: (e) => {
        if (settled) return;
        if (e.type === 'done') {
          settled = true;
          clearTimeout(timer);
          resolve({ success: true, message: '连接成功' });
        } else if (e.type === 'error') {
          settled = true;
          clearTimeout(timer);
          resolve({ success: false, message: e.content ?? 'chat error' });
        }
      },
    }).catch((err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ success: false, message: String(err) });
    });
  });
}
