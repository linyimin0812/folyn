import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import type { CliMessage } from '@quill/cli-adapter';
import { isTauri } from '@/utils/platform';
import { MessageContent } from './MessageContent';
import { ToolCallBlock } from './ToolCallBlock';
import { FileImage } from './FileImage';
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
  /** When true, image segments on assistant messages render a "保存到 vault"
   *  button that decodes the data URL and writes it under
   *  `<vault>/__attachments__/`. Defaults to false; both AiPanel and Pet
   *  chat opt in. */
  showSaveImageButton?: boolean;
  /** Render a small "provider : model" tag under assistant messages that carry
   *  a `provider` + `model` pair (PR4). The resolver is consumer-supplied
   *  because shared chat components MUST NOT import the provider catalog
   *  (per component-guidelines.md). AiPanel passes a resolver that uses
   *  `providerDisplayName`; the pet/bubble paths omit it (no tag). */
  renderPairTag?: (msg: CliMessage) => ReactNode | null;
  className?: string;
  /** Reserved session-switch props (PRD R: PetChat does not pass them and
   *  the UI does not render a switcher yet). Kept on the type so future
   *  callers can wire a session bar without changing the component shape. */
  sessions?: { id: string; label: string }[];
  activeSessionId?: string;
  onSwitchSession?: (id: string) => void;
}

const DEFAULT_EMPTY_HINT = (
  <div className="chat-empty">
    <div className="chat-empty-badge">✦</div>
    <div className="text-[13px] font-semibold text-t1">输入指令让 AI 编辑你的文档</div>
    <div className="text-[11px] text-t3 leading-relaxed max-w-[240px]">
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
      className="inline-flex items-center justify-center w-6 h-6 rounded-md text-t3 hover:bg-hov hover:text-t1 transition-colors"
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
  showSaveImageButton,
  renderPairTag,
}: {
  msg: CliMessage;
  isLast: boolean;
  streaming: boolean;
  plaintext?: boolean;
  showCopy?: boolean;
  onCopy?: (msg: CliMessage) => void;
  streamingIndicator: 'dots' | 'cursor' | 'none';
  onSaveToWiki?: (msg: CliMessage) => void;
  showSaveImageButton?: boolean;
  renderPairTag?: (msg: CliMessage) => ReactNode | null;
}) {
  const isAssistant = msg.role === 'assistant';
  // Per-bubble cursor on the last assistant msg while streaming, for any
  // indicator mode other than 'none'. 'dots' ALSO renders the list-level
  // 3-dot block (see ChatMessageList body); 'cursor' renders only this
  // per-bubble cursor (matches the pet); 'none' renders neither.
  const showCursor = streaming && isLast && isAssistant && streamingIndicator !== 'none';

  // ── User bubble: right-aligned accent gradient, white text, timestamp
  //    meta at the bottom-right. Multi-line input preserved via pre-wrap. ──
  if (!isAssistant) {
    return (
      <div className="chat-msg-row justify-end">
        <div className="chat-msg-bubble chat-msg-bubble-user">
          <AttachmentsRow msg={msg} />
          <div className="chat-msg-user-text">{msg.content}</div>
          {msg.timestamp ? (
            <div className="chat-msg-user-meta">{formatTimestamp(msg.timestamp)}</div>
          ) : null}
        </div>
      </div>
    );
  }

  // ── Assistant bubble: flat soft card; pair tag sits OUTSIDE the bubble
  //    as a small meta line above it; copy / wiki actions on hover. ──
  const hasActions = Boolean(msg.content) && (showCopy || onSaveToWiki);
  return (
    <div className="chat-msg-row">
      <div className="flex flex-col flex-1 min-w-0">
        {msg.provider && msg.model && renderPairTag ? (
          <span className="chat-pair-tag mb-1 px-0.5" data-testid="msg-pair-tag">
            {renderPairTag(msg)}
          </span>
        ) : null}
        <div className="chat-msg-bubble chat-msg-bubble-ai">

        {msg.thinking && (
          <details className="msg-thinking" open={streaming && isLast}>
            <summary className="msg-thinking-label">Thinking</summary>
            <div className="msg-thinking-body">{msg.thinking}</div>
          </details>
        )}

        {msg.toolCalls && msg.toolCalls.length > 0 && <ToolCallBlock toolCalls={msg.toolCalls} />}

        <AttachmentsRow msg={msg} />

        <div className="text-[12px] leading-[1.6] text-t1 break-words">
          {msg.content || (msg.images && msg.images.length > 0) ? (
            <MessageContent
              content={msg.content}
              images={msg.images}
              plaintext={plaintext}
              className={plaintext ? 'whitespace-pre-wrap' : undefined}
              showSaveImageButton={showSaveImageButton}
            />
          ) : null}
          {showCursor && <span className="cursor-blink">▎</span>}
        </div>

        {hasActions && (
          <div className="chat-msg-actions">
            {msg.content && onSaveToWiki && (
              <button
                type="button"
                className="py-0.5 px-2.5 border border-acc rounded-full bg-transparent text-acc text-[11px] cursor-pointer hover:bg-accdim transition-colors"
                onClick={() => onSaveToWiki(msg)}
              >
                保存到 Wiki
              </button>
            )}
            {msg.content && showCopy && <CopyButton msg={msg} onCopy={onCopy} />}
          </div>
        )}
        </div>
      </div>
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
  showSaveImageButton,
  renderPairTag,
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
            showSaveImageButton={showSaveImageButton}
            renderPairTag={renderPairTag}
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
          className="self-center mt-1 mb-1 py-1 px-3.5 text-[11px] text-t3 border border-brd rounded-full bg-transparent hover:bg-hov hover:text-t1 hover:border-brd2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          onClick={onClear}
          disabled={streaming}
        >
          清空对话
        </button>
      )}
    </div>
  );
}
