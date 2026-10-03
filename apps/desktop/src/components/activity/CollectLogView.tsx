/**
 * 采集记录 view: past collection runs (scheduled polls and manual collects)
 * recorded by runCollect into the activity db (`collect_runs` table). Each
 * row shows collector name, time, duration, accepted/deduped counts and an
 * expandable log section fed by the collector's onProgress messages.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, ScrollText } from 'lucide-react';
import { useActivityCollectorStore, type CollectRunRecord } from '@/store/activityCollectorStore';
import { listActivityCollectRuns } from '@/services/activity/api';

function RunRow({ run, expanded, onToggle }: {
  run: CollectRunRecord;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t, i18n } = useTranslation();
  const dateTimeFmt = new Intl.DateTimeFormat(i18n.language, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const seconds = Math.max(1, Math.round((run.finishedAt - run.startedAt) / 1000));
  return (
    <div className="border border-brd rounded-lg bg-panel overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-2.5 px-3.5 py-3 rounded-lg text-left cursor-pointer bg-transparent border-0 hover:bg-hov transition-colors"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <ChevronRight
          size={12}
          className={`text-t3 shrink-0 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
        />
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            run.outcome === 'ok' ? 'bg-green' : 'bg-amber'
          }`}
        />
        <span className="text-[13px] font-medium text-t1 truncate">{run.collectorName}</span>
        <span className="text-[12px] text-t3 shrink-0">
          {dateTimeFmt.format(new Date(run.startedAt))}
          {' · '}
          {t('activity:collectLog.duration', { time: `${seconds}s` })}
        </span>
        <span className="flex-1" />
        {run.outcome === 'ok' ? (
          <span className="flex items-center gap-1.5 shrink-0">
            <span className="cl-badge ok">
              {t('activity:collectLog.records', { count: run.accepted })}
            </span>
            {run.deduped > 0 && (
              <span className="cl-badge muted">
                {t('activity:collectLog.deduped', { count: run.deduped })}
              </span>
            )}
          </span>
        ) : (
          <span className="cl-badge none">{t('activity:collectLog.noResult')}</span>
        )}
      </button>
      <div
        className={`grid [transition-property:grid-template-rows] duration-200 ease-out ${
          expanded ? '[grid-template-rows:1fr]' : '[grid-template-rows:0fr]'
        }`}
      >
        <div className="overflow-hidden min-h-0">
          <div className="border-t border-brd">
            <div className="mx-3.5 my-3 rounded-md bg-surf2 border border-brd p-3">
            <p className="m-0 mb-1.5 text-[11px] font-semibold text-acc tracking-wide uppercase">
              {t('activity:collectLog.logs')}
            </p>
            {run.logs.length === 0 ? (
              <p className="m-0 text-[12px] text-t3">{t('activity:collectLog.emptyLogs')}</p>
            ) : (
              <ul className="m-0 pl-4 font-mono text-[11px] text-t2 leading-relaxed break-all">
                {run.logs.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CollectLogView() {
  const { t, i18n } = useTranslation();
  const history = useActivityCollectorStore((s) => s.collectHistory);
  const setCollectHistory = useActivityCollectorStore((s) => s.setCollectHistory);
  // True once the initial listActivityCollectRuns promise settles (store may
  // already hold runs from a same-session collect, which skips the skeleton).
  const [loaded, setLoaded] = useState(false);
  // Initial load from the activity db (also runs the one-time legacy
  // localStorage→db migration — see listActivityCollectRuns). Later runs
  // refresh the store from runCollect's finally.
  useEffect(() => {
    let cancelled = false;
    void listActivityCollectRuns()
      .then((runs) => {
        if (!cancelled) setCollectHistory(runs);
      })
      .catch((err) => console.error('[activity] collect history load failed:', err))
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [setCollectHistory]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Collapsed collector groups; empty = all groups expanded (default).
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // Groups expanded beyond the default 5 most-recent run records.
  const [showAllGroups, setShowAllGroups] = useState<Set<string>>(new Set());
  // Deselected collector ids (filter chips); empty = show all groups.
  const [deselected, setDeselected] = useState<Set<string>>(new Set());

  if (!loaded && history.length === 0) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="border border-brd rounded-lg bg-panel px-3.5 py-3 animate-pulse">
            <div className="h-3 w-1/4 rounded bg-hov" />
            <div className="h-2.5 w-2/5 rounded bg-hov mt-2.5" />
          </div>
        ))}
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="chat-empty bg-panel border border-brd rounded-lg">
        <span className="chat-empty-badge">
          <ScrollText size={18} />
        </span>
        <p className="m-0 text-[13px] text-t2 max-w-[360px]">
          {t('activity:collectLog.empty')}
        </p>
      </div>
    );
  }

  // Group by collector. History is reverse-chronological, so Map insertion
  // order gives newest-active-collector-first groups, first record carries the
  // display name, and pushes keep runs reverse-chronological.
  const groups = new Map<string, CollectRunRecord[]>();
  for (const r of history) {
    const g = groups.get(r.collectorId);
    if (g) g.push(r);
    else groups.set(r.collectorId, [r]);
  }

  const dateTimeFmt = new Intl.DateTimeFormat(i18n.language, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleGroup = (id: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleShowAll = (id: string) => {
    setShowAllGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleDeselected = (id: string) => {
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = deselected.size === 0;
  const toggleAll = () => {
    setDeselected(allSelected ? new Set(groups.keys()) : new Set());
  };

  const chipClass = (selected: boolean) =>
    `px-2 py-[3px] rounded-full text-[11.5px] cursor-pointer border-0 transition-colors ${
      selected ? 'bg-accdim text-acc font-semibold' : 'bg-hov text-t3'
    }`;

  const visibleGroups = [...groups.entries()].filter(([id]) => !deselected.has(id));

  return (
    <div className="flex flex-col gap-4 flex-1">
      {groups.size > 1 && (
        <div className="flex flex-wrap gap-1.5 pb-2.5 border-b border-brd">
          <button type="button" className={chipClass(allSelected)} onClick={toggleAll}>
            {t('activity:collectLog.all')}
          </button>
          {[...groups.entries()].map(([id, runs]) => (
            <button
              key={id}
              type="button"
              className={chipClass(!deselected.has(id))}
              onClick={() => toggleDeselected(id)}
            >
              {runs[0].collectorName}
            </button>
          ))}
        </div>
      )}
      {visibleGroups.length === 0 ? (
        <div className="chat-empty bg-panel border border-brd rounded-lg">
          <span className="chat-empty-badge">
            <ScrollText size={18} />
          </span>
          <p className="m-0 text-[13px] text-t2 max-w-[360px]">
            {t('activity:collectLog.noMatch')}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4 divide-y divide-brd">
        {visibleGroups.map(([id, runs]) => {
        const collapsed = collapsedGroups.has(id);
        const latest = runs[0];
        return (
          <div key={id}>
            <button
              className="w-full flex items-center gap-2 px-2 -mx-2 py-1.5 rounded-md cursor-pointer text-left bg-transparent border-0 hover:bg-hov transition-colors"
              onClick={() => toggleGroup(id)}
              aria-expanded={!collapsed}
            >
              <ChevronRight
                size={12}
                className={`text-t3 shrink-0 transition-transform duration-200 ${collapsed ? '' : 'rotate-90'}`}
              />
              <span className="text-[13px] font-semibold text-t1 truncate">
                {latest.collectorName}
              </span>
              <span className="cl-badge muted shrink-0">
                {t('activity:collectLog.runs', { count: runs.length })}
              </span>
              <span className="flex-1" />
              <span className="text-[11.5px] text-t3 shrink-0">
                {dateTimeFmt.format(new Date(latest.startedAt))}
              </span>
            </button>
            <div
              className={`grid [transition-property:grid-template-rows] duration-200 ease-out ${
                collapsed ? '[grid-template-rows:0fr]' : '[grid-template-rows:1fr]'
              }`}
            >
              <div className="overflow-hidden min-h-0">
                <div className="flex flex-col gap-2 pt-2">
                  {(showAllGroups.has(id) ? runs : runs.slice(0, 5)).map((r) => {
                    const key = `${r.collectorId}:${r.startedAt}`;
                    return (
                      <RunRow key={key} run={r} expanded={expanded.has(key)} onToggle={() => toggle(key)} />
                    );
                  })}
                  {runs.length > 5 && (
                    <button
                      type="button"
                      className="btn btn-g btn-sm inline-flex items-center gap-1.5 self-start"
                      onClick={() => toggleShowAll(id)}
                    >
                      {showAllGroups.has(id)
                        ? t('activity:collectLog.less')
                        : t('activity:collectLog.more', { count: runs.length - 5 })}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
        })}
        </div>
      )}
    </div>
  );
}
