/**
 * Timeline list (design §7.1): reverse-chronological event rows. Icon/color
 * come from the activityDisplay index (collector declaration → builtin table
 * → gray-dot fallback); clicking a row expands the detail panel with
 * declared detailFields (or the raw payload flat-list fallback), the cached
 * AI summary (lazily generated on first expand when the event's collector
 * opted in via its own `allowAiSummary` config, then served from the
 * ai_summary cache), and a「查看原文」link that
 * only renders when the event carries a url.
 */

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ExternalLink } from 'lucide-react';
import { isTauri } from '@/utils/platform';
import type { ActivityEventRow } from '@/services/activity/api';
import type { DisplayIndexEntry } from '@/services/activity/registry';
import { useActivityCollectorStore } from '@/store/activityCollectorStore';
import { generateEventSummary } from '@/services/activity/eventSummary';
import { LucideNameIcon } from '@/components/icons/LucideNameIcon';
import { dateKey } from './period';
import { ACTIVITY_PALETTE, BUILTIN_EVENT_DISPLAY, formatDetailValue, isExternalUrl, paletteOf } from './display';

interface TimelineListProps {
  events: ActivityEventRow[];
  displayByType: Record<string, DisplayIndexEntry>;
  /** Vault root for the ai_summary cache write. */
  vaultRoot: string;
}

function eventPalette(e: ActivityEventRow, displayByType: Record<string, DisplayIndexEntry>) {
  const declared = displayByType[e.type];
  if (declared?.color) return paletteOf(declared.color);
  return paletteOf(BUILTIN_EVENT_DISPLAY[e.type]?.color);
}

function eventIcon(e: ActivityEventRow, displayByType: Record<string, DisplayIndexEntry>) {
  return displayByType[e.type]?.icon ?? BUILTIN_EVENT_DISPLAY[e.type]?.icon;
}

/** Collector urls open via the app's external-open path (shell plugin /
 *  window.open), never a raw href navigation — see isExternalUrl. */
function openExternalUrl(u: string) {
  if (isTauri()) {
    void import('@tauri-apps/plugin-shell').then(({ open }) => open(u));
  } else {
    window.open(u, '_blank', 'noopener,noreferrer');
  }
}

export function TimelineList({ events, displayByType, vaultRoot }: TimelineListProps) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // 「收起全部」hides the whole records list (day groups + rows), not the
  // per-event detail cards — those stay per-row via `toggle` below.
  const [recordsHidden, setRecordsHidden] = useState(false);
  // Per-collector AI opt-in: `event.source` is the collector id (validated
  // Rust-side to equal it), which keys the authSchema-rendered config values.
  const configs = useActivityCollectorStore((s) => s.configs);
  const aiAllowed = (e: ActivityEventRow) =>
    configs[e.source]?.allowAiSummary === true;
  // Lazy summaries (§6): first expand generates + caches into ai_summary;
  // later expands read this session map (row prop stays stale until refetch).
  const [generated, setGenerated] = useState<Record<string, string>>({});
  const [pendingSummary, setPendingSummary] = useState<Set<string>>(new Set());
  const tried = useRef<Set<string>>(new Set());

  if (events.length === 0) {
    return (
      <div className="text-[13px] text-t3 bg-panel border border-brd rounded-lg p-8 text-center">
        {t('activity:timeline.empty')}
      </div>
    );
  }

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    const event = events.find((e) => e.id === id);
    if (
      event &&
      aiAllowed(event) &&
      !event.aiSummary &&
      !generated[id] &&
      !tried.current.has(id)
    ) {
      tried.current.add(id);
      setPendingSummary((prev) => new Set(prev).add(id));
      void generateEventSummary(vaultRoot, event)
        .then((summary) => {
          if (summary) setGenerated((prev) => ({ ...prev, [id]: summary }));
        })
        .finally(() => {
          setPendingSummary((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        });
    }
  };

  // Day-group formatting (spec: Intl only, no new i18n key) — group header
  // carries the date, each row shows only the time of day.
  const todayKeyStr = dateKey(new Date());
  const dayFmt = new Intl.DateTimeFormat(i18n.language, { month: '2-digit', day: '2-digit' });
  const weekdayFmt = new Intl.DateTimeFormat(i18n.language, { weekday: 'short' });
  const timeFmt = new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' });
  const dayLabelOf = (d: Date) =>
    dateKey(d) === todayKeyStr
      ? `${t('activity:period.today')} · ${dayFmt.format(d)}`
      : `${dayFmt.format(d)} ${weekdayFmt.format(d)}`;

  // Events arrive reverse-chronological; group consecutive same-day rows.
  const groups: { key: string; dayLabel: string; events: ActivityEventRow[] }[] = [];
  for (const e of events) {
    const d = new Date(e.occurredAt);
    const key = dateKey(d);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.events.push(e);
    else groups.push({ key, dayLabel: dayLabelOf(d), events: [e] });
  }

  return (
    <div>
      <div className="pb-2 flex justify-end">
        <button
          className="text-[12px] text-t3 hover:text-t1 cursor-pointer bg-transparent border-0 p-0"
          onClick={() => setRecordsHidden((h) => !h)}
        >
          {recordsHidden
            ? t('activity:timeline.expandAll')
            : t('activity:timeline.collapseAll')}
        </button>
      </div>
      {!recordsHidden && groups.map((g, gi) => (
        <div key={g.key} className={gi === 0 ? '' : 'mt-5'}>
          <div className={gi === 0 ? 'pb-2' : 'pt-3 pb-2 border-t border-brd'}>
            <p className="m-0 text-[12px] text-t3">{g.dayLabel}</p>
          </div>
          <div className="relative">
            {/* Vertical rail behind the icon bubbles (centered on bubble column). */}
            <span
              className="absolute left-[15px] top-2 bottom-2 w-[2px] rounded-full"
              style={{ background: 'var(--brd)' }}
              aria-hidden="true"
            />
            {g.events.map((e) => {
              const pal = ACTIVITY_PALETTE[eventPalette(e, displayByType)];
              const icon = eventIcon(e, displayByType);
              const isOpen = expanded.has(e.id);
              const detailFields = displayByType[e.type]?.detailFields;
              const payload = e.payload ?? {};
              const url = isExternalUrl(e.url) ? e.url : null;
              const sub = e.summary || e.type;
              return (
                <div key={e.id}>
                  <button
                    className="relative w-full flex items-start gap-3 py-2 pr-2 rounded-md text-left cursor-pointer bg-transparent border-0 hover:bg-hov"
                    onClick={() => toggle(e.id)}
                  >
                    <span
                      className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: pal.bg, color: pal.color }}
                    >
                      {icon ? (
                        <LucideNameIcon name={icon} size={16} />
                      ) : (
                        <span className="w-2 h-2 rounded-full" style={{ background: pal.color }} />
                      )}
                    </span>
                    <span className="flex-1 min-w-0 mt-0.5">
                      <span className="block text-[13px] font-medium text-t1 truncate">
                        {e.title || e.id}
                      </span>
                      <span className="block text-[12px] text-t2 truncate">{sub}</span>
                    </span>
                    <span className="mt-1 shrink-0 text-[12px] text-t3">
                      {timeFmt.format(new Date(e.occurredAt))}
                    </span>
                    <ChevronDown
                      size={14}
                      className="mt-1 text-t3 shrink-0"
                      style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }}
                    />
                  </button>

                  {isOpen && (
                    <div className="ml-11 mr-2 mb-2 rounded-md bg-surf2 border border-brd p-3 text-[13px] text-t2">
                      {e.summary && <p className="m-0 mb-2">{e.summary}</p>}

                      {detailFields && detailFields.length > 0 ? (
                        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                          {detailFields.map((f) => {
                            const raw = (payload as Record<string, unknown>)[f.key];
                            const text = formatDetailValue(raw, f.format);
                            if (!text) return null;
                            return (
                              <div key={f.key} className="contents">
                                <dt className="text-t3">{f.label}</dt>
                                <dd className="m-0 text-t1">{text}</dd>
                              </div>
                            );
                          })}
                        </dl>
                      ) : (
                        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                          {Object.entries(payload as Record<string, unknown>).map(([k, v]) => (
                            <div key={k} className="contents">
                              <span className="text-t3">{k}</span>
                              <span className="text-t1 break-words">
                                {formatDetailValue(v, 'text')}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {aiAllowed(e) &&
                        (e.aiSummary || generated[e.id] || pendingSummary.has(e.id)) && (
                          <div className="mt-3">
                            <p className="m-0 text-[12px] text-acc">{t('activity:timeline.aiSummary')}</p>
                            {pendingSummary.has(e.id) && !e.aiSummary && !generated[e.id] ? (
                              <p className="m-0 mt-0.5 text-t3">
                                {t('activity:timeline.aiSummaryLoading')}
                              </p>
                            ) : (
                              <p className="m-0 mt-0.5 text-t1 leading-relaxed">
                                {e.aiSummary || generated[e.id]}
                              </p>
                            )}
                          </div>
                        )}

                      {url && (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 mt-3 text-[12px] text-acc no-underline hover:underline"
                          onClick={(ev) => {
                            ev.preventDefault();
                            openExternalUrl(url);
                          }}
                        >
                          {t('activity:timeline.viewSource')}
                          <ExternalLink size={12} />
                        </a>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
