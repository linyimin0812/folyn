/**
 * Report generation + vault write (design §7.5): deterministic markdown
 * composition from the activity queries (§4.4 double input for daily), written
 * as a real vault note under 活动记录/{日报|周报|月报}/. Conflict rule: the
 * content hash of the last thing WE wrote is kept in the activity-collector
 * settings slice (sidecar, never inside the note); regenerate against an
 * unchanged file → overwrite, against a hand-edited (or unknown) file → append
 * a「重新生成于」section below the original.
 *
 * Report prose is plain templates — no LLM on this path.
 * // ponytail: design's diagram notes cli-adapter for 日报生成, but the
 * structure (metrics table / timeline / ongoing wording) is fixed either way;
 * wiring a CLI agent only to rephrase deterministic sections costs a process
 * spawn + stream plumbing for zero information gain. Upgrade path: pipe
 * `composeReportMarkdown`'s section inputs into a cli-adapter agent as a
 * post-processing step when narrative reports are asked for.
 */

import { dateKey, endOfDay, startOfDay, taskDayProgress, weekNumber } from '@/components/activity/period';
import type { ActivityEventRow, ActivityMetricRow } from './api';
import { aggregateActivityMetrics, getActivityDailyDigestInput, listActivityEvents } from './api';
import { metricCardsFromRows } from '@/components/activity/display';
import type { MetricCard } from '@/components/activity/display';
import type { DisplayIndexEntry } from './registry';

export type ReportPeriod = 'daily' | 'weekly' | 'monthly';
export type ReportWriteMode = 'created' | 'overwritten' | 'appended';

/** Vault root folder for all activity reports (design §7.5 default). */
// ponytail: fixed folder — a user-configurable root is a settings field away
// when someone asks for it; locale-independent so paths survive a switch.
export const REPORT_ROOT = '活动记录';

const PERIOD_DIRS: Record<ReportPeriod, string> = {
  daily: '日报',
  weekly: '周报',
  monthly: '月报',
};

/** Zero-padded 2-digit week number ({WW} in the design's path rule). */
export function weekKey(d: Date): string {
  return `${d.getFullYear()}-W${String(weekNumber(d)).padStart(2, '0')}`;
}

/** Period key used in both the filename and frontmatter `date`. */
export function reportPeriodKey(mode: ReportPeriod, start: Date): string {
  if (mode === 'weekly') return weekKey(start);
  if (mode === 'monthly') return dateKey(start).slice(0, 7);
  return dateKey(start);
}

/** Vault-relative note path: 活动记录/日报/2026-09-23.md etc. */
export function reportRelPath(mode: ReportPeriod, start: Date): string {
  return `${REPORT_ROOT}/${PERIOD_DIRS[mode]}/${reportPeriodKey(mode, start)}.md`;
}

// ── Markdown composition (pure, unit-tested) ─────────────────────────────────

export interface ReportEventInput {
  occurredAt: number;
  type: string;
  title?: string | null;
  summary?: string | null;
}

export interface ReportOngoingTask {
  name: string;
  current: number;
  total: number;
  /** The report day has a task event → §4.4 "完成/更新" branch. */
  updatedToday: boolean;
}

/** Localized strings + formatters injected by the caller (i18n-owned). */
export interface ReportStrings {
  /** Period label: 日报 / 周报 / 月报. */
  label: string;
  metricsHeading: string;
  metricCol: string;
  valueCol: string;
  timelineHeading: string;
  emptyTimeline: string;
  ongoingHeading: string;
  updatedTask: (name: string) => string;
  ongoingTask: (name: string, current: number, total: number) => string;
  regeneratedAt: (time: string) => string;
  notifyText: (label: string) => string;
}

export function frontmatterBlock(
  mode: ReportPeriod,
  periodKey: string,
  generatedAt: string,
): string {
  return [
    '---',
    'type: activity-report',
    `period: ${mode}`,
    `date: ${periodKey}`,
    `generated_at: ${generatedAt}`,
    '---',
  ].join('\n');
}

export function composeReportMarkdown(input: {
  mode: ReportPeriod;
  periodKey: string;
  generatedAt: string;
  metrics: Pick<MetricCard, 'label' | 'value'>[];
  events: ReportEventInput[];
  ongoingTasks: ReportOngoingTask[];
  formatTime: (ms: number) => string;
  s: ReportStrings;
}): string {
  const { mode, periodKey, generatedAt, metrics, events, ongoingTasks, formatTime, s } = input;
  const lines: string[] = [
    frontmatterBlock(mode, periodKey, generatedAt),
    '',
    `# ${s.label} · ${periodKey}`,
  ];

  if (metrics.length > 0) {
    lines.push(
      '',
      `## ${s.metricsHeading}`,
      '',
      `| ${s.metricCol} | ${s.valueCol} |`,
      '| --- | --- |',
    );
    for (const m of metrics) lines.push(`| ${m.label} | ${m.value} |`);
  }

  lines.push('', `## ${s.timelineHeading}`);
  if (events.length === 0) {
    lines.push('', s.emptyTimeline);
  } else {
    // Chronological (read-time order) for the report, unlike the UI's reverse.
    const sorted = [...events].sort((a, b) => a.occurredAt - b.occurredAt);
    for (const e of sorted) {
      const head = `- ${formatTime(e.occurredAt)} · ${e.type} · ${e.title || ''}`.replace(/\s+$/, '');
      lines.push(e.summary ? `${head} — ${e.summary}` : head);
    }
  }

  if (mode === 'daily' && ongoingTasks.length > 0) {
    lines.push('', `## ${s.ongoingHeading}`, '');
    for (const task of ongoingTasks) {
      lines.push(
        task.updatedToday
          ? `- ${s.updatedTask(task.name)}`
          : `- ${s.ongoingTask(task.name, task.current, task.total)}`,
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

// ── Conflict handling (pure) ─────────────────────────────────────────────────

/** Deterministic content hash (djb2, hex). Change detection only — not crypto. */
export function hashContent(content: string): string {
  let h = 5381;
  for (let i = 0; i < content.length; i++) h = ((h * 33) ^ content.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

/**
 * Overwrite-vs-append (design §7.5): no existing file → created; file content
 * still matches the hash we recorded at our last write → overwritten; anything
 * else (hand-edited, or no hash recorded) → appended.
 */
export function decideWriteMode(
  existingContent: string | null,
  storedHash: string | undefined,
): ReportWriteMode {
  if (existingContent == null) return 'created';
  if (storedHash != null && storedHash === hashContent(existingContent)) return 'overwritten';
  return 'appended';
}

export function stripFrontmatter(md: string): string {
  return md.replace(/^---\n[\s\S]*?\n---\n/, '');
}

/** Appended write: original preserved, new body (frontmatter stripped) below. */
export function appendRegeneration(
  existing: string,
  freshMarkdown: string,
  regenTime: string,
  s: ReportStrings,
): string {
  return `${existing.replace(/\s+$/, '')}\n\n## ${s.regeneratedAt(regenTime)}\n\n${stripFrontmatter(freshMarkdown).replace(/^\s+/, '')}\n`;
}

// ── Orchestration (I/O) ──────────────────────────────────────────────────────

export interface GenerateReportOptions {
  vaultRoot: string;
  mode: ReportPeriod;
  start: Date;
  end: Date;
  displayByType: Record<string, DisplayIndexEntry>;
  metricLabel: (metricId: string) => string;
  formatTime: (ms: number) => string;
  formatDateTime: (ms: number) => string;
  s: ReportStrings;
}

export interface GeneratedReport {
  path: string;
  mode: ReportWriteMode;
  markdown: string;
}

/** Task entity metadata (materialized by ingest, design §4.4). */
interface TaskMeta {
  status?: unknown;
  taskId?: unknown;
  startDate?: unknown;
  dueDate?: unknown;
}

/**
 * Gather input, compose, and write the report for the currently selected
 * period. Daily uses `activity_daily_digest_input` (events + ongoingTasks
 * double input, §4.4); weekly/monthly use range queries, no ongoing section.
 * Returns the written note's path + write mode + full content for preview.
 */
export async function generateReport(opts: GenerateReportOptions): Promise<GeneratedReport> {
  const { vaultRoot, mode, start, end, displayByType, metricLabel, s } = opts;
  // Period `end` is a start-of-day Date (daily: end == start) — widen to the
  // end of that day, same as the page's own range, or the last day drops out.
  const range = { from: startOfDay(start).getTime(), to: endOfDay(end).getTime() };

  let events: ActivityEventRow[];
  const ongoing: ReportOngoingTask[] = [];
  if (mode === 'daily') {
    const digest = await getActivityDailyDigestInput(vaultRoot, dateKey(start));
    events = digest?.events ?? [];
    for (const task of digest?.ongoingTasks ?? []) {
      const meta = (task.metadata ?? {}) as TaskMeta;
      const startDate = typeof meta.startDate === 'number' ? meta.startDate : null;
      const dueDate = typeof meta.dueDate === 'number' ? meta.dueDate : null;
      const name = task.displayName || task.identityKey;
      // "The report day has a task event" = a task-type event whose taskId
      // resolves to this entity (identityKey == taskId in the ingest mapping).
      const taskId = typeof meta.taskId === 'string' ? meta.taskId : task.identityKey;
      const updatedToday = events.some(
        (e) => e.type === 'task' && (e.payload as { taskId?: unknown } | null)?.taskId === taskId,
      );
      ongoing.push({
        name,
        updatedToday,
        ...(startDate != null && dueDate != null
          ? taskDayProgress(startDate, dueDate, start)
          : { current: 0, total: 0 }),
      });
    }
  } else {
    events = await listActivityEvents(vaultRoot, range);
  }

  const metricRows: ActivityMetricRow[] = await aggregateActivityMetrics(vaultRoot, range);
  const metrics = metricCardsFromRows(metricRows, displayByType, metricLabel, metricLabel);

  const generatedAt = new Date();
  const path = reportRelPath(mode, start);
  const periodKey = reportPeriodKey(mode, start);
  const markdown = composeReportMarkdown({
    mode,
    periodKey,
    generatedAt: generatedAt.toISOString(),
    metrics,
    events,
    ongoingTasks: ongoing,
    formatTime: opts.formatTime,
    s,
  });

  // ── write via the vault's own chokepoint (design §7.5: 核心直连 vault) ──
  const { useVaultStore } = await import('@/store/vaultStore');
  const { useActivityCollectorStore } = await import('@/store/activityCollectorStore');
  let existing: string | null = null;
  try {
    existing = await useVaultStore.getState().readFile(path);
  } catch {
    existing = null;
  }
  const storedHash = useActivityCollectorStore.getState().reportHashes[path];
  const writeMode = decideWriteMode(existing, storedHash);
  const content =
    writeMode === 'appended' && existing != null
      ? appendRegeneration(existing, markdown, opts.formatDateTime(generatedAt.getTime()), s)
      : markdown;
  await useVaultStore.getState().writeFile(path, content);
  // Record the hash only when we authored the WHOLE file. After an append we
  // must not: matching it on the next regen would overwrite the file and
  // silently delete the manual edits the append was supposed to preserve —
  // a once-appended path keeps appending (design §7.5).
  if (writeMode !== 'appended') {
    useActivityCollectorStore.getState().setReportHash(path, hashContent(content));
  }
  void useVaultStore.getState().refreshFileTree();

  void notifyReportGenerated(s, path);
  return { path, mode: writeMode, markdown: content };
}

/**
 * Pet notification after a write (design §7.6). Calls the main-window
 * dispatcher directly — the same chokepoint the external POST /pet/action
 * route feeds (pet_api mod.rs emits `pet://notify` → dispatchNotification),
 * minus the localhost HTTP round trip. Clicking the notification opens the
 * report note in the editor (target.kind 'file'). Failure is silent-log: the
 * pet may be off.
 */
async function notifyReportGenerated(s: ReportStrings, path: string): Promise<void> {
  try {
    const { dispatchNotification } = await import('@/services/petNotifyDispatcher');
    await dispatchNotification({
      kind: 'info',
      title: 'Folyn',
      text: s.notifyText(s.label),
      source: 'activity',
      target: { kind: 'file', id: path },
    });
  } catch (err) {
    console.warn('[activity] pet notify failed (pet may be off):', err);
  }
}
