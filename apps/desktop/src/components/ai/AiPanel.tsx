import { useState, useRef, useEffect, useCallback } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { useAiStore } from '@/store/aiStore';
import { useAiStream } from '@/hooks/useAiStream';

export function AiPanel() {
  const aiPanelVisible = useEditorStore((s) => s.aiPanelVisible);
  const toggleAiPanel = useEditorStore((s) => s.toggleAiPanel);
  const messages = useAiStore((s) => s.messages);
  const isStreaming = useAiStore((s) => s.isStreaming);
  const contextScope = useAiStore((s) => s.contextScope);
  const setContextScope = useAiStore((s) => s.setContextScope);
  const clearMessages = useAiStore((s) => s.clearMessages);
  const { send } = useAiStream();

  const [input, setInput] = useState('');
  const msgsEndRef = useRef<HTMLDivElement>(null);

  // Drag resize
  const [panelWidth, setPanelWidth] = useState(320);
  const isDragging = useRef(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const newWidth = window.innerWidth - e.clientX;
      setPanelWidth(Math.max(240, Math.min(600, newWidth)));
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

  const [chatMode, setChatMode] = useState<'chat' | 'agent'>('chat');

  if (!aiPanelVisible) return null;

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    send(input.trim(), chatMode);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="ai-panel" style={{ width: `${panelWidth}px` }}>
      <div className="ai-resizer" onMouseDown={handleResizeStart} />
      <div className="ai-header">
        <span className="ai-title">✦ Quill AI</span>
        <div className="ai-header-actions">
          <button className="ai-hbtn" onClick={clearMessages} title="清空对话">🗑</button>
          <button className="ai-hbtn" onClick={toggleAiPanel} title="关闭">✕</button>
        </div>
      </div>

      <div className="ai-body">
        {/* Context scope */}
        <div className="ai-ctx">
          <span className="ai-ctx-lbl">上下文</span>
          <div className="ai-chips">
            <button
              className={`chip ${contextScope === 'document' ? 'on' : ''}`}
              onClick={() => setContextScope('document')}
            >📄 当前文档</button>
            <button
              className={`chip ${contextScope === 'vault' ? 'on' : ''}`}
              onClick={() => setContextScope('vault')}
            >🗂 Vault</button>
          </div>
        </div>

        {/* Mode toggle */}
        <div className="ai-ctx">
          <span className="ai-ctx-lbl">模式</span>
          <div className="ai-chips">
            <button className={`chip ${chatMode === 'chat' ? 'on' : ''}`} onClick={() => setChatMode('chat')}>💬 对话</button>
            <button className={`chip ${chatMode === 'agent' ? 'on' : ''}`} onClick={() => setChatMode('agent')}>🤖 Agent</button>
          </div>
        </div>

        {/* Messages */}
        <div className="ai-msgs">
          {messages.map((msg) => (
            <div key={msg.id} className={`msg ${msg.role}`}>
              <div className="msg-from">{msg.role === 'ai' ? 'Quill AI' : '你'}</div>

              {/* Thinking section */}
              {msg.thinking && (
                <div className="msg-thinking">
                  <div className="msg-thinking-label">💭 思考中...</div>
                  <div className="msg-thinking-body">{msg.thinking}</div>
                </div>
              )}

              {/* Tool calls */}
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="msg-tools">
                  {msg.toolCalls.map((tc) => (
                    <div key={tc.id} className={`msg-tool ${tc.status}`}>
                      <span className="msg-tool-icon">{tc.status === 'running' ? '⏳' : '✅'}</span>
                      <span className="msg-tool-name">{tc.name}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="msg-body">
                {msg.content}
                {msg.role === 'ai' &&
                  isStreaming &&
                  messages[messages.length - 1]?.id === msg.id && (
                    <span className="cursor-blink">▎</span>
                  )}
              </div>
            </div>
          ))}
          <div ref={msgsEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="ai-input-wrap">
        <textarea
          className="ai-input"
          placeholder="输入你的问题..."
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
          {isStreaming ? '⏳' : '➤'}
        </button>
      </div>
    </div>
  );
}
