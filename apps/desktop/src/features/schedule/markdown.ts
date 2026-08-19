// daily note 的解析/序列化。事件写在 `## 日程` 段，任务写在 `## 任务` 段。
// 写回策略：只重写匹配托管正则的行；新记录追加到段尾；其余行（含段内散文、
// 其它段、标题、空行）一律原样保留。未带 `@{...}` 的普通 `- [ ]` 复选框视为
// 未托管，绝不改写。

import type {
  ParsedDaily,
  ScheduleEvent,
  ScheduleTask,
  EventCategory,
  TaskCategory,
  Priority,
} from './types';

const SECTION_EVENT = '日程';
const SECTION_TASK = '任务';

// - @event 09:00-10:00 | work | 标题 | 备注
const EVENT_RE = /^- @event\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})\s*\|\s*(\w+)\s*\|\s*(.+?)(?:\s*\|\s*(.+))?$/;
// - [ ] 标题 @{col:todo cat:dev prio:med due:06-29 prog:0 sub:0 as:YL}
const TASK_RE = /^- \[([ x])\] (.+?)\s+@\{([^}]*)\}\s*$/;
const ATTR_RE = /(\w+):(\S+)/g;
const H2_RE = /^##\s+(.+?)\s*#*\s*$/;

/** HH:MM → 小时浮点（9.5 = 09:30）。非法返回 NaN。 */
export function parseTime(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return NaN;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return NaN;
  return h + mm / 60;
}

/** 小时浮点 → HH:MM */
export function formatTime(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function parseAttrBlock(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(block)) !== null) {
    out[m[1]] = m[2];
  }
  return out;
}

function sectionOf(heading: string): 'events' | 'tasks' | null {
  const t = heading.trim();
  if (t === SECTION_EVENT) return 'events';
  if (t === SECTION_TASK) return 'tasks';
  return null;
}

/** 解析一个 daily note 文件内容。noteDate = YYYY-MM-DD（来自文件名）。 */
export function parseDaily(content: string, noteDate: string): ParsedDaily {
  const rawLines = content.split('\n');
  const events: ScheduleEvent[] = [];
  const tasks: ScheduleTask[] = [];
  let section: 'events' | 'tasks' | null = null;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const h2 = H2_RE.exec(line);
    if (h2) {
      section = sectionOf(h2[1]);
      continue;
    }
    if (section === 'events') {
      const m = EVENT_RE.exec(line);
      if (m) {
        const start = parseTime(m[1]);
        const end = parseTime(m[2]);
        if (Number.isNaN(start) || Number.isNaN(end)) continue;
        events.push({
          id: `${noteDate}#${i}`,
          noteDate,
          start,
          end,
          category: m[3] as EventCategory,
          title: m[4].trim(),
          note: m[5]?.trim() || undefined,
          lineIndex: i,
        });
      }
    } else if (section === 'tasks') {
      const m = TASK_RE.exec(line);
      if (m) {
        const done = m[1] === 'x';
        const title = m[2].trim();
        const attrs = parseAttrBlock(m[3]);
        const col = attrs.col || 'todo';
        const sched = attrs.sched;
        let scheduledDate: string | undefined;
        let scheduledStart: number | undefined;
        let scheduledEnd: number | undefined;
        if (sched) {
          // YYYY-MM-DDTHH:MM-HH:MM
          const sm = /^(\d{4}-\d{2}-\d{2})T(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.exec(sched);
          if (sm) {
            scheduledDate = sm[1];
            scheduledStart = parseTime(sm[2]);
            scheduledEnd = parseTime(sm[3]);
          }
        }
        // 收集固定字段未覆盖的未知属性（如 topic:/unit: 回链），原样透传写回。
        const KNOWN_KEYS = new Set([
          'col', 'cat', 'prio', 'due', 'sched', 'prog', 'sub', 'as',
        ]);
        let extraAttrs: Record<string, string> | undefined;
        for (const [k, v] of Object.entries(attrs)) {
          if (!KNOWN_KEYS.has(k)) {
            if (!extraAttrs) extraAttrs = {};
            extraAttrs[k] = v;
          }
        }
        tasks.push({
          id: `${noteDate}#${i}`,
          noteDate,
          title,
          column: col,
          category: (attrs.cat as TaskCategory) || 'dev',
          priority: (attrs.prio as Priority) || 'med',
          due: attrs.due,
          scheduledDate,
          scheduledStart,
          scheduledEnd,
          progress: attrs.prog != null ? clampInt(attrs.prog, 0, 100) : done ? 100 : 0,
          subtasks: attrs.sub != null ? clampInt(attrs.sub, 0, 1e6) : 0,
          assignees: attrs.as ? attrs.as.split(',').map((s) => s.trim()).filter(Boolean) : [],
          done,
          lineIndex: i,
          extraAttrs,
        });
      }
    }
  }

  return { rawLines, events, tasks };
}

function clampInt(s: string, lo: number, hi: number): number {
  const n = parseInt(s, 10);
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

/** 序列化一个事件为规范行。 */
export function buildEventLine(e: ScheduleEvent): string {
  const note = e.note ? ` | ${e.note}` : '';
  return `- @event ${formatTime(e.start)}-${formatTime(e.end)} | ${e.category} | ${e.title}${note}`;
}

/** 序列化一个任务为规范行（含复选框 + 属性块）。 */
export function buildTaskLine(t: ScheduleTask): string {
  const box = t.done ? '[x]' : '[ ]';
  const attrs: string[] = [`col:${t.column}`, `cat:${t.category}`, `prio:${t.priority}`];
  if (t.due) attrs.push(`due:${t.due}`);
  if (t.scheduledDate && t.scheduledStart != null && t.scheduledEnd != null) {
    attrs.push(`sched:${t.scheduledDate}T${formatTime(t.scheduledStart)}-${formatTime(t.scheduledEnd)}`);
  }
  attrs.push(`prog:${t.progress}`, `sub:${t.subtasks}`);
  if (t.assignees.length) attrs.push(`as:${t.assignees.join(',')}`);
  // 透传未知属性（如 topic:/unit: 回链），按键名字典序输出保证幂等。
  if (t.extraAttrs) {
    const keys = Object.keys(t.extraAttrs).sort();
    for (const k of keys) attrs.push(`${k}:${t.extraAttrs[k]}`);
  }
  return `- ${box} ${t.title} @{${attrs.join(' ')}}`;
}

/** 给定解析结果与本 note 的最新 events/tasks，重建文件文本。
 *  - 已有 lineIndex 的记录：原地重写该行。
 *  - 新记录（lineIndex < 0）：追加到对应段尾；段不存在则新建并追加到文件末尾。
 *  - 被删除的行（原 lineIndex 既不在新 events 也不在新 tasks 中）：移除。
 *  - 其余行原样保留。 */
export function serializeDaily(parsed: ParsedDaily, events: ScheduleEvent[], tasks: ScheduleTask[]): string {
  const rawLines = parsed.rawLines.slice();

  // 原行号 → 新行文本（或 null 表示删除）
  const rewrite = new Map<number, string | null>();
  for (const e of events) {
    if (e.lineIndex >= 0 && e.lineIndex < rawLines.length) rewrite.set(e.lineIndex, buildEventLine(e));
  }
  for (const t of tasks) {
    if (t.lineIndex >= 0 && t.lineIndex < rawLines.length) rewrite.set(t.lineIndex, buildTaskLine(t));
  }
  // 被删除的托管行：原 parsed 中存在、但不在新 events/tasks 里的 lineIndex → 标记 null（删除）。
  // 否则 walker 会把原行原样保留，导致跨日移动时旧事件未被删除。
  for (const e of parsed.events) {
    if (e.lineIndex >= 0 && !rewrite.has(e.lineIndex)) rewrite.set(e.lineIndex, null);
  }
  for (const t of parsed.tasks) {
    if (t.lineIndex >= 0 && !rewrite.has(t.lineIndex)) rewrite.set(t.lineIndex, null);
  }

  // 待追加的新记录（lineIndex < 0）
  const newEvents = events.filter((e) => e.lineIndex < 0);
  const newTasks = tasks.filter((t) => t.lineIndex < 0);

  // 找各段的 [headerLine, endLine) 区间（endLine = 下一个 H2 或 EOF）
  const er = findSectionRange(rawLines, SECTION_EVENT);

  const out: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    if (rewrite.has(i)) {
      const v = rewrite.get(i);
      if (v != null) out.push(v);
      // v === null → 删除，跳过
      continue;
    }
    out.push(rawLines[i]);
  }

  // 追加新记录到段尾
  appendToSection(out, er, SECTION_EVENT, newEvents.map(buildEventLine));
  // 任务段在日程段之后时索引会漂移，在 out 上重新查找。
  const tr2 = findSectionRange(out, SECTION_TASK);
  appendToSection(out, tr2, SECTION_TASK, newTasks.map(buildTaskLine));

  return out.join('\n');
}

function findSectionRange(lines: string[], heading: string): { start: number; end: number } | null {
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = H2_RE.exec(lines[i]);
    if (m && m[1].trim() === heading) {
      start = i;
      // end = 下一个 H2 行或 EOF
      let end = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        if (H2_RE.test(lines[j])) { end = j; break; }
      }
      return { start, end };
    }
  }
  return null;
}

/** 把 lines 追加到段尾；段不存在则在文件末尾新建段。原地修改 out。 */
function appendToSection(out: string[], range: { start: number; end: number } | null, heading: string, lines: string[]) {
  if (!lines.length) return;
  if (range) {
    // 在 end 之前插入（保持段在下一个 H2 之前）
    out.splice(range.end, 0, ...lines);
  } else {
    // 段不存在：末尾新建（前导空行）
    if (out.length && out[out.length - 1].trim() !== '') out.push('');
    out.push(`## ${heading}`);
    out.push(...lines);
  }
}

/** 把日期字符串 YYYY-MM-DD 转为今日相对信息（用于 dueState）。
 *  due 形如 "06-29"，无年份 → 取今日年份，跨年修正。 */
export function dueState(due: string | undefined, today = new Date()): '' | 'soon' | 'over' {
  if (!due) return '';
  const m = /^(\d{2})-(\d{2})$/.exec(due);
  if (!m) return '';
  const t = new Date(today);
  t.setHours(0, 0, 0, 0);
  let year = t.getFullYear();
  const dueDate = new Date(year, Number(m[1]) - 1, Number(m[2]));
  // 若 due 已经过去超过半年，视为明年
  if (dueDate.getTime() - t.getTime() < -180 * 86400000) {
    dueDate.setFullYear(year + 1);
  }
  const diff = Math.round((dueDate.getTime() - t.getTime()) / 86400000);
  if (diff < 0) return 'over';
  if (diff <= 1) return 'soon';
  return '';
}
