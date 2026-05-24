import { useState, useRef, useEffect, useCallback } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { useAiStore } from '@/store/aiStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useVaultStore } from '@/store/vaultStore';
import { CliAdapterRegistry } from '@quill/cli-adapter';
import type { CliAdapter, CliStreamEvent } from '@quill/cli-adapter';
import { MessageContent } from './MessageContent';
import { ToolCallBlock } from './ToolCallBlock';

const sessionAdapters = new Map<string, CliAdapter>();

function getAdapterForSession(sessionId: string): CliAdapter {
  const settings = useSettingsStore.getState();
  const existing = sessionAdapters.get(sessionId);
  if (existing && existing.id === settings.cliAdapter) return existing;
  const adapter = CliAdapterRegistry.getInstance().create(settings.cliAdapter);
  sessionAdapters.set(sessionId, adapter);
  return adapter;
}

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
  const messages = activeSession?.messages ?? [];
  const pendingFileCount = (activeSession?.fileChanges ?? []).filter((c) => c.status === 'pending').length;

  const [input, setInput] = useState('');
  const [showSessionList, setShowSessionList] = useState(false);
  const msgsEndRef = useRef<HTMLDivElement>(null);
  const sessionListRef = useRef<HTMLDivElement>(null);

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
        document.body.style.userSelect = '';
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
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;
    const prompt = input.trim();
    setInput('');

    let sessionId = activeSessionId;
    if (!sessionId) {
      sessionId = createSession();
    }

    addMessage('user', prompt, sessionId);
    addMessage('assistant', '', sessionId);
    setSessionStreaming(sessionId, true);

    const adapter = getAdapterForSession(sessionId);
    const settings = useSettingsStore.getState();
    const vault = useVaultStore.getState().currentVault;

    let workingDir = vault?.basePath ?? '';
    if (workingDir.startsWith('~')) {
      try {
        const { homeDir } = await import('@tauri-apps/api/path');
        const home = (await homeDir()).replace(/\/+$/, '');
        workingDir = home + workingDir.slice(1);
      } catch {
        // fallback
      }
    }

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
          break;
      }
    };

    adapter.onEvent(eventHandler);

    try {
      await adapter.start({ cliPath: settings.cliPath, workingDir });
      await adapter.send(prompt, { resumeSessionId });
    } catch (err) {
      appendToLastMessage(`\n\n[错误] ${String(err)}`, sid);
      setSessionStreaming(sid, false);
      adapter.offEvent(eventHandler);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewSession = () => {
    createSession();
    setShowSessionList(false);
  };

  const handleDeleteSession = async () => {
    if (!activeSessionId || sessions.length <= 1) return;
    const { confirm } = await import('@tauri-apps/plugin-dialog');
    const yes = await confirm('确定要删除当前会话吗？删除后无法恢复。', { title: '删除会话', kind: 'warning' });
    if (yes) {
      sessionAdapters.delete(activeSessionId);
      deleteSession(activeSessionId);
    }
  };

  const handleSwitchSession = (id: string) => {
    switchSession(id);
    setShowSessionList(false);
  };

  return (
    <div className="ai-panel" style={{ width: `${panelWidth}px` }}>
      <div className="ai-resizer" onMouseDown={handleResizeStart} />
      <div className="ai-header">
        <div className="ai-session-picker" ref={sessionListRef}>
          <button
            className="ai-session-btn"
            onClick={() => setShowSessionList(!showSessionList)}
          >
            <span className="ai-title">✦ {activeSession?.title || '新会话'}</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {showSessionList && (
            <div className="ai-session-list">
              {sessions.map((s) => (
                <button
                  key={s.id}
                  className={`ai-session-item ${s.id === activeSessionId ? 'active' : ''}`}
                  onClick={() => handleSwitchSession(s.id)}
                >
                  <span className="ai-session-item-title">
                    {s.isStreaming && <span className="ai-session-streaming" />}
                    {s.title}
                  </span>
                  <span className="ai-session-item-count">{s.messages.filter((m) => m.role === 'user').length} 条</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="ai-header-actions">
          <button className="ai-hbtn" onClick={handleNewSession} title="新建会话">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          {sessions.length > 1 && (
            <button className="ai-hbtn" onClick={handleDeleteSession} title="删除会话">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          )}
          <button className="ai-hbtn" onClick={toggleAiPanel} title="关闭">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <div className="ai-body">
        <div className="ai-msgs">
          {messages.length === 0 && (
            <div className="ai-empty">
              <div className="ai-empty-icon">✦</div>
              <div className="ai-empty-text">输入指令让 AI 编辑你的文档</div>
              <div className="ai-empty-hint">AI 会直接修改文件，你可以在 Diff 视图中审查变更</div>
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className={`msg ${msg.role}`}>
              <div className="msg-from">{msg.role === 'assistant' ? 'AI' : '你'}</div>

              {msg.thinking && (
                <details className="msg-thinking" open={isStreaming && messages[messages.length - 1]?.id === msg.id}>
                  <summary className="msg-thinking-label">Thinking</summary>
                  <div className="msg-thinking-body">{msg.thinking}</div>
                </details>
              )}

              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <ToolCallBlock toolCalls={msg.toolCalls} />
              )}

              <div className="msg-body">
                {msg.role === 'assistant' && msg.content ? (
                  <MessageContent content={msg.content} />
                ) : (
                  msg.content
                )}
                {msg.role === 'assistant' &&
                  isStreaming &&
                  messages[messages.length - 1]?.id === msg.id && (
                    <span className="cursor-blink">▎</span>
                  )}
              </div>
            </div>
          ))}

          {pendingFileCount > 0 && (
            <div className="ai-file-notify">
              ✦ {pendingFileCount} 个文件已修改，请在编辑器中审查
            </div>
          )}

          <div ref={msgsEndRef} />
        </div>
      </div>

      <div className="ai-input-wrap">
        <textarea
          className="ai-input"
          placeholder="输入指令，如：在文档末尾添加总结..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          disabled={isStreaming}
          autoCapitalize="off"
        />
        <button
          className="ai-send"
          onClick={handleSend}
          disabled={!input.trim() || isStreaming}
        >
          {isStreaming ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
