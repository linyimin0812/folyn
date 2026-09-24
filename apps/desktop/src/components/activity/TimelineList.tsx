/**
 * Timeline list (design §7.1): reverse-chronological event rows. Icon/color
 * come from the activityDisplay index (collector declaration → builtin table
 * → gray-dot fallback); clicking a row expands the detail panel with
 * declared detailFields (or the raw payload flat-list fallback), the cached
 * AI summary (lazily generated on first expand when the event's collector
 * opted in via its own `allowAiSummary` config, then served from the
 * ai_summary cache); failures are shown in the panel and retried on the
 * next expand, and a「查看原文」link that
 * only renders when the event carries a url.
 *
 * Window-activity events arrive roughly every minute and would flood the
 * list, so consecutive runs (adjacent gap ≤ 5min, other types interrupt)
 * collapse into one「使用会话」row whose expansion holds the member rows —
 * view-only aggregation, raw data untouched.
 */

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppWindow, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
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

// ── Session aggregation (pure, view-only) ────────────────────────────────────

const SESSION_GAP_MS = 5 * 60 * 1000;

export type TimelineItem =
  | { kind: 'event'; event: ActivityEventRow }
  | { kind: 'session'; events: ActivityEventRow[]; newest: ActivityEventRow; oldest: ActivityEventRow };

/**
 * Merge runs of adjacent `window_activity` events (gap between consecutive
 * members ≤ SESSION_GAP_MS, in time order) into single session items; a lone
 * window event stays a plain event row. Input is reverse-chronological and
 * so is the output.
 */
export function mergeTimelineSessions(events: ActivityEventRow[]): TimelineItem[] {
  const items: TimelineItem[] = [];
  let run: ActivityEventRow[] = [];
  const flush = () => {
    if (run.length === 0) return;
    if (run.length === 1) items.push({ kind: 'event', event: run[0] });
    // Reverse-chronological walk: run[0] is newest, last is oldest.
    else items.push({ kind: 'session', events: run, newest: run[0], oldest: run[run.length - 1] });
    run = [];
  };
  for (const e of events) {
    const prev = run[run.length - 1];
    if (e.type === 'window_activity' && prev && prev.occurredAt - e.occurredAt <= SESSION_GAP_MS) {
      run.push(e);
    } else {
      flush();
      if (e.type === 'window_activity') run = [e];
      else items.push({ kind: 'event', event: e });
    }
  }
  flush();
  return items;
}

/** `2 小时 15 分`-style duration via Intl units (no new i18n keys). */
export function formatSessionDuration(ms: number, locale: string): string {
  const totalMin = Math.max(1, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const unit = (u: string, v: number) =>
    new Intl.NumberFormat(locale, { style: 'unit', unit: u, unitDisplay: 'short' }).format(v);
  return (
    [h > 0 ? unit('hour', h) : null, m > 0 ? unit('minute', m) : null].filter(Boolean).join(' ') ||
    unit('minute', 0)
  );
}

// ── Display helpers ──────────────────────────────────────────────────────────

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
  // Per-day-group collapse (chevron on the day header); the per-event detail
  // cards are separate, per-row via `toggle` below. Sessions use their own
  // `session:` prefixed keys so member-row expansion stays independent.
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());
  // Per-collector AI opt-in: `event.source` is the collector id (validated
  // Rust-side to equal it), which keys the authSchema-rendered config values.
  const configs = useActivityCollectorStore((s) => s.configs);
  const aiAllowed = (e: ActivityEventRow) =>
    configs[e.source]?.allowAiSummary === true;
  // Lazy summaries (§6): first expand generates + caches into ai_summary;
  // later expands read this session map (row prop stays stale until refetch).
  const [generated, setGenerated] = useState<Record<string, string>>({});
  const [pendingSummary, setPendingSummary] = useState<Set<string>>(new Set());
  const [failedSummary, setFailedSummary] = useState<Set<string>>(new Set());
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
          else {
            // Failure: un-mark tried so the next expand retries.
            tried.current.delete(id);
            setFailedSummary((prev) => new Set(prev).add(id));
          }
        })
        .catch(() => {
          tried.current.delete(id);
          setFailedSummary((prev) => new Set(prev).add(id));
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

  // Sessions are aggregated before day grouping; a session belongs to the
  // day of its newest event (cross-midnight sessions land wholly there).
  const items = mergeTimelineSessions(events);
  const groups: { key: string; dayLabel: string; items: TimelineItem[] }[] = [];
  for (const item of items) {
    const d = new Date(item.kind === 'session' ? item.newest.occurredAt : item.event.occurredAt);
    const key = dateKey(d);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, dayLabel: dayLabelOf(d), items: [item] });
  }

  const toggleDay = (key: string) => {
    setCollapsedDays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /** One event row + its expandable detail card — shared by the flat
   *  timeline and the member rows inside a session's expansion. */
  const renderEventRow = (e: ActivityEventRow) => {
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

        {/* ponytail: same grid-rows collapse as the day groups / metrics summary */}
        <div
          className={`grid [transition-property:grid-template-rows] duration-200 ease-out ${
            isOpen ? '[grid-template-rows:1fr]' : '[grid-template-rows:0fr]'
          }`}
        >
          <div className="overflow-hidden min-h-0">
            <div className="ml-11 mr-2 mt-2 mb-2 rounded-md bg-surf2 border border-brd p-3 text-[13px] text-t2">
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
                (e.aiSummary || generated[e.id] || pendingSummary.has(e.id) || failedSummary.has(e.id)) && (
                  <div className="mt-3">
                    <p className="m-0 text-[12px] text-acc">{t('activity:timeline.aiSummary')}</p>
                    {pendingSummary.has(e.id) && !e.aiSummary && !generated[e.id] ? (
                      <p className="m-0 mt-0.5 text-t3">
                        {t('activity:timeline.aiSummaryLoading')}
                      </p>
                    ) : failedSummary.has(e.id) && !e.aiSummary && !generated[e.id] ? (
                      <p className="m-0 mt-0.5 text-t3">
                        {t('activity:timeline.aiSummaryFailed')}
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
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      {groups.map((g, gi) => {
        const collapsed = collapsedDays.has(g.key);
        return (
          <div key={g.key} className={gi === 0 ? '' : 'mt-5'}>
            <div className={gi === 0 ? 'pb-2' : 'pt-3 pb-2 border-t border-brd'}>
              <button
                className="bg-transparent border-0 p-0 m-0 w-full flex items-center gap-1 cursor-pointer text-left"
                onClick={() => toggleDay(g.key)}
                aria-expanded={!collapsed}
              >
                {collapsed ? (
                  <ChevronRight size={12} className="text-t3 shrink-0" />
                ) : (
                  <ChevronDown size={12} className="text-t3 shrink-0" />
                )}
                <span className="text-[13px] font-semibold text-t2">{g.dayLabel}</span>
              </button>
            </div>
            <div
              className={`grid [transition-property:grid-template-rows] duration-200 ease-out ${
                collapsed ? '[grid-template-rows:0fr]' : '[grid-template-rows:1fr]'
              }`}
            >
              <div className="overflow-hidden min-h-0">
          <div className="relative">
            {/* Vertical rail behind the icon bubbles (centered on bubble column). */}
            <span
              className="absolute left-[15px] top-2 bottom-2 w-[2px] rounded-full"
              style={{ background: 'var(--brd)' }}
              aria-hidden="true"
            />
            {g.items.map((item) => {
              if (item.kind === 'event') return renderEventRow(item.event);
              // Merged window-activity session row.
              const sessionKey = `session:${item.newest.id}`;
              const isOpen = expanded.has(sessionKey);
              const pal = ACTIVITY_PALETTE[eventPalette(item.newest, displayByType)];
              const icon = eventIcon(item.newest, displayByType);
              const duration = formatSessionDuration(
                item.newest.occurredAt - item.oldest.occurredAt + 60_000,
                i18n.language,
              );
              return (
                <div key={sessionKey}>
                  <button
                    className="relative w-full flex items-start gap-3 py-2 pr-2 rounded-md text-left cursor-pointer bg-transparent border-0 hover:bg-hov"
                    onClick={() => toggle(sessionKey)}
                    aria-expanded={isOpen}
                  >
                    <span
                      className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: pal.bg, color: pal.color }}
                    >
                      {icon ? (
                        <LucideNameIcon name={icon} size={16} />
                      ) : (
                        <AppWindow size={16} />
                      )}
                    </span>
                    <span className="flex-1 min-w-0 mt-0.5">
                      <span className="block text-[13px] font-medium text-t1 truncate">
                        {t('activity:timeline.sessionTitle', { count: item.events.length })}
                      </span>
                      <span className="block text-[12px] text-t2 truncate">
                        {t('activity:timeline.sessionDuration', { duration })}
                      </span>
                    </span>
                    <span className="mt-1 shrink-0 text-[12px] text-t3">
                      {timeFmt.format(new Date(item.oldest.occurredAt))} –{' '}
                      {timeFmt.format(new Date(item.newest.occurredAt))}
                    </span>
                    <ChevronDown
                      size={14}
                      className="mt-1 text-t3 shrink-0"
                      style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }}
                    />
                  </button>

                  {/* ponytail: same grid-rows collapse as the day groups / metrics summary */}
                  <div
                    className={`grid [transition-property:grid-template-rows] duration-200 ease-out ${
                      isOpen ? '[grid-template-rows:1fr]' : '[grid-template-rows:0fr]'
                    }`}
                  >
                    <div className="overflow-hidden min-h-0">
                      {item.events.map((e) => renderEventRow(e))}
                    </div>
                  </div>
                </div>
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
