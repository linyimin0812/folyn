import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri } from '@/utils/platform';
import { useSettingsStore } from '@/store/settingsStore';
import { usePetChatStore } from '@/store/petChatStore';
import { sendPetChatMessage, stopPetChat, resetPetChatAdapter } from '@/services/petChatService';
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
 *    `pet-chat:messages` in `storageClient`). `streaming` is runtime-only.
 *  - No vault UI: no file mentions, no wiki/clip toolbar, no attachments.
 *  - Unconfigured-AI (R7): if `settings.cliPath` or `settings.cliAdapter`
 *    is empty, render a guidance CTA instead of the input.
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

export function PetChat() {
  const messages = usePetChatStore((s) => s.messages);
  const streaming = usePetChatStore((s) => s.streaming);
  const addMessage = usePetChatStore((s) => s.addMessage);
  const appendToLastMessage = usePetChatStore((s) => s.appendToLastMessage);
  const setStreaming = usePetChatStore((s) => s.setStreaming);
  const clear = usePetChatStore((s) => s.clear);

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const configured = isPetChatConfigured();

  // Auto-scroll to the latest message on new content.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  // Stop the adapter on unmount so an in-flight stream doesn't outlive the
  // panel (the cached adapter is reset so the next mount starts fresh).
  useEffect(() => {
    return () => {
      if (streaming) {
        void stopPetChat().finally(() => {
          setStreaming(false);
          resetPetChatAdapter();
        });
      } else {
        resetPetChatAdapter();
      }
    };
  }, [streaming, setStreaming]);

  const handleSend = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || streaming || !configured) return;
    setInput('');
    addMessage('user', prompt);
    addMessage('assistant', '');
    setStreaming(true);
    try {
      await sendPetChatMessage(prompt, {
        onToken: (text) => appendToLastMessage(text),
        onDone: () => {
          setStreaming(false);
        },
        onError: (message) => {
          appendToLastMessage(`\n\n[错误] ${message}`);
          setStreaming(false);
        },
      });
    } catch (err) {
      appendToLastMessage(`\n\n[错误] ${String(err)}`);
      setStreaming(false);
    }
  }, [input, streaming, configured, addMessage, appendToLastMessage, setStreaming]);

  const handleStop = useCallback(async () => {
    await stopPetChat();
    setStreaming(false);
  }, [setStreaming]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

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
    return (
      <div className="pet-chat-empty" role="status">
        <div className="pet-chat-empty-title">未配置 AI</div>
        <div className="pet-chat-empty-desc">在设置中配置 CLI 路径后即可在此对话。</div>
        <button type="button" className="pet-chat-cta" onClick={() => void handleOpenSettings()}>
          打开 AI 设置
        </button>
      </div>
    );
  }

  return (
    <div className="pet-chat">
      <div className="pet-chat-messages" role="log" aria-live="polite">
        {messages.length === 0 && (
          <div className="pet-chat-hint">向 AI 提问，回答会在此处流式显示。</div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`pet-chat-bubble pet-chat-bubble-${m.role}`}>
            <div className="pet-chat-bubble-role">{m.role === 'user' ? '我' : 'AI'}</div>
            <div className="pet-chat-bubble-content">{m.content || (streaming ? '…' : '')}</div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div className="pet-chat-input-row">
        <textarea
          className="pet-chat-input"
          placeholder="输入消息，Enter 发送"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={streaming}
          rows={1}
          aria-label="Pet chat input"
        />
        {streaming ? (
          <button type="button" className="pet-chat-stop" onClick={() => void handleStop()} aria-label="停止生成">
            <span className="pet-chat-action-icon" aria-hidden="true">
              {/* stop square */}
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <rect x="3" y="3" width="10" height="10" rx="1.5" />
              </svg>
            </span>
          </button>
        ) : (
          <button
            type="button"
            className="pet-chat-send"
            onClick={() => void handleSend()}
            disabled={!input.trim()}
            aria-label="发送"
          >
            <span className="pet-chat-action-icon" aria-hidden="true">
              {/* paper plane */}
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.5 1.5L1.5 7l5 1.5L8 14l6.5-12.5z" />
                <path d="M6.5 8.5L14.5 1.5" />
              </svg>
            </span>
          </button>
        )}
      </div>
      {messages.length > 0 && (
        <button type="button" className="pet-chat-clear" onClick={() => clear()} disabled={streaming}>
          清空对话
        </button>
      )}
    </div>
  );
}
