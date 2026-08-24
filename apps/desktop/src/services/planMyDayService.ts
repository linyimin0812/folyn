// AI 规划今日 (Plan My Day) — headless service.
//
// Pattern B (AI as JSON advisor): gather today's context → call the AI → parse a
// structured plan JSON → expose an apply function the UI calls after the user
// accepts per-item. Mirrors clipService's adapter-call + JSON-parse + error-handling
// shape; reuses scheduleStore actions for apply. No UI here (PR2 wires the button).
//
// NOTE on time units: scheduleStore / schedule/types.ts store `start`/`end`/
// `scheduledStart`/`scheduledEnd` as **hour floating** (9.5 == 09:30), NOT minutes
// since midnight. The plan JSON follows the same convention so apply can feed
// scheduleStore directly. (prd.md says "minutes since midnight" — that is a doc
// error; the store is the source of truth.)

import { createAdapter } from '@folyn/cli-adapter';
import { useVaultStore } from '@/store/vaultStore';
import { useAiConfigStore, getFeatureAdapter, getFeatureCliPath } from '@/store/aiConfigStore';
import { useScheduleStore } from '@/store/scheduleStore';
import { collectTextFromStream, extractJsonObject, type StreamEvent } from './aiStreamUtils';
import { resolveBasePath } from '@/utils/pathResolver';
import { dateToString } from '@/features/schedule/dailyScan';
import type { ScheduleEvent, ScheduleTask } from '@/features/schedule/types';

// ponytail: prompt previously lived in services/skillDefaults.ts and was
// overridable via the Skills settings page. After removing that page the
// template is inlined here. Kept independent of clipService to avoid pulling
// clipParse (excalidraw / roughjs) into this module's import graph — the test
// suite breaks on open-color.json import in this pnpm+node environment.
const CLIP_CARD_PROMPT = `# Web Clip Card Generation

你是一个网页内容分析助手。请按照以下步骤分析网页内容并生成结构化知识卡片。

## 重要规则
- **不要使用 Write 或任何文件创建工具将结果保存到磁盘。** 应用会自动处理保存。
- 只在回复文本中输出 JSON 结果。

## 步骤

1. **获取网页内容**：使用 WebFetch 工具获取用户提供的 URL 内容
2. **分析内容**：阅读并理解网页的核心主题、关键信息
3. **生成知识卡片**：按照下方 JSON 格式输出结构化卡片

## 输出格式

请以 JSON 格式回复（不要使用 markdown 代码块包裹）：
{
  "title": "网页标题",
  "tags": ["tag1", "tag2", "tag3"],
  "suggestedTags": ["tag4", "tag5", "tag6", "tag7", "tag8"],
  "summary": "2-4句话概括核心内容",
  "keyPoints": [
    "要点1: 一句话描述关键信息",
    "要点2: 一句话描述关键信息",
    "要点3: 一句话描述关键信息"
  ]
}

## 规则
- tags 字段生成恰好 3-5 个简洁的关键词标签
- suggestedTags 字段额外提供 5-8 个候选标签，供用户选择添加
- 摘要概括核心内容，2-4句话
- 要点提取3-8条最重要的信息，每条一句话
- 所有输出内容使用与网页内容相同的语言`;

// ── Types ─────────────────────────────────────────────────────────────────────

/** A today event the AI must respect (busy time). */
export interface PlanContextEvent {
  title: string;
  /** hour floating, 9.5 == 09:30 */
  start: number;
  /** hour floating */
  end: number;
  note?: string;
}

/** An unfinished backlog task from the last 7 days. */
export interface PlanContextTask {
  id: string;
  title: string;
  priority?: string;
  /** MM-DD due */
  due?: string;
  category?: string;
  scheduledStart?: number;
  scheduledEnd?: number;
  /** YYYY-MM-DD — the daily note this task lives in (creation date) */
  sourceDate: string;
}

/** Serialized context fed to the AI prompt. */
export interface PlanContext {
  /** YYYY-MM-DD */
  today: string;
  todayEvents: PlanContextEvent[];
  backlog: PlanContextTask[];
}

/** An existing backlog task the AI proposes to schedule into today. */
export interface PlannedScheduledTask {
  /** existing scheduleStore task id (`${noteDate}#${lineIndex}`) */
  taskId: string;
  /** hour floating */
  start: number;
  /** hour floating */
  end: number;
  priority?: number;
}

/** A brand-new task the AI proposes (no existing id — create then schedule). */
export interface PlannedNewTask {
  title: string;
  /** hour floating */
  start: number;
  /** hour floating */
  end: number;
  priority?: number;
}

/** A brand-new calendar event the AI proposes (e.g. break/buffer block). */
export interface PlannedEvent {
  title: string;
  /** hour floating */
  start: number;
  /** hour floating */
  end: number;
  note?: string;
}

/** The parsed AI plan. */
export interface Plan {
  scheduledTasks: PlannedScheduledTask[];
  newTasks: PlannedNewTask[];
  newEvents: PlannedEvent[];
  notes: string;
}

/** Per-item accept selection (indices into the corresponding Plan arrays). */
export interface PlanAcceptance {
  scheduledTaskIndices: number[];
  newTaskIndices: number[];
  newEventIndices: number[];
}

export interface ApplyFailure {
  item: string;
  error: string;
}

export interface ApplyResult {
  applied: string[];
  failed: ApplyFailure[];
}

// ── Context gather ────────────────────────────────────────────────────────────

function isUnfinished(task: ScheduleTask): boolean {
  // `done` is the source of truth (see schedule/types.ts); column is derived.
  return !task.done;
}

function eventToContext(e: ScheduleEvent): PlanContextEvent {
  return {
    title: e.title,
    start: e.start,
    end: e.end,
    note: e.note,
  };
}

function taskToContext(t: ScheduleTask): PlanContextTask {
  return {
    id: t.id,
    title: t.title,
    priority: t.priority,
    due: t.due,
    category: t.category,
    scheduledStart: t.scheduledStart,
    scheduledEnd: t.scheduledEnd,
    sourceDate: t.noteDate,
  };
}

/**
 * Gather today's existing events + the last 7 days' unfinished task backlog.
 * Pure: reads scheduleStore snapshots only. The 7-day window is inclusive of
 * today (today-6 .. today) and keyed by each task's `noteDate` (creation date).
 */
export function gatherPlanContext(): PlanContext {
  const today = dateToString(new Date());
  const { events, tasks } = useScheduleStore.getState();

  const todayEvents = events
    .filter((e) => e.noteDate === today)
    .map(eventToContext);

  // Build the set of YYYY-MM-DD strings in [today-6, today].
  const windowDates = new Set<string>();
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  for (let i = 6; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(d.getDate() - i);
    windowDates.add(dateToString(d));
  }

  const backlog = tasks
    .filter((t) => windowDates.has(t.noteDate) && isUnfinished(t))
    .map(taskToContext);

  return { today, todayEvents, backlog };
}

// ── Prompt builder ────────────────────────────────────────────────────────────

/**
 * Build the AI prompt. Instructs: S2 scope (schedule backlog into free slots +
 * may propose a few new tasks/breaks; do NOT move/shorten existing events; no
 * cross-day carry-over), T2 (AI decides work hours/breaks/granularity freely
 * but keep within reasonable hours and DON'T double-book existing events), and
 * STRICT JSON output matching the Plan shape. Times are hour floating.
 */
export function buildPlanPrompt(ctx: PlanContext): string {
  const eventsLine =
    ctx.todayEvents.length > 0
      ? ctx.todayEvents
          .map(
            (e) =>
              `  - { title: ${JSON.stringify(e.title)}, start: ${e.start}, end: ${e.end}${e.note ? `, note: ${JSON.stringify(e.note)}` : ''} }`,
          )
          .join('\n')
      : '  (none)';

  const backlogLine =
    ctx.backlog.length > 0
      ? ctx.backlog
          .map(
            (t) =>
              `  - { id: ${JSON.stringify(t.id)}, title: ${JSON.stringify(t.title)}, priority: ${t.priority ? JSON.stringify(t.priority) : '"med"'}, due: ${t.due ? JSON.stringify(t.due) : 'null'}, category: ${t.category ? JSON.stringify(t.category) : 'null'}, sourceDate: ${JSON.stringify(t.sourceDate)} }`,
          )
          .join('\n')
      : '  (none — no unfinished tasks in the last 7 days; you may propose a light plan or a few starter tasks)';

  return [
    '你是一位日程规划助手。请为今天（' + ctx.today + '）生成一份时间块化的日程计划。',
    '',
    '## 规划规则',
    '- S2 范围：将下方 backlog 中的未完成任务排进今日的空闲时段；可额外提议少量新任务或必要的休息/缓冲块。',
    '- 不得移动或缩短已有的今日事件；不得跨天延续（仅规划今天）。',
    '- T2：你可自由决定工作时段、休息、颗粒度，但须保持在合理时段内（例如 7:00–23:00），且绝不可与已有事件冲突（不要双排）。',
    '- 把 backlog 任务排进 `scheduledTasks`（带 taskId）；新提议的任务放进 `newTasks`（带 title，不含 taskId）；新提议的事件/休息/缓冲放进 `newEvents`。',
    '- 时间一律用 **小时浮点**（9.5 表示 09:30，14.0 表示 14:00），与下方已有事件单位一致。',
    '- 若 backlog 为空，可提议一份轻量计划或若干起步任务。',
    '',
    '## 今日已有事件（必须避让）',
    eventsLine,
    '',
    '## 最近 7 天未完成任务 backlog',
    backlogLine,
    '',
    '## 输出格式',
    '只返回一个 JSON 对象，不要任何解释文字、不要 markdown 代码块。结构如下：',
    '{',
    '  "scheduledTasks": [',
    '    { "taskId": "<backlog 任务的 id>", "start": <小时浮点>, "end": <小时浮点>, "priority": <1-5 数字, 可选> }',
    '  ],',
    '  "newTasks": [',
    '    { "title": "<新任务标题>", "start": <小时浮点>, "end": <小时浮点>, "priority": <1-5 数字, 可选> }',
    '  ],',
    '  "newEvents": [',
    '    { "title": "<事件/休息标题>", "start": <小时浮点>, "end": <小时浮点>, "note": "<可选备注>" }',
    '  ],',
    '  "notes": "<对本次计划的简短说明>"',
    '}',
  ].join('\n');
}

// ── AI call ───────────────────────────────────────────────────────────────────

/**
 * Parse the AI text into a Plan. Extracts the first {...} block (like clipService)
 * and tolerates surrounding prose. Throws a friendly Chinese error on failure.
 */
export function parsePlan(aiText: string): Plan {
  const jsonStr = extractJsonObject(aiText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr ?? aiText);
  } catch {
    throw new Error('AI 返回的计划无法解析');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('AI 返回的计划无法解析');
  }
  const obj = parsed as Record<string, unknown>;
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

  const scheduledTasks = arr(obj.scheduledTasks).map((item): PlannedScheduledTask => {
    const it = item as Record<string, unknown>;
    return {
      taskId: typeof it.taskId === 'string' ? it.taskId : '',
      start: typeof it.start === 'number' ? it.start : 0,
      end: typeof it.end === 'number' ? it.end : 0,
      priority: typeof it.priority === 'number' ? it.priority : undefined,
    };
  });

  const newTasks = arr(obj.newTasks).map((item): PlannedNewTask => {
    const it = item as Record<string, unknown>;
    return {
      title: typeof it.title === 'string' ? it.title : '',
      start: typeof it.start === 'number' ? it.start : 0,
      end: typeof it.end === 'number' ? it.end : 0,
      priority: typeof it.priority === 'number' ? it.priority : undefined,
    };
  });

  const newEvents = arr(obj.newEvents).map((item): PlannedEvent => {
    const it = item as Record<string, unknown>;
    return {
      title: typeof it.title === 'string' ? it.title : '',
      start: typeof it.start === 'number' ? it.start : 0,
      end: typeof it.end === 'number' ? it.end : 0,
      note: typeof it.note === 'string' ? it.note : undefined,
    };
  });

  return {
    scheduledTasks,
    newTasks,
    newEvents,
    notes: typeof obj.notes === 'string' ? obj.notes : '',
  };
}

/**
 * Call the AI to generate a plan. Mirrors clipService.generateClip: start the
 * adapter, send the prompt, collect the stream, parse JSON, stop the adapter in
 * `finally`. On parse failure throws a friendly error and applies nothing.
 */
export async function generatePlan(
  ctx: PlanContext,
  onProgress?: (msg: string) => void,
  onStream?: (chunk: string) => void,
  onEvent?: (event: StreamEvent) => void,
): Promise<Plan> {
  const vault = useVaultStore.getState();
  if (!vault.currentVault) throw new Error('没有活跃的 vault');

  onProgress?.('AI 正在规划今日...');
  const aiConfig = useAiConfigStore.getState();
  const basePath = await resolveBasePath(vault.currentVault.basePath);

  const adapter = createAdapter(getFeatureAdapter('schedule', aiConfig));
  await adapter.start({ cliPath: getFeatureCliPath('schedule', aiConfig), workingDir: basePath });

  try {
    const basePrompt = buildPlanPrompt(ctx);
    const prompt = `${CLIP_CARD_PROMPT}\n\n## Task\n${basePrompt}`;

    const textPromise = collectTextFromStream(adapter, onStream, onEvent);
    await adapter.send(prompt);
    const aiText = await textPromise;

    return parsePlan(aiText);
  } finally {
    await adapter.stop();
  }
}

// ── Apply ─────────────────────────────────────────────────────────────────────

/**
 * Resolve the id of a task just created by `quickAddTask`. `quickAddTask` returns
 * void and `addTask` assigns the real id (`${noteDate}#${lineIndex}`) during
 * mutateNote's re-parse. So: snapshot existing ids before, then after the call
 * find the new task in today's noteDate whose id is fresh and whose title matches.
 *
 * `consumed` tracks ids already resolved in this apply pass so that two new
 * tasks sharing the same title don't collapse onto the first created task —
 * each quickAddTask call is resolved to a distinct fresh id.
 */
function resolveNewTaskId(
  beforeIds: Set<string>,
  consumed: Set<string>,
  title: string,
  today: string,
): string | null {
  const tasks = useScheduleStore.getState().tasks;
  const created = tasks.find(
    (t) =>
      !beforeIds.has(t.id) &&
      !consumed.has(t.id) &&
      t.noteDate === today &&
      t.title === title,
  );
  if (created) consumed.add(created.id);
  return created ? created.id : null;
}

function describeScheduledItem(p: PlannedScheduledTask): string {
  return `scheduledTask(${p.taskId} @ ${p.start}-${p.end})`;
}

function describeNewTask(p: PlannedNewTask): string {
  return `newTask(${p.title} @ ${p.start}-${p.end})`;
}

function describeEvent(p: PlannedEvent): string {
  return `newEvent(${p.title} @ ${p.start}-${p.end})`;
}

/**
 * Apply ONLY the accepted plan items via scheduleStore. Fail-soft: each item is
 * wrapped in try/catch; one failure does not abort the rest.
 *
 * Apply order (per prd.md): create new tasks first (capture their ids) →
 * scheduleTask for all scheduled items (existing + newly created) → addEvent for
 * new events. Returns { applied, failed }.
 */
export async function applyPlan(plan: Plan, accepted: PlanAcceptance): Promise<ApplyResult> {
  const store = useScheduleStore.getState();
  const today = dateToString(new Date());

  const applied: string[] = [];
  const failed: ApplyFailure[] = [];

  // 1. Create accepted new tasks; then schedule each into its proposed slot
  //    (create-then-schedule). The new id is resolved by diffing the task list
  //    before/after quickAddTask (see resolveNewTaskId).
  const beforeIds = new Set(useScheduleStore.getState().tasks.map((t) => t.id));
  const consumedNewIds = new Set<string>();
  for (const idx of accepted.newTaskIndices) {
    const p = plan.newTasks[idx];
    if (!p) {
      failed.push({ item: `newTask[index=${idx}]`, error: 'index out of range' });
      continue;
    }
    try {
      await store.quickAddTask(p.title);
      const id = resolveNewTaskId(beforeIds, consumedNewIds, p.title, today);
      if (!id) {
        throw new Error('创建后无法定位新任务 id');
      }
      // Schedule the newly created task into its proposed slot. Wrapped
      // separately so a schedule failure is recorded without masking the
      // successful creation.
      try {
        await useScheduleStore.getState().scheduleTask(id, today, p.start, p.end);
        applied.push(`${describeNewTask(p)} → created ${id} & scheduled`);
      } catch (err) {
        applied.push(`${describeNewTask(p)} → created ${id}`);
        failed.push({ item: `${describeNewTask(p)} (schedule)`, error: String(err) });
      }
    } catch (err) {
      failed.push({ item: describeNewTask(p), error: String(err) });
    }
  }

  // 2. Schedule accepted existing tasks. (New tasks created in step 1 carry
  //    their own start/end in the plan and are scheduled immediately after
  //    creation — see step 1b below — so they don't need a separate pass.)
  for (const idx of accepted.scheduledTaskIndices) {
    const p = plan.scheduledTasks[idx];
    if (!p) {
      failed.push({ item: `scheduledTask[index=${idx}]`, error: 'index out of range' });
      continue;
    }
    try {
      await useScheduleStore.getState().scheduleTask(p.taskId, today, p.start, p.end);
      applied.push(`${describeScheduledItem(p)} → scheduled`);
    } catch (err) {
      failed.push({ item: describeScheduledItem(p), error: String(err) });
    }
  }

  // 3. Add accepted new events.
  for (const idx of accepted.newEventIndices) {
    const p = plan.newEvents[idx];
    if (!p) {
      failed.push({ item: `newEvent[index=${idx}]`, error: 'index out of range' });
      continue;
    }
    try {
      await useScheduleStore.getState().addEvent(today, {
        title: p.title,
        start: p.start,
        end: p.end,
        note: p.note,
      });
      applied.push(`${describeEvent(p)} → added`);
    } catch (err) {
      failed.push({ item: describeEvent(p), error: String(err) });
    }
  }

  return { applied, failed };
}
