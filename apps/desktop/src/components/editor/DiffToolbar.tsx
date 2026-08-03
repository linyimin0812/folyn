import { useTranslation } from 'react-i18next';
import { useDiffReviewStore } from '@/store/diffReviewStore';

interface DiffToolbarProps {
  hunkCount: number;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}

export function DiffToolbar({ hunkCount, onAcceptAll, onRejectAll }: DiffToolbarProps) {
  const { t } = useTranslation();
  const diffReviewMode = useDiffReviewStore((s) => s.diffReviewMode);

  if (!diffReviewMode) return null;

  return (
    <div className="diff-toolbar flex items-center justify-between py-2 px-4 bg-surf border-b border-brd">
      <span className="text-[13px] text-t2">
        {t('editor:diffToolbar.pendingCount', { count: hunkCount })}
      </span>
      <div className="flex gap-2">
        <button className="py-1 px-3 rounded border-none text-xs cursor-pointer bg-[#22c55e] text-white hover:bg-[#16a34a]" onClick={onAcceptAll}>
          {t('editor:diffToolbar.acceptAll')}
        </button>
        <button className="py-1 px-3 rounded border-none text-xs cursor-pointer bg-[#ef4444] text-white hover:bg-[#dc2626]" onClick={onRejectAll}>
          {t('editor:diffToolbar.rejectAll')}
        </button>
      </div>
    </div>
  );
}
