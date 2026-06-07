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
    <div className="border-t border-brd p-0 shrink-0 max-h-[200px] overflow-y-auto">
      <div className="flex items-center gap-1.5 py-1.5 px-3 text-[12px] font-semibold text-t2 cursor-pointer select-none hover:bg-hov">
        待审核 ({pending.length})
      </div>
      {pending.map((item) => (
        <div key={item.id} className="py-1.5 px-3 border-b border-brd text-[12px] last:border-b-0">
          <div className="flex items-center gap-1.5 text-t2">
            <span>{TYPE_ICONS[item.type] || '📋'}</span>
            <span className="text-[11px] py-px px-[5px] rounded-[3px] bg-accdim text-acc font-medium">{TYPE_LABELS[item.type] || item.type}</span>
            <span className="font-medium">{item.title}</span>
          </div>
          <div className="mt-0.5 text-[11px] text-t3 truncate">{item.description}</div>
          <div className="flex gap-1 mt-1">
            {item.suggestedActions.map((action, i) => (
              <button
                key={i}
                className={`py-0.5 px-2 border border-brd rounded bg-transparent text-[11px] cursor-pointer hover:bg-hov hover:text-t1 ${action.type === 'reject' ? 'text-t3' : 'text-t2'}`}
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
