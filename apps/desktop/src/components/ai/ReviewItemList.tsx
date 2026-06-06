import { useWikiStore } from '@/store/wikiStore';

const TYPE_ICONS: Record<string, string> = {
  contradiction: '⚠',
  low_confidence: 'ℹ',
  merge_suggestion: '🔗',
  structure_change: '📋',
  stale_content: '🕐',
};

const TYPE_LABELS: Record<string, string> = {
  contradiction: '矛盾',
  low_confidence: '低确信',
  merge_suggestion: '合并建议',
  structure_change: '结构变更',
  stale_content: '过时内容',
};

export function ReviewItemList() {
  const reviewItems = useWikiStore((s) => s.reviewItems);
  const resolveReviewItem = useWikiStore((s) => s.resolveReviewItem);
  const dismissReviewItem = useWikiStore((s) => s.dismissReviewItem);

  const pending = reviewItems.filter((r) => r.status === 'pending');

  if (pending.length === 0) return null;

  return (
    <div className="review-list">
      <div className="review-list-header">
        待审核 ({pending.length})
      </div>
      {pending.map((item) => (
        <div key={item.id} className="review-item">
          <div className="review-item-header">
            <span className="review-item-icon">{TYPE_ICONS[item.type] || '📋'}</span>
            <span className="review-item-type">{TYPE_LABELS[item.type] || item.type}</span>
            <span className="review-item-title">{item.title}</span>
          </div>
          <div className="review-item-desc">{item.description}</div>
          <div className="review-item-actions">
            {item.suggestedActions.map((action, i) => (
              <button
                key={i}
                className={`review-item-btn ${action.type}`}
                onClick={() => {
                  if (action.type === 'reject') {
                    dismissReviewItem(item.id);
                  } else {
                    resolveReviewItem(item.id);
                  }
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
