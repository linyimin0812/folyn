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
  type: 'delta' | 'done' | 'error';
  text?: string;
  message?: string;
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
    },
    onEvent: channel,
  });
}
