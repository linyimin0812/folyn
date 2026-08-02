import { useTranslation } from 'react-i18next';
import { DiffModeEnum } from '@git-diff-view/react';
import { useDiffReviewStore } from '@/store/diffReviewStore';

interface DiffToolbarProps {
  hunkCount: number;
  pendingCount: number;
  mode: DiffModeEnum;
  onModeChange: (mode: DiffModeEnum) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}

export function DiffToolbar({ hunkCount, pendingCount, mode, onModeChange, onAcceptAll, onRejectAll }: DiffToolbarProps) {
  const { t } = useTranslation();
  const diffReviewMode = useDiffReviewStore((s) => s.diffReviewMode);

  if (!diffReviewMode) return null;

  const isSplit = mode === DiffModeEnum.Split || mode === DiffModeEnum.SplitGitHub || mode === DiffModeEnum.SplitGitLab;

  return (
    <div className="diff-toolbar flex items-center justify-between py-2 px-4 bg-surf border-b border-brd gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-[13px] text-t2 whitespace-nowrap">
          {t('editor:diffToolbar.pendingCount', { count: pendingCount })}
        </span>
        <span className="text-[11px] text-t3 whitespace-nowrap">
          {t('editor:diffToolbar.hunkTotal', { count: hunkCount })}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex border border-brd rounded overflow-hidden">
          <button
            className={`py-1 px-2.5 text-xs cursor-pointer border-none ${isSplit ? 'bg-acc text-white' : 'bg-surf text-t2 hover:bg-acc/10'}`}
            onClick={() => onModeChange(DiffModeEnum.Split)}
            title={t('editor:diffToolbar.splitHint')}
          >
            {t('editor:diffToolbar.split')}
          </button>
          <button
            className={`py-1 px-2.5 text-xs cursor-pointer border-none ${!isSplit ? 'bg-acc text-white' : 'bg-surf text-t2 hover:bg-acc/10'}`}
            onClick={() => onModeChange(DiffModeEnum.Unified)}
            title={t('editor:diffToolbar.unifiedHint')}
          >
            {t('editor:diffToolbar.unified')}
          </button>
        </div>
        <button
          className="py-1 px-3 rounded border-none text-xs cursor-pointer bg-[#22c55e] text-white hover:bg-[#16a34a] disabled:opacity-50"
          onClick={onAcceptAll}
          disabled={hunkCount === 0}
        >
          {t('editor:diffToolbar.acceptAll')}
        </button>
        <button
          className="py-1 px-3 rounded border-none text-xs cursor-pointer bg-[#ef4444] text-white hover:bg-[#dc2626] disabled:opacity-50"
          onClick={onRejectAll}
          disabled={hunkCount === 0}
        >
          {t('editor:diffToolbar.rejectAll')}
        </button>
      </div>
    </div>
  );
}
