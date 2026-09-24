/**
 * Metric card grid (design §3.3/§7.1): builtin 6 default pinned,
 * collector-declared cards default collapsed into 「更多指标 · N」. Pin state
 * persists by metric id via activityCollectorStore (override map — the
 * pure semantics live in display.ts).
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, ChevronUp, Pin } from 'lucide-react';
import { type MetricCard, effectivePinned, togglePinOverride } from './display';
import { useActivityCollectorStore } from '@/store/activityCollectorStore';

interface MetricsGridProps {
  cards: MetricCard[];
  /** Selecting a card filters the timeline to that event type; null clears. */
  selectedType?: string | null;
  onSelectType?: (t: string | null) => void;
}

export function MetricsGrid({ cards, selectedType, onSelectType }: MetricsGridProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [summaryCollapsed, setSummaryCollapsed] = useState(false);
  const pinnedMetrics = useActivityCollectorStore((s) => s.pinnedMetrics);
  const setPinnedMetrics = useActivityCollectorStore((s) => s.setPinnedMetrics);

  const pinned = cards.filter((c) => effectivePinned(c, pinnedMetrics));
  const unpinned = cards.filter((c) => !effectivePinned(c, pinnedMetrics));
  // ponytail: two full rows of the 6-col grid; pinned never collapse, extra pinned just wrap
  const MAX_VISIBLE = 12;
  const unpinnedVisible = unpinned.slice(0, Math.max(0, MAX_VISIBLE - pinned.length));
  const collapsed = unpinned.slice(unpinnedVisible.length);

  const renderCard = (c: MetricCard) => {
    const isPinned = effectivePinned(c, pinnedMetrics);
    const selected = selectedType != null && selectedType === c.type;
    return (
      <div
        key={c.id}
        className={`relative bg-panel border rounded-lg p-4 min-w-[130px] ${
          selected ? 'border-transparent ring-1 ring-[var(--acc, #6366f1)]' : 'border-brd'
        } ${onSelectType ? 'cursor-pointer hover:bg-hov' : ''}`}
        onClick={() => onSelectType?.(selected ? null : c.type)}
      >
        <button
          className="absolute top-2 right-2 p-0.5 border-0 bg-transparent cursor-pointer leading-none"
          style={{ color: isPinned ? 'var(--acc, #6366f1)' : 'var(--t3)' }}
          title={isPinned ? t('activity:metric.unpin') : t('activity:metric.pin')}
          onClick={(e) => {
            e.stopPropagation();
            setPinnedMetrics(togglePinOverride(c, pinnedMetrics));
          }}
        >
          <Pin size={12} />
        </button>
        <p className="m-0 mb-1.5 text-[12px] text-t3 pr-5 truncate">{c.label}</p>
        <p className="m-0 text-[22px] font-semibold text-t1 leading-tight">{c.value}</p>
      </div>
    );
  };

  if (cards.length === 0) return null;

  return (
    <div className="mb-6">
      <button
        className="m-0 mb-3 text-[13px] font-semibold text-t2 bg-transparent border-0 p-0 cursor-pointer flex items-center gap-1"
        aria-label={t('activity:metric.title')}
        onClick={() => setSummaryCollapsed(!summaryCollapsed)}
      >
        {summaryCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        {t('activity:metric.title')}
      </button>
      {/* ponytail: CSS grid-rows collapse — Safari 16+/Chrome 107+ (WKWebView fine); fall back to conditional unmount if an old WKWebView ever needs it */}
      <div
        className={`grid [transition-property:grid-template-rows] duration-200 ease-out ${
          summaryCollapsed ? '[grid-template-rows:0fr]' : '[grid-template-rows:1fr]'
        }`}
      >
        <div className="overflow-hidden min-h-0">
          <div className="grid grid-cols-[repeat(6,minmax(130px,1fr))] gap-3">
            {pinned.map(renderCard)}
            {unpinnedVisible.map(renderCard)}
            {collapsed.length > 0 && (
              <div className="col-span-full">
                <button
                  className="btn btn-g btn-sm inline-flex items-center gap-1.5"
                  onClick={() => setExpanded(!expanded)}
                >
                  {t('activity:metric.more', { count: collapsed.length })}
                  {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>
                {expanded && (
                  <div className="grid grid-cols-[repeat(6,minmax(130px,1fr))] gap-3 mt-3">
                    {collapsed.map(renderCard)}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
