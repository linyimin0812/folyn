// 日程工作台数据模型。事件与任务持久化在 daily notes 的 markdown 中
// （见 markdown.ts 的解析/序列化约定）。

export type TaskCategory = 'design' | 'dev' | 'bug' | 'growth' | 'ops' | 'calendar' | 'learn';
/** 看板列 id（自由字符串，由 settings.boardColumns 定义） */
export type TaskColumn = string;
export type Priority = 'high' | 'med' | 'low';

/** 看板列定义（用户可自定义，持久化在 settings） */
export interface BoardColumnDef {
  id: string;
  name: string;
  color: string;
  /** 标记为"完成"列：勾选任务时任务移入此列 */
  isDone?: boolean;
}

/** daily note 中的日历事件（`## 日程` 段内 `- @event ...` 行） */
export interface ScheduleEvent {
  /** 稳定 id = `${noteDate}#${lineIndex}` */
  id: string;
  /** 所属 daily note 的日期 YYYY-MM-DD */
  noteDate: string;
  /** 开始时间（小时浮点，9.5 = 09:30） */
  start: number;
  /** 结束时间（小时浮点） */
  end: number;
  title: string;
  note?: string;
  /** 在源文件中的行号，用于写回定位 */
  lineIndex: number;
}

/** daily note 中的任务（`## 任务` 段内 `- [ ] ...@{...}` 行） */
export interface ScheduleTask {
  /** 稳定 id = `${noteDate}#${lineIndex}` */
  id: string;
  /** 所属 daily note 的日期 YYYY-MM-DD（创建日） */
  noteDate: string;
  title: string;
  /** 描述（可选，存为 `desc:"..."` 属性）。不支持内嵌双引号。 */
  desc?: string;
  column: TaskColumn;
  category: TaskCategory;
  priority: Priority;
  /** 截止日 MM-DD */
  due?: string;
  /** 已排程日期 YYYY-MM-DD（来自 sched 标签） */
  scheduledDate?: string;
  /** 已排程开始时间（小时浮点） */
  scheduledStart?: number;
  /** 已排程结束时间（小时浮点） */
  scheduledEnd?: number;
  /** 进度 0-100 */
  progress: number;
  /** 子任务数（手动计数，v1） */
  subtasks: number;
  /** 负责人首字母列表 */
  assignees: string[];
  /** 是否完成（source of truth；勾选/完成列派生） */
  done: boolean;
  /** 在源文件中的行号，用于写回定位 */
  lineIndex: number;
  /**
   * 托管属性块中不被 ScheduleTask 固定字段覆盖的未知属性（如 `topic:<slug>` /
   * `unit:<n>` 回链）。解析时收集、序列化时原样透传，保证 schedule 侧对任务行
   * 的任何写回（勾选/移动/排程）不会丢弃外部 feature 赖以回链的自由属性。
   */
  extraAttrs?: Record<string, string>;
}

/** 一个 daily note 解析后的结构 */
export interface ParsedDaily {
  /** 完整文件按行切分（含未托管行，写回时原样保留） */
  rawLines: string[];
  events: ScheduleEvent[];
  tasks: ScheduleTask[];
}

export const TASK_CATEGORIES: TaskCategory[] = ['design', 'dev', 'bug', 'growth', 'ops', 'calendar', 'learn'];
export const PRIORITIES: Priority[] = ['high', 'med', 'low'];

/** 默认看板列（与原硬编码 4 列一致） */
export const DEFAULT_BOARD_COLUMNS: BoardColumnDef[] = [
  { id: 'todo', name: '待办', color: 'var(--t3)' },
  { id: 'doing', name: '进行中', color: 'var(--acc)' },
  { id: 'review', name: '评审', color: 'var(--amber)' },
  { id: 'done', name: '已完成', color: 'var(--green)', isDone: true },
];

/** 新建列时轮转的颜色调色板 */
export const COLUMN_COLOR_PALETTE: string[] = [
  'var(--acc)', 'var(--purple)', 'var(--amber)', 'var(--green)',
  'var(--cyan)', 'var(--red)', 'var(--t3)',
];

// ponytail: TASK_CATEGORY_LABEL / DIFFICULTY_LABEL
// are display-label maps retained for legacy callers (e.g. feature/markdown.ts
// which bakes difficulty labels into persisted markdown data). UI display
// sites now use t('schedule:category.<id>') / t('schedule:difficulty.<id>')
// directly. Lift the markdown.ts label to i18n when display-site refactor
// (rendered label vs persisted data) is in scope.
export const TASK_CATEGORY_LABEL: Record<TaskCategory, string> = {
  design: '设计',
  dev: '研发',
  bug: 'Bug',
  growth: '增长',
  ops: '运维',
  calendar: '日历',
  learn: '学习',
};
