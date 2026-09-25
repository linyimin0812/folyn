/**
 * Native「活动」page (design §7.1–§7.5): timeline + metrics + ongoing module +
 * calendar period picker, with the entity-relation browser as a second tab,
 * plus report generation (日/周/月 written into the vault, §7.5).
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, History, List, Loader2, Network, Plug, RefreshCw, SlidersHorizontal, Sparkles, Zap } from 'lucide-react';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkDirective from 'remark-directive';
import remarkDirectiveRehype from 'remark-directive-rehype';
import rehypeHighlight from 'rehype-highlight';
import { all as allLowlightGrammars } from 'lowlight';
import { renderMarkdownToReact } from '@/services/markdown/renderMarkdown';
import { useNavStore } from '@/store/navStore';
import { FileIcon } from '@/components/icons/FileIcon';
import {
  type Period,
  dateKey,
  endOfDay,
  formatPeriodRange,
  isCurrentPeriod,
  quickRange,
  sameDay,
  startOfDay,
} from './period';
import { metricCardsFromRows } from './display';
import {
  aggregateActivityMetrics,
  getActivityDailyDigestInput,
  listActivityEvents,
} from '@/services/activity/api';
import {
  type GeneratedReport,
  type ReportPeriod,
  type ReportStrings,
  generateReport,
  stripFrontmatter,
} from '@/services/activity/reports';
import { useCollectorRegistryStore } from '@/services/activity/registry';
import { collectNow } from '@/services/activity/runtime';
import { getCollectorSettings, useActivityCollectorStore } from '@/store/activityCollectorStore';
import { CollectorsSettings } from '@/components/settings/CollectorsSettings';
import { ReportSettingsView } from './ReportSettingsView';
import { CollectLogView } from './CollectLogView';
import { useAsync, useEnabledSources, useVaultRoot } from './useActivityData';
import { PeriodPicker } from './PeriodPicker';
import { OngoingTasks } from './OngoingTasks';
import { MetricsGrid } from './MetricsGrid';
import { TimelineList } from './TimelineList';
import { CollectAllModal, type CollectAllRun } from './CollectAllModal';
import { EntityGraphView } from './EntityGraphView';

/** Map the picker's period mode to the report kind (custom ranges: no report). */
function reportModeOf(mode: Period['mode']): ReportPeriod | null {
  if (mode === 'today') return 'daily';
  if (mode === 'week') return 'weekly';
  if (mode === 'month') return 'monthly';
  return null;
}

/** Secondary rail views (activity page-local — NOT the global ActivityBar).
 *  `collectLog` is a second-level child under 采集器, rendered indented like
 *  the timeline/graph children under 活动 — not part of RAIL_VIEWS. */
type ActivityView = 'main' | 'collectors' | 'collectLog' | 'reportSettings';
const RAIL_VIEWS: { id: ActivityView; icon: typeof Activity; key: string }[] = [
  { id: 'main', icon: Activity, key: 'activity:rail.main' },
  { id: 'collectors', icon: Plug, key: 'activity:rail.collectors' },
  { id: 'reportSettings', icon: SlidersHorizontal, key: 'activity:rail.reportSettings' },
];

/** Keep a boolean flag shown for at least `ms` after it turns true — refetches
 *  can finish in ~50ms and the overlay would just flash. */
function useMinimumDuration(flag: boolean, ms: number): boolean {
  const [shown, setShown] = useState(false);
  const startedAt = useRef(0);
  useEffect(() => {
    if (flag) {
      startedAt.current = Date.now();
      setShown(true);
      return;
    }
    if (!shown) return;
    const remain = ms - (Date.now() - startedAt.current);
    if (remain <= 0) {
      setShown(false);
      return;
    }
    const t = setTimeout(() => setShown(false), remain);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `shown` intentionally excluded: it must not retrigger the timer
  }, [flag]);
  return shown;
}

/** Report preview — same plugin set as the editor's markdown preview (memoized per text). */
function ReportMarkdown({ markdown }: { markdown: string }) {
  const node = useMemo(() => {
    try {
      return renderMarkdownToReact(stripFrontmatter(markdown), {
        // ponytail: editor-only features skipped (scroll-sync, script runner/containers, code-break cleanup)
        remarkExtensions: [remarkGfm, remarkBreaks, remarkDirective, remarkDirectiveRehype],
        allowDangerousHtml: true,
        rehypeExtensions: [[rehypeHighlight, { languages: allLowlightGrammars, ignoreMissing: true } as any]],
      });
    } catch {
      return markdown;
    }
  }, [markdown]);
  return <div className="md-preview max-h-[280px] overflow-y-auto">{node}</div>;
}

export function ActivityPage() {
  const { t, i18n } = useTranslation();
  const vaultRoot = useVaultRoot();
  const [tab, setTab] = useState<'timeline' | 'graph'>('timeline');
  const [view, setView] = useState<ActivityView>('main');
  const [period, setPeriod] = useState<Period>(() => quickRange('today', new Date()));
  const displayByType = useCollectorRegistryStore((s) => s.displayByType);
  const [report, setReport] = useState<GeneratedReport | null>(null);
  const [generating, setGenerating] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  // 「采集」run — component-local view state (NOT a store): the modal can be
  // closed and reopened while a run continues in the background.
  const [collectRun, setCollectRun] = useState<CollectAllRun | null>(null);
  const [collectModalOpen, setCollectModalOpen] = useState(false);
  // Manual refresh: bumps all data useAsync deps to re-read from the activity db.
  const [refreshKey, setRefreshKey] = useState(0);

  const today = new Date();
  const current = isCurrentPeriod(period, today);
  const periodKey = `${period.mode}:${dateKey(period.start)}:${dateKey(period.end)}`;
  const range = {
    from: startOfDay(period.start).getTime(),
    to: endOfDay(period.end).getTime(),
  };

  // Enabled-source include-list: disabling a collector hides its events/
  // metrics/digest. `sourcesKey` re-fetches the three reads on toggle.
  const enabledSources = useEnabledSources();
  const sourcesKey = enabledSources.join(',');

  const { data: events, loading: eventsLoading } = useAsync(
    () =>
      vaultRoot
        ? listActivityEvents(vaultRoot, range, typeFilter ? [typeFilter] : undefined, enabledSources)
        : Promise.resolve([] as Awaited<ReturnType<typeof listActivityEvents>>),
    [vaultRoot, periodKey, typeFilter, refreshKey, sourcesKey],
  );
  const { data: metricRows } = useAsync(
    () =>
      vaultRoot
        ? aggregateActivityMetrics(vaultRoot, range, enabledSources)
        : Promise.resolve([] as Awaited<ReturnType<typeof aggregateActivityMetrics>>),
    [vaultRoot, periodKey, refreshKey, sourcesKey],
  );
  // Ongoing tasks reflect "now" — only fetched while on the current period.
  const todayKey = dateKey(today);
  const { data: digest } = useAsync(
    () =>
      vaultRoot && current
        ? getActivityDailyDigestInput(vaultRoot, todayKey, enabledSources)
        : Promise.resolve(null as Awaited<ReturnType<typeof getActivityDailyDigestInput>>),
    [vaultRoot, current ? '1' : '0', todayKey, refreshKey, sourcesKey],
  );

  const showOverlay = useMinimumDuration(eventsLoading, 500);

  const cards = metricCardsFromRows(
    metricRows ?? [],
    displayByType,
    (id) => metricLabel(t, id),
    (id) => metricLabel(t, id),
  );

  const reportMode = reportModeOf(period.mode);
  const reportLabel = reportMode ? t(`activity:report.${reportMode}`) : '';
  const timeFmt = new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' });
  const dateTimeFmt = new Intl.DateTimeFormat(i18n.language, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  // Period description under the page title — pure Intl formatting, no i18n key.
  const ymdFmt = new Intl.DateTimeFormat(i18n.language, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const weekdayFmt = new Intl.DateTimeFormat(i18n.language, { weekday: 'long' });
  const periodDesc = sameDay(period.start, period.end)
    ? `${ymdFmt.format(period.start)} · ${weekdayFmt.format(period.start)}`
    : formatPeriodRange(period, i18n.language);

  const reportStrings: ReportStrings = {
    label: reportLabel,
    metricsHeading: t('activity:report.metrics'),
    metricCol: t('activity:report.metricCol'),
    valueCol: t('activity:report.valueCol'),
    timelineHeading: t('activity:report.timeline'),
    emptyTimeline: t('activity:report.empty'),
    ongoingHeading: t('activity:ongoing.title'),
    updatedTask: (name) => t('activity:report.updatedTask', { name }),
    ongoingTask: (name, current, total) =>
      t('activity:report.ongoingTask', { name, current, total }),
    regeneratedAt: (time) => t('activity:report.regeneratedAt', { time }),
    notifyText: (label) => t('activity:report.notifyText', { label }),
  };

  const onGenerate = async () => {
    if (!vaultRoot || !reportMode || generating) return;
    setGenerating(true);
    setReportError(null);
    try {
      const result = await generateReport({
        vaultRoot,
        mode: reportMode,
        start: period.start,
        end: period.end,
        displayByType,
        metricLabel: (id) => metricLabel(t, id),
        formatTime: (ms) => timeFmt.format(new Date(ms)),
        formatDateTime: (ms) => dateTimeFmt.format(new Date(ms)),
        s: reportStrings,
      });
      setReport(result);
    } catch (err) {
      // reports.ts throws i18n keys for typed errors (e.g. NO_MODEL_ERROR);
      // anything else is a generic generation failure.
      const msg = err instanceof Error ? err.message : String(err);
      setReportError(msg.startsWith('activity:') ? t(msg) : t('activity:report.generateFailed'));
      console.warn('[activity] report generation failed:', err);
    } finally {
      setGenerating(false);
    }
  };

  /** Open the progress modal; start a fresh run only when none is in flight
   *  (closing the modal mid-run does NOT stop the run — reopening shows it). */
  const onCollectAll = () => {
    setCollectModalOpen(true);
    if (collectRun?.running) return;
    const ids = useCollectorRegistryStore
      .getState()
      .collectors.filter((c) =>
        getCollectorSettings(useActivityCollectorStore.getState(), c.collectorId).enabled,
      )
      .map((c) => c.collectorId);
    const results: CollectAllRun['results'] = {};
    for (const id of ids) results[id] = { status: 'running' };
    setCollectRun({ running: ids.length > 0, results });
    if (ids.length === 0) return;
    void Promise.all(
      ids.map((id) =>
        collectNow(id).then((outcome) => {
          setCollectRun((prev) =>
            prev && {
              ...prev,
              results: {
                ...prev.results,
                [id]: outcome
                  ? { status: 'ok', accepted: outcome.accepted, deduped: outcome.deduped }
                  : { status: 'failed' },
              },
            },
          );
        }),
      ),
    ).finally(() => {
      setCollectRun((prev) => prev && { ...prev, running: false });
    });
  };

  const openReportInEditor = async () => {
    if (!report) return;
    try {
      const { openFile } = await import('@/services/editorIoService');
      const name = report.path.split('/').pop() ?? report.path;
      await openFile(report.path, name);
      useNavStore.getState().setCurrentPage('editor');
    } catch (err) {
      console.warn('[activity] open report failed:', err);
    }
  };

  return (
    <div className="flex-1 min-w-0 flex">
      {/* Secondary left rail — page-local, a sibling of the global ActivityBar
          (NOT a modification of it). Switching views swaps the page content. */}
      <div className="w-56 shrink-0 border-r border-brd bg-panel flex flex-col gap-1 py-3 px-2">
        {/* 活动 group: parent + indented timeline/graph children (second-level nav). */}
        <button
          type="button"
          className={`flex w-full items-center gap-2 px-2.5 py-2 rounded cursor-pointer ${
            view === 'main' ? 'bg-accdim text-acc font-semibold' : 'font-semibold text-t1 hover:bg-hov'
          }`}
          aria-label={t('activity:rail.main')}
          onClick={() => {
            setView('main');
            setTab('timeline');
          }}
        >
          <Activity size={16} />
          <span className="text-[13px]">{t('activity:rail.main')}</span>
        </button>
        {(['timeline', 'graph'] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={`flex w-full items-center gap-2 pl-7 pr-2.5 py-1.5 rounded cursor-pointer ${
              view === 'main' && tab === m
                ? 'bg-accdim text-acc font-semibold'
                : 'font-semibold text-t1 hover:bg-hov'
            }`}
            aria-label={t(`activity:tabs.${m}`)}
            onClick={() => {
              setView('main');
              setTab(m);
            }}
          >
            {m === 'timeline' ? <List size={14} /> : <Network size={14} />}
            <span className="text-[12px]">{t(`activity:tabs.${m}`)}</span>
          </button>
        ))}
        {RAIL_VIEWS.filter((v) => v.id !== 'main').map((v) => (
          <Fragment key={v.id}>
            <button
              type="button"
              className={`flex w-full items-center gap-2 px-2.5 py-2 rounded cursor-pointer ${
                view === v.id ? 'bg-accdim text-acc font-semibold' : 'font-semibold text-t1 hover:bg-hov'
              }`}
              aria-label={t(v.key)}
              onClick={() => setView(v.id)}
            >
              <v.icon size={16} />
              <span className="text-[13px]">{t(v.key)}</span>
            </button>
            {/* 采集记录: indented child of 采集器 (same pattern as timeline/graph). */}
            {v.id === 'collectors' && (
              <button
                type="button"
                className={`flex w-full items-center gap-2 pl-7 pr-2.5 py-1.5 rounded cursor-pointer ${
                  view === 'collectLog' ? 'bg-accdim text-acc font-semibold' : 'font-semibold text-t1 hover:bg-hov'
                }`}
                aria-label={t('activity:rail.collectLog')}
                onClick={() => setView('collectLog')}
              >
                <History size={14} />
                <span className="text-[12px]">{t('activity:rail.collectLog')}</span>
              </button>
            )}
          </Fragment>
        ))}
      </div>

      {view === 'main' ? (
      <div className="relative flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Refetch-in-progress overlay: grays the content, keeps header buttons
            visible (but dimmed) — same flag that spins the refresh icon. */}
        {showOverlay && (
          <div
            className="absolute inset-0 z-10 bg-black/20 flex items-center justify-center"
            aria-label={t('common:common.loading')}
          >
            <Loader2 size={28} className="animate-spin text-acc" />
          </div>
        )}
        {/* Fixed header block — identical for both tabs, so switching tabs never
            re-layouts it. Full-width so the divider spans the pane; inner content
            keeps the 1200px alignment. */}
        <div className="shrink-0 border-b border-brd pt-3 pb-3">
          <div className="max-w-[1200px] mx-auto px-8">
        {/* Page title row: title + period description on the left, actions right. */}
        <div className="flex items-end justify-between gap-x-6 gap-y-3 flex-wrap shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <h1 className="m-0 text-[17px] font-semibold text-t1">{t('activity:title')}</h1>
            <p className="m-0 text-[12px] text-t3 truncate">{periodDesc}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {reportMode && (
              <button
                className="btn btn-g btn-sm inline-flex items-center gap-1.5"
                disabled={generating || !vaultRoot}
                onClick={() => void onGenerate()}
              >
                <Sparkles size={14} className="text-acc" />
                {generating
                  ? t('activity:report.generating')
                  : t('activity:report.generate', { label: reportLabel })}
              </button>
            )}
            <PeriodPicker period={period} onPeriodChange={setPeriod} />
            <button
              className="btn btn-g btn-sm inline-flex items-center gap-1.5"
              onClick={onCollectAll}
            >
              <Zap size={14} className="text-acc" />
              {t('activity:collectAll.action')}
            </button>
            <button
              className="btn btn-g btn-sm inline-flex items-center gap-1.5"
              onClick={() => setRefreshKey((k) => k + 1)}
            >
              <RefreshCw size={14} className={showOverlay ? 'animate-spin text-acc' : 'text-acc'} />
              {t('activity:refresh')}
            </button>
          </div>
        </div>

        {reportError && (
          <div className="flex items-center justify-between gap-2 mt-3 border border-red-500/40 rounded-md px-3 py-2 bg-red-500/5 shrink-0">
            <span className="text-[12px] text-red-700 dark:text-red-400 min-w-0">{reportError}</span>
            <button
              type="button"
              className="flex size-6 shrink-0 items-center justify-center rounded text-t3 hover:text-t1 hover:bg-hov cursor-pointer"
              aria-label={t('common:common.close')}
              onClick={() => setReportError(null)}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
                <path d="m4 4 8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        )}

        {report && (
          <div className="border border-brd rounded-lg p-4 mt-4 mb-0 bg-panel shrink-0">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
              <p className="m-0 text-[11px] text-acc">
                {t('activity:report.savedTo', { path: report.path })}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="flex size-7 shrink-0 items-center justify-center rounded text-t3 hover:text-t1 hover:bg-hov focus-visible:outline-2 focus-visible:outline-acc cursor-pointer"
                  aria-label={t('activity:report.openInEditor')}
                  title={t('activity:report.openInEditor')}
                  onClick={() => void openReportInEditor()}
                >
                  <span className="inline-flex items-center justify-center [&>svg]:w-3.5 [&>svg]:h-3.5">
                    <FileIcon filename={report.path.split('/').pop() ?? report.path} />
                  </span>
                </button>
                <button
                  type="button"
                  className="flex size-7 shrink-0 items-center justify-center rounded text-t3 hover:text-t1 hover:bg-hov focus-visible:outline-2 focus-visible:outline-acc cursor-pointer"
                  aria-label={t('common:common.close')}
                  title={t('common:common.close')}
                  onClick={() => setReport(null)}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
                    <path d="m4 4 8 8M12 4l-8 8" />
                  </svg>
                </button>
              </div>
            </div>
            <ReportMarkdown markdown={report.markdown} />
          </div>
        )}

          </div>
        </div>

        {/* Timeline scrolls its own region (header stays pinned); graph fills
            the remaining height. */}
        {tab === 'timeline' ? (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="max-w-[1200px] mx-auto px-8 py-6">
              {!vaultRoot ? (
                <div className="text-[13px] text-t3 bg-panel border border-brd rounded-lg p-8 text-center">
                  {t('activity:noVault')}
                </div>
              ) : (
                <>
                  {current && <OngoingTasks tasks={digest?.ongoingTasks ?? []} />}
                  <MetricsGrid
                    cards={cards}
                    selectedType={typeFilter}
                    onSelectType={setTypeFilter}
                  />
                  <TimelineList
                    events={events ?? []}
                    displayByType={displayByType}
                    vaultRoot={vaultRoot}
                  />
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden max-w-[1200px] w-full mx-auto px-8">
            <EntityGraphView vaultRoot={vaultRoot} />
          </div>
        )}
      </div>
      ) : (
        <div className="flex-1 min-w-0 overflow-y-auto">
          <div className="max-w-[1200px] mx-auto px-8 py-5">
            <h1 className="m-0 mb-4 pb-3 border-b border-brd text-[17px] font-semibold text-t1">
              {view === 'collectLog'
                ? t('activity:collectLog.title')
                : t(view === 'collectors' ? 'activity:rail.collectors' : 'activity:rail.reportSettings')}
            </h1>
            {view === 'collectors' ? (
              <CollectorsSettings />
            ) : view === 'collectLog' ? (
              <CollectLogView />
            ) : (
              <ReportSettingsView />
            )}
          </div>
        </div>
      )}

      {collectModalOpen && collectRun && (
        <CollectAllModal run={collectRun} onClose={() => setCollectModalOpen(false)} />
      )}
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
