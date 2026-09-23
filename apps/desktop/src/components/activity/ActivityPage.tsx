/**
 * Native「活动」page (design §7.1–§7.4): timeline + metrics + ongoing module +
 * calendar period picker, with the entity-relation browser as a second tab.
 * Out of scope this pass (subtask 4): report generation, AI summary
 * generation, pet notification.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type Period,
  dateKey,
  endOfDay,
  isCurrentPeriod,
  quickRange,
  startOfDay,
} from './period';
import { metricCardsFromRows } from './display';
import {
  aggregateActivityMetrics,
  getActivityDailyDigestInput,
  listActivityEvents,
} from '@/services/activity/api';
import { useCollectorRegistryStore } from '@/services/activity/registry';
import { useAsync, useVaultRoot } from './useActivityData';
import { PeriodPicker } from './PeriodPicker';
import { OngoingTasks } from './OngoingTasks';
import { MetricsGrid } from './MetricsGrid';
import { TimelineList } from './TimelineList';
import { EntityGraphView } from './EntityGraphView';

export function ActivityPage() {
  const { t } = useTranslation();
  const vaultRoot = useVaultRoot();
  const [tab, setTab] = useState<'timeline' | 'graph'>('timeline');
  const [period, setPeriod] = useState<Period>(() => quickRange('today', new Date()));
  const displayByType = useCollectorRegistryStore((s) => s.displayByType);

  const today = new Date();
  const current = isCurrentPeriod(period, today);
  const periodKey = `${period.mode}:${dateKey(period.start)}:${dateKey(period.end)}`;
  const range = {
    from: startOfDay(period.start).getTime(),
    to: endOfDay(period.end).getTime(),
  };

  const { data: events } = useAsync(
    () =>
      vaultRoot
        ? listActivityEvents(vaultRoot, range)
        : Promise.resolve([] as Awaited<ReturnType<typeof listActivityEvents>>),
    [vaultRoot, periodKey],
  );
  const { data: metricRows } = useAsync(
    () =>
      vaultRoot
        ? aggregateActivityMetrics(vaultRoot, range)
        : Promise.resolve([] as Awaited<ReturnType<typeof aggregateActivityMetrics>>),
    [vaultRoot, periodKey],
  );
  // Ongoing tasks reflect "now" — only fetched while on the current period.
  const todayKey = dateKey(today);
  const { data: digest } = useAsync(
    () =>
      vaultRoot && current
        ? getActivityDailyDigestInput(vaultRoot, todayKey)
        : Promise.resolve(null as Awaited<ReturnType<typeof getActivityDailyDigestInput>>),
    [vaultRoot, current ? '1' : '0', todayKey],
  );

  const cards = metricCardsFromRows(
    metricRows ?? [],
    displayByType,
    (id) => metricLabel(t, id),
    (id) => metricLabel(t, id),
  );

  return (
    <div className="flex-1 min-w-0 overflow-y-auto">
      <div className="max-w-[860px] mx-auto p-6">
        <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
          <div className="inline-flex rounded-md border border-brd overflow-hidden">
            {(['timeline', 'graph'] as const).map((m) => (
              <button
                key={m}
                className={`px-4 py-1.5 text-[length:calc(var(--ui-font-size)-1px)] border-l border-brd first:border-l-0 ${
                  tab === m ? 'bg-accdim text-acc' : 'bg-panel text-t2 hover:bg-hov'
                }`}
                onClick={() => setTab(m)}
              >
                {t(`activity:tabs.${m}`)}
              </button>
            ))}
          </div>
          <PeriodPicker period={period} onPeriodChange={setPeriod} />
        </div>

        {tab === 'timeline' ? (
          !vaultRoot ? (
            <div className="text-[12px] text-t3 bg-surf2 border border-brd2 rounded-md p-4 text-center">
              {t('activity:noVault')}
            </div>
          ) : (
            <>
              {current && <OngoingTasks tasks={digest?.ongoingTasks ?? []} />}
              <MetricsGrid cards={cards} />
              <TimelineList events={events ?? []} displayByType={displayByType} />
            </>
          )
        ) : (
          <EntityGraphView vaultRoot={vaultRoot} />
        )}
      </div>
    </div>
  );
}

/** Builtin metric labels via i18n; unknown ids fall back to the raw id. */
const METRIC_KEYS: Record<string, string> = {
  commit_count: 'activity:metric.commit',
  meeting_count: 'activity:metric.meeting',
  meeting_minutes: 'activity:metric.meetingMinutes',
  active_conversations: 'activity:metric.message',
  doc_edit_count: 'activity:metric.docEdit',
  task_update_count: 'activity:metric.task',
};
function metricLabel(
  t: (k: string) => string,
  metricId: string,
): string {
  const key = METRIC_KEYS[metricId];
  return key ? t(key) : metricId;
}
