import { useState, useRef, useEffect, useMemo, useCallback, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiStore } from '@/store/aiStore';
import { useVaultStore } from '@/store/vaultStore';
import { useEditorStore } from '@/store/editorStore';
import { useAiConfigStore } from '@/store/aiConfigStore';
import { flattenFileTree } from '@/utils/treeUtils';
import { FileIcon } from '@/components/icons/FileIcon';
import { listInputModes, isRigMode } from './inputModes';
import { Sparkles, Zap, Command as CommandIcon, Eraser, Trash2 } from 'lucide-react';
import { AdapterSelector } from './AdapterSelector';
import { PairSelector, useEnabledPairs, type Pair } from './PairSelector';
import { useNavStore } from '@/store/navStore';
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
import { getAdapterForSession } from './adapterManager';
import type { CommandEntry, SkillEntry } from '@quill/cli-adapter';

// Re-export PendingAttachment so existing AiPanel imports
// (`import type { PendingAttachment } from './ChatInput'`) keep working
// during the PR3 migration. The canonical type now lives in the shared
// `components/chat/attachments.ts` helper.
export type { PendingAttachment };

/** Build the text inserted into the input box when the user picks a slash-menu
 *  entry. Mirrors the per-CLI invocation rules from the research file:
 *  - Claude skill → `/name` (Claude resolves skills via bare `/name`)
 *  - Pi skill      → `/skill:name` (Pi's mandatory `skill:` prefix)
 *  - command/template → `/name` (both CLIs use bare `/name` for templates)
 *  When the entry has an `argumentHint` and `args` is provided, the args are
 *  appended after a space. Exported for unit testing. */
export function buildSlashInsertString(
  entry: { kind: 'skill' | 'command'; name: string },
  adapterId: string,
  args?: string,
): string {
  const trigger =
    entry.kind === 'skill' && adapterId === 'pi' ? `/skill:${entry.name}` : `/${entry.name}`;
  const trimmed = args?.trim();
  return trimmed ? `${trigger} ${trimmed}` : trigger;
}

/** Filter skills + commands by a lowercase `q` prefix typed after `/`.
 *  Matches on name OR description (case-insensitive). Exported for unit
 *  testing the `/`-trigger filter without rendering. */
export function filterSlashEntries(
  skills: SkillEntry[],
  commands: CommandEntry[],
  q: string,
): { skills: SkillEntry[]; commands: CommandEntry[] } {
  const lf = q.toLowerCase();
  const match = (name: string, desc: string) => !lf || name.toLowerCase().includes(lf) || desc.toLowerCase().includes(lf);
  return {
    skills: skills.filter((s) => match(s.name, s.description)).slice(0, 20),
    commands: commands.filter((c) => match(c.name, c.description)).slice(0, 20),
  };
}

/** Split input text into segments, marking slash-invocation tokens
 *  (`/name`, `/skill:name`, `/group:cmd`) for highlight. A token is a `/`
 *  at start-of-string or after whitespace, followed by word/colon/hyphen
 *  chars. Segments concatenate back to EXACTLY the original `text`.
 *  Exported for unit testing. */
export function splitSlashTokens(
  text: string,
): { text: string; isToken: boolean }[] {
  const re = /(^|\s)(\/[\w:][\w:-]*)/g;
  const segments: { text: string; isToken: boolean }[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const ws = m[1];
    const token = m[2];
    const tokenStart = m.index + ws.length;
    if (tokenStart > last) {
      segments.push({ text: text.slice(last, tokenStart), isToken: false });
    }
    segments.push({ text: token, isToken: true });
    last = tokenStart + token.length;
  }
  if (last < text.length) {
    segments.push({ text: text.slice(last), isToken: false });
  }
  if (segments.length === 0) {
    segments.push({ text: '', isToken: false });
  }
  return segments;
}

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
  // `/`-slash trigger (agent mode only). Mirrors the @-mention overlay's
  // shape so the two share the same container + keyboard nav. Mutually
  // exclusive with mentionMenu: the trigger char decides which opens.
  const [slashMenu, setSlashMenu] = useState<{ visible: boolean; filter: string; anchorPos: number }>({ visible: false, filter: '', anchorPos: 0 });
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashEntries, setSlashEntries] = useState<{ skills: SkillEntry[]; commands: CommandEntry[] }>({ skills: [], commands: [] });
  const [argPrompt, setArgPrompt] = useState<{ entry: { kind: 'skill' | 'command'; name: string }; value: string } | null>(null);
  // ponytail: per-session slash list cache. Invalidated when sessionId or
  // cwd changes (cwd = vault basePath). Re-reading the disk every keystroke
  // would thrash; the cache is rebuilt only on session/vault switch or
  // manual refresh. The adapter's start() only stores config (no spawn) so
  // it is safe to call before the first send just to seed the cwd.
  const slashCacheRef = useRef<{ sessionId: string; cwd: string; skills: SkillEntry[]; commands: CommandEntry[] } | null>(null);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  /** Inline guardrail / save-error message rendered under the input. Cleared
   *  on the next successful add/paste or after a timeout. Mirrors PetChat's
   *  rejectError pattern so both consumers surface attachment rejections
   *  consistently (previously AiPanel had no validation UI at all). */
  const [rejectError, setRejectError] = useState<string | null>(null);
  /** Transient success/info notice (e.g. "context cleared"). Mirrors the
   *  rejectError pattern so both surface inline under the input. */
  const [notice, setNotice] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);

  const pendingFileAttachments = useAiStore((s) => s.pendingFileAttachments);
  const consumePendingFiles = useAiStore((s) => s.consumePendingFiles);
  const pendingPrompt = useAiStore((s) => s.pendingPrompt);
  const consumePendingPrompt = useAiStore((s) => s.consumePendingPrompt);
  const setInputMode = useAiStore((s) => s.setInputMode);
  const setSessionMode = useAiStore((s) => s.setSessionMode);
  const clearContext = useAiStore((s) => s.clearContext);
  const clearMessages = useAiStore((s) => s.clearMessages);
  const inputModes = useMemo(() => listInputModes(), []);
  // Feature-agent sessions (kind='study') pick their own adapter at impl
  // time and ignore the user-facing adapter selector; only general chat
  // sessions show it.
  const sessionKind = useAiStore((s) => s.sessions?.find((x) => x.id === s.activeSessionId)?.kind);
  // ponytail: read mode off the active session so it survives restart;
  // fall back to the global inputMode when no session is active (transient
  // state during creation) or for legacy sessions without a persisted mode.
  // Both store reads must be unconditional — `??` short-circuits and would
  // skip the second hook call on some renders, corrupting React's deps count.
  const sessionId = useAiStore((s) => s.activeSessionId);
  const sessionMode = useAiStore((s) => s.sessions?.find((x) => x.id === s.activeSessionId)?.mode);
  const globalInputMode = useAiStore((s) => s.inputMode);
  const inputMode = sessionMode ?? globalInputMode;
  const currentModeDef = useMemo(
    () => inputModes.find((m) => m.id === inputMode),
    [inputMode, inputModes],
  );
  // ponytail: custom modes registered without an icon get a generic glyph —
  // the icon-only trigger has no text label to fall back to.
  const ModeIcon = currentModeDef?.icon ?? Sparkles;
  const modeTitle = currentModeDef?.description
    ? `${currentModeDef.label} — ${currentModeDef.description}`
    : (currentModeDef?.label ?? inputMode);

  // ── Mode-linked secondary selector ──
  // Chat (rig backend) talks straight to an LLM provider, so it needs the
  // (provider, model) pair picker; Agent/Ask run through the CLI adapter,
  // so they surface the adapter (Agent CLI) picker instead. Exactly one of
  // the two renders next to the mode toggle.
  const rigMode = isRigMode(inputMode);
  // ponytail: select stable refs (sessions array, id string) and derive the
  // pair in a memo — a selector returning a fresh {provider, model} object
  // would re-render on every aiStore change (zustand compares Object.is).
  const sessions = useAiStore((s) => s.sessions);
  const activeSessionId = useAiStore((s) => s.activeSessionId);
  const activeSessionIdForSlash = activeSessionId ?? '';
  const setSessionPair = useAiStore((s) => s.setSessionPair);
  const activeSessionPair = useMemo<Pair | null>(() => {
    const sess = sessions?.find((x) => x.id === activeSessionId);
    return sess?.provider && sess?.model ? { provider: sess.provider, model: sess.model } : null;
  }, [sessions, activeSessionId]);
  const { pairs } = useEnabledPairs();
  // ponytail: display-only fallback to the first enabled pair mirrors
  // AiPanel's legacy render-time fallback — a fresh session (no persisted
  // pair) still shows the model that a send would resolve to.
  const sessionPair: Pair | null = activeSessionPair ?? (pairs.length > 0 ? pairs[0] : null);

  // R6: once a session has sent/received any message, lock the input-mode
  // dropdown and the Agent/Ask CLI adapter selector mid-session. Chat mode's
  // PairSelector stays unlocked (user explicitly wants mid-session model
  // switching). `messages.length > 0` is the "session started" signal — more
  // general than `cliSessionId` (rig/Chat never sets cliSessionId but still
  // warrants a lock once the user has typed).
  const sessionStarted = useMemo(() => {
    const sess = sessions?.find((x) => x.id === activeSessionId);
    return Boolean(sess && sess.messages.length > 0);
  }, [sessions, activeSessionId]);

  const handlePairChange = useCallback((pair: Pair | null) => {
    if (!pair) return;
    // A fresh panel/AiPanel has no active session yet (the send path creates
    // one on the first message) — switching the model before sending must
    // create the session so the pick sticks. Without this the change was
    // silently dropped ("cannot switch model" in the pet panel).
    const sessionId = activeSessionId ?? useAiStore.getState().createSession();
    if (!sessionId) return;
    setSessionPair(sessionId, pair);
  }, [activeSessionId, setSessionPair]);

  const handleOpenModelSettings = useCallback(() => {
    useNavStore.getState().setCurrentPage('settings');
    useNavStore.getState().setSettingsTab('models');
  }, []);

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

  // Auto-clear the inline notice after a short delay so it does not linger.
  // Mirrors rejectError's timeout; re-arms on each new notice.
  useEffect(() => {
    if (notice === null) return;
    const t = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(t);
  }, [notice]);

  // Tauri confirm() with a window.confirm fallback for non-Tauri contexts
  // (browser-extension userscripts can intercept window.confirm — same reason
  // as PetSettings). Mirrors the AiPanel.handleDeleteSession pattern.
  const confirmAction = useCallback(async (message: string, title: string): Promise<boolean> => {
    try {
      const { confirm } = await import('@tauri-apps/plugin-dialog');
      return await confirm(message, { title, kind: 'warning' });
    } catch {
      return window.confirm(message);
    }
  }, []);

  const handleClearContext = useCallback(async () => {
    const yes = await confirmAction(t('ai:chat.clearContextConfirm'), t('ai:chat.clearContextConfirmTitle'));
    if (!yes) return;
    clearContext();
    setNotice(t('ai:chat.clearContextDone'));
  }, [confirmAction, clearContext, t]);

  const handleClearMessages = useCallback(async () => {
    const yes = await confirmAction(t('ai:chat.clearMessagesConfirm'), t('ai:chat.clearMessagesConfirmTitle'));
    if (!yes) return;
    clearMessages();
  }, [confirmAction, clearMessages, t]);

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

  // ── `/`-slash trigger (agent mode only) ──
  // Lists the current CLI adapter's skills + commands. The adapter is the
  // per-session instance from adapterManager; `start()` only stores config
  // (no spawn), so calling it here to seed the cwd is safe before the first
  // real send. Cache is keyed by (sessionId, cwd); a vault/session switch
  // invalidates it.
  const currentVault = useVaultStore((s) => s.currentVault);
  const slashCwd = useMemo(() => currentVault?.basePath ?? '', [currentVault]);
  const slashEnabled = inputMode === 'agent' && !rigMode;

  const loadSlashEntries = useCallback(async (sessionId: string, cwd: string): Promise<void> => {
    const cache = slashCacheRef.current;
    if (cache && cache.sessionId === sessionId && cache.cwd === cwd) {
      setSlashEntries({ skills: cache.skills, commands: cache.commands });
      return;
    }
    if (!sessionId || !cwd) {
      setSlashEntries({ skills: [], commands: [] });
      return;
    }
    const aiConfig = useAiConfigStore.getState();
    const adapter = getAdapterForSession(sessionId);
    // start() is idempotent (only stores config); safe to call before send.
    try {
      await adapter.start({ cliPath: aiConfig.cliPath, workingDir: cwd });
    } catch {
      // ignore — listing will just return []
    }
    let skills: SkillEntry[] = [];
    let commands: CommandEntry[] = [];
    try {
      skills = await adapter.listSkills();
    } catch {
      skills = [];
    }
    try {
      commands = await adapter.listCommands();
    } catch {
      commands = [];
    }
    slashCacheRef.current = { sessionId, cwd, skills, commands };
    setSlashEntries({ skills, commands });
  }, []);

  // Invalidate cache on session/vault switch.
  useEffect(() => {
    if (!slashMenu.visible) return;
    const sid = activeSessionIdForSlash;
    const cwd = slashCwd;
    const cache = slashCacheRef.current;
    if (!cache || cache.sessionId !== sid || cache.cwd !== cwd) {
      loadSlashEntries(sid, cwd);
    }
  }, [slashMenu.visible, activeSessionIdForSlash, slashCwd, loadSlashEntries]);

  const filteredSlashEntries = useMemo(() => {
    if (!slashMenu.visible) return { skills: [] as SkillEntry[], commands: [] as CommandEntry[] };
    return filterSlashEntries(slashEntries.skills, slashEntries.commands, slashMenu.filter);
  }, [slashMenu.visible, slashMenu.filter, slashEntries]);

  const totalSlashRows = filteredSlashEntries.skills.length + filteredSlashEntries.commands.length;

  /** Insert a `/name`-style trigger string at the slash anchor, replacing the
   *  `/filter` the user typed. Mirrors insertMention's cursor handling. */
  const insertSlash = useCallback((entry: { kind: 'skill' | 'command'; name: string }, args?: string) => {
    const { anchorPos } = slashMenu;
    const textarea = textareaRef.current;
    const cursorPos = textarea?.selectionStart ?? input.length;
    const adapterId = getAdapterForSession(activeSessionIdForSlash).id;
    const trigger = buildSlashInsertString(entry, adapterId, args);
    const before = input.slice(0, anchorPos);
    const after = input.slice(cursorPos);
    const newValue = `${before}${trigger} ${after}`;
    setInput(newValue);
    setSlashMenu({ visible: false, filter: '', anchorPos: 0 });
    setArgPrompt(null);
    setTimeout(() => {
      if (textarea) {
        const pos = anchorPos + trigger.length + 1;
        textarea.selectionStart = textarea.selectionEnd = pos;
        textarea.focus();
      }
    }, 0);
  }, [slashMenu, input, activeSessionIdForSlash]);

  const handleChange = useCallback((value: string) => {
    setInput(value);
    // Chat mode (rig backend) has no file tools — `@`-mention attachments
    // would be dead weight. Skip the menu; `@` stays as plain text.
    if (rigMode) {
      if (mentionMenu.visible) setMentionMenu({ visible: false, filter: '', anchorPos: 0 });
      return;
    }
    // Read the live cursor position off the textarea DOM node (the same
    // node ChatInputBox owns; `textareaRef` is the merged `inputRef`).
    const cursorPos = textareaRef.current?.selectionStart ?? value.length;
    const textBeforeCursor = value.slice(0, cursorPos);

    // `/`-slash trigger: agent mode only, at line start or after whitespace.
    // Mutually exclusive with `@`-mention (trigger char decides).
    if (slashEnabled) {
      const slashIdx = textBeforeCursor.lastIndexOf('/');
      if (slashIdx >= 0 && (slashIdx === 0 || /\s/.test(textBeforeCursor[slashIdx - 1]))) {
        const filter = textBeforeCursor.slice(slashIdx + 1);
        if (!filter.includes(' ') && !filter.includes('\n')) {
          setSlashMenu({ visible: true, filter, anchorPos: slashIdx });
          setSlashIndex(0);
          // Close mention if open (mutual exclusion).
          if (mentionMenu.visible) setMentionMenu({ visible: false, filter: '', anchorPos: 0 });
          return;
        }
      }
      if (slashMenu.visible) setSlashMenu({ visible: false, filter: '', anchorPos: 0 });
    }

    const atIdx = textBeforeCursor.lastIndexOf('@');
    if (atIdx >= 0 && (atIdx === 0 || /\s/.test(textBeforeCursor[atIdx - 1]))) {
      const filter = textBeforeCursor.slice(atIdx + 1);
      if (!filter.includes(' ') && !filter.includes('\n')) {
        setMentionMenu({ visible: true, filter, anchorPos: atIdx });
        setMentionIndex(0);
        // Close slash if open (mutual exclusion).
        if (slashMenu.visible) setSlashMenu({ visible: false, filter: '', anchorPos: 0 });
        return;
      }
    }
    setMentionMenu({ visible: false, filter: '', anchorPos: 0 });
  }, [rigMode, slashEnabled, mentionMenu.visible, slashMenu.visible]);

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

  // Mention-menu / slash-menu key handling runs BEFORE the base Enter-to-send.
  // Returns true when a key is consumed so ChatInputBox skips its Enter handler.
  const handleBeforeKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Argument-prompt mini input: Enter confirms (insert /name <args>),
    // Escape cancels back to the slash list.
    if (argPrompt) {
      if (e.key === 'Enter') {
        e.preventDefault();
        insertSlash(argPrompt.entry, argPrompt.value);
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setArgPrompt(null);
        return true;
      }
      return false;
    }
    if (slashMenu.visible && totalSlashRows > 0) {
      const skills = filteredSlashEntries.skills;
      const commands = filteredSlashEntries.commands;
      const pick = (idx: number) => {
        if (idx < skills.length) {
          return { kind: 'skill' as const, entry: skills[idx] };
        }
        return { kind: 'command' as const, entry: commands[idx - skills.length] };
      };
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % totalSlashRows);
        return true;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex((i) => (i - 1 + totalSlashRows) % totalSlashRows);
        return true;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const { kind, entry } = pick(slashIndex);
        if (kind === 'command' && entry.argumentHint) {
          // Switch overlay to the argument mini-input.
          setArgPrompt({ entry: { kind, name: entry.name }, value: '' });
        } else {
          insertSlash({ kind, name: entry.name });
        }
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashMenu({ visible: false, filter: '', anchorPos: 0 });
        return true;
      }
    }
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
  }, [argPrompt, insertSlash, slashMenu.visible, totalSlashRows, filteredSlashEntries, slashIndex, mentionMenu.visible, filteredMentionFiles, mentionIndex, insertMention]);

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
        <div key={att.id} className="flex items-center gap-1.5 py-1 px-1.5 bg-panel border border-brd rounded-lg text-[11px] text-t2 max-w-[160px]">
          {att.previewUrl ? (
            <img className="w-7 h-7 object-cover rounded-md shrink-0" src={att.previewUrl} alt={att.name} />
          ) : (
            <span className="inline-flex items-center shrink-0"><FileIcon filename={att.name} /></span>
          )}
          <span className="truncate min-w-0 flex-1">{att.name}</span>
          <button className="w-4 h-4 flex items-center justify-center rounded-full text-[10px] text-t3 cursor-pointer shrink-0 transition-all duration-100 bg-transparent border-none hover:bg-hov hover:text-red" onClick={() => removeAttachment(att.id)} aria-label={t('ai:chat.removeAttachment')}>×</button>
        </div>
      ))}
    </div>
  ) : null;

  const mentionOverlay = mentionMenu.visible && filteredMentionFiles.length > 0 ? (
    <div className="absolute bottom-full left-0 right-0 max-h-[200px] overflow-y-auto bg-panel border border-brd rounded-lg mb-1 shadow-[0_-8px_24px_rgba(0,0,0,.12)] z-[100] p-1">
      {filteredMentionFiles.map((file, i) => (
        <div
          key={file.path}
          className={`py-1.5 px-2 rounded-md text-[12px] cursor-pointer flex items-center gap-1.5 transition-colors ${i === mentionIndex ? 'bg-hov' : ''} hover:bg-hov`}
          onMouseDown={(e) => { e.preventDefault(); insertMention(file.path); }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><FileIcon filename={file.name} /> {file.name}</span>
          <span className="text-t3 text-[11px] ml-auto overflow-hidden text-ellipsis whitespace-nowrap max-w-[60%] text-right">{file.path}</span>
        </div>
      ))}
    </div>
  ) : null;

  // `/`-slash overlay: lists skills (Zap icon) then commands (Command icon).
  // Source tag (user/project/plugin) mirrors config-layering terminology.
  // When the picked command has an `argument-hint`, the overlay switches to
  // the argPrompt mini-input (below) instead of inserting immediately.
  const sourceTag = (s: SkillEntry['source']): string => t(`ai:slash.source${s[0].toUpperCase()}${s.slice(1)}`);
  const slashOverlay = slashMenu.visible ? (
    argPrompt ? (
      <div className="absolute bottom-full left-0 right-0 bg-panel border border-brd rounded-lg mb-1 shadow-[0_-8px_24px_rgba(0,0,0,.12)] z-[100] p-2 flex items-center gap-2">
        <CommandIcon size={14} className="text-t3 shrink-0" />
        <input
          className="flex-1 min-w-0 bg-transparent border-none outline-none text-[12px] text-t1"
          autoFocus
          placeholder={t('ai:slash.argumentPlaceholder', { name: argPrompt.entry.name })}
          value={argPrompt.value}
          onChange={(e) => setArgPrompt({ ...argPrompt, value: e.target.value })}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); insertSlash(argPrompt.entry, argPrompt.value); }
            else if (e.key === 'Escape') { e.preventDefault(); setArgPrompt(null); }
          }}
        />
        <button
          className="text-[11px] px-2 py-0.5 rounded-md bg-acc text-white border-none cursor-pointer shrink-0"
          onMouseDown={(e) => { e.preventDefault(); insertSlash(argPrompt.entry, argPrompt.value); }}
        >
          {t('ai:slash.argumentConfirm')}
        </button>
      </div>
    ) : totalSlashRows > 0 ? (
      <div className="absolute bottom-full left-0 right-0 max-h-[220px] overflow-y-auto bg-panel border border-brd rounded-lg mb-1 shadow-[0_-8px_24px_rgba(0,0,0,.12)] z-[100] p-1">
        {filteredSlashEntries.skills.length > 0 && (
          <>
            <div className="text-[10px] uppercase tracking-wide text-t3 px-2 pt-1 pb-0.5">{t('ai:slash.skillsLabel')}</div>
            {filteredSlashEntries.skills.map((s, i) => (
              <div
                key={`skill-${s.source}-${s.name}`}
                className={`py-1.5 px-2 rounded-md text-[12px] cursor-pointer flex items-center gap-1.5 transition-colors ${i === slashIndex ? 'bg-hov' : ''} hover:bg-hov`}
                onMouseDown={(e) => { e.preventDefault(); insertSlash({ kind: 'skill', name: s.name }); }}
              >
                <Zap size={13} className="text-acc shrink-0" />
                <span className="font-medium truncate">{s.name}</span>
                <span className="text-t3 text-[11px] truncate min-w-0 flex-1">{s.description}</span>
                <span className="text-t3 text-[10px] shrink-0">{sourceTag(s.source)}</span>
              </div>
            ))}
          </>
        )}
        {filteredSlashEntries.commands.length > 0 && (
          <>
            <div className="text-[10px] uppercase tracking-wide text-t3 px-2 pt-1 pb-0.5">{t('ai:slash.commandsLabel')}</div>
            {filteredSlashEntries.commands.map((c, ci) => {
              const idx = filteredSlashEntries.skills.length + ci;
              return (
                <div
                  key={`cmd-${c.source}-${c.name}`}
                  className={`py-1.5 px-2 rounded-md text-[12px] cursor-pointer flex items-center gap-1.5 transition-colors ${idx === slashIndex ? 'bg-hov' : ''} hover:bg-hov`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (c.argumentHint) setArgPrompt({ entry: { kind: 'command', name: c.name }, value: '' });
                    else insertSlash({ kind: 'command', name: c.name });
                  }}
                >
                  <CommandIcon size={13} className="text-t3 shrink-0" />
                  <span className="font-medium truncate">{c.name}</span>
                  {c.argumentHint && <span className="text-t3 text-[10px] truncate">{c.argumentHint}</span>}
                  <span className="text-t3 text-[11px] truncate min-w-0 flex-1">{c.description}</span>
                  <span className="text-t3 text-[10px] shrink-0">{sourceTag(c.source)}</span>
                </div>
              );
            })}
          </>
        )}
      </div>
    ) : (
      <div className="absolute bottom-full left-0 right-0 bg-panel border border-brd rounded-lg mb-1 shadow-[0_-8px_24px_rgba(0,0,0,.12)] z-[100] p-2 text-[11px] text-t3">
        {t('ai:slash.empty')}
      </div>
    )
  ) : null;

  const overlayLayer = slashOverlay ?? mentionOverlay;

  // ── `/`-token highlight mirror (agent mode only) ──
  // A transparent-text mirror div rendered behind the textarea by
  // ChatInputBox, wrapping `/name` tokens in a highlighted span. Only
  // built when there's at least one token so the textarea stays normal
  // (opaque text) when there's nothing to highlight.
  const slashMirror: ReactNode = useMemo(() => {
    if (!slashEnabled) return undefined;
    const segs = splitSlashTokens(input);
    if (!segs.some((s) => s.isToken)) return undefined;
    return segs.map((s, i) =>
      s.isToken ? (
        <span
          key={i}
          className="slash-token rounded bg-accglow text-acc box-decoration-clone"
        >
          {s.text}
        </span>
      ) : (
        <span key={i}>{s.text}</span>
      ),
    );
  }, [slashEnabled, input]);


  const leadingSlot = (
    <>
      {inputModes.length > 1 && (
        <div className="relative" ref={modeMenuRef}>
          {/* ponytail: icon-only ghost trigger — the old bordered label box
              looked heavy next to the ghost icon buttons beside it. Mode
              identity stays discoverable via the tooltip + rich dropdown. */}
          <button
            className="w-7 h-7 flex items-center justify-center rounded-md text-t3 cursor-pointer transition-all duration-[120ms] hover:bg-hov hover:text-t1 disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => setModeMenuOpen((v) => !v)}
            disabled={isStreaming || sessionStarted}
            aria-label={currentModeDef?.label ?? inputMode}
            title={modeTitle}
          >
            {/* ponytail: 14px, not the neighbors' 16 — MessageSquare/Bot fill
                their viewBox more fully than the thin paperclip/mic glyphs,
                so equal sizes read visually larger. */}
            <ModeIcon size={14} />
          </button>
          {/* ponytail: two-line rows (label line + description line), but
              the description itself never wraps — panel sizes to the widest
              row via w-max so long Chinese descriptions stay on one line. */}
          {modeMenuOpen && (
            <div className="absolute bottom-full left-0 mb-1 w-max min-w-[200px] max-w-[360px] bg-panel border border-brd rounded-lg shadow-[0_8px_24px_rgba(0,0,0,.14)] z-[100] p-1">
              {inputModes.map((m) => {
                const active = m.id === inputMode;
                const RowIcon = m.icon ?? Sparkles;
                return (
                  <div
                    key={m.id}
                    data-mode={m.id}
                    className={`flex items-start gap-2 py-1.5 px-2 rounded-md cursor-pointer whitespace-nowrap transition-colors ${active ? 'bg-accdim text-acc' : 'text-t2 hover:bg-hov hover:text-t1'}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      // ponytail: write mode to the active session so it
                      // persists; also mirror to the global for the
                      // session-less fallback path (and tests).
                      if (sessionId) setSessionMode(sessionId, m.id);
                      else setInputMode(m.id);
                      setModeMenuOpen(false);
                    }}
                  >
                    <RowIcon size={14} className="mt-[1px] shrink-0" />
                    <span>
                      <span className={`block text-[12px] leading-tight ${active ? 'font-semibold' : ''}`}>{m.label}</span>
                      {m.description && <span className="block text-[11px] leading-tight mt-0.5 text-t3">{m.description}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {rigMode ? (
        <PairSelector
          trigger="icon"
          dropDirection="up"
          panelAlign="left"
          value={sessionPair}
          onChange={handlePairChange}
          onOpenSettings={handleOpenModelSettings}
        />
      ) : (
        sessionKind !== 'study' && <AdapterSelector disabled={isStreaming || sessionStarted} />
      )}
      <button className="w-7 h-7 flex items-center justify-center rounded-md text-t3 cursor-pointer transition-all duration-[120ms] hover:bg-hov hover:text-t1 disabled:opacity-40 disabled:cursor-not-allowed" onClick={handleFileSelect} disabled={isStreaming} title={t('ai:chat.attachFile')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
      </button>
      <VoiceInputButton />
    </>
  );

  const trailingSlot = (
    <>
      <button
        type="button"
        className="w-7 h-7 flex items-center justify-center rounded-md text-t3 cursor-pointer transition-all duration-[120ms] hover:bg-hov hover:text-t1 disabled:opacity-40 disabled:cursor-not-allowed"
        onClick={handleClearContext}
        disabled={isStreaming}
        title={t('ai:chat.clearContextTitle')}
        aria-label={t('ai:chat.clearContext')}
      >
        <Eraser size={14} />
      </button>
      <button
        type="button"
        className="w-7 h-7 flex items-center justify-center rounded-md text-t3 cursor-pointer transition-all duration-[120ms] hover:bg-hov hover:text-t1 disabled:opacity-40 disabled:cursor-not-allowed"
        onClick={handleClearMessages}
        disabled={isStreaming}
        title={t('ai:chat.clearMessagesTitle')}
        aria-label={t('ai:chat.clearMessages')}
      >
        <Trash2 size={14} />
      </button>
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
        trailingSlot={trailingSlot}
        attachmentsRow={attachmentsRow}
        overlayLayer={overlayLayer}
        mirrorLayer={slashMirror}
      />
      {rejectError && (
        <div className="chat-inline-error" role="alert">
          <svg className="shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span className="min-w-0">{rejectError}</span>
        </div>
      )}
      {notice && (
        <div className="chat-toast" role="status">
          <span className="dot" />
          <span>{notice}</span>
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
