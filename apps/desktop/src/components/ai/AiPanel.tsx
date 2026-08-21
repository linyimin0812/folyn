import { useState, useRef, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { useEditorViewStateStore } from '@/store/editorViewState';
import * as editorIoService from '@/services/editorIoService';
import { useAiStore } from '@/store/aiStore';
import { useAiConfigStore, resolvePairForSession } from '@/store/aiConfigStore';
import { useNavStore } from '@/store/navStore';
import { isTauri } from '@/utils/platform';
import { useVaultStore } from '@/store/vaultStore';
import type { CliMessage, CliStreamEvent, MessageAttachment } from '@quill/cli-adapter';
import { pauseWatcher, resumeWatcher } from '@/utils/fileWatcher';
import { flattenFileTree } from '@/utils/treeUtils';
import { isExternalPath } from '@/utils/isExternalPath';
import { resolveAbsolutePath } from '@/services/externalFileProvider';
import { normalizeVaultPath } from './vaultPath';
import { sessionAdapters, getAdapterForSession } from './adapterManager';
import { ChatMessageList } from '@/components/chat';
import { clearPathExistsCache } from '@/components/chat/filePath';
import { ChatInput } from './ChatInput';
import type { PendingAttachment } from './ChatInput';
import { SaveMessageDialog } from './SaveMessageDialog';
import { useEnabledPairs } from './PairSelector';
import { resolveSendOptions, isRigMode } from './inputModes';
import { saveBlobs, buildReadInstructions, buildRigPrompt, blobToRigImage } from '@/components/chat';
import type { SavedAttachment } from '@/components/chat';
import { runRigChat, type RigChatImage } from '@/services/rigChat';
import { Trash2 } from 'lucide-react';

function defaultSaveName(msg: CliMessage): string {
  const ts = msg.timestamp ? new Date(msg.timestamp) : new Date();
  const stamp = ts.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `ai-msg-${stamp}.md`;
}
import { PairTag } from '@/components/chat/PairTag';
import { AgentCliTag } from './AgentCliTag';
import { useTranslation } from 'react-i18next';

interface AiPanelProps {
  /** Render in a secondary window (e.g. pet-panel) instead of the main
   *  editor shell. Skips the `aiPanelVisible` gate, hides the × close
   *  button (the host window owns its own dismiss), hides the left
   *  resize handle (the host window owns its own size), and drops
   *  `border-l` + fixed `panelWidth` so the panel fills its container. */
  embedded?: boolean;
  /** When embedded, still render the × close button (used by the right dock,
   *  which doesn't own a tab-bar close affordance). */
  showClose?: boolean;
}

/** Extract a human-readable message from a Tauri invoke rejection.
 *  Backend errors serialize as `AppError { category, detail }` — `String()`
 *  on that object yields "[object Object]"; prefer `detail`, then
 *  `message`, then the raw string. */
export function errorMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const detail = (err as { detail?: unknown }).detail;
    if (typeof detail === 'string' && detail) return detail;
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return String(err);
}

export function AiPanel({ embedded = false, showClose = false }: AiPanelProps = {}) {
  const { t } = useTranslation();
  const aiPanelVisible = useEditorViewStateStore((s) => s.aiPanelVisible);
  const toggleAiPanel = useEditorViewStateStore((s) => s.toggleAiPanel);

  const sessions = useAiStore((s) => s.sessions);
  const activeSessionId = useAiStore((s) => s.activeSessionId);
  const createSession = useAiStore((s) => s.createSession);
  const switchSession = useAiStore((s) => s.switchSession);
  const deleteSession = useAiStore((s) => s.deleteSession);
  const addMessage = useAiStore((s) => s.addMessage);
  const appendToLastMessage = useAiStore((s) => s.appendToLastMessage);
  const appendImageToLastMessage = useAiStore((s) => s.appendImageToLastMessage);
  const appendThinking = useAiStore((s) => s.appendThinking);
  const addToolCall = useAiStore((s) => s.addToolCall);
  const completeToolCall = useAiStore((s) => s.completeToolCall);
  const addFileChange = useAiStore((s) => s.addFileChange);
  const setSessionStreaming = useAiStore((s) => s.setSessionStreaming);
  const setCliSessionId = useAiStore((s) => s.setCliSessionId);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const isStreaming = activeSession?.isStreaming ?? false;
  const messages = activeSession?.messages ?? [];
  // ponytail: only Chat (rig) mode needs a configured (provider, model) pair
  // to send — Ask/Agent modes go through the CLI adapter and don't require
  // a pair. So the input is disabled + the setup banner is shown only when
  // the active mode is rig AND no pair is configured.
  const inputMode = useAiStore((s) => s.inputMode);
  const currentMode = activeSession?.mode ?? inputMode;
  const needsPair = isRigMode(currentMode);

  // ponytail: the (provider, model) picker moved from the panel header into
  // ChatInput's mode-linked slot (visible in Chat mode only). `hasPair`
  // gates the Chat (rig) send path only — Ask/Agent go through the CLI
  // adapter and don't need a pair. The send path itself resolves the pair
  // via `resolvePairForSession` (display-only fallback to pairs[0] in
  // ChatInput).
  const { hasAny: hasPair } = useEnabledPairs();

  const setSettingsTab = useNavStore((s) => s.setSettingsTab);
  const setCurrentPage = useNavStore((s) => s.setCurrentPage);
  // ponytail: when no pair is configured, show a setup prompt + button
  // instead of silently disabling the input. Embedded (pet panel) is a
  // separate JS realm — route through pet://menu-action: open-ai-settings
  // so the main window focuses itself + lands on Settings → models tab.
  const openSettings = useCallback(() => {
    if (embedded) {
      if (isTauri()) {
        void import('@tauri-apps/api/event')
          .then(({ emit }) =>
            emit('pet://menu-action', { action: 'open-ai-settings' }),
          )
          .catch(() => {});
      }
      return;
    }
    setSettingsTab('models');
    setCurrentPage('settings');
  }, [embedded, setSettingsTab, setCurrentPage]);

  const [showSessionList, setShowSessionList] = useState(false);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [pendingSave, setPendingSave] = useState<{ content: string; defaultName: string } | null>(null);
  const sessionListRef = useRef<HTMLDivElement>(null);

  const fileTree = useVaultStore((s) => s.fileTree);
  const allFiles = useMemo(() => flattenFileTree(fileTree), [fileTree]);
  const activeVaultId = useVaultStore((s) => s.activeVaultId);
  const currentVault = useVaultStore((s) => s.currentVault);

  // ponytail: path-exists cache is keyed by raw path string, but existence
  // depends on the active vault. Clear on vault switch so stale hits don't
  // mis-render clickable paths from the prior vault's fileTree.
  useEffect(() => {
    clearPathExistsCache();
  }, [activeVaultId]);

  // Normalize an absolute / `~/` path that actually lives inside the active
  // vault's basePath to its vault-relative form. Without this, an AI-quoted
  // `/Users/.../apps/desktop/src/foo.ts` would be routed as external and
  // open a duplicate `ext:` tab next to the existing vault tab.
  const normalizePath = useCallback(
    (raw: string): string => normalizeVaultPath(raw, currentVault),
    [currentVault],
  );

  // Inline-code file paths in assistant messages: resolve existence via the
  // same routing editorIoService uses (external / wiki / vault-relative).
  // `allFiles` covers the vault-relative case without an fs read.
  const resolvePath = useCallback(async (raw: string): Promise<boolean> => {
    const normalized = normalizePath(raw);
    if (normalized !== raw) {
      // Absolute path inside the vault — check the fileTree.
      return allFiles.some((f) => f.path === normalized);
    }
    if (isExternalPath(raw)) {
      try {
        const { exists } = await import('@tauri-apps/plugin-fs');
        const abs = await resolveAbsolutePath(raw);
        return await exists(abs);
      } catch {
        return false;
      }
    }
    return allFiles.some((f) => f.path === raw);
  }, [allFiles, normalizePath]);

  const handlePathClick = useCallback(
    (path: string, line?: number, col?: number) => {
      const normalized = normalizePath(path);
      const name = normalized.includes('/')
        ? normalized.slice(normalized.lastIndexOf('/') + 1)
        : normalized;
      void editorIoService.openFile(normalized, name).then(() => {
        if (line) {
          useEditorViewStateStore.getState().setCursorPosition(line, col ?? 1);
        }
      });
    },
    [normalizePath],
  );

  const handleSaveMessage = useCallback((msg: CliMessage) => {
    if (!msg.content) return;
    setPendingSave({ content: msg.content, defaultName: defaultSaveName(msg) });
  }, []);

  const handleEnterMultiSelect = useCallback(() => {
    setMultiSelectMode(true);
  }, []);

  const handleExitMultiSelect = useCallback(() => {
    setMultiSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const buildBatchContent = useCallback((): { content: string; defaultName: string } | null => {
    if (selectedIds.size === 0) return null;
    const picked = messages.filter((m) => selectedIds.has(m.id) && m.content);
    if (picked.length === 0) return null;
    const labeled = picked.map((m) => {
      const role = m.role === 'user' ? 'User' : 'Assistant';
      return `## ${role}\n\n${m.content}`;
    });
    const content = labeled.join('\n\n---\n\n');
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    return { content, defaultName: `ai-msgs-batch-${ts}.md` };
  }, [messages, selectedIds]);

  const handleBatchSave = useCallback(() => {
    const ctx = buildBatchContent();
    if (ctx) {
      setPendingSave(ctx);
      setMultiSelectMode(false);
      setSelectedIds(new Set());
    }
  }, [buildBatchContent]);

  const handleBatchCopy = useCallback(async () => {
    const ctx = buildBatchContent();
    if (!ctx) return;
    try {
      const { writeText } = await import('@tauri-apps/plugin-clipboard-manager');
      await writeText(ctx.content);
      setMultiSelectMode(false);
      setSelectedIds(new Set());
    } catch (err) {
      console.warn('[ai] batch copy failed:', err);
    }
  }, [buildBatchContent]);

  const handleSaveMessageConfirm = useCallback(async (path: string) => {
    const ctx = pendingSave;
    if (!ctx) return;
    const store = useVaultStore.getState();
    if (!store.currentVault) {
      console.warn('[ai] save message: no active vault');
      setPendingSave(null);
      return;
    }
    try {
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      if (dir) {
        try {
          await store.createDir(dir);
        } catch {
          // dir may already exist
        }
      }
      await store.writeFile(path, ctx.content);
      await store.refreshFileTree();
    } catch (err) {
      console.warn('[ai] save message to vault failed:', err);
    } finally {
      setPendingSave(null);
    }
  }, [pendingSave]);

  const handleSaveMessageExternal = useCallback(async (absolutePath: string) => {
    const ctx = pendingSave;
    if (!ctx) return;
    try {
      const { writeTextFile } = await import('@tauri-apps/plugin-fs');
      await writeTextFile(absolutePath, ctx.content);
    } catch (err) {
      console.warn('[ai] save message to external path failed:', err);
    } finally {
      setPendingSave(null);
    }
  }, [pendingSave]);

  // ponytail: renderPairTag closes over customerProviders (stable ref from
  // zustand) so the resolver doesn't need to be a useCallback; it's only
  // called inside DefaultMessageRow.
  // For Chat (rig) mode → provider/model PairTag.
  // For Ask/Agent (CLI adapter) mode → AgentCliTag with the mode label —
  // those messages come from the CLI adapter, not the rig LLM pair, so
  // showing provider/model would be misleading.
  const customerProviders = useAiConfigStore((s) => s.customerProviders);
  const renderPairTag = (msg: CliMessage): ReactNode | null => {
    // ponytail: read the mode off the message (persisted at send time) so the
    // Agent/Ask/Chat tag survives app restart. Fall back to 'chat' for legacy
    // messages persisted before the mode field existed.
    const modeId = msg.mode ?? 'chat';
    if (!isRigMode(modeId)) {
      return <AgentCliTag modeId={modeId} />;
    }
    if (!msg.provider || !msg.model) return null;
    return <PairTag provider={msg.provider} model={msg.model} customerProviders={customerProviders} />;
  };

  // Drag resize
  const [panelWidth, setPanelWidth] = useState(380);
  const isDragging = useRef(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const newWidth = window.innerWidth - e.clientX;
      setPanelWidth(Math.max(280, Math.min(700, newWidth)));
    };
    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = '';
        document.documentElement.classList.remove('is-resizing');
      }
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const handleResizeStart = useCallback(() => {
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.documentElement.classList.add('is-resizing');
  }, []);

  // Close session list on click outside
  useEffect(() => {
    if (!showSessionList) return;
    const handleClick = (e: MouseEvent) => {
      if (sessionListRef.current && !sessionListRef.current.contains(e.target as Node)) {
        setShowSessionList(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showSessionList]);

  if (!embedded && !aiPanelVisible) return null;

  const handleSend = async (userText: string, currentAttachments: PendingAttachment[]) => {
    if ((!userText && currentAttachments.length === 0) || isStreaming) return;

    let sessionId = activeSessionId;
    if (!sessionId) {
      sessionId = createSession();
    }

    // Show user message immediately with preview attachments
    const previewAttachments: MessageAttachment[] = currentAttachments.map((att) => ({
      name: att.name,
      path: att.path || '',
      type: att.type,
      previewUrl: att.previewUrl,
    }));
    // ponytail: hoist the pair lookup so the assistant bubble is tagged at
    // creation time with the same pair the send path will use. Reads fresh
    // store state (not the render-time activeSession closure) so a pair
    // switch between the click and handleSend running is reflected.
    const aiConfig = useAiConfigStore.getState();
    const targetSession = useAiStore.getState().sessions.find((s) => s.id === sessionId);
    // ponytail: only Chat (rig) mode needs a (provider, model) pair —
    // Ask/Agent go through the CLI adapter and don't need one. The prior
    // unconditional check aborted Ask/Agent sends on first launch before
    // the assistant bubble existed, so the error had nowhere to land and
    // the user saw "no response".
    const sendMode = useAiStore.getState().sessions.find((s) => s.id === sessionId)?.mode ?? useAiStore.getState().inputMode;
    const isRig = isRigMode(sendMode);
    const resolved = isRig ? resolvePairForSession(sessionId) : null;
    if (isRig && !resolved) {
      appendToLastMessage(t('ai:errors.streamError', { error: 'No provider configured' }), sessionId);
      setSessionStreaming(sessionId, false);
      return;
    }
    const sendProvider = resolved?.provider;
    const sendModel = resolved?.model;
    addMessage('user', userText || t('ai:panel.attachmentPlaceholder'), sessionId, previewAttachments.length > 0 ? previewAttachments : undefined, undefined, undefined, sendMode);
    addMessage('assistant', '', sessionId, undefined, sendProvider, sendModel, sendMode);
    setSessionStreaming(sessionId, true);

    const vault = useVaultStore.getState().currentVault;

    let workingDir = vault?.basePath ?? '';
    if (workingDir.startsWith('~')) {
      try {
        const { homeDir, join } = await import('@tauri-apps/api/path');
        const home = (await homeDir()).replace(/[/\\]+$/, '');
        // ponytail: join() is separator-aware — string concat produced mixed
        // separators on Windows failing the fs scope glob.
        workingDir = await join(home, workingDir.slice(1));
      } catch {}
    }

    // Save blob attachments to temp directory.
    //
    // Saves blob attachments via the shared `saveBlobs` helper's fs-plugin
    // path (`mkdir` + `writeFile` → `<vault>/.quill-tmp`). The main window's
    // fs ACL scope includes `$HOME/**/.*/**`, which covers the dot-dir
    // `.quill-tmp` under any home-based vault, so no shell sidecar is
    // needed. The old base64-via-`claude-cli` sidecar embedded the whole
    // payload in the command line and failed with "Argument list too long
    // (os error 7)" on sizeable images.
    //
    // path-only attachments (vault @mention / pendingFileAttachments) pass
    // through unchanged; blob attachments (paste / file-picker) are written
    // to disk. previewUrls are revoked per-attachment after the write.
    let saved: SavedAttachment[] = [];
    let attachSaveError = '';
    if (currentAttachments.length > 0) {
      try {
        saved = await saveBlobs(currentAttachments, workingDir, {
          subdir: '.quill-tmp',
        });
      } catch (err) {
        attachSaveError = errorMessage(err);
        console.error('[AiPanel] Failed to save attachments:', err);
      }
    }

    // Persist the real on-disk paths onto the user bubble. The bubble was
    // added with blob-preview URLs, which only live for the current page;
    // the saved paths let the attachment re-render from disk after the
    // session is reopened (see ChatMessageList: path is preferred over
    // previewUrl). saveBlobs returns one entry per accepted attachment in
    // order (path-only pass through; blobs are written), so the index
    // mapping back to the original preview URL is 1:1.
    if (saved.length > 0) {
      useAiStore.getState().setUserMessageAttachments(
        sessionId,
        saved.map((s, i) => ({
          name: s.name,
          path: s.path,
          type: s.type,
          previewUrl: currentAttachments[i]?.previewUrl,
        })),
      );
    }

    // Phase A — build the Read-tool instruction prefix from saved
    // attachments (images first, then files; wraps `用户消息: <prompt>`).
    // Delegated to the shared `buildReadInstructions` helper (vault-free).
    // Chat (rig) mode is an exception: it has no Read tool, so attached
    // images travel as multimodal content blocks (converted in the rig send
    // branch below) and are excluded from the prompt via buildRigPrompt.
    // Phase B (@mention resolution) runs AFTER this on the already-wrapped
    // prompt and is vault-coupled (needs `allFiles`), so it stays inline.
    const isRigSend = isRigMode(sendMode);
    let prompt = isRigSend
      ? buildRigPrompt(userText, saved, t('ai:panel.attachmentPlaceholder'))
      : buildReadInstructions(saved, userText);

    // Extract @file references from prompt
    const mentionedFiles: string[] = [];
    const mentionRegex = /@([\w\-./一-鿿]+)/g;
    let match: RegExpExecArray | null;
    while ((match = mentionRegex.exec(prompt)) !== null) {
      const mentioned = match[1];
      if (allFiles.some((f) => f.path === mentioned)) {
        mentionedFiles.push(mentioned);
      }
    }
    if (mentionedFiles.length > 0) {
      const fileInstruction = `请先使用 Read 工具读取以下文件:\n${mentionedFiles.join('\n')}`;
      prompt = `${fileInstruction}\n\n用户消息: ${prompt}`;
    }

    if (attachSaveError) {
      appendToLastMessage(t('ai:errors.attachmentSaveFailed', { error: attachSaveError }), sessionId);
      setSessionStreaming(sessionId, false);
      return;
    }

    const adapter = getAdapterForSession(sessionId);

    const resumeSessionId = targetSession?.cliSessionId ?? undefined;
    // ponytail: sendProvider/sendModel are hoisted to before the user/assistant
    // addMessage calls so the assistant bubble tag and the actual send use the
    // same pair. The fresh lookup captures any pair switch between the click
    // and handleSend running.

    const sid = sessionId;
    // Backend stream errors are surfaced BOTH as a `ChatChunk::Error` event
    // (appended in the handler below) and as a rejected invoke (caught at
    // the bottom). Track whether the event already showed the message so the
    // catch doesn't append a duplicate.
    let errorAlreadyShown = false;
    const eventHandler = (event: CliStreamEvent) => {
      switch (event.type) {
        case 'text':
          if (event.content) appendToLastMessage(event.content, sid);
          break;
        case 'thinking':
          if (event.content) appendThinking(event.content, sid);
          break;
        case 'image':
          if (event.imageData) appendImageToLastMessage(event.imageData, sid);
          break;
        case 'tool_start':
          if (event.toolId && event.toolName) addToolCall(event.toolId, event.toolName, event.toolInput, sid);
          break;
        case 'tool_end':
          if (event.toolId) completeToolCall(event.toolId, event.toolOutput, sid);
          break;
        case 'file_change':
          if (event.fileChange) addFileChange(event.fileChange, sid);
          break;
        case 'session_id':
          if (event.sessionId) setCliSessionId(event.sessionId, sid);
          break;
        case 'error':
          if (event.content) {
            errorAlreadyShown = true;
            appendToLastMessage(t('ai:errors.streamError', { error: event.content }), sid);
          }
          break;
        case 'done':
          setSessionStreaming(sid, false);
          adapter.offEvent(eventHandler);
          useVaultStore.getState().refreshFileTree();
          editorIoService.checkDiskChanges().finally(() => {
            resumeWatcher();
          });
          break;
      }
    };

    adapter.onEvent(eventHandler);
    await editorIoService.flushAutoSaves();
    pauseWatcher();

    try {
      // ponytail: prefer session's persisted mode; fall back to global for
      // legacy sessions without a mode field.
      const inputMode = useAiStore.getState().sessions.find((s) => s.id === sid)?.mode ?? useAiStore.getState().inputMode;
      if (isRigMode(inputMode)) {
        // chat: rig direct LLM, no CLI adapter. runRigChat calls eventHandler
        // directly with the same CliStreamEvent shape; the dormant
        // adapter.onEvent subscription above is harmless and cleaned up in
        // finally. workingDir / cliPath are unused (rig has no cwd).
        // Attached images are converted to multimodal content blocks — rig
        // has no Read tool, so the file-path instruction from Phase A would
        // be useless (see buildRigPrompt).
        const images: RigChatImage[] = [];
        for (const att of currentAttachments) {
          if (att.type === 'image' && att.blob) {
            try {
              images.push(await blobToRigImage(att.blob));
            } catch (err) {
              console.warn('[AiPanel] failed to convert image attachment:', err);
            }
          }
        }
        await runRigChat({
          sessionId: sid,
          prompt,
          // ponytail: null-guarded at line 380 (isRig && !resolved → return);
          // non-null assertion is safe inside the rig branch.
          provider: resolved!.provider,
          model: resolved!.model,
          apiKey: resolved!.apiKey,
          baseUrl: resolved!.baseUrl,
          // T07: forward reasoning budget. rig applies it via per-provider
          // additional_params; non-reasoning models silently ignore.
          thinkingBudget: resolved!.thinkingBudget,
          adapterFamily: resolved!.adapterFamily,
          onEvent: eventHandler,
          ...(images.length > 0 ? { images } : {}),
        });
      } else {
        await adapter.start({ cliPath: aiConfig.cliPath, workingDir });
        // 合并当前输入模式（ask/agent/…）的 permissionMode/systemPrompt 等到 send options。
        const sendOptions = resolveSendOptions(inputMode, { resumeSessionId });
        await adapter.send(prompt, sendOptions);
      }
    } catch (err) {
      if (!errorAlreadyShown) {
        appendToLastMessage(t('ai:errors.streamError', { error: errorMessage(err) }), sid);
      }
      setSessionStreaming(sid, false);
      resumeWatcher();
    } finally {
      adapter.offEvent(eventHandler);
    }
  };

  const handleStop = async () => {
    if (!activeSessionId) return;
    const adapter = sessionAdapters.get(activeSessionId);
    if (adapter) {
      await adapter.stop();
    }
    resumeWatcher();
    setSessionStreaming(activeSessionId, false);
  };

  const handleNewSession = () => {
    createSession();
    setShowSessionList(false);
  };

  const handleDeleteSession = async () => {
    if (!activeSessionId) return;
    const { confirm } = await import('@tauri-apps/plugin-dialog');
    const yes = await confirm(t('ai:panel.deleteConfirm'), { title: t('ai:panel.deleteConfirmTitle'), kind: 'warning' });
    if (yes) {
      sessionAdapters.delete(activeSessionId);
      deleteSession(activeSessionId);
      if (sessions.length <= 1) {
        createSession();
      }
    }
  };

  const handleSwitchSession = (id: string) => {
    switchSession(id);
    setShowSessionList(false);
  };

  return (
    <div
      className={`h-full bg-panel flex flex-col overflow-hidden relative${embedded ? ' w-full' : ' shrink-0 border-l border-brd'}`}
      style={embedded ? undefined : { width: `${panelWidth}px` }}
    >
      {!embedded && (
        <div className="absolute left-0 top-0 bottom-0 w-0.5 cursor-col-resize z-10 bg-transparent transition-[background] duration-[140ms] hover:bg-acc hover:opacity-30" onMouseDown={handleResizeStart} />
      )}
      {/* h-[34px] matches the editor TabBar so both top bars align visually. */}
      <div className="flex items-center justify-between h-[34px] pl-3 pr-2 border-b border-brd shrink-0">
        <div className="relative min-w-0 flex-1" ref={sessionListRef}>
          <button
            className="flex items-center gap-1.5 cursor-pointer bg-transparent border-none py-1 px-1.5 rounded-md max-w-full min-w-0 transition-colors hover:bg-hov"
            onClick={() => setShowSessionList(!showSessionList)}
          >
            <span className="text-[13px] font-semibold text-t1 truncate"><span className="text-acc">✦</span> {activeSession?.title || t('ai:panel.title')}</span>
            <svg className={`shrink-0 text-t3 transition-transform duration-150 ${showSessionList ? 'rotate-180' : ''}`} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {showSessionList && sessions.length > 0 && (
            <div className="absolute top-full left-0 mt-1 min-w-[200px] max-w-[280px] max-h-[300px] overflow-y-auto bg-panel border border-brd rounded-lg shadow-[0_8px_24px_rgba(0,0,0,.14)] z-[100] p-1">
              {sessions.map((s) => (
                <button
                  key={s.id}
                  className={`flex items-center justify-between gap-2 w-full py-1.5 px-2 rounded-md cursor-pointer bg-transparent border-none text-left text-[12px] transition-colors hover:bg-hov ${s.id === activeSessionId ? 'bg-accdim text-acc' : 'text-t2'}`}
                  onClick={() => handleSwitchSession(s.id)}
                >
                  <span className="truncate min-w-0 flex-1 flex items-center gap-1.5">
                    {s.isStreaming && <span className="ai-session-streaming" />}
                    {s.title}
                  </span>
                  <span className="shrink-0 text-[10px] text-t3">{s.messages.filter((m) => m.role === 'user').length} {t('ai:panel.messageCountSuffix')}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-0.5 shrink-0">
          <button className="w-[26px] h-[26px] flex items-center justify-center rounded-md text-t3 cursor-pointer transition-all duration-[120ms] hover:bg-hov hover:text-t1" onClick={handleNewSession} title={t('ai:panel.newSession')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button className="w-[26px] h-[26px] flex items-center justify-center rounded-md text-t3 cursor-pointer transition-all duration-[120ms] hover:bg-hov hover:text-red" onClick={handleDeleteSession} title={t('ai:panel.deleteSession')}>
            <Trash2 className="w-[14px] h-[14px]" />
          </button>
          {(!embedded || showClose) && (
            <button className="w-[26px] h-[26px] flex items-center justify-center rounded-md text-t3 cursor-pointer transition-all duration-[120ms] hover:bg-hov hover:text-t1" onClick={toggleAiPanel} title={t('ai:panel.close')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <ChatMessageList
        messages={messages}
        streaming={isStreaming}
        streamingIndicator="dots"
        renderPairTag={renderPairTag}
        showSaveImageButton
        showCopy
        onSaveToFile={handleSaveMessage}
        multiSelectMode={multiSelectMode}
        onEnterMultiSelect={handleEnterMultiSelect}
        onExitMultiSelect={handleExitMultiSelect}
        selectedIds={selectedIds}
        onToggleSelect={handleToggleSelect}
        onBatchCopy={handleBatchCopy}
        onBatchSave={handleBatchSave}
        onPathClick={handlePathClick}
        resolvePath={resolvePath}
        className="p-3 gap-3"
      />

      {needsPair && !hasPair && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-t border-brd2 bg-surf2/40 text-[12px] text-t3">
          <span className="flex-1 min-w-0 truncate">{t('ai:pairSelector.empty')}</span>
          <button
            type="button"
            className="text-acc text-[12px] hover:underline whitespace-nowrap cursor-pointer bg-transparent border-none"
            onClick={openSettings}
          >
            {t('ai:pairSelector.openSettings')}
          </button>
        </div>
      )}

      <ChatInput
        onSend={handleSend}
        onStop={handleStop}
        isStreaming={isStreaming}
        disabled={needsPair && !hasPair}
      />

      {pendingSave && (
        <SaveMessageDialog
          fileTree={fileTree}
          defaultFilename={pendingSave.defaultName}
          onCancel={() => setPendingSave(null)}
          onConfirmVault={handleSaveMessageConfirm}
          onConfirmExternal={handleSaveMessageExternal}
        />
      )}
    </div>
  );
}
