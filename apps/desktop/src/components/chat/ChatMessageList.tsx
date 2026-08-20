import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, ListTodo, Copy, X } from 'lucide-react';
import type { CliMessage } from '@quill/cli-adapter';
import { isTauri } from '@/utils/platform';
import { MessageContent } from './MessageContent';
import { ToolCallBlock } from './ToolCallBlock';
import { FileImage } from './FileImage';
import { ZoomableImage } from './ZoomableImage';
import { FileIcon } from '@/components/icons/FileIcon';

export interface ChatMessageListProps {
  messages: CliMessage[];
  streaming: boolean;
  onClear?: () => void;
  emptyState?: ReactNode;
  renderMessage?: (msg: CliMessage, isLast: boolean) => ReactNode;
  /** Multi-select mode. When true, each message row shows a select-toggle
   *  icon on its right edge; the bottom toolbar (count + copy/save/close)
   *  renders. When false, the trigger button in assistant actions rows
   *  enters the mode. */
  multiSelectMode?: boolean;
  onEnterMultiSelect?: () => void;
  onExitMultiSelect?: () => void;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  /** Batch ops in the bottom toolbar. Copy writes concatenated content to
   *  the clipboard; Save opens the save dialog. */
  onBatchCopy?: () => void;
  onBatchSave?: () => void;
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
  /** Save-to-vault button on assistant msgs with content. Opens an in-app
   *  vault path picker (consumer-supplied) — the consumer renders the picker
   *  and writes `msg.content` to the chosen path. */
  onSaveToFile?: (msg: CliMessage) => void;
  /** When true, image segments on assistant messages render a "保存到 vault"
   *  button that decodes the data URL and writes it under
   *  `<vault>/__attachments__/`. Defaults to false; both AiPanel and Pet
   *  chat opt in. */
  showSaveImageButton?: boolean;
  /** Clickable inline-code file paths. When both are present, an inline-code
   *  token that matches a file-path shape renders as a clickable element that
   *  calls `onPathClick(path, line?, col?)` after `resolvePath(raw)` confirms
   *  the file exists. The pet chat omits both (vault-free); AiPanel supplies. */
  onPathClick?: (path: string, line?: number, col?: number) => void;
  resolvePath?: (raw: string) => Promise<boolean>;
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

/**
 * Pick the greeting bucket from the current hour.
 *  - morning: 05:00–11:59  (早上好)
 *  - noon:    12:00–13:59  (中午好)
 *  - afternoon: 14:00–17:59 (下午好)
 *  - evening: 18:00–04:59  (晚上好)
 */
export function greetingKeyForHour(hour: number): 'morning' | 'noon' | 'afternoon' | 'evening' {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 14) return 'noon';
  if (hour >= 14 && hour < 18) return 'afternoon';
  return 'evening';
}

function DefaultEmptyHint() {
  const { t } = useTranslation();
  const greeting = t(
    `ai:panel.emptyState.greeting.${greetingKeyForHour(new Date().getHours())}`,
  );
  return (
    <div className="chat-empty">
      <div className="chat-empty-badge">
        <span>✦</span>
      </div>
      <div className="text-[13px] font-semibold text-t1">{greeting}</div>
    </div>
  );
}

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

function SaveButton({ msg, onSave }: { msg: CliMessage; onSave: (msg: CliMessage) => void }) {
  return (
    <button
      type="button"
      className="inline-flex items-center justify-center w-6 h-6 rounded-md text-t3 hover:bg-hov hover:text-t1 transition-colors"
      onClick={() => onSave(msg)}
      aria-label="保存到 vault"
      title="保存到 vault"
    >
      <Send size={14} />
    </button>
  );
}

function MultiSelectTriggerButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="inline-flex items-center justify-center w-6 h-6 rounded-md text-t3 hover:bg-hov hover:text-t1 transition-colors"
      onClick={onClick}
      aria-label="多选"
      title="多选"
    >
      <ListTodo size={14} />
    </button>
  );
}

function SelectToggleButton({
  msg,
  selected,
  onToggle,
}: {
  msg: CliMessage;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className="inline-flex items-center justify-center w-6 h-6 rounded-md text-t3 hover:bg-hov hover:text-t1 transition-colors"
      onClick={() => onToggle(msg.id)}
      aria-label={selected ? '取消选中' : '选中'}
      aria-pressed={selected}
      title={selected ? '取消选中' : '选中'}
    >
      {selected ? (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2" width="12" height="12" rx="2" />
          <path d="M5 8.5l2 2L11 6" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2" width="12" height="12" rx="2" />
        </svg>
      )}
    </button>
  );
}

function MultiSelectToolbar({
  count,
  onCopy,
  onSave,
  onClose,
}: {
  count: number;
  onCopy: () => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const btn = 'inline-flex items-center justify-center w-7 h-7 rounded-md text-t3 hover:bg-hov hover:text-t1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  return (
    <div className="self-center mt-1 mb-1 inline-flex items-center justify-between gap-2 py-1 px-2 border border-brd rounded-md bg-surf">
      <span className="text-[11px] text-t2 whitespace-nowrap">已选 {count} 条</span>
      <div className="flex gap-0.5">
        <button type="button" className={btn} onClick={onCopy} disabled={count === 0} aria-label="复制已选" title="复制已选">
          <Copy size={14} />
        </button>
        <button type="button" className={btn} onClick={onSave} disabled={count === 0} aria-label="保存已选" title="保存已选">
          <Send size={14} />
        </button>
        <button type="button" className={btn} onClick={onClose} aria-label="退出多选" title="退出多选">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

function AttachmentsRow({ msg }: { msg: CliMessage }) {
  if (!msg.attachments || msg.attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mb-1.5">
      {msg.attachments.map((att, i) => (
        <div key={i} className="rounded overflow-hidden">
          {att.type === 'image' ? (
            // Prefer the on-disk path: previewUrl is a blob URL that dies
            // with the page, so a persisted session must re-render the image
            // from the saved file (FileImage). previewUrl remains the
            // fallback for transient/legacy attachments without a path.
            att.path ? (
              <FileImage className="max-w-[120px] max-h-[80px] object-cover rounded border border-brd" path={att.path} alt={att.name} />
            ) : att.previewUrl ? (
              <ZoomableImage className="max-w-[120px] max-h-[80px] object-cover rounded border border-brd" src={att.previewUrl} alt={att.name} />
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
  onSaveToFile,
  showSaveImageButton,
  onPathClick,
  resolvePath,
  renderPairTag,
  multiSelectMode,
  onEnterMultiSelect,
  selectedIds,
  onToggleSelect,
}: {
  msg: CliMessage;
  isLast: boolean;
  streaming: boolean;
  plaintext?: boolean;
  showCopy?: boolean;
  onCopy?: (msg: CliMessage) => void;
  streamingIndicator: 'dots' | 'cursor' | 'none';
  onSaveToWiki?: (msg: CliMessage) => void;
  onSaveToFile?: (msg: CliMessage) => void;
  showSaveImageButton?: boolean;
  onPathClick?: (path: string, line?: number, col?: number) => void;
  resolvePath?: (raw: string) => Promise<boolean>;
  renderPairTag?: (msg: CliMessage) => ReactNode | null;
  multiSelectMode?: boolean;
  onEnterMultiSelect?: () => void;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
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
    const userSelected = selectedIds?.has(msg.id) ?? false;
    return (
      <div className="chat-msg-row justify-end">
        <div className="chat-msg-bubble chat-msg-bubble-user">
          <AttachmentsRow msg={msg} />
          <div className="chat-msg-user-text">{msg.content}</div>
          {msg.timestamp ? (
            <div className="chat-msg-user-meta">{formatTimestamp(msg.timestamp)}</div>
          ) : null}
        </div>
        {multiSelectMode && onToggleSelect && (
          <SelectToggleButton msg={msg} selected={userSelected} onToggle={onToggleSelect} />
        )}
      </div>
    );
  }

  // ── Assistant bubble: flat soft card; pair tag sits OUTSIDE the bubble
  //    as a small meta line above it; copy / wiki actions on hover. ──
  const hasActions = Boolean(msg.content) && (showCopy || onSaveToWiki || onSaveToFile || onEnterMultiSelect);
  const selected = selectedIds?.has(msg.id) ?? false;
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
              onPathClick={onPathClick}
              resolvePath={resolvePath}
            />
          ) : null}
          {showCursor && <span className="cursor-blink">▎</span>}
        </div>

        {hasActions && (
          <div className="chat-msg-actions">
            {msg.content && onEnterMultiSelect && !multiSelectMode && (
              <MultiSelectTriggerButton onClick={onEnterMultiSelect} />
            )}
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
            {msg.content && onSaveToFile && <SaveButton msg={msg} onSave={onSaveToFile} />}
          </div>
        )}
        </div>
      </div>
      {multiSelectMode && onToggleSelect && (
        <SelectToggleButton msg={msg} selected={selected} onToggle={onToggleSelect} />
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
  onSaveToFile,
  showSaveImageButton,
  onPathClick,
  resolvePath,
  renderPairTag,
  multiSelectMode,
  onEnterMultiSelect,
  onExitMultiSelect,
  selectedIds,
  onToggleSelect,
  onBatchCopy,
  onBatchSave,
  className,
}: ChatMessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // True while the view is pinned to the bottom (auto-follow streaming). The
  // user scrolling up flips it off so auto-scroll never yanks them back.
  const pinnedRef = useRef(true);
  const prevLenRef = useRef(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // A length increase means a NEW message was appended (user sent / session
    // opened) — always follow it, even if the user had scrolled up to read
    // history. Streaming tokens grow the LAST message in place (length
    // unchanged) — only follow while pinned, so the user can scroll up freely.
    if (messages.length > prevLenRef.current) {
      pinnedRef.current = true;
    }
    prevLenRef.current = messages.length;
    if (!pinnedRef.current) return;
    // Direct scrollTop instead of scrollIntoView({ behavior: 'smooth' }):
    // the smooth scroll was re-triggered on EVERY token, restarting the
    // animation each time → the viewport jittered/flickered while streaming.
    // Instant pinning is stable, and it scrolls only THIS container instead
    // of every scrollable ancestor that scrollIntoView would also nudge.
    el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedRef.current = distance < 60;
  }, []);

  const showListDots = streaming && streamingIndicator === 'dots';

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className={`flex flex-col gap-2 flex-1 min-h-0 overflow-y-auto chat-msg-scroll ${className ?? ''}`}
      role="log"
      aria-live="polite"
    >
      {messages.length === 0 && (emptyState ?? <DefaultEmptyHint />)}

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
            onSaveToFile={onSaveToFile}
            showSaveImageButton={showSaveImageButton}
            onPathClick={onPathClick}
            resolvePath={resolvePath}
            renderPairTag={renderPairTag}
            multiSelectMode={multiSelectMode}
            onEnterMultiSelect={onEnterMultiSelect}
            selectedIds={selectedIds}
            onToggleSelect={onToggleSelect}
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

      {onClear && messages.length > 0 && !multiSelectMode && (
        <button
          type="button"
          className="self-center mt-1 mb-1 py-1 px-3.5 text-[11px] text-t3 border border-brd rounded-full bg-transparent hover:bg-hov hover:text-t1 hover:border-brd2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          onClick={onClear}
          disabled={streaming}
        >
          清空对话
        </button>
      )}

      {multiSelectMode && onExitMultiSelect && (
        <MultiSelectToolbar
          count={selectedIds?.size ?? 0}
          onCopy={() => onBatchCopy?.()}
          onSave={() => onBatchSave?.()}
          onClose={onExitMultiSelect}
        />
      )}
    </div>
  );
}
