import { useEffect, useRef } from 'react';
import type { CliMessage } from '@quill/cli-adapter';
import type { AiChatMode } from '@/store/aiStore';
import { MessageContent } from './MessageContent';
import { ToolCallBlock } from './ToolCallBlock';
import { FileImage } from './FileImage';
import { FileIcon } from '@/components/icons/FileIcon';

interface ChatMessagesProps {
  messages: CliMessage[];
  isStreaming: boolean;
  chatMode: AiChatMode;
  onSaveToWiki?: (content: string) => void;
}

export function ChatMessages({ messages, isStreaming, chatMode, onSaveToWiki }: ChatMessagesProps) {
  const msgsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex flex-col gap-2 flex-1">
      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center py-10 px-5 gap-2">
          <div className="text-[32px] text-acc opacity-60">✦</div>
          <div className="text-[13px] font-semibold text-t2">输入指令让 AI 编辑你的文档</div>
          <div className="text-[11px] text-t3 text-center leading-normal">AI 会直接修改文件，变更将在编辑器内以 Diff 形式展示</div>
        </div>
      )}
      {messages.map((msg) => {
          return (
            <div key={msg.id} className={`py-2 px-2.5 rounded-lg ${msg.role === 'user' ? 'bg-accdim self-end max-w-[90%]' : 'bg-surf border border-brd'}`}>
              <div className="text-[9px] font-semibold text-t3 mb-1 uppercase flex items-center gap-1.5">
                {msg.role === 'assistant' ? 'AI' : '你'}
                {msg.role === 'user' && msg.timestamp && (
                  <span className="font-normal normal-case opacity-70 text-[9px]">{new Date(msg.timestamp).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(/\//g, '-')}</span>
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
                <div className="flex flex-wrap gap-1 mb-1.5">
                  {msg.attachments.map((att, i) => (
                    <div key={i} className="rounded overflow-hidden">
                      {att.type === 'image' ? (
                        att.previewUrl
                          ? <img className="max-w-[120px] max-h-[80px] object-cover rounded border border-brd" src={att.previewUrl} alt={att.name} />
                          : att.path
                            ? <FileImage className="max-w-[120px] max-h-[80px] object-cover rounded border border-brd" path={att.path} alt={att.name} />
                            : <span className="inline-flex items-center gap-1 text-[11px] py-0.5 px-1.5 bg-surf border border-brd rounded-md text-t2">🖼 {att.name}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] py-0.5 px-1.5 bg-surf border border-brd rounded-md text-t2"><FileIcon filename={att.name} /> {att.name}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="text-[12px] leading-[1.6] text-t1 break-words">
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
              {msg.role === 'assistant' && chatMode === 'wiki' && msg.content && onSaveToWiki && (
                <button
                  className="mt-1.5 py-0.5 px-2.5 border border-acc rounded bg-transparent text-acc text-[12px] cursor-pointer hover:bg-accdim"
                  onClick={() => onSaveToWiki(msg.content)}
                >
                  保存到 Wiki
                </button>
              )}
            </div>
          );
      })}

      {isStreaming && (
        <div className="ai-streaming-indicator">
          <div className="ai-streaming-dots">
            <span /><span /><span />
          </div>
          <span className="text-[11px] text-acc font-medium">AI 正在处理...</span>
        </div>
      )}

      <div ref={msgsEndRef} />
    </div>
  );
}
