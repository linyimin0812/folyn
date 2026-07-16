import { useDiffReviewStore } from '@/store/diffReviewStore';

interface DiffToolbarProps {
  hunkCount: number;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}

export function DiffToolbar({ hunkCount, onAcceptAll, onRejectAll }: DiffToolbarProps) {
  const diffReviewMode = useDiffReviewStore((s) => s.diffReviewMode);

  if (!diffReviewMode) return null;

  return (
    <div className="diff-toolbar flex items-center justify-between py-2 px-4 bg-surf border-b border-brd">
      <span className="text-[13px] text-t2">
        {hunkCount} 处变更待审阅
      </span>
      <div className="flex gap-2">
        <button className="py-1 px-3 rounded border-none text-xs cursor-pointer bg-[#22c55e] text-white hover:bg-[#16a34a]" onClick={onAcceptAll}>
          全部接受
        </button>
        <button className="py-1 px-3 rounded border-none text-xs cursor-pointer bg-[#ef4444] text-white hover:bg-[#dc2626]" onClick={onRejectAll}>
          全部拒绝
        </button>
      </div>
    </div>
  );
}
