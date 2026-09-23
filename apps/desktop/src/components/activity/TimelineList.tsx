/**
 * Timeline list (design §7.1): reverse-chronological event rows. Icon/color
 * come from the activityDisplay index (collector declaration → builtin table
 * → gray-dot fallback); clicking a row expands the detail panel with
 * declared detailFields (or the raw payload flat-list fallback), the cached
 * AI summary (lazily generated on first expand when the privacy switch allows
 * it, then served from the ai_summary cache), and a「查看原文」link that
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
  const allowAiSummary = useActivityCollectorStore((s) => s.allowAiSummary);
  // Lazy summaries (§6): first expand generates + caches into ai_summary;
  // later expands read this session map (row prop stays stale until refetch).
  const [generated, setGenerated] = useState<Record<string, string>>({});
  const [pendingSummary, setPendingSummary] = useState<Set<string>>(new Set());
  const tried = useRef<Set<string>>(new Set());

  if (events.length === 0) {
    return (
      <div className="text-[12px] text-t3 bg-surf2 border border-brd2 rounded-md p-4 text-center">
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
      allowAiSummary &&
      event &&
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

  const timeFmt = new Intl.DateTimeFormat(i18n.language, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div>
      {events.map((e) => {
        const pal = ACTIVITY_PALETTE[eventPalette(e, displayByType)];
        const icon = eventIcon(e, displayByType);
        const isOpen = expanded.has(e.id);
        const detailFields = displayByType[e.type]?.detailFields;
        const payload = e.payload ?? {};
        const url = isExternalUrl(e.url) ? e.url : null;
        return (
          <div key={e.id} className="border border-brd rounded-lg mb-2 bg-panel">
            <button
              className="w-full flex items-center gap-2.5 p-2.5 text-left cursor-pointer bg-transparent border-0"
              onClick={() => toggle(e.id)}
            >
              <span
                className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                style={{ background: pal.bg, color: pal.color }}
              >
                {icon ? (
                  <LucideNameIcon name={icon} size={14} />
                ) : (
                  <span className="w-2 h-2 rounded-full" style={{ background: pal.color }} />
                )}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[length:calc(var(--ui-font-size)] text-t1 truncate">
                  {e.title || e.id}
                </span>
                <span className="block text-[11px] text-t3 truncate">
                  {timeFmt.format(new Date(e.occurredAt))} · {e.type}
                </span>
              </span>
              <ChevronDown
                size={14}
                className="text-t3 shrink-0"
                style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }}
              />
            </button>

            {isOpen && (
              <div className="px-3 pb-2.5 pt-2 border-t border-brd text-[length:calc(var(--ui-font-size)-1px)] text-t2">
                {e.summary && <p className="m-0 mb-1.5">{e.summary}</p>}

                {detailFields && detailFields.length > 0 ? (
                  <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
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
                  <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                    {Object.entries(payload as Record<string, unknown>).map(([k, v]) => (
                      <div key={k} className="contents">
                        <span className="text-t3">{k}</span>
                        <span className="text-t1 break-words">{formatDetailValue(v, 'text')}</span>
                      </div>
                    ))}
                  </div>
                )}

                {allowAiSummary && (e.aiSummary || generated[e.id] || pendingSummary.has(e.id)) && (
                  <div className="mt-2">
                    <p className="m-0 text-[11px] text-acc">{t('activity:timeline.aiSummary')}</p>
                    {pendingSummary.has(e.id) && !e.aiSummary && !generated[e.id] ? (
                      <p className="m-0 mt-0.5 text-t3">{t('activity:timeline.aiSummaryLoading')}</p>
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
                    className="inline-flex items-center gap-1 mt-2 text-[11px] text-acc no-underline hover:underline"
                    onClick={(ev) => {
                      ev.preventDefault();
                      openExternalUrl(url);
                    }}
                  >
                    {t('activity:timeline.viewSource')}
                    <ExternalLink size={11} />
                  </a>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
