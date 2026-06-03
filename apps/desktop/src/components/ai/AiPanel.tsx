import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { useAiStore } from '@/store/aiStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useVaultStore } from '@/store/vaultStore';
import { CliAdapterRegistry } from '@quill/cli-adapter';
import type { CliAdapter, CliStreamEvent, MessageAttachment } from '@quill/cli-adapter';
import type { VaultEntry } from '@quill/vault-provider';
import { pauseWatcher, resumeWatcher } from '@/utils/fileWatcher';
import { MessageContent } from './MessageContent';
import { ToolCallBlock } from './ToolCallBlock';
import { FileIcon } from '@/components/icons/FileIcon';

interface PendingAttachment {
  id: string;
  name: string;
  type: 'image' | 'file';
  path?: string;
  blob?: Blob;
  previewUrl?: string;
}

function FileImage({ path, alt, className }: { path: string; alt: string; className?: string }) {
  const [src, setSrc] = useState<string>('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let revoke = '';
    import('@tauri-apps/plugin-fs').then(({ readFile }) =>
      readFile(path).then((bytes) => {
        const ext = path.split('.').pop()?.toLowerCase() || 'png';
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : 'image/png';
        const blob = new Blob([bytes], { type: mime });
        const url = URL.createObjectURL(blob);
        revoke = url;
        setSrc(url);
      }),
    ).catch(() => setFailed(true));
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [path]);
  if (failed) return <span className="ai-msg-attach-file">🖼 {alt}</span>;
  if (!src) return null;
  return <img className={className} src={src} alt={alt} onError={() => setFailed(true)} />;
}

function flattenFileTree(entries: VaultEntry[]): { path: string; name: string }[] {
  const result: { path: string; name: string }[] = [];
  for (const entry of entries) {
    if (entry.type === 'file') {
      result.push({ path: entry.path, name: entry.name });
    }
    if (entry.type === 'dir' && entry.children) {
      result.push(...flattenFileTree(entry.children));
    }
  }
  return result;
}

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

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [showSessionList, setShowSessionList] = useState(false);
  const [mentionMenu, setMentionMenu] = useState<{ visible: boolean; filter: string; anchorPos: number }>({ visible: false, filter: '', anchorPos: 0 });
  const [mentionIndex, setMentionIndex] = useState(0);
  const msgsEndRef = useRef<HTMLDivElement>(null);
  const sessionListRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const pendingFileAttachments = useAiStore((s) => s.pendingFileAttachments);
  const consumePendingFiles = useAiStore((s) => s.consumePendingFiles);

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

  const fileTree = useVaultStore((s) => s.fileTree);
  const allFiles = useMemo(() => flattenFileTree(fileTree), [fileTree]);
  const filteredMentionFiles = useMemo(() => {
    if (!mentionMenu.visible) return [];
    const q = mentionMenu.filter.toLowerCase();
    if (!q) return allFiles.slice(0, 20);
    return allFiles.filter((f) => f.path.toLowerCase().includes(q) || f.name.toLowerCase().includes(q)).slice(0, 20);
  }, [mentionMenu.visible, mentionMenu.filter, allFiles]);

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
    if ((!input.trim() && attachments.length === 0) || isStreaming) return;
    const userText = input.trim();
    setInput('');
    const currentAttachments = [...attachments];
    setAttachments([]);

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

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);
    const cursorPos = e.target.selectionStart;
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
  };

  const insertMention = (filePath: string) => {
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
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (mentionMenu.visible && filteredMentionFiles.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % filteredMentionFiles.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + filteredMentionFiles.length) % filteredMentionFiles.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(filteredMentionFiles[mentionIndex].path);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionMenu({ visible: false, filter: '', anchorPos: 0 });
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        const ext = file.type.split('/')[1] || 'png';
        const previewUrl = URL.createObjectURL(file);
        setAttachments((prev) => [...prev, {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: `paste-${Date.now()}.${ext}`,
          type: 'image',
          blob: file,
          previewUrl,
        }]);
        return;
      }
    }
  };

  const handleFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      const isImage = file.type.startsWith('image/');
      const previewUrl = isImage ? URL.createObjectURL(file) : undefined;
      setAttachments((prev) => [...prev, {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name,
        type: isImage ? 'image' : 'file',
        blob: file,
        previewUrl,
      }]);
    }
    e.target.value = '';
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const att = prev.find((a) => a.id === id);
      if (att?.previewUrl) URL.revokeObjectURL(att.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
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
          <button className="ai-hbtn" onClick={handleDeleteSession} title="删除会话">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
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
              <div className="ai-empty-hint">AI 会直接修改文件，变更将在编辑器内以 Diff 形式展示</div>
            </div>
          )}
          {messages.map((msg) => {
              return (
                <div key={msg.id} className={`msg ${msg.role}`}>
                  <div className="msg-from">
                    {msg.role === 'assistant' ? 'AI' : '你'}
                    {msg.role === 'user' && msg.timestamp && (
                      <span className="msg-time">{new Date(msg.timestamp).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(/\//g, '-')}</span>
                    )}
                  </div>

                  {msg.thinking && (
                    <details className="msg-thinking" open={isStreaming && messages[messages.length - 1]?.id === msg.id}>
                      <summary className="msg-thinking-label">Thinking</summary>
                      <div className="msg-thinking-body">{msg.thinking}</div>
                    </details>
                  )}

                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <ToolCallBlock toolCalls={msg.toolCalls} />
                  )}

                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="ai-msg-attachments">
                      {msg.attachments.map((att, i) => (
                        <div key={i} className="ai-msg-attach-item">
                          {att.type === 'image' ? (
                            att.previewUrl
                              ? <img className="ai-msg-attach-img" src={att.previewUrl} alt={att.name} />
                              : att.path
                                ? <FileImage className="ai-msg-attach-img" path={att.path} alt={att.name} />
                                : <span className="ai-msg-attach-file">🖼 {att.name}</span>
                          ) : (
                            <span className="ai-msg-attach-file"><FileIcon filename={att.name} /> {att.name}</span>
                          )}
                        </div>
                      ))}
                    </div>
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
              );
          })}

          {isStreaming && (
            <div className="ai-streaming-indicator">
              <div className="ai-streaming-dots">
                <span /><span /><span />
              </div>
              <span className="ai-streaming-text">AI 正在处理...</span>
            </div>
          )}

          <div ref={msgsEndRef} />
        </div>
      </div>

      <div className="ai-input-wrap">
        {attachments.length > 0 && (
          <div className="ai-attachments">
            {attachments.map((att) => (
              <div key={att.id} className="ai-attach-item">
                {att.previewUrl ? (
                  <img className="ai-attach-thumb" src={att.previewUrl} alt={att.name} />
                ) : (
                  <span className="ai-attach-file-icon"><FileIcon filename={att.name} /></span>
                )}
                <span className="ai-attach-name">{att.name}</span>
                <button className="ai-attach-remove" onClick={() => removeAttachment(att.id)}>×</button>
              </div>
            ))}
          </div>
        )}
        <div className="ai-input-box" style={{ position: 'relative' }}>
          {mentionMenu.visible && filteredMentionFiles.length > 0 && (
            <div className="ai-mention-menu">
              {filteredMentionFiles.map((file, i) => (
                <div
                  key={file.path}
                  className={`ai-mention-item ${i === mentionIndex ? 'active' : ''}`}
                  onMouseDown={(e) => { e.preventDefault(); insertMention(file.path); }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><FileIcon filename={file.name} /> {file.name}</span>
                  <span className="ai-mention-item-path">{file.path}</span>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            className="ai-input"
            placeholder="输入指令，@ 引用文件..."
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            rows={2}
            disabled={isStreaming}
            autoCapitalize="off"
          />
          <div className="ai-input-actions">
            <button className="ai-input-action" onClick={handleFileSelect} disabled={isStreaming} title="附加文件">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <div className="ai-input-actions-spacer" />
            {isStreaming ? (
              <button className="ai-input-action ai-stop-btn" onClick={handleStop} title="停止">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                className="ai-input-action ai-send-btn"
                onClick={handleSend}
                disabled={!input.trim() && attachments.length === 0}
                title="发送"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            )}
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.txt,.md,.json,.csv,.pdf,.html,.htm,.xml,.yaml,.yml,.toml,.log"
          style={{ display: 'none' }}
          onChange={handleFileInputChange}
        />
      </div>
    </div>
  );
}
