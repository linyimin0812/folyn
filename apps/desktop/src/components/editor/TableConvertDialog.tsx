// Confirmation prompt for the smart paste → table detection flow. When the
// clipboard's plain text is detected as a Markdown/TSV table, this modal
// asks: convert to a table, or paste as plain text. Mirrors the overlay
// style of PasteConflictDialog / ImagePasteDialog.

import { useCallback, useRef, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface TableConvertChoice {
  /** Convert the detected table (to a native tiptap table, or markdown source). */
  convert: boolean;
  /** When true, remember the choice so the dialog is not shown again. */
  remember: boolean;
}

interface TableConvertDialogProps {
  visible: boolean;
  /** Human-readable summary, e.g. "3 columns × 4 rows". */
  summary: string;
  onResolve: (choice: TableConvertChoice) => void;
}

export function TableConvertDialog({
  visible,
  summary,
  onResolve,
}: TableConvertDialogProps) {
  const { t } = useTranslation();
  const [remember, setRemember] = useState(false);
  const convertBtnRef = useRef<HTMLButtonElement>(null);

  // Reset the checkbox each time the dialog opens for a fresh paste.
  useEffect(() => {
    if (visible) setRemember(false);
  }, [visible]);

  // Focus the primary (convert) action on open so Enter converts.
  useEffect(() => {
    if (visible) setTimeout(() => convertBtnRef.current?.focus(), 30);
  }, [visible]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onResolve({ convert: false, remember });
      }
    },
    [onResolve, remember],
  );

  const resolve = useCallback(
    (convert: boolean) => {
      onResolve({ convert, remember });
    },
    [onResolve, remember],
  );

  if (!visible) return null;

  return (
    <div
      className="img-paste-overlay fixed inset-0 z-[10000] bg-black/45 flex items-center justify-center animate-[fadeIn_.15s]"
      onKeyDown={handleKeyDown}
    >
      <div className="bg-panel border border-brd2 rounded-xl shadow-[0_16px_48px_rgba(0,0,0,.2)] w-[440px] max-w-[92vw] animate-[slideUp_.2s] overflow-hidden">
        <div className="flex items-center justify-between py-3.5 px-[18px] border-b border-brd font-semibold text-sm">
          <span>{t('editor:table.convertTitle')}</span>
        </div>

        <div className="py-4 px-[18px]">
          <div className="text-sm text-t2 mb-1">{t('editor:table.convertMessage')}</div>
          <div className="font-mono text-[13px] text-t1 bg-surf rounded-md px-2.5 py-1.5 border border-brd2 break-all">
            {summary}
          </div>
          <label className="flex items-center gap-2 mt-3 text-xs text-t3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="cursor-pointer"
            />
            {t('editor:table.rememberChoice')}
          </label>
        </div>

        <div className="flex justify-end gap-2 py-3 px-[18px] border-t border-brd">
          <button
            className="py-[7px] px-[14px] rounded-md text-[13px] font-medium cursor-pointer border border-brd2 bg-surf2 text-t2 hover:bg-brd"
            onClick={() => resolve(false)}
          >
            {t('editor:table.pasteAsText')}
          </button>
          <button
            ref={convertBtnRef}
            className="py-[7px] px-[14px] rounded-md text-[13px] font-medium cursor-pointer border-none bg-acc text-white hover:brightness-110"
            onClick={() => resolve(true)}
          >
            {t('editor:table.convert')}
          </button>
        </div>
      </div>
    </div>
  );
}
