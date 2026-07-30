import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiStore } from '@/store/aiStore';
import { useVaultStore } from '@/store/vaultStore';
import { useEditorStore } from '@/store/editorStore';
import { flattenFileTree } from '@/utils/treeUtils';
import { FileIcon } from '@/components/icons/FileIcon';
import { listInputModes } from './inputModes';
import { AdapterSelector } from './AdapterSelector';
import { ChatInputBox } from '@/components/chat';
import type { PendingAttachment } from '@/components/chat';
import {
  addFiles,
  handlePaste as handlePasteHelper,
  revokeUrls,
  DEFAULT_MAX_BYTES,
  DEFAULT_ALLOWED_TYPES,
} from '@/components/chat';
import { VoiceInputButton } from './VoiceInputButton';

// Re-export PendingAttachment so existing AiPanel imports
// (`import type { PendingAttachment } from './ChatInput'`) keep working
// during the PR3 migration. The canonical type now lives in the shared
// `components/chat/attachments.ts` helper.
export type { PendingAttachment };

interface ChatInputProps {
  onSend: (text: string, attachments: PendingAttachment[]) => void;
  onStop: () => void;
  isStreaming: boolean;
  /** Disable the textarea + send button (e.g. no provider/model pair picked). */
  disabled?: boolean;
}

export function ChatInput({ onSend, onStop, isStreaming, disabled }: ChatInputProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [mentionMenu, setMentionMenu] = useState<{ visible: boolean; filter: string; anchorPos: number }>({ visible: false, filter: '', anchorPos: 0 });
  const [mentionIndex, setMentionIndex] = useState(0);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  /** Inline guardrail / save-error message rendered under the input. Cleared
   *  on the next successful add/paste or after a timeout. Mirrors PetChat's
   *  rejectError pattern so both consumers surface attachment rejections
   *  consistently (previously AiPanel had no validation UI at all). */
  const [rejectError, setRejectError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);

  const pendingFileAttachments = useAiStore((s) => s.pendingFileAttachments);
  const consumePendingFiles = useAiStore((s) => s.consumePendingFiles);
  const pendingPrompt = useAiStore((s) => s.pendingPrompt);
  const consumePendingPrompt = useAiStore((s) => s.consumePendingPrompt);
  const inputMode = useAiStore((s) => s.inputMode);
  const setInputMode = useAiStore((s) => s.setInputMode);
  const inputModes = useMemo(() => listInputModes(), []);
  // Feature-agent sessions (kind='study') pick their own adapter at impl
  // time and ignore the user-facing adapter selector; only general chat
  // sessions show it.
  const sessionKind = useAiStore((s) => s.sessions?.find((x) => x.id === s.activeSessionId)?.kind);
  // Forbid in-session adapter switching: once a chat session has talked to
  // a backend (has a cliSessionId) or is mid-stream, lock the selector. The
  // user starts a new session to use a different adapter.
  const sessionLocked = useAiStore((s) =>
    Boolean(s.sessions?.find((x) => x.id === s.activeSessionId)?.cliSessionId),
  );
  const currentModeDef = useMemo(
    () => inputModes.find((m) => m.id === inputMode),
    [inputMode, inputModes],
  );

  // 点击外部关闭模式下拉
  useEffect(() => {
    if (!modeMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)) {
        setModeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [modeMenuOpen]);

  useEffect(() => {
    if (pendingFileAttachments.length === 0) return;
    const files = consumePendingFiles();
    setAttachments((prev) => {
      const existing = new Set(prev.map((a) => a.path));
      const newOnes = files
        .filter((f) => !existing.has(f.path))
        .map((f) => ({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: f.name,
          type: 'file' as const,
          path: f.path,
        }));
      return [...prev, ...newOnes];
    });
  }, [pendingFileAttachments, consumePendingFiles]);

  // 预填提示词（学习工作台 AI 动作经 aiStore.pendingPrompt 注入，无新调用链）。
  useEffect(() => {
    if (!pendingPrompt) return;
    const p = consumePendingPrompt();
    if (!p) return;
    setInput(p);
    // 聚焦输入框末端，便于用户审阅后直接发送。
    setTimeout(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.selectionStart = ta.selectionEnd = p.length;
        ta.focus();
      }
    }, 0);
  }, [pendingPrompt, consumePendingPrompt]);

  // Auto-clear the inline guardrail error after a short delay so it does
  // not linger after the user has moved on. Re-arms on each new error.
  // Mirrors PetChat's rejectError timeout.
  useEffect(() => {
    if (rejectError === null) return;
    const t = setTimeout(() => setRejectError(null), 3000);
    return () => clearTimeout(t);
  }, [rejectError]);

  const fileTree = useVaultStore((s) => s.fileTree);
  const allFiles = useMemo(() => flattenFileTree(fileTree), [fileTree]);
  const activeFilePath = useEditorStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab?.path ?? null;
  });
  const filteredMentionFiles = useMemo(() => {
    if (!mentionMenu.visible) return [];
    const q = mentionMenu.filter.toLowerCase();
    const matched = q
      ? allFiles.filter((f) => f.path.toLowerCase().includes(q) || f.name.toLowerCase().includes(q))
      : allFiles;
    if (!activeFilePath) return matched.slice(0, 20);
    const activeIdx = matched.findIndex((f) => f.path === activeFilePath);
    if (activeIdx <= 0) return matched.slice(0, 20);
    return [matched[activeIdx], ...matched.slice(0, activeIdx), ...matched.slice(activeIdx + 1)].slice(0, 20);
  }, [mentionMenu.visible, mentionMenu.filter, allFiles, activeFilePath]);

  const handleChange = useCallback((value: string) => {
    setInput(value);
    // Read the live cursor position off the textarea DOM node (the same
    // node ChatInputBox owns; `textareaRef` is the merged `inputRef`).
    const cursorPos = textareaRef.current?.selectionStart ?? value.length;
    const textBeforeCursor = value.slice(0, cursorPos);
    const atIdx = textBeforeCursor.lastIndexOf('@');
    if (atIdx >= 0 && (atIdx === 0 || /\s/.test(textBeforeCursor[atIdx - 1]))) {
      const filter = textBeforeCursor.slice(atIdx + 1);
      if (!filter.includes(' ') && !filter.includes('\n')) {
        setMentionMenu({ visible: true, filter, anchorPos: atIdx });
        setMentionIndex(0);
        return;
      }
    }
    setMentionMenu({ visible: false, filter: '', anchorPos: 0 });
  }, []);

  const insertMention = useCallback((filePath: string) => {
    const { anchorPos } = mentionMenu;
    const textarea = textareaRef.current;
    const cursorPos = textarea?.selectionStart ?? input.length;
    const before = input.slice(0, anchorPos);
    const after = input.slice(cursorPos);
    const newValue = `${before}${after}`;
    setInput(newValue);
    setMentionMenu({ visible: false, filter: '', anchorPos: 0 });

    const fileName = filePath.split('/').pop() || filePath;
    setAttachments((prev) => {
      if (prev.some((a) => a.path === filePath)) return prev;
      return [...prev, {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: fileName,
        type: 'file' as const,
        path: filePath,
      }];
    });

    setTimeout(() => {
      if (textarea) {
        textarea.selectionStart = textarea.selectionEnd = anchorPos;
        textarea.focus();
      }
    }, 0);
  }, [mentionMenu, input]);

  const handleSendClick = useCallback(() => {
    if ((!input.trim() && attachments.length === 0) || isStreaming) return;
    const userText = input.trim();
    const currentAttachments = [...attachments];
    setInput('');
    setAttachments([]);
    onSend(userText, currentAttachments);
  }, [input, attachments, isStreaming, onSend]);

  // Mention-menu key handling runs BEFORE the base Enter-to-send. Returns
  // true when a key is consumed so ChatInputBox skips its Enter handler.
  const handleBeforeKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionMenu.visible && filteredMentionFiles.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % filteredMentionFiles.length);
        return true;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + filteredMentionFiles.length) % filteredMentionFiles.length);
        return true;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(filteredMentionFiles[mentionIndex].path);
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionMenu({ visible: false, filter: '', anchorPos: 0 });
        return true;
      }
    }
    return false;
  }, [mentionMenu.visible, filteredMentionFiles, mentionIndex, insertMention]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const { accepted, rejected } = handlePasteHelper(e, {
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
  }, []);

  const handleFileSelect = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
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
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const att = prev.find((a) => a.id === id);
      if (att) revokeUrls([att]);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  // ── Slots built from AiPanel-specific state ──

  const attachmentsRow = attachments.length > 0 ? (
    <div className="flex flex-wrap gap-1.5 mb-2">
      {attachments.map((att) => (
        <div key={att.id} className="flex items-center gap-1 py-0.5 px-1.5 bg-surf border border-brd rounded-md text-[11px] text-t2 max-w-[160px]">
          {att.previewUrl ? (
            <img className="w-7 h-7 object-cover rounded shrink-0" src={att.previewUrl} alt={att.name} />
          ) : (
            <span className="inline-flex items-center shrink-0"><FileIcon filename={att.name} /></span>
          )}
          <span className="truncate min-w-0 flex-1">{att.name}</span>
          <button className="w-3.5 h-3.5 flex items-center justify-center rounded-full text-[10px] text-t3 cursor-pointer shrink-0 transition-all duration-100 bg-transparent border-none hover:bg-hov hover:text-red" onClick={() => removeAttachment(att.id)} aria-label={t('ai:chat.removeAttachment')}>×</button>
        </div>
      ))}
    </div>
  ) : null;

  const mentionOverlay = mentionMenu.visible && filteredMentionFiles.length > 0 ? (
    <div className="absolute bottom-full left-0 right-0 max-h-[200px] overflow-y-auto bg-panel border border-brd rounded-lg mb-1 shadow-[0_-4px_12px_rgba(0,0,0,.08)] z-[100]">
      {filteredMentionFiles.map((file, i) => (
        <div
          key={file.path}
          className={`py-1.5 px-3 text-[12px] cursor-pointer flex items-center gap-1.5 ${i === mentionIndex ? 'bg-hov' : ''} hover:bg-hov`}
          onMouseDown={(e) => { e.preventDefault(); insertMention(file.path); }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><FileIcon filename={file.name} /> {file.name}</span>
          <span className="text-t3 text-[11px] ml-auto overflow-hidden text-ellipsis whitespace-nowrap max-w-[60%] text-right">{file.path}</span>
        </div>
      ))}
    </div>
  ) : null;

  const leadingSlot = (
    <>
      {inputModes.length > 1 && (
        <div className="relative" ref={modeMenuRef}>
          <button
            className="px-1.5 h-7 flex items-center gap-1 rounded text-[11px] cursor-pointer border-none transition-all duration-[120ms] bg-transparent text-t3 hover:bg-hov hover:text-t1 disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => setModeMenuOpen((v) => !v)}
            disabled={isStreaming}
            title={currentModeDef?.description}
          >
            <span>{currentModeDef?.label ?? inputMode}</span>
          </button>
          {modeMenuOpen && (
            <div className="absolute bottom-full left-0 mb-1 min-w-[120px] bg-panel border border-brd rounded-md shadow-[0_4px_16px_rgba(0,0,0,.12)] z-[100] py-0.5">
              {inputModes.map((m) => {
                const active = m.id === inputMode;
                return (
                  <div
                    key={m.id}
                    className={`py-1.5 px-3 text-[12px] cursor-pointer whitespace-nowrap ${active ? 'bg-accdim text-acc font-semibold' : 'text-t2 hover:bg-hov hover:text-t1'}`}
                    title={m.description}
                    onMouseDown={(e) => { e.preventDefault(); setInputMode(m.id); setModeMenuOpen(false); }}
                  >
                    {m.label}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {sessionKind !== 'study' && <AdapterSelector disabled={isStreaming || sessionLocked} />}
      <button className="w-7 h-7 flex items-center justify-center rounded-md text-t3 cursor-pointer transition-all duration-[120ms] hover:bg-hov hover:text-t1 disabled:opacity-40 disabled:cursor-not-allowed" onClick={handleFileSelect} disabled={isStreaming} title={t('ai:chat.attachFile')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
      </button>
      <VoiceInputButton />
    </>
  );

  return (
    <>
      <ChatInputBox
        value={input}
        onChange={handleChange}
        onSend={handleSendClick}
        onStop={onStop}
        streaming={isStreaming}
        disabled={disabled}
        canSend={input.trim().length > 0 || attachments.length > 0}
        placeholder={t('ai:chat.placeholder')}
        textareaRows={2}
        onPaste={handlePaste}
        inputRef={textareaRef}
        onBeforeKeyDown={handleBeforeKeyDown}
        leadingSlot={leadingSlot}
        attachmentsRow={attachmentsRow}
        overlayLayer={mentionOverlay}
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
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />
    </>
  );
}
