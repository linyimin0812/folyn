// Conflict prompt for the paste-external-files-into-vault flow. When the user
// pastes a file whose name already exists at the picked target folder, this
// modal asks: Overwrite / Skip / Rename, with an "Apply to all" checkbox for
// multi-file batches. Mirrors the ImagePasteDialog overlay style.
//
// See task 08-30-paste-external-files-with-folder-picker.

import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

export type ConflictChoice = 'overwrite' | 'skip' | 'rename';

export interface ConflictResolution {
  choice: ConflictChoice;
  applyToAll: boolean;
}

interface PasteConflictDialogProps {
  visible: boolean;
  fileName: string;
  remaining: number;
  onResolve: (resolution: ConflictResolution) => void;
}

export function PasteConflictDialog({
  visible,
  fileName,
  remaining,
  onResolve,
}: PasteConflictDialogProps) {
  const { t } = useTranslation();
  const [applyToAll, setApplyToAll] = useState(false);
  const renameBtnRef = useRef<HTMLButtonElement>(null);

  // ponytail: default Apply-to-all off each time the dialog opens for a new
  // file; the user re-affirms per batch. Reset on visibility change.
  useEffect(() => {
    if (visible) setApplyToAll(false);
  }, [visible, fileName]);

  // Focus the safest choice (Rename) on open so Enter doesn't clobber.
  useEffect(() => {
    if (visible) setTimeout(() => renameBtnRef.current?.focus(), 30);
  }, [visible]);

  const resolve = useCallback(
    (choice: ConflictChoice) => {
      onResolve({ choice, applyToAll });
    },
    [applyToAll, onResolve],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onResolve({ choice: 'skip', applyToAll });
      }
    },
    [onResolve],
  );

  if (!visible) return null;

  return (
    <div
      className="img-paste-overlay fixed inset-0 z-[10000] bg-black/45 flex items-center justify-center animate-[fadeIn_.15s]"
      onKeyDown={handleKeyDown}
    >
      <div className="bg-panel border border-brd2 rounded-xl shadow-[0_16px_48px_rgba(0,0,0,.2)] w-[440px] max-w-[92vw] animate-[slideUp_.2s] overflow-hidden">
        <div className="flex items-center justify-between py-3.5 px-[18px] border-b border-brd font-semibold text-sm">
          <span>{t('editor:filePaste.conflictTitle')}</span>
        </div>

        <div className="py-4 px-[18px]">
          <div className="text-sm text-t2 mb-1">{t('editor:filePaste.conflictMessage')}</div>
          <div className="font-mono text-[13px] text-t1 bg-surf rounded-md px-2.5 py-1.5 border border-brd2 break-all">
            {fileName}
          </div>
          {remaining > 0 && (
            <label className="flex items-center gap-2 mt-3 text-xs text-t3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={applyToAll}
                onChange={(e) => setApplyToAll(e.target.checked)}
                className="cursor-pointer"
              />
              {t('editor:filePaste.applyToAll', { count: remaining })}
            </label>
          )}
        </div>

        <div className="flex justify-end gap-2 py-3 px-[18px] border-t border-brd">
          <button
            className="py-[7px] px-[14px] rounded-md text-[13px] font-medium cursor-pointer border border-brd2 bg-surf2 text-t2 hover:bg-brd"
            onClick={() => resolve('skip')}
          >
            {t('editor:filePaste.skip')}
          </button>
          <button
            ref={renameBtnRef}
            className="py-[7px] px-[14px] rounded-md text-[13px] font-medium cursor-pointer border border-brd2 bg-surf text-t1 hover:bg-hov"
            onClick={() => resolve('rename')}
          >
            {t('editor:filePaste.rename')}
          </button>
          <button
            className="py-[7px] px-[14px] rounded-md text-[13px] font-medium cursor-pointer border-none bg-acc text-white hover:brightness-110"
            onClick={() => resolve('overwrite')}
          >
            {t('editor:filePaste.overwrite')}
          </button>
        </div>
      </div>
    </div>
  );
}
