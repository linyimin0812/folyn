import { useCallback, useEffect, useRef, useState } from 'react';
import type { CliMessage } from '@quill/cli-adapter';
import { isTauri } from '@/utils/platform';
import { useSettingsStore } from '@/store/settingsStore';
import { usePetChatStore } from '@/store/petChatStore';
import type { PetChatMessage } from '@/store/petChatStore';
import { sendPetChatMessage, stopPetChat, resetPetChatAdapter } from '@/services/petChatService';
import { ChatMessageList, ChatInputBox } from '@/components/chat';
import { PetChatSessionHeader } from './PetChatSessionHeader';
import type { PetMenuAction } from './PetContextMenu';

/**
 * PetChat — the embedded vault-free AI chat in the pet-panel window (PR3,
 * PRD R6/R7). Mounts inside the `pet-panel-chat-slot` reserved by
 * `PetPanelApp`.
 *
 * Design:
 *  - Owns a `CliAdapter` via `services/petChatService` (NOT `aiStore` /
 *    `sessionAdapters`). Fresh exchange per send, no vault system prompt,
 *    `bare: true` isolation, workingDir = neutral app-data temp dir.
 *  - Message list persisted across restarts via `petChatStore` (namespace
 *    `pet-chat:sessions` in `storageClient`; PR2: per-session adapter +
 *    `resumeSessionId` cross-turn memory). `streaming` is runtime-only.
 *  - No vault UI: no file mentions, no wiki/clip toolbar, no attachments.
 *  - Unconfigured-AI (R7): if `settings.cliPath` or `settings.cliAdapter`
 *    is empty, render a guidance CTA instead of the input.
 *
 * PR3: the message list, bubbles, copy button, clear button, and input box
 * are now the shared `components/chat/*` components (Tailwind). PetChat only
 * owns: the send/stop/clear handlers, the unmount lifecycle, the
 * unconfigured-CTA, and the `PetChatMessage → CliMessage` boundary mapping.
 * The copy button is fully owned by `ChatMessageList` (its built-in
 * clipboard write + 1.2s "已复制" feedback is identical to pet's old
 * inline copy button, so no `onCopy` is wired — see `CopyButton` in
 * `ChatMessageList.tsx`).
 *
 * Dismiss paths (× / Esc / second pet click) are owned by `PetPanelApp`;
 * this component only owns the Stop button mid-stream.
 */

/** Emit `pet://menu-action` so the main window's listener focuses + opens
 *  settings. Mirrors `PetLauncher`'s emit helper. */
async function emitMenuAction(action: PetMenuAction): Promise<void> {
  if (!isTauri()) return;
  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit('pet://menu-action', { action });
  } catch (err) {
    console.warn('[pet-chat] emit menu-action failed:', err);
  }
}

/** Detect "no AI configured" (R7). Mirrors the implicit check in
 *  AiPanel/ChatInput: the AI is considered configured when both the
 *  adapter id and the CLI binary path are non-empty. Defaults in
 *  `settingsStore` are `'claude'` / `'claude'`, so this is only true when
 *  the user has explicitly cleared them. */
export function isPetChatConfigured(): boolean {
  const { cliAdapter, cliPath } = useSettingsStore.getState();
  return Boolean(cliAdapter && cliPath);
}

/** Stable empty reference for the messages selector. When the active
 *  session isn't found (initial `sessions: []` state before rehydrate, or a
 *  stale activeSessionId), returning an inline `[]` here would create a NEW
 *  array reference on every selector call. Zustand v5 uses
 *  `useSyncExternalStore`, and React 18 treats a changing snapshot as a
 *  store mutation → re-render → new snapshot → infinite loop →
 *  "Maximum update depth exceeded" → the component tree crashes and the
 *  panel renders blank. Returning this constant keeps the not-found path
 *  referentially stable. */
const EMPTY_MESSAGES: PetChatMessage[] = [];

/** Map the pet store's flat message shape to the shared `CliMessage`
 *  supertype at the prop boundary. `petChatStore` keeps its own
 *  `{id, role, content, ts}` type (unchanged); thinking / toolCalls /
 *  attachments are left undefined (pet is vault-free). */
function toCliMessages(
  msgs: { id: string; role: 'user' | 'assistant'; content: string; ts: number }[],
): CliMessage[] {
  return msgs.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    timestamp: m.ts,
  }));
}

export function PetChat() {
  const activeSessionId = usePetChatStore((s) => s.activeSessionId);
  // Derive the active session's messages at the boundary. PR3 mounts a
  // `PetChatSessionHeader` above the list for new/switch/delete/rename; the
  // header owns session switching and stop-while-streaming, this component
  // only renders the active session's linear history + the input box.
  const messages = usePetChatStore(
    (s) => s.sessions.find((sess) => sess.id === s.activeSessionId)?.messages ?? EMPTY_MESSAGES,
  );
  const streaming = usePetChatStore((s) => s.streaming);
  const addMessage = usePetChatStore((s) => s.addMessage);
  const appendToLastMessage = usePetChatStore((s) => s.appendToLastMessage);
  const setStreaming = usePetChatStore((s) => s.setStreaming);
  const clear = usePetChatStore((s) => s.clearActive);

  const [input, setInput] = useState('');
  const configured = isPetChatConfigured();

  // Stop + reset ALL active adapters on unmount so an in-flight stream does
  // not outlive the panel (PR2: per-session model → reset all adapters, not
  // just one). Unmount-only via an empty-deps effect with a ref holding the
  // latest `streaming` — avoids the old `[streaming, setStreaming]` deps
  // pattern that re-ran the cleanup on every streaming flip (see
  // research/input-and-streaming.md caveat).
  const streamingRef = useRef(streaming);
  streamingRef.current = streaming;
  useEffect(() => {
    return () => {
      const wasStreaming = streamingRef.current;
      void resetPetChatAdapter().finally(() => {
        if (wasStreaming) setStreaming(false);
      });
    };
  }, [setStreaming]);

  const handleSend = useCallback(async () => {
    const prompt = input.trim();
    const sessionId = activeSessionId;
    if (!prompt || streaming || !configured || !sessionId) return;
    setInput('');
    addMessage(sessionId, 'user', prompt);
    addMessage(sessionId, 'assistant', '');
    setStreaming(true);
    try {
      await sendPetChatMessage(sessionId, prompt, {
        onToken: (text) => appendToLastMessage(sessionId, text),
        onDone: () => {
          setStreaming(false);
        },
        onError: (message) => {
          appendToLastMessage(sessionId, `\n\n[错误] ${message}`);
          setStreaming(false);
        },
      });
    } catch (err) {
      appendToLastMessage(sessionId, `\n\n[错误] ${String(err)}`);
      setStreaming(false);
    }
  }, [input, streaming, configured, activeSessionId, addMessage, appendToLastMessage, setStreaming]);

  const handleStop = useCallback(async () => {
    const sessionId = activeSessionId;
    if (!sessionId) return;
    await stopPetChat(sessionId);
    setStreaming(false);
  }, [activeSessionId, setStreaming]);

  const handleOpenSettings = useCallback(async () => {
    // focusMain() path: emit `show-main` then navigate to settings. The
    // main window's App.tsx listener handles `show-main` (shows+focuses
    // the hidden main window); settings navigation piggybacks on the
    // `command-palette`-style action by setting the page directly via the
    // shared settings store (the main window reads the same store).
    useSettingsStore.getState().setCurrentPage('settings');
    useSettingsStore.getState().setSettingsTab('ai');
    await emitMenuAction('show-main');
  }, []);

  if (!configured) {
    // Unconfigured-AI CTA (R7) — rendered OUTSIDE the shared chat
    // components (it replaces the whole chat body). Styled with Tailwind
    // tokens; the old `.pet-chat-empty` / `.pet-chat-cta` BEM classes were
    // deleted from pet.css in PR3.
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 px-2 py-4 text-center flex-1"
        role="status"
      >
        <div className="text-[13px] font-semibold text-t1">未配置 AI</div>
        <div className="text-[12px] text-t3">在设置中配置 CLI 路径后即可在此对话。</div>
        <button
          type="button"
          className="mt-1 py-1.5 px-3 border border-acc rounded-md bg-acc text-white text-[12px] cursor-pointer hover:opacity-[.85] transition-opacity"
          onClick={() => void handleOpenSettings()}
        >
          打开 AI 设置
        </button>
      </div>
    );
  }

  // streamingIndicator choice (see PR3 task spec):
  // Pet's OLD behavior: empty streaming assistant content showed a `…`
  // placeholder; once tokens arrived, only the content showed (no cursor).
  // The shared `ChatMessageList`:
  //  - 'none': shows NOTHING for empty streaming content (regression vs
  //    pet's `…` placeholder) but matches pet for the has-content case.
  //  - 'cursor': shows a `▎` cursor for BOTH empty and has-content
  //    streaming last-assistant messages (pet never had a cursor once
  //    content arrived).
  // Because 'none' regresses the empty-streaming case (shows nothing
  // instead of `…`), we use 'cursor' and accept the minor visual delta
  // (a `▎` cursor appears during streaming, including on the empty
  // initial frame). This is the task-spec's prescribed fallback.
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PetChatSessionHeader />
      <ChatMessageList
        messages={toCliMessages(messages)}
        streaming={streaming}
        plaintext
        showCopy
        streamingIndicator="cursor"
        onClear={clear}
        emptyState={
          <div className="text-[12px] text-t3 text-center px-1 py-3">
            向 AI 提问，回答会在此处流式显示。
          </div>
        }
      />
      <ChatInputBox
        value={input}
        onChange={setInput}
        onSend={handleSend}
        streaming={streaming}
        onStop={handleStop}
        placeholder="输入消息，Enter 发送"
        textareaRows={1}
        inputAriaLabel="Pet chat input"
      />
      {/* Note on `disabled` / `canSend`: both are intentionally OMITTED.
          The task spec suggested `disabled={!input.trim()}`, but
          `ChatInputBox`'s `disabled` prop disables the <textarea> itself
          (not just the send button) — passing it would make the input
          untypeable when empty (the user could never type the first char).
          Omitting both props uses the base default
          `canSend = value.trim().length > 0`, which disables the SEND
          button on empty input (matching pet's old `disabled={!input.trim}`
          on the send button) while leaving the textarea enabled until
          streaming flips it off. This exactly preserves the pre-refactor
          behavior. */}
    </div>
  );
}
