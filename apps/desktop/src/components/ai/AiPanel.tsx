import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { useAiStore } from '@/store/aiStore';
import type { AiChatMode } from '@/store/aiStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useVaultStore } from '@/store/vaultStore';
import type { CliStreamEvent, MessageAttachment } from '@quill/cli-adapter';
import { pauseWatcher, resumeWatcher } from '@/utils/fileWatcher';
import { flattenFileTree } from '@/utils/treeUtils';
import { sessionAdapters, getAdapterForSession } from './adapterManager';
import { WikiToolbar } from './WikiToolbar';
import { WikiActivityLog } from './WikiActivityLog';
import { ClipToolbar } from './ClipToolbar';
import { ReviewItemList } from './ReviewItemList';
import { IngestDialog } from './IngestDialog';
import { DeepResearchDialog } from './DeepResearchDialog';
import { useWikiStore } from '@/store/wikiStore';
import { useClipStore } from '@/store/clipStore';
import { runIngest } from '@/services/wikiIngestService';
import { runWikiLint } from '@/services/wikiLintService';
import { saveToWiki } from '@/services/wikiQueryService';
import { ChatMessages } from './ChatMessages';
import { ChatInput } from './ChatInput';
import type { PendingAttachment } from './ChatInput';

export function AiPanel() {
  const aiPanelVisible = useEditorStore((s) => s.aiPanelVisible);
  const toggleAiPanel = useEditorStore((s) => s.toggleAiPanel);

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

  const chatMode = useAiStore((s) => s.chatMode);
  const setChatMode = useAiStore((s) => s.setChatMode);
  const [showIngestDialog, setShowIngestDialog] = useState(false);
  const [showDeepResearch, setShowDeepResearch] = useState(false);

  // Track separate active session per mode (seed chat with current session)
  const modeSessionRef = useRef<Record<AiChatMode, string | null>>({ chat: activeSessionId, wiki: null, clip: null });

  const handleModeSwitch = useCallback((mode: AiChatMode) => {
    if (mode === chatMode) return;
    // Save current session for the old mode
    modeSessionRef.current[chatMode] = activeSessionId;
    // Restore or create session for the new mode
    const savedId = modeSessionRef.current[mode];
    if (savedId && sessions.some((s) => s.id === savedId)) {
      switchSession(savedId);
    } else {
      const newId = createSession();
      modeSessionRef.current[mode] = newId;
    }
    setChatMode(mode);
  }, [chatMode, activeSessionId, sessions, switchSession, createSession, setChatMode]);

  const handleIngest = async (filePaths: string[]) => {
    setShowIngestDialog(false);
    try {
      await runIngest(filePaths);
    } catch (err) {
      console.error('Ingest failed:', err);
    }
  };

  const handleLint = async () => {
    const store = useWikiStore.getState();
    store.setLinting(true);
    store.pushActivity('info', '开始健康检查...');
    try {
      const items = await runWikiLint();
      store.addReviewItems(items);
      if (items.length > 0) {
        store.pushActivity('success', `健康检查完成，发现 ${items.length} 个问题`);
      } else {
        store.pushActivity('success', '健康检查完成，一切正常');
      }
    } catch (err) {
      store.pushActivity('error', `健康检查失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      store.setLinting(false);
    }
  };

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

    // Handle /clip <url> and /clip! <url> commands in chat mode.
    // `/clip <url>` is the default non-destructive path: if the URL was
    // already clipped, open the existing note and reply in chat instead of
    // re-clipping. `/clip! <url>` forces a re-clip and overwrites the
    // existing file at its current path.
    if (chatMode === 'chat' && (userText.startsWith('/clip ') || userText.startsWith('/clip! '))) {
      const force = userText.startsWith('/clip! ');
      const url = userText.slice(force ? 7 : 6).trim();
      if (url) {
        let sessionId = activeSessionId;
        if (!sessionId) sessionId = createSession();
        addMessage('user', userText, sessionId);

        // Non-force mode: surface duplicate without re-clipping.
        if (!force) {
          await useClipStore.getState().loadClips();
          const existing = useClipStore.getState().findClipByUrl(url);
          if (existing) {
            const fileName = existing.split('/').pop() || existing;
            addMessage('assistant', `已剪藏过，已打开 [${fileName}]`, sessionId);
            try {
              await useEditorStore.getState().openFile(existing, fileName);
            } catch (err) {
              console.error('[AiPanel] openFile failed:', err);
            }
            return;
          }
        }

        addMessage('assistant', `正在剪藏: ${url} ...`, sessionId);
        try {
          const filePath = await useClipStore.getState().clipUrl(url, undefined, undefined, { force });
          appendToLastMessage(`\n\n剪藏完成: \`${filePath}\``, sessionId);
        } catch (err) {
          appendToLastMessage(`\n\n[错误] 剪藏失败: ${err instanceof Error ? err.message : String(err)}`, sessionId);
        }
      }
      return;
    }

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
    addMessage('user', userText || '(附件)', sessionId, previewAttachments.length > 0 ? previewAttachments : undefined);
    addMessage('assistant', '', sessionId);
    setSessionStreaming(sessionId, true);

    const settings = useSettingsStore.getState();
    const vault = useVaultStore.getState().currentVault;

    let workingDir = vault?.basePath ?? '';
    if (workingDir.startsWith('~')) {
      try {
        const { homeDir } = await import('@tauri-apps/api/path');
        const home = (await homeDir()).replace(/\/+$/, '');
        workingDir = home + workingDir.slice(1);
      } catch {}
    }

    // Save blob attachments to temp directory
    const savedAttachments: MessageAttachment[] = [];
    let attachSaveError = '';
    if (currentAttachments.length > 0) {
      try {
        const { Command } = await import('@tauri-apps/plugin-shell');
        const tmpDir = `${workingDir}/.quill-tmp`;
        await Command.create('claude-cli', ['-l', '-c', `mkdir -p '${tmpDir}'`]).execute();

        for (const att of currentAttachments) {
          if (att.path) {
            savedAttachments.push({ name: att.name, path: att.path, type: att.type });
          } else if (att.blob) {
            const ext = att.name.split('.').pop() || 'png';
            const fileName = `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
            const filePath = `${tmpDir}/${fileName}`;
            const buffer = await att.blob.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            let binaryStr = '';
            const chunk = 8192;
            for (let i = 0; i < bytes.length; i += chunk) {
              binaryStr += String.fromCharCode(...bytes.slice(i, i + chunk));
            }
            const base64 = btoa(binaryStr);
            const writeResult = await Command.create('claude-cli', ['-l', '-c',
              `printf '%s' '${base64}' | base64 -D > '${filePath}'`,
            ]).execute();
            if (writeResult.code === 0) {
              savedAttachments.push({ name: att.name, path: filePath, type: att.type });
            }
          }
          if (att.previewUrl) URL.revokeObjectURL(att.previewUrl);
        }
      } catch (err) {
        attachSaveError = String(err);
        console.error('[AiPanel] Failed to save attachments:', err);
      }
    }

    // Build prompt with attachment references
    let prompt = userText;
    if (savedAttachments.length > 0) {
      const images = savedAttachments.filter((a) => a.type === 'image');
      const files = savedAttachments.filter((a) => a.type === 'file');
      const parts: string[] = [];
      if (images.length > 0) {
        parts.push(`请先使用 Read 工具读取以下图片文件:\n${images.map((a) => a.path).join('\n')}`);
      }
      if (files.length > 0) {
        parts.push(`请先使用 Read 工具读取以下文件:\n${files.map((a) => a.path).join('\n')}`);
      }
      const instruction = parts.join('\n\n');
      prompt = prompt ? `${instruction}\n\n用户消息: ${prompt}` : instruction;
    }

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
      appendToLastMessage(`[错误] 附件保存失败: ${attachSaveError}`, sessionId);
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
          if (event.content) appendToLastMessage(`\n\n[错误] ${event.content}`, sid);
          break;
        case 'done':
          setSessionStreaming(sid, false);
          adapter.offEvent(eventHandler);
          useVaultStore.getState().refreshFileTree();
          useEditorStore.getState().checkDiskChanges().finally(() => {
            resumeWatcher();
          });
          break;
      }
    };

    adapter.onEvent(eventHandler);
    await useEditorStore.getState().flushAutoSaves();
    pauseWatcher();

    try {
      await adapter.start({ cliPath: settings.cliPath, workingDir });
      await adapter.send(prompt, { resumeSessionId });
    } catch (err) {
      appendToLastMessage(`\n\n[错误] ${String(err)}`, sid);
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

  const handleSaveToWiki = async (content: string) => {
    const title = content.split('\n')[0]?.replace(/^#+\s*/, '').slice(0, 50) || '综合分析';
    const lastUserMsg = messages.filter((m) => m.role === 'user').pop();
    const query = lastUserMsg?.content || '';
    const path = await saveToWiki(title, content, query);
    await useWikiStore.getState().refreshWikiFiles();
    alert(`已保存到 wiki://${path}`);
  };

  const handleNewSession = () => {
    createSession();
    setShowSessionList(false);
  };

  const handleDeleteSession = async () => {
    if (!activeSessionId) return;
    const { confirm } = await import('@tauri-apps/plugin-dialog');
    const yes = await confirm('确定要删除当前会话吗？删除后无法恢复。', { title: '删除会话', kind: 'warning' });
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
            <span className="text-[13px] font-bold text-acc truncate">✦ {activeSession?.title || '新会话'}</span>
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
                  <span className="shrink-0 text-[10px] text-t3">{s.messages.filter((m) => m.role === 'user').length} 条</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          <button className="w-6 h-6 flex items-center justify-center rounded text-[12px] text-t3 cursor-pointer transition-all duration-[120ms] hover:bg-hov hover:text-t1" onClick={handleNewSession} title="新建会话">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button className="w-6 h-6 flex items-center justify-center rounded text-[12px] text-t3 cursor-pointer transition-all duration-[120ms] hover:bg-hov hover:text-t1" onClick={handleDeleteSession} title="删除会话">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
          <button className="w-6 h-6 flex items-center justify-center rounded text-[12px] text-t3 cursor-pointer transition-all duration-[120ms] hover:bg-hov hover:text-t1" onClick={toggleAiPanel} title="关闭">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex gap-0 px-3 border-b border-brd shrink-0">
        <button
          className={`flex-1 py-1.5 border-none bg-transparent text-[12px] cursor-pointer border-b-2 transition-[color,border-color] duration-150 hover:text-t1 ${chatMode === 'chat' ? 'text-acc border-b-acc font-semibold' : 'text-t3 font-medium border-b-transparent'}`}
          onClick={() => handleModeSwitch('chat')}
        >
          Chat
        </button>
        <button
          className={`flex-1 py-1.5 border-none bg-transparent text-[12px] cursor-pointer border-b-2 transition-[color,border-color] duration-150 hover:text-t1 ${chatMode === 'wiki' ? 'text-acc border-b-acc font-semibold' : 'text-t3 font-medium border-b-transparent'}`}
          onClick={() => handleModeSwitch('wiki')}
        >
          Wiki
        </button>
        <button
          className={`flex-1 py-1.5 border-none bg-transparent text-[12px] cursor-pointer border-b-2 transition-[color,border-color] duration-150 hover:text-t1 ${chatMode === 'clip' ? 'text-acc border-b-acc font-semibold' : 'text-t3 font-medium border-b-transparent'}`}
          onClick={() => handleModeSwitch('clip')}
        >
          Clip
        </button>
      </div>

      {chatMode === 'wiki' && (
        <WikiToolbar
          onIngest={() => setShowIngestDialog(true)}
          onLint={handleLint}
          onDeepResearch={() => setShowDeepResearch(true)}
        />
      )}

      {chatMode === 'clip' && (
        <ClipToolbar onClip={async (url) => {
          await useClipStore.getState().clipUrl(url);
        }} />
      )}

      <div className="ai-body flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        <ChatMessages
          messages={messages}
          isStreaming={isStreaming}
          chatMode={chatMode}
          onSaveToWiki={chatMode === 'wiki' ? handleSaveToWiki : undefined}
        />
      </div>

      {chatMode === 'wiki' && <WikiActivityLog />}
      {chatMode === 'wiki' && <ReviewItemList />}

      {isStudySession ? (
        <div className="flex items-center justify-between gap-2 py-2.5 px-3 border-t border-brd shrink-0 text-[12px] text-t2">
          <span className="flex items-center gap-1.5 min-w-0">
            {isStreaming && <span className="ai-session-streaming shrink-0" />}
            <span className="truncate">
              {isStreaming ? 'study agent 运行中…' : 'study agent 会话（不可手动输入）'}
            </span>
          </span>
          {isStreaming && (
            <button
              className="w-7 h-7 flex items-center justify-center rounded-md cursor-pointer transition-all duration-[120ms] bg-red text-white hover:opacity-[.85] shrink-0"
              onClick={handleStop}
              title="停止"
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

      {showIngestDialog && (
        <IngestDialog
          onConfirm={handleIngest}
          onCancel={() => setShowIngestDialog(false)}
        />
      )}
      {showDeepResearch && (
        <DeepResearchDialog
          onConfirm={(topic) => {
            setShowDeepResearch(false);
            console.log('Deep research topic:', topic);
          }}
          onCancel={() => setShowDeepResearch(false)}
        />
      )}
    </div>
  );
}
