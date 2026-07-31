import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AssistantImage, CliMessage } from '@quill/cli-adapter';
import { isTauri } from '@/utils/platform';
import { useAiConfigStore } from '@/store/aiConfigStore';
import { usePetChatStore } from '@/store/petChatStore';
import type { PetChatMessage } from '@/store/petChatStore';
import {
  sendPetChatMessage,
  stopPetChat,
  resetPetChatAdapter,
  getPetChatWorkingDir,
} from '@/services/petChatService';
import { ChatMessageList, ChatInputBox } from '@/components/chat';
import type { PendingAttachment } from '@/components/chat';
import {
  addFiles,
  handlePaste,
  saveBlobs,
  buildReadInstructions,
  revokeUrls,
  DEFAULT_MAX_BYTES,
  DEFAULT_ALLOWED_TYPES,
  ATTACHMENTS_SUBDIR,
} from '@/components/chat';
import { FileIcon } from '@/components/icons/FileIcon';
import { PetChatSessionHeader } from './PetChatSessionHeader';
import { listInputModes, getInputModeDef } from '@/components/ai/inputModes';
import { AdapterSelector } from '@/components/ai/AdapterSelector';
import { VoiceInputButton } from '@/components/ai/VoiceInputButton';
import { PairSelector } from '@/components/ai/PairSelector';
import {
  allProviders,
  providerDisplayName,
  type ProviderEntry,
} from '@/services/providers/catalog';
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
 *  - Vault-aware per mode: chat (rig) has no cwd; ask/agent run against the
 *    current vault (via `vaultConfigStore.vaultPath`, appData fallback). A mode
 *    dropdown (chat/ask/agent) lives in the input `leadingSlot`; chat routes
 *    to the rig backend, ask/agent to the claude CLI.
 *  - Unconfigured-AI (R7): if `aiConfig.cliPath` or `aiConfig.cliAdapter`
 *    is empty, render a guidance CTA instead of the input.
 *
 * PR3: the message list, bubbles, copy button, clear button, and input box
 * are the shared `components/chat/*` components (Tailwind). PetChat only
 * owns: the send/stop/clear handlers, the unmount lifecycle, the
 * unconfigured-CTA, and the `PetChatMessage → CliMessage` boundary mapping.
 * The message list renders markdown parity with AiPanel (no `plaintext` prop
 * → MessageContent runs the unified/remark/rehype pipeline into `.msg-md`;
 * `streamingIndicator='dots'` matches AiPanel's list-level 3-dot block +
 * per-bubble cursor). The copy button is fully owned by `ChatMessageList`
 * (its built-in clipboard write + 1.2s "已复制" feedback is identical to
 * pet's old inline copy button, so no `onCopy` is wired — see `CopyButton`
 * in `ChatMessageList.tsx`).
 *
 * PR4 (file-upload): attachments are wired via the shared `ChatInputBox`
 * slot props (`leadingSlot` = file-picker button, `attachmentsRow` = chip
 * row, `onPaste` = paste-image) + the vault-free `components/chat/
 * attachments.ts` helper. Send flow: save blob attachments to
 * `<appData>/pet-chat-tmp/attachments/`, build Read-tool instructions,
 * store the RAW user text as the visible user bubble, and send the
 * Read-wrapped `finalPrompt` to the CLI — mirroring AiPanel's split
 * (visible text ≠ what the CLI receives). No `overlayLayer` (no @mention).
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

/** Detect "no AI configured" (R7). Mode-aware: chat (rig) mode always returns
 *  true — the inline `<PairSelector>` handles both the "pick a pair" empty
 *  state AND the "no provider enabled" empty state with its own Settings
 *  link. ask/agent need the CLI adapter id + binary path; the CTA fires
 *  only for those modes. */
export function isPetChatConfigured(): boolean {
  const s = useAiConfigStore.getState();
  const mode = usePetChatStore.getState().inputMode;
  if (mode === 'chat') return true;
  return Boolean(s.cliAdapter && s.cliPath);
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
 *  `{id, role, content, ts, thinking?, provider?, model?}` type; toolCalls /
 *  attachments are left undefined (pet is vault-free). */
function toCliMessages(
  msgs: {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    ts: number;
    thinking?: string;
    provider?: string;
    model?: string;
    images?: AssistantImage[];
  }[],
): CliMessage[] {
  return msgs.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    thinking: m.thinking,
    timestamp: m.ts,
    provider: m.provider,
    model: m.model,
    images: m.images,
  }));
}

export function PetChat() {
  const { t } = useTranslation();
  const activeSessionId = usePetChatStore((s) => s.activeSessionId);
  const activePetSession = usePetChatStore((s) =>
    s.sessions.find((sess) => sess.id === s.activeSessionId),
  );
  const messages = usePetChatStore(
    (s) => s.sessions.find((sess) => sess.id === s.activeSessionId)?.messages ?? EMPTY_MESSAGES,
  );
  // Phase 2: the pet pair is per-session. Read the active session's pair
  // (undefined when the session has no pair yet — same empty state as the
  // old null petPair global). The in-panel PairSelector writes via
  // setSessionPair; petChatService reads via resolvePairForPetSession.
  // ponytail: Phase 3 — ChatProvider is `string`, session.provider assigns
  // directly (no cast).
  const petPair = activePetSession?.provider && activePetSession?.model
    ? { provider: activePetSession.provider, model: activePetSession.model }
    : null;
  const setSessionPair = usePetChatStore((s) => s.setSessionPair);
  const customerProviders = useAiConfigStore((s) => s.customerProviders);
  const streaming = usePetChatStore((s) => s.streaming);
  const addMessage = usePetChatStore((s) => s.addMessage);
  const appendToLastMessage = usePetChatStore((s) => s.appendToLastMessage);
  const appendToLastMessageImage = usePetChatStore((s) => s.appendToLastMessageImage);
  const appendToLastMessageThinking = usePetChatStore((s) => s.appendToLastMessageThinking);
  const setStreaming = usePetChatStore((s) => s.setStreaming);
  const clear = usePetChatStore((s) => s.clearActive);
  const inputMode = usePetChatStore((s) => s.inputMode);
  const setInputMode = usePetChatStore((s) => s.setInputMode);

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  /** Inline guardrail / save-error message rendered under the input. Cleared
   *  on the next successful add/paste/send or after a timeout. */
  const [rejectError, setRejectError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Ref to the chat textarea so we can `.focus()` it on `pet://panel-fade-in`
  // (the show signal). ChatInputBox merges this with its own internal ref.
  // The panel defaults to the Chat tab, so on open the user can type
  // immediately — no click needed. On the Actions tab PetChat is unmounted,
  // so the listener never fires (don't force-focus input on Actions).
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const configured = isPetChatConfigured();

  // ponytail: renderPairTag closes over customerProviders (stable ref from
  // zustand) so the resolver doesn't need to be a useCallback; it's only
  // called inside DefaultMessageRow when msg.provider+model exist. Mirrors
  // AiPanel's resolver verbatim — both panels share the provider catalog
  // convention; diverging would just rot.
  const renderPairTag = (msg: CliMessage): ReactNode | null => {
    if (!msg.provider || !msg.model) return null;
    const entry: ProviderEntry | undefined = allProviders(customerProviders).find((e) => e.id === msg.provider);
    const name = entry ? providerDisplayName(entry, t) : msg.provider;
    return <span>{name} : {msg.model}</span>;
  };

  // Hold the latest attachments for the unmount cleanup so it can revoke
  // any pending object URLs without depending on `attachments` in its deps
  // (which would re-run the cleanup on every attachment change).
  const attachmentsRef = useRef<PendingAttachment[]>(attachments);
  attachmentsRef.current = attachments;

  // Stop + reset ALL active adapters on unmount so an in-flight stream does
  // not outlive the panel (PR2: per-session model → reset all adapters, not
  // just one). Also revoke any pending attachment previewUrls so object
  // URLs don't leak when the panel closes mid-compose. Unmount-only via an
  // empty-deps effect with refs holding the latest `streaming` /
  // `attachments` — avoids the old `[streaming, setStreaming]` deps pattern
  // that re-ran the cleanup on every streaming flip.
  const streamingRef = useRef(streaming);
  streamingRef.current = streaming;
  useEffect(() => {
    return () => {
      const wasStreaming = streamingRef.current;
      void resetPetChatAdapter().finally(() => {
        if (wasStreaming) setStreaming(false);
      });
      revokeUrls(attachmentsRef.current);
    };
  }, [setStreaming]);

  // Auto-clear the inline guardrail error after a short delay so it does
  // not linger after the user has moved on. Re-arm on each new error.
  useEffect(() => {
    if (rejectError === null) return;
    const t = setTimeout(() => setRejectError(null), 3000);
    return () => clearTimeout(t);
  }, [rejectError]);

  // ── Focus the textarea on panel show (Esc + typing without click) ──
  // Listens for `pet://panel-fade-in` (emitted by `applyPanelFrame` after the
  // post-show frame re-assert) and focuses the chat textarea so the user can
  // type immediately. Also reinforces the WKWebView's first-responder status
  // (belt-and-suspenders for the Rust `makeFirstResponder` in `pet_panel_show`).
  // PetChat is only mounted when `tab === 'chat'` (PetPanelApp conditional
  // render), so the listener never fires on the Actions tab — no force-focus
  // when the user is on Actions. Wrapped in isTauri so non-Tauri/test envs skip.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen('pet://panel-fade-in', () => {
          // Focus on the next microtask so the CSS fade-in has started and
          // the webview is visible — focusing a hidden webview can be a no-op.
          requestAnimationFrame(() => {
            textareaRef.current?.focus();
          });
        });
      } catch (err) {
        console.warn('[pet-chat] panel-fade-in listener failed:', err);
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // ── Attachment add / remove ──

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      const { accepted, rejected } = addFiles(files, {
        maxBytes: DEFAULT_MAX_BYTES,
        allowedTypes: [...DEFAULT_ALLOWED_TYPES],
      });
      if (accepted.length > 0) {
        setAttachments((prev) => [...prev, ...accepted]);
        setRejectError(null);
      }
      if (rejected.length > 0) {
        const first = rejected[0];
        setRejectError(`${first.name}: ${first.error}`);
      }
      // Reset so the same file can be re-picked (the picker only fires
      // onChange when the selection actually changes).
      e.target.value = '';
    },
    [],
  );

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handlePasteWrapper = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const { accepted, rejected } = handlePaste(e, {
        maxBytes: DEFAULT_MAX_BYTES,
        allowedTypes: [...DEFAULT_ALLOWED_TYPES],
      });
      if (accepted.length > 0) {
        // Consume the paste so the image is NOT also inserted as text.
        e.preventDefault();
        setAttachments((prev) => [...prev, ...accepted]);
        setRejectError(null);
      }
      if (rejected.length > 0) {
        const first = rejected[0];
        setRejectError(`${first.name}: ${first.error}`);
      }
      // No image item → let the textarea insert text normally.
    },
    [],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const att = prev.find((a) => a.id === id);
      if (att) revokeUrls([att]);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  // ── Send ──

  const handleSend = useCallback(async () => {
    const prompt = input.trim();
    const sessionId = activeSessionId;
    if ((!prompt && attachments.length === 0) || streaming || !configured || !sessionId) return;

    // Save blob attachments to <appData>/pet-chat-tmp/attachments/ BEFORE
    // clearing input / adding messages: a save failure must preserve the
    // user's text + attachments for retry (the CLI can't Read a blob that
    // hasn't been written to disk). Path-only attachments pass through.
    let saved;
    try {
      const workingDir = await getPetChatWorkingDir();
      saved = await saveBlobs(attachments, workingDir, { subdir: ATTACHMENTS_SUBDIR });
    } catch (err) {
      setRejectError(t('pet:chat.attachmentSaveFailed', { error: String(err) }));
      return;
    }
    const finalPrompt = buildReadInstructions(saved, prompt);

    // Now that the save succeeded, clear the compose state (input +
    // attachments) and record the messages. The visible user bubble shows
    // the RAW text (NOT the Read-wrapped finalPrompt) — mirroring AiPanel,
    // which stores `userText` and sends the wrapped prompt to the CLI.
    revokeUrls(attachments);
    setAttachments([]);
    setInput('');
    setRejectError(null);
    addMessage(sessionId, 'user', prompt);
    // Stamp the assistant bubble with the active session's pair so
    // ChatMessageList can render the pair tag — parity with AiPanel (every
    // assistant message carries the session's pair). The pair is
    // snapshotted at send time via addMessage, so historical bubbles keep
    // their tag after a pair switch. chat mode (rig) actually consumes the
    // pair; ask/agent run the claude CLI binary but still surface the tag
    // for consistency with the picked pair.
    addMessage(
      sessionId,
      'assistant',
      '',
      petPair?.provider,
      petPair?.model,
    );
    setStreaming(true);
    try {
      await sendPetChatMessage(sessionId, finalPrompt, {
        onToken: (text) => appendToLastMessage(sessionId, text),
        onThinking: (text) => appendToLastMessageThinking(sessionId, text),
        onImage: (image) => appendToLastMessageImage(sessionId, image),
        onDone: () => {
          setStreaming(false);
        },
        onError: (message) => {
          appendToLastMessage(sessionId, t('pet:chat.errorPrefix', { message }));
          setStreaming(false);
        },
      });
    } catch (err) {
      appendToLastMessage(sessionId, t('pet:chat.errorPrefix', { message: String(err) }));
      setStreaming(false);
    }
  }, [
    input,
    attachments,
    streaming,
    configured,
    activeSessionId,
    addMessage,
    appendToLastMessage,
    appendToLastMessageImage,
    appendToLastMessageThinking,
    setStreaming,
    petPair,
  ]);

  const handleStop = useCallback(async () => {
    const sessionId = activeSessionId;
    if (!sessionId) return;
    await stopPetChat(sessionId);
    setStreaming(false);
  }, [activeSessionId, setStreaming]);

  const handleOpenSettings = useCallback(async () => {
    await emitMenuAction('open-ai-settings');
  }, []);

  // ── Slot wiring ──

  const attachmentsRow =
    attachments.length > 0 ? (
      <div className="flex flex-wrap gap-1.5 mb-2">
        {attachments.map((att) => (
          <div
            key={att.id}
            className="flex items-center gap-1 py-0.5 px-1.5 bg-surf border border-brd rounded-md text-[11px] text-t2 max-w-[160px]"
          >
            {att.previewUrl ? (
              <img
                className="w-7 h-7 object-cover rounded shrink-0"
                src={att.previewUrl}
                alt={att.name}
              />
            ) : (
              <span className="inline-flex items-center shrink-0">
                <FileIcon filename={att.name} />
              </span>
            )}
            <span className="truncate min-w-0 flex-1">{att.name}</span>
            <button
              type="button"
              className="w-3.5 h-3.5 flex items-center justify-center rounded-full text-[10px] text-t3 cursor-pointer shrink-0 transition-all duration-100 bg-transparent border-none hover:bg-hov hover:text-red"
              onClick={() => removeAttachment(att.id)}
              aria-label={t('pet:chat.removeAttachment')}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    ) : null;

  const leadingSlot = (
    <>
      {/* Mode picker (chat / ask / agent). Native <select> — zero JS for the
        open/close the AI panel's custom dropdown needs, and the pet panel is
        compact. chat routes to the rig backend; ask/agent to the claude CLI. */}
      <select
        className="h-7 max-w-[96px] text-[11px] bg-transparent text-t3 border-none cursor-pointer outline-none appearance-none disabled:opacity-40 disabled:cursor-not-allowed"
        value={inputMode}
        onChange={(e) => setInputMode(e.target.value)}
        disabled={streaming}
        title={getInputModeDef(inputMode)?.description}
        aria-label={t('pet:chat.aiMode')}
      >
        {listInputModes().map((m) => (
          <option key={m.id} value={m.id} title={m.description}>
            {m.label}
          </option>
        ))}
      </select>
      <AdapterSelector disabled={streaming} />
      <button
        type="button"
        className="w-7 h-7 flex items-center justify-center rounded-md text-t3 cursor-pointer transition-all duration-[120ms] hover:bg-hov hover:text-t1 disabled:opacity-40 disabled:cursor-not-allowed"
        onClick={handleFileSelect}
        disabled={streaming}
        title={t('pet:chat.attachFile')}
        aria-label={t('pet:chat.attachFile')}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
      </button>
      <VoiceInputButton disabled={streaming} />
    </>
  );

  if (!configured) {
    // Unconfigured-AI CTA (R7) — rendered OUTSIDE the shared chat
    // components (it replaces the whole chat body).
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 px-2 py-4 text-center flex-1"
        role="status"
      >
        <div className="text-[13px] font-semibold text-t1">{t('pet:chat.noAiConfig')}</div>
        <div className="text-[12px] text-t3">{t('pet:chat.noAiConfigHint')}</div>
        <button
          type="button"
          className="mt-1 py-1.5 px-3 border border-acc rounded-md bg-acc text-white text-[12px] cursor-pointer hover:opacity-[.85] transition-opacity"
          onClick={() => void handleOpenSettings()}
        >
          {t('pet:chat.openAiSettings')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PetChatSessionHeader />
      <div className="border-b border-brd px-2 py-1">
        <PairSelector
          value={petPair}
          onChange={(pair) => {
            // Phase 2: pair is per-session. No active session → no-op (the
            // panel always has at least one session post-rehydrate, so this
            // is a defensive guard).
            if (activeSessionId && pair) {
              setSessionPair(activeSessionId, pair);
            }
          }}
          onOpenSettings={handleOpenSettings}
        />
      </div>
      <ChatMessageList
        messages={toCliMessages(messages)}
        streaming={streaming}
        showCopy
        showSaveImageButton
        streamingIndicator="dots"
        renderPairTag={renderPairTag}
        onClear={clear}
        className="pt-2"
        emptyState={
          <div className="text-[12px] text-t3 text-center px-1 py-3">
            {t('pet:chat.emptyHint')}
          </div>
        }
      />
      <ChatInputBox
        value={input}
        onChange={setInput}
        onSend={handleSend}
        streaming={streaming}
        onStop={handleStop}
        canSend={(input.trim().length > 0 || attachments.length > 0) && (inputMode !== 'chat' || petPair !== null)}
        placeholder={t('pet:chat.inputPlaceholder')}
        textareaRows={1}
        inputAriaLabel="Pet chat input"
        inputRef={textareaRef}
        onPaste={handlePasteWrapper}
        leadingSlot={leadingSlot}
        attachmentsRow={attachmentsRow}
      />
      {rejectError && (
        <div className="px-3 pb-1.5 text-[11px] text-red" role="alert">
          {rejectError}
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={DEFAULT_ALLOWED_TYPES.join(',')}
        className="hidden"
        onChange={handleFileInputChange}
      />
    </div>
  );
}
