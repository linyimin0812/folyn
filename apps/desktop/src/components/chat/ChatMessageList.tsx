import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import type { CliMessage } from '@quill/cli-adapter';
import { isTauri } from '@/utils/platform';
import { MessageContent } from './MessageContent';
// TODO(PR2): relocate ToolCallBlock / FileImage / FileIcon into `components/chat/`
// (or a shared `components/shared/`) so the chat package does not depend on
// `components/ai/`. For PR1 we import directly to keep things working; the
// types are stable and the coupling is one-directional (chat → ai, never
// ai → chat).
import { ToolCallBlock } from '../ai/ToolCallBlock';
import { FileImage } from '../ai/FileImage';
import { FileIcon } from '@/components/icons/FileIcon';

export interface ChatMessageListProps {
  messages: CliMessage[];
  streaming: boolean;
  onClear?: () => void;
  emptyState?: ReactNode;
  renderMessage?: (msg: CliMessage, isLast: boolean) => ReactNode;
  /** Plaintext rendering path for assistant messages (pet chat). When true,
   *  the markdown pipeline is skipped and `msg.content` is rendered as-is.
   *  Defaults to false (markdown, AiPanel path). */
  plaintext?: boolean;
  /** Show a per-bubble copy button on assistant messages with content. The
   *  pet chat sets this; the AiPanel omits it (but gets copy for free when
   *  true). */
  showCopy?: boolean;
  onCopy?: (msg: CliMessage) => void;
  /** Streaming indicator style.
   *  - `'dots'` (default): the 3-dot "AI 正在处理..." block after all msgs.
   *  - `'cursor'`: a per-bubble `▎` cursor on the last assistant msg, no
   *    list-level block (matches the pet).
   *  - `'none'`: neither. */
  streamingIndicator?: 'dots' | 'cursor' | 'none';
  /** AiPanel wiki-mode "保存到 Wiki" button on assistant msgs with content.
   *  The pet chat omits this. */
  onSaveToWiki?: (msg: CliMessage) => void;
  className?: string;
  /** Reserved session-switch props (PRD R: PetChat does not pass them and
   *  the UI does not render a switcher yet). Kept on the type so future
   *  callers can wire a session bar without changing the component shape. */
  sessions?: { id: string; label: string }[];
  activeSessionId?: string;
  onSwitchSession?: (id: string) => void;
}

const DEFAULT_EMPTY_HINT = (
  <div className="flex flex-col items-center justify-center py-10 px-5 gap-2">
    <div className="text-[32px] text-acc opacity-60">✦</div>
    <div className="text-[13px] font-semibold text-t2">输入指令让 AI 编辑你的文档</div>
    <div className="text-[11px] text-t3 text-center leading-normal">
      AI 会直接修改文件，变更将在编辑器内以 Diff 形式展示
    </div>
  </div>
);

/** Copy text to the clipboard via the Tauri clipboard-manager plugin. The
 *  dynamic import keeps the plugin out of the main-window bundle; the
 *  `isTauri()` guard makes it a no-op in non-Tauri (web/dev) contexts.
 *  Returns true on success so the caller can toggle "已复制" feedback. */
async function copyToClipboard(text: string): Promise<boolean> {
  if (!isTauri() || !text) return false;
  try {
    const mod = await import('@tauri-apps/plugin-clipboard-manager');
    await mod.writeText(text);
    return true;
  } catch (err) {
    console.warn('[chat] clipboard writeText failed:', err);
    return false;
  }
}

function formatTimestamp(ts: number): string {
  return new Date(ts)
    .toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    .replace(/\//g, '-');
}

function CopyButton({ msg, onCopy }: { msg: CliMessage; onCopy?: (msg: CliMessage) => void }) {
  const [copied, setCopied] = useState(false);

  const handleClick = useCallback(async () => {
    if (onCopy) {
      onCopy(msg);
      return;
    }
    const ok = await copyToClipboard(msg.content);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied((curr) => (curr ? false : curr)), 1200);
    }
  }, [msg, onCopy]);

  return (
    <button
      type="button"
      className="mt-1 self-end inline-flex items-center justify-center w-6 h-6 rounded text-t3 hover:bg-hov hover:text-t1 transition-colors"
      onClick={() => void handleClick()}
      aria-label={copied ? '已复制' : '复制'}
      aria-pressed={copied}
      title={copied ? '已复制' : '复制'}
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 8.5l3.5 3.5L13 5" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="5" width="8" height="8" rx="1.5" />
          <path d="M11 5V3.5A1.5 1.5 0 009.5 2H3.5A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" />
        </svg>
      )}
    </button>
  );
}

function AttachmentsRow({ msg }: { msg: CliMessage }) {
  if (!msg.attachments || msg.attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mb-1.5">
      {msg.attachments.map((att, i) => (
        <div key={i} className="rounded overflow-hidden">
          {att.type === 'image' ? (
            att.previewUrl ? (
              <img className="max-w-[120px] max-h-[80px] object-cover rounded border border-brd" src={att.previewUrl} alt={att.name} />
            ) : att.path ? (
              <FileImage className="max-w-[120px] max-h-[80px] object-cover rounded border border-brd" path={att.path} alt={att.name} />
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] py-0.5 px-1.5 bg-surf border border-brd rounded-md text-t2">🖼 {att.name}</span>
            )
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] py-0.5 px-1.5 bg-surf border border-brd rounded-md text-t2">
              <FileIcon filename={att.name} /> {att.name}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function DefaultMessageRow({
  msg,
  isLast,
  streaming,
  plaintext,
  showCopy,
  onCopy,
  streamingIndicator,
  onSaveToWiki,
}: {
  msg: CliMessage;
  isLast: boolean;
  streaming: boolean;
  plaintext?: boolean;
  showCopy?: boolean;
  onCopy?: (msg: CliMessage) => void;
  streamingIndicator: 'dots' | 'cursor' | 'none';
  onSaveToWiki?: (msg: CliMessage) => void;
}) {
  const isAssistant = msg.role === 'assistant';
  // Per-bubble cursor on the last assistant msg while streaming, for any
  // indicator mode other than 'none'. 'dots' ALSO renders the list-level
  // 3-dot block (see ChatMessageList body); 'cursor' renders only this
  // per-bubble cursor (matches the pet); 'none' renders neither.
  const showCursor = streaming && isLast && isAssistant && streamingIndicator !== 'none';
  return (
    <div
      className={`py-2 px-2.5 rounded-lg ${isAssistant ? 'bg-surf border border-brd' : 'bg-accdim self-end max-w-[90%]'}`}
    >
      <div className="text-[9px] font-semibold text-t3 mb-1 uppercase flex items-center gap-1.5">
        {isAssistant ? 'AI' : '我'}
        {msg.role === 'user' && msg.timestamp && (
          <span className="font-normal normal-case opacity-70 text-[9px]">{formatTimestamp(msg.timestamp)}</span>
        )}
      </div>

      {msg.thinking && (
        <details className="msg-thinking" open={streaming && isLast}>
          <summary className="msg-thinking-label">Thinking</summary>
          <div className="msg-thinking-body">{msg.thinking}</div>
        </details>
      )}

      {msg.toolCalls && msg.toolCalls.length > 0 && <ToolCallBlock toolCalls={msg.toolCalls} />}

      <AttachmentsRow msg={msg} />

      <div className="text-[12px] leading-[1.6] text-t1 break-words">
        {isAssistant && msg.content ? (
          <MessageContent content={msg.content} plaintext={plaintext} className={plaintext ? 'whitespace-pre-wrap' : undefined} />
        ) : (
          msg.content
        )}
        {showCursor && <span className="cursor-blink">▎</span>}
      </div>

      {isAssistant && msg.content && showCopy && <CopyButton msg={msg} onCopy={onCopy} />}

      {isAssistant && msg.content && onSaveToWiki && (
        <button
          type="button"
          className="mt-1.5 py-0.5 px-2.5 border border-acc rounded bg-transparent text-acc text-[12px] cursor-pointer hover:bg-accdim"
          onClick={() => onSaveToWiki(msg)}
        >
          保存到 Wiki
        </button>
      )}
    </div>
  );
}

export function ChatMessageList({
  messages,
  streaming,
  onClear,
  emptyState,
  renderMessage,
  plaintext,
  showCopy,
  onCopy,
  streamingIndicator = 'dots',
  onSaveToWiki,
  className,
}: ChatMessageListProps) {
  const msgsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    msgsEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, streaming]);

  const showListDots = streaming && streamingIndicator === 'dots';

  return (
    <div className={`flex flex-col gap-2 flex-1 min-h-0 overflow-y-auto chat-msg-scroll ${className ?? ''}`} role="log" aria-live="polite">
      {messages.length === 0 && (emptyState ?? DEFAULT_EMPTY_HINT)}

      {messages.map((msg, idx) => {
        const isLast = idx === messages.length - 1;
        if (renderMessage) return <div key={msg.id}>{renderMessage(msg, isLast)}</div>;
        return (
          <DefaultMessageRow
            key={msg.id}
            msg={msg}
            isLast={isLast}
            streaming={streaming}
            plaintext={plaintext}
            showCopy={showCopy}
            onCopy={onCopy}
            streamingIndicator={streamingIndicator}
            onSaveToWiki={onSaveToWiki}
          />
        );
      })}

      {showListDots && (
        <div className="ai-streaming-indicator">
          <div className="ai-streaming-dots">
            <span />
            <span />
            <span />
          </div>
          <span className="text-[11px] text-acc font-medium">AI 正在处理...</span>
        </div>
      )}

      <div ref={msgsEndRef} />

      {onClear && messages.length > 0 && (
        <button
          type="button"
          className="self-center mt-1 py-1 px-3 text-[11px] text-t3 border border-brd rounded bg-transparent hover:bg-hov hover:text-t1 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          onClick={onClear}
          disabled={streaming}
        >
          清空对话
        </button>
      )}
    </div>
  );
}
