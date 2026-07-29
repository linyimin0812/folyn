import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useEditorViewStateStore } from '@/store/editorViewState';
import * as editorIoService from '@/services/editorIoService';
import { useAiStore } from '@/store/aiStore';
import { useAiConfigStore } from '@/store/aiConfigStore';
import { useVaultStore } from '@/store/vaultStore';
import type { CliStreamEvent, MessageAttachment } from '@quill/cli-adapter';
import { pauseWatcher, resumeWatcher } from '@/utils/fileWatcher';
import { flattenFileTree } from '@/utils/treeUtils';
import { sessionAdapters, getAdapterForSession } from './adapterManager';
import { ChatMessageList } from '@/components/chat';
import { ChatInput } from './ChatInput';
import type { PendingAttachment } from './ChatInput';
import { resolveSendOptions, isRigMode } from './inputModes';
import { saveBlobs, buildReadInstructions } from '@/components/chat';
import type { SavedAttachment } from '@/components/chat';
import { runRigChat } from '@/services/rigChat';
import { useTranslation } from 'react-i18next';

export function AiPanel() {
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
  const appendThinking = useAiStore((s) => s.appendThinking);
  const addToolCall = useAiStore((s) => s.addToolCall);
  const completeToolCall = useAiStore((s) => s.completeToolCall);
  const addFileChange = useAiStore((s) => s.addFileChange);
  const setSessionStreaming = useAiStore((s) => s.setSessionStreaming);
  const setCliSessionId = useAiStore((s) => s.setCliSessionId);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const isStreaming = activeSession?.isStreaming ?? false;
  const isStudySession = activeSession?.kind === 'study';
  const messages = activeSession?.messages ?? [];

  const [showSessionList, setShowSessionList] = useState(false);
  const sessionListRef = useRef<HTMLDivElement>(null);

  const fileTree = useVaultStore((s) => s.fileTree);
  const allFiles = useMemo(() => flattenFileTree(fileTree), [fileTree]);

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

  if (!aiPanelVisible) return null;

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
    addMessage('user', userText || t('ai:panel.attachmentPlaceholder'), sessionId, previewAttachments.length > 0 ? previewAttachments : undefined);
    addMessage('assistant', '', sessionId);
    setSessionStreaming(sessionId, true);

    const aiConfig = useAiConfigStore.getState();
    const vault = useVaultStore.getState().currentVault;

    let workingDir = vault?.basePath ?? '';
    if (workingDir.startsWith('~')) {
      try {
        const { homeDir } = await import('@tauri-apps/api/path');
        const home = (await homeDir()).replace(/\/+$/, '');
        workingDir = home + workingDir.slice(1);
      } catch {}
    }

    // Save blob attachments to temp directory.
    //
    // Uses the shared `saveBlobs` helper with `strategy: 'shell'` to preserve
    // AiPanel's EXACT legacy mechanism (base64-via-`claude-cli` sidecar →
    // `<vault>/.quill-tmp`), so behavior is byte-identical to the pre-PR3
    // inline implementation. The main window's fs ACL scope for arbitrary
    // vault paths was not verified to cover `.quill-tmp`, so we keep the
    // shell path (which bypasses the fs ACL via `/bin/sh`) rather than
    // switching to the helper's cleaner default `'fs'` strategy.
    //
    // path-only attachments (vault @mention / pendingFileAttachments) pass
    // through unchanged; blob attachments (paste / file-picker) are written
    // to disk. previewUrls are revoked per-attachment after the write.
    let saved: SavedAttachment[] = [];
    let attachSaveError = '';
    if (currentAttachments.length > 0) {
      try {
        saved = await saveBlobs(currentAttachments, workingDir, {
          strategy: 'shell',
          subdir: '.quill-tmp',
        });
      } catch (err) {
        attachSaveError = String(err);
        console.error('[AiPanel] Failed to save attachments:', err);
      }
    }

    // Phase A — build the Read-tool instruction prefix from saved
    // attachments (images first, then files; wraps `用户消息: <prompt>`).
    // Delegated to the shared `buildReadInstructions` helper (vault-free).
    // Phase B (@mention resolution) runs AFTER this on the already-wrapped
    // prompt and is vault-coupled (needs `allFiles`), so it stays inline.
    let prompt = buildReadInstructions(saved, userText);

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

    const targetSession = useAiStore.getState().sessions.find((s) => s.id === sessionId);
    const resumeSessionId = targetSession?.cliSessionId ?? undefined;

    const sid = sessionId;
    const eventHandler = (event: CliStreamEvent) => {
      switch (event.type) {
        case 'text':
          if (event.content) appendToLastMessage(event.content, sid);
          break;
        case 'thinking':
          if (event.content) appendThinking(event.content, sid);
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
          if (event.content) appendToLastMessage(t('ai:errors.streamError', { error: event.content }), sid);
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
      const inputMode = useAiStore.getState().inputMode;
      if (isRigMode(inputMode)) {
        // chat: rig direct LLM, no CLI adapter. runRigChat calls eventHandler
        // directly with the same CliStreamEvent shape; the dormant
        // adapter.onEvent subscription above is harmless and cleaned up in
        // finally. workingDir / cliPath are unused (rig has no cwd).
        await runRigChat({
          sessionId: sid,
          prompt,
          provider: aiConfig.chatProvider,
          model: aiConfig.chatModel,
          apiKey: aiConfig.chatApiKey,
          baseUrl: aiConfig.chatBaseUrl,
          // T07: forward reasoning budget. rig applies it via per-provider
          // additional_params; non-reasoning models silently ignore.
          thinkingBudget: aiConfig.chatThinkingBudget,
          // PR2e: route custom providers via the endpoint resolver in Rust.
          customProvider: !!aiConfig.customerProviders[aiConfig.chatProvider],
          defaultChatEndpoint: aiConfig.customerProviders[aiConfig.chatProvider]?.defaultChatEndpoint,
          onEvent: eventHandler,
        });
      } else {
        await adapter.start({ cliPath: aiConfig.cliPath, workingDir });
        // 合并当前输入模式（ask/agent/…）的 permissionMode/systemPrompt 等到 send options。
        const sendOptions = resolveSendOptions(inputMode, { resumeSessionId });
        await adapter.send(prompt, sendOptions);
      }
    } catch (err) {
      appendToLastMessage(t('ai:errors.streamError', { error: String(err) }), sid);
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
    <div className="shrink-0 h-full bg-panel border-l border-brd flex flex-col overflow-hidden relative" style={{ width: `${panelWidth}px` }}>
      <div className="absolute left-0 top-0 bottom-0 w-0.5 cursor-col-resize z-10 bg-transparent transition-[background] duration-[140ms] hover:bg-acc hover:opacity-30" onMouseDown={handleResizeStart} />
      <div className="flex items-center justify-between h-[34px] px-3 border-b border-brd shrink-0">
        <div className="relative min-w-0 flex-1" ref={sessionListRef}>
          <button
            className="flex items-center gap-1 cursor-pointer bg-transparent border-none py-0.5 px-1.5 rounded max-w-full min-w-0 hover:bg-hov"
            onClick={() => setShowSessionList(!showSessionList)}
          >
            <span className="text-[13px] font-bold text-acc truncate">✦ {activeSession?.title || t('ai:panel.title')}</span>
            <svg className="shrink-0 text-t3" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {showSessionList && (
            <div className="absolute top-full left-0 mt-1 min-w-[200px] max-w-[280px] max-h-[300px] overflow-y-auto bg-panel border border-brd rounded-md shadow-[0_4px_16px_rgba(0,0,0,.12)] z-[100] p-1">
              {sessions.map((s) => (
                <button
                  key={s.id}
                  className={`flex items-center justify-between gap-2 w-full py-1.5 px-2 rounded cursor-pointer bg-transparent border-none text-left text-[12px] hover:bg-hov ${s.id === activeSessionId ? 'bg-accdim text-acc' : 'text-t2'}`}
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
        <div className="flex gap-1 shrink-0">
          <button className="w-6 h-6 flex items-center justify-center rounded text-[12px] text-t3 cursor-pointer transition-all duration-[120ms] hover:bg-hov hover:text-t1" onClick={handleNewSession} title={t('ai:panel.newSession')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button className="w-6 h-6 flex items-center justify-center rounded text-[12px] text-t3 cursor-pointer transition-all duration-[120ms] hover:bg-hov hover:text-t1" onClick={handleDeleteSession} title={t('ai:panel.deleteSession')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
          <button className="w-6 h-6 flex items-center justify-center rounded text-[12px] text-t3 cursor-pointer transition-all duration-[120ms] hover:bg-hov hover:text-t1" onClick={toggleAiPanel} title={t('ai:panel.close')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <ChatMessageList
        messages={messages}
        streaming={isStreaming}
        streamingIndicator="dots"
        className="p-3 gap-3"
      />

      {isStudySession ? (
        <div className="flex items-center justify-between gap-2 py-2.5 px-3 border-t border-brd shrink-0 text-[12px] text-t2">
          <span className="flex items-center gap-1.5 min-w-0">
            {isStreaming && <span className="ai-session-streaming shrink-0" />}
            <span className="truncate">
              {isStreaming ? t('ai:panel.studyStreaming') : t('ai:panel.studyIdle')}
            </span>
          </span>
          {isStreaming && (
            <button
              className="w-7 h-7 flex items-center justify-center rounded-md cursor-pointer transition-all duration-[120ms] bg-red text-white hover:opacity-[.85] shrink-0"
              onClick={handleStop}
              title={t('ai:panel.stop')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          )}
        </div>
      ) : (
        <ChatInput
          onSend={handleSend}
          onStop={handleStop}
          isStreaming={isStreaming}
        />
      )}
    </div>
  );
}
