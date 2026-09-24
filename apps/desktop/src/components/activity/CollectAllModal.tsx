/**
 * 「采集」run modal — one row per enabled collector with live progress
 * (collectProgress from the store) and the final ok/failed result. The run
 * itself is component-local state in ActivityPage; closing the modal only
 * hides it (the run continues in the background).
 */

import { useTranslation } from 'react-i18next';
import { Check, Loader2, TriangleAlert, X } from 'lucide-react';
import { useActivityCollectorStore } from '@/store/activityCollectorStore';

export interface CollectAllRun {
  running: boolean;
  results: Record<
    string,
    { status: 'running' | 'ok' | 'failed'; accepted?: number; deduped?: number }
  >;
}

export function CollectAllModal({ run, onClose }: { run: CollectAllRun; onClose: () => void }) {
  const { t } = useTranslation();
  const progress = useActivityCollectorStore((s) => s.collectProgress);
  const totalAccepted = Object.values(run.results).reduce(
    (n, r) => n + (r.status === 'ok' ? (r.accepted ?? 0) : 0),
    0,
  );

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-panel border border-brd rounded-lg p-4 max-w-md w-[90vw] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="text-[length:calc(var(--ui-font-size)+1px)] font-bold text-t1">
            {t('activity:collectAll.title')}
          </div>
          <button
            type="button"
            className="flex size-6 shrink-0 items-center justify-center rounded text-t3 hover:text-t1 hover:bg-hov cursor-pointer"
            aria-label={t('common:common.close')}
            onClick={onClose}
          >
            <X size={13} />
          </button>
        </div>

        {Object.keys(run.results).length === 0 ? (
          <div className="text-[length:calc(var(--ui-font-size)-2px)] text-t3 mb-1">
            {t('activity:collectAll.none')}
          </div>
        ) : (
          <div className="space-y-1.5 mb-3">
            {Object.entries(run.results).map(([id, r]) => (
              <div key={id} className="flex items-center justify-between gap-2 min-w-0">
                <span className="text-[11px] font-mono text-t2 truncate">{id}</span>
                <span className="flex items-center gap-1.5 text-[11px] text-t2 shrink-0 min-w-0">
                  {r.status === 'running' && (
                    <>
                      <Loader2 size={12} className="animate-spin shrink-0" />
                      <span className="truncate">
                        {progress[id]
                          ? `${t('activity:collectors.collecting')} ${progress[id]}`
                          : t('activity:collectors.collecting')}
                      </span>
                    </>
                  )}
                  {r.status === 'ok' && (
                    <>
                      <Check size={12} className="text-acc shrink-0" />
                      <span>
                        {t('activity:collectors.collectResult', {
                          accepted: r.accepted ?? 0,
                          deduped: r.deduped ?? 0,
                        })}
                      </span>
                    </>
                  )}
                  {r.status === 'failed' && (
                    <>
                      <TriangleAlert size={12} className="text-amber-700 dark:text-amber-400 shrink-0" />
                      <span className="text-amber-700 dark:text-amber-400">
                        {t('activity:collectors.collectFailed')}
                      </span>
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="text-[11px] text-t3 border-t border-brd pt-2">
          {run.running
            ? t('activity:collectAll.running')
            : t('activity:collectAll.done', { count: totalAccepted })}
        </div>
      </div>
    </div>
  );
}
