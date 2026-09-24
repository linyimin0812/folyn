/**
 * 采集记录 view: past collection runs (scheduled polls and manual collects)
 * recorded by runCollect into the persisted `collectHistory`. Each row shows
 * collector name, time, duration, accepted/deduped counts and an expandable
 * log section fed by the collector's onProgress messages.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useActivityCollectorStore, type CollectRunRecord } from '@/store/activityCollectorStore';

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
    <div className="border border-brd rounded-lg bg-panel">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-left cursor-pointer bg-transparent border-0 hover:bg-hov"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        {expanded ? (
          <ChevronDown size={12} className="text-t3 shrink-0" />
        ) : (
          <ChevronRight size={12} className="text-t3 shrink-0" />
        )}
        <span className="text-[13px] font-medium text-t1 truncate">{run.collectorName}</span>
        <span className="text-[12px] text-t3 shrink-0">
          {dateTimeFmt.format(new Date(run.startedAt))}
        </span>
        <span className="text-[12px] text-t3 shrink-0">
          {t('activity:collectLog.duration', { time: `${seconds}s` })}
        </span>
        <span className="flex-1" />
        {run.outcome === 'ok' ? (
          <span className="text-[12px] text-t3 shrink-0">
            {t('activity:collectLog.records', { count: run.accepted })}
            {' · '}
            {t('activity:collectLog.deduped', { count: run.deduped })}
          </span>
        ) : (
          <span className="text-[11px] text-t3 bg-hov rounded px-1.5 py-0.5 shrink-0">
            {t('activity:collectLog.noResult')}
          </span>
        )}
      </button>
      <div
        className={`grid [transition-property:grid-template-rows] duration-200 ease-out ${
          expanded ? '[grid-template-rows:1fr]' : '[grid-template-rows:0fr]'
        }`}
      >
        <div className="overflow-hidden min-h-0">
          <div className="mx-3 mb-3 rounded-md bg-surf2 border border-brd p-3">
            <p className="m-0 mb-1.5 text-[11px] text-acc">
              {t('activity:collectLog.logs')}
            </p>
            {run.logs.length === 0 ? (
              <p className="m-0 text-[12px] text-t3">{t('activity:collectLog.emptyLogs')}</p>
            ) : (
              <ul className="m-0 pl-4 text-[12px] text-t2 leading-relaxed">
                {run.logs.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function CollectLogView() {
  const { t, i18n } = useTranslation();
  const history = useActivityCollectorStore((s) => s.collectHistory);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Collapsed collector groups; empty = all groups expanded (default).
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  if (history.length === 0) {
    return (
      <div className="text-[13px] text-t3 bg-panel border border-brd rounded-lg p-8 text-center">
        {t('activity:collectLog.empty')}
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

  return (
    <div className="flex flex-col gap-4">
      {[...groups.entries()].map(([id, runs]) => {
        const collapsed = collapsedGroups.has(id);
        const latest = runs[0];
        return (
          <div key={id}>
            <button
              className="bg-transparent border-0 p-0 m-0 w-full flex items-center gap-2 cursor-pointer text-left"
              onClick={() => toggleGroup(id)}
              aria-expanded={!collapsed}
            >
              {collapsed ? (
                <ChevronRight size={12} className="text-t3 shrink-0" />
              ) : (
                <ChevronDown size={12} className="text-t3 shrink-0" />
              )}
              <span className="text-[13px] font-semibold text-t2 truncate">
                {latest.collectorName}
              </span>
              <span className="text-[12px] text-t3 shrink-0">
                {t('activity:collectLog.runs', { count: runs.length })}
                {' · '}
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
                  {runs.map((r) => {
                    const key = `${r.collectorId}:${r.startedAt}`;
                    return (
                      <RunRow key={key} run={r} expanded={expanded.has(key)} onToggle={() => toggle(key)} />
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
