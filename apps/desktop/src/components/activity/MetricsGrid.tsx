/**
 * Metric card grid (design §3.3/§7.1): builtin 6 default pinned,
 * collector-declared cards default collapsed into 「更多指标 · N」. Pin state
 * persists by metric id via activityCollectorStore (override map — the
 * pure semantics live in display.ts).
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Pin } from 'lucide-react';
import { type MetricCard, effectivePinned, togglePinOverride } from './display';
import { useActivityCollectorStore } from '@/store/activityCollectorStore';

interface MetricsGridProps {
  cards: MetricCard[];
}

export function MetricsGrid({ cards }: MetricsGridProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const pinnedMetrics = useActivityCollectorStore((s) => s.pinnedMetrics);
  const setPinnedMetrics = useActivityCollectorStore((s) => s.setPinnedMetrics);

  const pinned = cards.filter((c) => effectivePinned(c, pinnedMetrics));
  const rest = cards.filter((c) => !effectivePinned(c, pinnedMetrics));

  const renderCard = (c: MetricCard) => {
    const isPinned = effectivePinned(c, pinnedMetrics);
    return (
      <div key={c.id} className="relative bg-surf2 border border-brd2 rounded-lg p-3.5 min-w-[120px]">
        <button
          className="absolute top-1.5 right-1.5 p-0.5 border-0 bg-transparent cursor-pointer leading-none"
          style={{ color: isPinned ? 'var(--acc, #6366f1)' : 'var(--t3)' }}
          title={isPinned ? t('activity:metric.unpin') : t('activity:metric.pin')}
          onClick={() => setPinnedMetrics(togglePinOverride(c, pinnedMetrics))}
        >
          <Pin size={12} style={{ transform: isPinned ? 'rotate(35deg)' : 'none' }} />
        </button>
        <p className="m-0 mb-1 text-[12px] text-t2 pr-5 truncate">{c.label}</p>
        <p className="m-0 text-[20px] font-medium text-t1">{c.value}</p>
      </div>
    );
  };

  if (cards.length === 0) return null;

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-4 mb-6">
      {pinned.map(renderCard)}
      {rest.length > 0 && (
        <div className="col-span-full">
          <button
            className="btn btn-g btn-sm inline-flex items-center gap-1.5"
            onClick={() => setExpanded(!expanded)}
          >
            {t('activity:metric.more', { count: rest.length })}
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          {expanded && (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-4 mt-4">
              {rest.map(renderCard)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
