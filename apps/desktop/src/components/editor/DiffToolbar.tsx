import { useEditorStore } from '@/store/editorStore';

interface DiffToolbarProps {
  hunkCount: number;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}

export function DiffToolbar({ hunkCount, onAcceptAll, onRejectAll }: DiffToolbarProps) {
  const diffReviewMode = useEditorStore((s) => s.diffReviewMode);

  if (!diffReviewMode) return null;

  return (
    <div className="diff-toolbar">
      <span className="diff-toolbar-info">
        {hunkCount} 处变更待审阅
      </span>
      <div className="diff-toolbar-actions">
        <button className="diff-toolbar-btn accept" onClick={onAcceptAll}>
          全部接受
        </button>
        <button className="diff-toolbar-btn reject" onClick={onRejectAll}>
          全部拒绝
        </button>
      </div>
    </div>
  );
}
