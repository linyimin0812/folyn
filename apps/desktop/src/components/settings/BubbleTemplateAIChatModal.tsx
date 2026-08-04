import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Paperclip, Plus, Trash2 } from 'lucide-react';
import { ChatInputBox, ChatMessageList } from '@/components/chat';
import { VoiceInputButton } from '@/components/ai/VoiceInputButton';
import { PairSelector } from '@/components/ai/PairSelector';
import { useNavStore } from '@/store/navStore';
import type { CliMessage } from '@quill/cli-adapter';
import { runRigChat } from '@/services/rigChat';
import { type ResolvedPairConfig } from '@/store/aiConfigStore';
import { useModelRegistryStore } from '@/store/modelRegistryStore';
import { findModelInCatalog } from '@/services/modelRegistry/loader';
import { isVisionModel } from '@/services/modelRegistry/merge';
import type { Model } from '@/services/modelRegistry/types';
import {
  useBubbleTemplateChatStore,
  resolvePairForBtSession,
} from '@/store/bubbleTemplateChatStore';
import { generateId } from '@/utils/idGenerator';
import { extractLastJsonFence } from '@/components/pet/extractLastJsonFence';
import { buildBubbleTemplateSystemPrompt } from '@/components/pet/bubbleTemplateSystemPrompt';

export interface BubbleTemplateAIChatModalProps {
  open: boolean;
  onClose: () => void;
  /** Returns `{ ok: true }` if import succeeded (modal will close); returns
   *  `{ ok: false, error }` to keep the modal open and surface the error. */
  onImport: (jsonText: string) => { ok: boolean; error?: string };
  /** Preview the draft template without importing it. Returns
   *  `{ ok: false, error }` to surface a parse error; `{ ok: true }` fires the
   *  preview and keeps the modal open so the user can iterate. */
  onPreview?: (jsonText: string) => { ok: boolean; error?: string };
}

interface PendingAttachment {
  kind: 'html' | 'image';
  name: string;
  /** HTML text content (kind='html'). */
  text?: string;
  /** Base64 image data without data: prefix (kind='image'). */
  data?: string;
  /** MIME type, e.g. image/png (kind='image'). */
  mediaType?: string;
  /** data: URL for thumbnail preview (kind='image'). */
  previewUrl?: string;
}

/** Resolve the active bt session's pair to a usable chat config. Null until
 *  the user picks a (provider, model) in the modal's PairSelector (or the
 *  active session has no pair). Phase 2: pair moved off the global bubblePair
 *  onto the bt session. */
function readChatConfig(sessionId: string | null): ResolvedPairConfig | null {
  if (!sessionId) return null;
  return resolvePairForBtSession(sessionId);
}

/** Stable empty reference for the active-session messages selector — when
 *  `activeSessionId` is null or stale (before rehydrate), returning an
 *  inline `[]` here creates a new array reference on every selector call.
 *  Zustand v5 uses `useSyncExternalStore`, and React 18 treats a changing
 *  snapshot as a store mutation → re-render → new snapshot → infinite loop.
 *  Returning this constant keeps the not-found path referentially stable. */
const EMPTY_MESSAGES: CliMessage[] = [];

/** Same pitfall as EMPTY_MESSAGES: `s.modelsByProvider[chatProvider] ?? []`
 *  creates a new array on every selector call when the provider has no
 *  fetched models yet, which sends useSyncExternalStore into an infinite
 *  re-render loop. Return this constant instead. */
const EMPTY_MODELS: Model[] = [];


/** Read an image File into {data, mediaType, previewUrl} via FileReader. */
function readImageFile(file: File): Promise<{ data: string; mediaType: string; previewUrl: string }> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const result = String(r.result); // "data:image/png;base64,...."
      const commaIdx = result.indexOf(',');
      if (commaIdx < 0) {
        reject(new Error('invalid data URL'));
        return;
      }
      const header = result.slice(0, commaIdx); // "data:image/png;base64"
      const data = result.slice(commaIdx + 1);
      const mtMatch = header.match(/^data:([^;]+);base64$/);
      const mediaType = mtMatch?.[1] ?? file.type ?? 'image/png';
      resolve({ data, mediaType, previewUrl: result });
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function BubbleTemplateAIChatModal({
  open,
  onClose,
  onImport,
  onPreview,
}: BubbleTemplateAIChatModalProps) {
  const { t } = useTranslation();
  const sessions = useBubbleTemplateChatStore((s) => s.sessions);
  const sessionId = useBubbleTemplateChatStore((s) => s.activeSessionId);
  const streaming = useBubbleTemplateChatStore((s) => s.streaming);
  const loaded = useBubbleTemplateChatStore((s) => s.loaded);
  const createSession = useBubbleTemplateChatStore((s) => s.createSession);
  const switchSession = useBubbleTemplateChatStore((s) => s.switchSession);
  const deleteSession = useBubbleTemplateChatStore((s) => s.deleteSession);
  const addMessage = useBubbleTemplateChatStore((s) => s.addMessage);
  const appendToLastMessage = useBubbleTemplateChatStore((s) => s.appendToLastMessage);
  const appendToLastMessageThinking = useBubbleTemplateChatStore((s) => s.appendToLastMessageThinking);
  const setStreaming = useBubbleTemplateChatStore((s) => s.setStreaming);
  const rehydrate = useBubbleTemplateChatStore((s) => s.rehydrate);

  const activeMessages = useBubbleTemplateChatStore(
    (s) => s.sessions.find((sess) => sess.id === s.activeSessionId)?.messages ?? EMPTY_MESSAGES,
  );

  // Phase 2: the bt pair is per-session. Read the active session's pair
  // (undefined when no pair yet — same empty state as the old null
  // bubblePair global). The in-modal PairSelector writes via setSessionPair;
  // readChatConfig resolves via resolvePairForBtSession at send time.
  const activeBtSession = useBubbleTemplateChatStore((s) =>
    s.sessions.find((sess) => sess.id === s.activeSessionId),
  );
  const setSessionPair = useBubbleTemplateChatStore((s) => s.setSessionPair);
  // ponytail: Phase 3 — ChatProvider is `string`, no cast needed.
  const bubblePair = activeBtSession?.provider && activeBtSession?.model
    ? { provider: activeBtSession.provider, model: activeBtSession.model }
    : null;
  const pairProvider = bubblePair?.provider;
  const pairModel = bubblePair?.model;
  const fetchedModels = useModelRegistryStore((s) =>
    pairProvider ? (s.modelsByProvider[pairProvider] ?? EMPTY_MODELS) : EMPTY_MODELS,
  );
  const selectedModel = (pairProvider && pairModel)
    ? (findModelInCatalog(pairProvider, pairModel) ?? fetchedModels.find((m) => m.id === pairModel))
    : undefined;
  const visionOk = !selectedModel || isVisionModel(selectedModel);

  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<PendingAttachment | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const confirmResetRef = useRef<number | null>(null);

  // ponytail: inline two-click confirm instead of window.confirm — Tauri's
  // webview override routes window.confirm to `dialog:confirm` IPC which
  // fails on this build. Second click within 3s commits the delete.
  useEffect(() => {
    return () => {
      if (confirmResetRef.current) window.clearTimeout(confirmResetRef.current);
    };
  }, []);

  const preamble = useRef(buildBubbleTemplateSystemPrompt()).current;

  // Lazy rehydrate on first open. The store's rehydrate is idempotent —
  // subsequent opens are a no-op.
  useEffect(() => {
    if (open) void rehydrate();
  }, [open, rehydrate]);

  const handleNewSession = useCallback(() => {
    if (streaming) return;
    createSession();
    setInput('');
    setPending(null);
    setError('');
  }, [streaming, createSession]);

  const handleClear = useCallback(() => {
    if (streaming || !sessionId) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      if (confirmResetRef.current) window.clearTimeout(confirmResetRef.current);
      confirmResetRef.current = window.setTimeout(() => setConfirmingDelete(false), 3000);
      return;
    }
    if (confirmResetRef.current) {
      window.clearTimeout(confirmResetRef.current);
      confirmResetRef.current = null;
    }
    setConfirmingDelete(false);
    deleteSession(sessionId);
    setInput('');
    setPending(null);
    setError('');
  }, [streaming, sessionId, deleteSession, confirmingDelete]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so picking the same file twice fires onChange again.
    e.target.value = '';
    if (!file) return;
    try {
      if (file.type.startsWith('image/')) {
        // T05: gate image upload on vision capability. HTML upload is
        // unaffected — the paperclip's `accept` shrinks to .html-only when
        // !visionOk, but drag/drop/paste can still bypass it.
        if (!visionOk) {
          setError(t('settings:pet.templates.ai.imageNotSupported'));
          return;
        }
        const { data, mediaType, previewUrl } = await readImageFile(file);
        setPending({ kind: 'image', name: file.name, data, mediaType, previewUrl });
      } else if (file.type === 'text/html' || /\.html?$/i.test(file.name)) {
        const text = await file.text();
        setPending({ kind: 'html', name: file.name, text });
      } else {
        setError(t('settings:pet.templates.ai.unsupportedFile'));
        return;
      }
      setError('');
    } catch {
      setError(t('settings:pet.templates.ai.fileReadFailed'));
    }
  }, [t, visionOk]);

  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // Only react to clipboard items that are images; let plain-text paste
    // fall through to the textarea's default handling.
    const items = e.clipboardData?.items ?? [];
    let imgFile: File | null = null;
    for (const it of items) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        imgFile = it.getAsFile();
        if (imgFile) break;
      }
    }
    if (!imgFile) return;
    e.preventDefault();
    if (!visionOk) {
      setError(t('settings:pet.templates.ai.imageNotSupported'));
      return;
    }
    try {
      const { data, mediaType, previewUrl } = await readImageFile(imgFile);
      setPending({ kind: 'image', name: imgFile.name || 'pasted.png', data, mediaType, previewUrl });
      setError('');
    } catch {
      setError(t('settings:pet.templates.ai.fileReadFailed'));
    }
  }, [t, visionOk]);

  const handleRemovePending = useCallback(() => {
    setPending(null);
  }, []);

  const handleSend = useCallback(async () => {
    if (streaming || !sessionId) return;
    const userText = input.trim();
    const hasAttachment = pending !== null;
    if (!userText && !hasAttachment) return;
    const cfg = readChatConfig(sessionId);
    if (!cfg) {
      setError(t('settings:pet.templates.ai.unconfigured'));
      return;
    }
    setError('');
    // ponytail: visible bubble shows the user's text (or a placeholder when
    // only an attachment is sent). The actual prompt sent to rig wraps the
    // HTML so the AI sees "adapt this HTML" rather than a raw blob; for
    // images, the text is sent as-is and the image travels as a separate
    // content block via `images`. Mirrors PetChat's split (visible text ≠
    // what the backend receives).
    const visibleContent = userText
      || (pending?.kind === 'html'
        ? t('settings:pet.templates.ai.htmlAttached', { name: pending.name })
        : pending?.kind === 'image'
          ? t('settings:pet.templates.ai.imageAttached', { name: pending.name })
          : '');
    const isHtml = pending?.kind === 'html';
    const isImage = pending?.kind === 'image';
    const prompt = isHtml
      ? `${t('settings:pet.templates.ai.htmlWrapPrefix')}\n\`\`\`html\n${pending!.text!}\n\`\`\`\n${userText ? `\n${userText}\n` : ''}`
      : isImage
        ? `${t('settings:pet.templates.ai.imageWrapPrefix')}${userText ? `\n\n${userText}` : ''}`
        : userText;
    const images = pending?.kind === 'image' && pending.data && pending.mediaType
      ? [{ data: pending.data, mediaType: pending.mediaType }]
      : undefined;
    const userMsg: CliMessage = {
      id: generateId(),
      role: 'user',
      content: visibleContent,
      timestamp: Date.now(),
      ...(hasAttachment ? { attachments: [{ name: pending!.name, path: '', type: 'file' as const }] } : {}),
    };
    const assistantMsg: CliMessage = {
      id: generateId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };
    addMessage(sessionId, userMsg);
    addMessage(sessionId, assistantMsg);
    setInput('');
    setPending(null);
    setStreaming(true);
    const targetSessionId = sessionId;
    const assistantId = assistantMsg.id;

    try {
      await runRigChat({
        sessionId: targetSessionId,
        prompt,
        provider: cfg.provider,
        model: cfg.model,
        apiKey: cfg.apiKey,
        ...(cfg.baseUrl ? { baseUrl: cfg.baseUrl } : {}),
        ...(cfg.thinkingBudget != null ? { thinkingBudget: cfg.thinkingBudget } : {}),
        adapterFamily: cfg.adapterFamily,
        preamble,
        ...(images ? { images } : {}),
        onEvent: (event) => {
          if (event.type === 'text') {
            appendToLastMessage(targetSessionId, event.content ?? '');
          } else if (event.type === 'thinking') {
            appendToLastMessageThinking(targetSessionId, event.content ?? '');
          } else if (event.type === 'error') {
            // Backend emitted an error chunk. The invoke typically rejects
            // right after, but don't rely on that — surface the error and
            // clear streaming now so the UI unsticks immediately.
            const msg = event.content || t('settings:pet.templates.ai.error');
            setError(msg);
            setStreaming(false);
          }
          // 'done' / others: streaming cleared in finally.
        },
      });
    } catch (err) {
      // Tauri rejects with a serialized AppError `{category, detail}` for
      // backend errors (e.g. save_history failure). String() on a plain
      // object gives "[object Object]" — extract `detail` for display.
      const msg = err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : (err as { detail?: string; message?: string })?.detail
            ?? (err as { message?: string })?.message
            ?? JSON.stringify(err);
      setError(msg);
    } finally {
      setStreaming(false);
      // Stream ended with no text content → surface empty-response so the
      // user isn't left staring at a stopped cursor with no feedback. This
      // fires even if thinking arrived: thinking alone means the model never
      // produced a final answer, which is still a failure for this UI's
      // purpose (drafting a BubbleTemplate).
      setError((prev) => {
        if (prev) return prev;
        const sess = useBubbleTemplateChatStore.getState().sessions.find((s) => s.id === targetSessionId);
        const last = sess?.messages.find((m) => m.id === assistantId);
        if (!last) return prev;
        const hasText = last.content.trim().length > 0;
        return !hasText ? t('settings:pet.templates.ai.emptyResponse') : prev;
      });
    }
  }, [sessionId, input, streaming, pending, preamble, t, addMessage, appendToLastMessage, appendToLastMessageThinking, setStreaming]);

  const lastAssistant = [...activeMessages].reverse().find((m) => m.role === 'assistant');
  const lastJsonFence = lastAssistant ? extractLastJsonFence(lastAssistant.content) : null;

  const handleImport = useCallback(() => {
    if (!lastJsonFence) return;
    const result = onImport(lastJsonFence);
    if (result.ok) {
      onClose();
    } else {
      setError(result.error ?? t('settings:pet.templates.invalidJson'));
    }
  }, [lastJsonFence, onImport, onClose, t]);

  const handlePreview = useCallback(() => {
    if (!lastJsonFence || !onPreview) return;
    const result = onPreview(lastJsonFence);
    if (!result.ok) {
      setError(result.error ?? t('settings:pet.templates.invalidJson'));
    } else {
      setError('');
    }
  }, [lastJsonFence, onPreview, t]);

  if (!open) return null;

  const chatConfig = readChatConfig(sessionId);
  const unconfigured = !chatConfig;

  const attachmentsRow = pending ? (
    <div className="flex flex-wrap gap-1.5 mb-2">
      <div className="flex items-center gap-1 py-0.5 px-1.5 bg-surf border border-brd rounded-md text-[11px] text-t2 max-w-[200px]">
        {pending.kind === 'image' && pending.previewUrl ? (
          <img src={pending.previewUrl} alt="" className="w-5 h-5 object-cover rounded-sm" />
        ) : null}
        <span className="truncate">{pending.name}</span>
        <button
          className="text-t3 hover:text-t1 ml-0.5"
          onClick={handleRemovePending}
          aria-label={t('settings:pet.templates.ai.removeAttachment')}
        >✕</button>
      </div>
    </div>
  ) : null;

  const leadingSlot = (
    <>
      <PairSelector
        trigger="icon"
        dropDirection="up"
        value={bubblePair}
        onChange={(pair) => {
          // Phase 2: pair is per-session — write the active bt session.
          if (sessionId && pair) {
            setSessionPair(sessionId, pair);
          }
        }}
        onOpenSettings={() => {
          useNavStore.getState().setCurrentPage('settings');
          useNavStore.getState().setSettingsTab('models');
        }}
      />
      <VoiceInputButton />
      <input
        ref={fileInputRef}
        type="file"
        // T05: shrink accept when the current model lacks vision — HTML
        // upload still works, image picker is hidden at the OS level.
        accept={visionOk ? '.html,.htm,image/*' : '.html,.htm'}
        className="hidden"
        aria-label={t('settings:pet.templates.ai.paperclip')}
        onChange={(e) => void handleFileChange(e)}
      />
      <button
        className="text-t3 hover:text-t1 px-1"
        onClick={() => fileInputRef.current?.click()}
        title={
          visionOk
            ? t('settings:pet.templates.ai.paperclip')
            : t('settings:pet.templates.ai.imageNotSupported')
        }
      ><Paperclip className="w-[16px] h-[16px]" /></button>
    </>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label={t('settings:pet.templates.ai.title')}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-surf rounded-lg border border-brd shadow-xl flex flex-col w-[760px] h-[640px] max-w-[90vw] max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-brd gap-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <h2 className="text-[14px] font-semibold text-t1 m-0 shrink-0">
              {t('settings:pet.templates.ai.title')}
            </h2>
            <select
              className="text-[11px] bg-surf2 border border-brd rounded px-1.5 py-0.5 min-w-0 max-w-[220px] truncate disabled:opacity-40"
              value={sessionId ?? ''}
              onChange={(e) => switchSession(e.target.value)}
              disabled={streaming || !loaded}
              aria-label={t('settings:pet.templates.ai.sessionSelect')}
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title || t('settings:pet.templates.ai.untitled')}
                </option>
              ))}
            </select>
            <button
              className="text-t3 hover:text-t1 px-1 disabled:opacity-40"
              onClick={handleNewSession}
              disabled={streaming || !loaded}
              title={t('settings:pet.templates.ai.newSession')}
              aria-label={t('settings:pet.templates.ai.newSession')}
            ><Plus className="w-[14px] h-[14px]" /></button>
            <button
              className={`px-1 disabled:opacity-40 ${confirmingDelete ? 'text-[#e53935] hover:text-[#e53935] text-[11px]' : 'text-t3 hover:text-t1'}`}
              onClick={handleClear}
              disabled={streaming || (activeMessages.length === 0 && sessions.length === 1)}
              title={t('settings:pet.templates.ai.clear')}
              aria-label={t('settings:pet.templates.ai.clear')}
            >{confirmingDelete ? t('settings:pet.templates.ai.confirmDelete') : <Trash2 className="w-[14px] h-[14px]" />}</button>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              className="text-t3 hover:text-t1 text-[14px]"
              onClick={onClose}
              aria-label={t('settings:pet.templates.ai.close')}
            >✕</button>
          </div>
        </div>
        {unconfigured ? (
          <div className="flex-1 flex items-center justify-center px-6 text-center">
            <div className="text-[12px] text-t3">
              {t('settings:pet.templates.ai.unconfigured')}
            </div>
          </div>
        ) : !loaded ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-[12px] text-t3">{t('settings:pet.templates.ai.loading')}</div>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-hidden flex flex-col min-h-0 px-4 pt-3 pb-2">
              <ChatMessageList
                messages={activeMessages}
                streaming={streaming}
                streamingIndicator="cursor"
                showCopy
                className="gap-3"
              />
            </div>
            {error && (
              <div className="px-5 py-1.5 text-[11px] text-[#e53935] border-t border-brd">
                {error}
              </div>
            )}
            {lastJsonFence && (
              <div className="px-5 py-2.5 border-t border-brd flex gap-2">
                <button
                  className="btn btn-g btn-sm flex-1 justify-center"
                  onClick={handlePreview}
                  disabled={streaming || !onPreview}
                >{t('settings:pet.templates.ai.preview')}</button>
                <button
                  className="btn btn-g btn-sm flex-1 justify-center"
                  onClick={handleImport}
                  disabled={streaming}
                >{t('settings:pet.templates.ai.importTemplate')}</button>
              </div>
            )}
            <div className="px-5 py-2.5 border-t border-brd">
              <ChatInputBox
                value={input}
                onChange={setInput}
                onSend={() => void handleSend()}
                streaming={streaming}
                textareaRows={3}
                placeholder={t('settings:pet.templates.ai.inputPlaceholder')}
                leadingSlot={leadingSlot}
                attachmentsRow={attachmentsRow}
                onPaste={handlePaste}
                canSend={Boolean(input.trim()) || pending !== null}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
