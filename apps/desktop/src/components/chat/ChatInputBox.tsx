import { useCallback, useRef, type ReactNode, type Ref } from 'react';
import { useTranslation } from 'react-i18next';

export interface ChatInputBoxProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  streaming: boolean;
  onStop?: () => void;
  onClear?: () => void;
  disabled?: boolean;
  /** Override the send-button enable check. When omitted, the button is
   *  enabled iff `value.trim().length > 0`. AiPanel passes
   *  `input.trim() || attachments.length > 0` so attachments alone can send;
   *  the pet path omits it (text-only). */
  canSend?: boolean;
  placeholder?: string;
  textareaRows?: number;
  inputAriaLabel?: string;
  onPaste?: React.ClipboardEventHandler<HTMLTextAreaElement>;
  /** External ref to the underlying <textarea>. AiPanel's ChatInput uses it
   *  for @-mention cursor positioning and pendingPrompt focus-end. Omitted on
   *  the pet path. */
  inputRef?: Ref<HTMLTextAreaElement>;
  /** Return `true` to skip the default Enter-to-send handling (e.g. when a
   *  @-mention popup is open and Enter selects an item instead). The caller
   *  is responsible for calling `preventDefault` itself in that case. */
  onBeforeKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
  /** Rendered left of the textarea (file-picker button + input-mode
   *  dropdown in AiPanel). Omit for the minimal pet path. */
  leadingSlot?: ReactNode;
  /** Rendered above the textarea (pending attachments row in AiPanel). */
  attachmentsRow?: ReactNode;
  /** Absolutely-positioned overlay inside the bordered box (for the
   *  @-mention popup and the input-mode menu). Omit for the minimal pet
   *  path. */
  overlayLayer?: ReactNode;
  /** Rendered in the action row to the right (after the flex spacer). The
   *  send/stop toggle is ALWAYS owned by the base component — do not put it
   *  here. Use this for extra trailing actions. */
  trailingSlot?: ReactNode;
  className?: string;
}

export function ChatInputBox({
  value,
  onChange,
  onSend,
  streaming,
  onStop,
  onClear,
  disabled,
  canSend,
  placeholder,
  textareaRows,
  inputAriaLabel,
  onPaste,
  inputRef,
  onBeforeKeyDown,
  leadingSlot,
  attachmentsRow,
  overlayLayer,
  trailingSlot,
  className,
}: ChatInputBoxProps) {
  const { t } = useTranslation();
  const internalRef = useRef<HTMLTextAreaElement | null>(null);
  // Merge the internal ref (unused for reads today, kept for future use)
  // with the caller-provided `inputRef` so AiPanel's ChatInput can drive
  // @-mention cursor positioning + pendingPrompt focus-end on the same
  // <textarea> the base component owns.
  const setTextareaRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      internalRef.current = el;
      if (typeof inputRef === 'function') {
        inputRef(el);
      } else if (inputRef) {
        (inputRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
      }
    },
    [inputRef],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (onBeforeKeyDown && onBeforeKeyDown(e)) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onSend();
      }
    },
    [onBeforeKeyDown, onSend],
  );

  const isDisabled = streaming || disabled;
  const canSendNow = !isDisabled && (canSend ?? value.trim().length > 0);

  return (
    <div className={`flex flex-col py-2.5 px-3 border-t border-brd shrink-0 ${className ?? ''}`}>
      {attachmentsRow}

      <div
        className="flex flex-col border border-brd rounded-xl bg-inp transition-[border-color,box-shadow] duration-150 focus-within:border-acc focus-within:shadow-[0_0_0_3px_var(--accglow)]"
        style={{ position: 'relative' }}
      >
        {overlayLayer}

        <textarea
          ref={setTextareaRef}
          className="flex-1 resize-none border-none rounded-t-xl pt-2.5 px-3 pb-1 text-[12px] font-ui bg-transparent text-t1 outline-none placeholder:text-t3"
          placeholder={placeholder ?? t('ai:chat.placeholderFallback')}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={onPaste}
          rows={textareaRows ?? 2}
          disabled={isDisabled}
          aria-label={inputAriaLabel ?? 'chat input'}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />

        <div className="flex items-center gap-1 py-1 px-1.5 pb-2">
          {leadingSlot}
          <div className="flex-1" />
          {trailingSlot}
          {onClear && (
            <button
              type="button"
              className="h-7 px-2 flex items-center justify-center rounded-md text-[11px] text-t3 cursor-pointer transition-all duration-[120ms] bg-transparent border-none hover:bg-hov hover:text-t1 disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={onClear}
              disabled={streaming}
              title={t('ai:chat.clearTitle')}
            >
              {t('ai:chat.clear')}
            </button>
          )}
          {streaming && onStop ? (
            <button
              type="button"
              className="chat-stop-btn"
              onClick={onStop}
              title={t('ai:chat.stop')}
              aria-label={t('ai:chat.stop')}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2.5" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              className="chat-send-btn"
              onClick={onSend}
              disabled={!canSendNow}
              title={t('ai:chat.send')}
              aria-label={t('ai:chat.send')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
