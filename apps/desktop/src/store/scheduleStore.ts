import { create } from 'zustand';
import { useVaultStore } from './vaultStore';
import { useSettingsStore } from './settingsStore';
import {
  parseDaily,
  serializeDaily,
  formatTime,
} from '@/features/schedule/markdown';
import { dateToString } from '@/features/schedule/dailyScan';
import { getDoneColumnId, getBoardColumns } from '@/features/schedule/columns';
import type {
  EventCategory,
  ParsedDaily,
  ScheduleEvent,
  ScheduleTask,
  TaskColumn,
} from '@/features/schedule/types';
export type { EventCategory, TaskColumn };

interface PomoState {
  mode: 'work' | 'break';
  remaining: number; // seconds
  running: boolean;
  round: number;
}

interface ScheduleState {
  events: ScheduleEvent[];
  tasks: ScheduleTask[];
  loading: boolean;
  lastScan: number;
  calendarFilter: Record<EventCategory, boolean>;
  boardAnchorDate: string; // YYYY-MM-DD

  pomo: PomoState;
  toastMsg: string;
  toastAction: { label: string; run: () => void } | null;
  _toastTimer: ReturnType<typeof setTimeout> | null;

  refresh: () => Promise<void>;
  setCalendarFilter: (cat: EventCategory, on: boolean) => void;
  setBoardAnchorDate: (date: string) => void;

  addEvent: (noteDate: string, e: Omit<ScheduleEvent, 'id' | 'noteDate' | 'lineIndex'>) => Promise<void>;
  moveEvent: (eventId: string, newNoteDate: string, newStart: number, newEnd: number) => Promise<void>;
  updateEvent: (eventId: string, patch: Partial<Pick<ScheduleEvent, 'title' | 'start' | 'end' | 'category' | 'note'>>) => Promise<void>;
  deleteEvent: (eventId: string) => Promise<void>;
  addTask: (noteDate: string, t: Omit<ScheduleTask, 'id' | 'noteDate' | 'lineIndex' | 'done'>) => Promise<void>;
  quickAddTask: (title: string) => Promise<void>;
  toggleTask: (taskId: string) => Promise<void>;
  moveTaskStatus: (taskId: string, col: TaskColumn) => Promise<void>;
  scheduleTask: (taskId: string, date: string, start: number, end: number) => Promise<void>;
  updateTask: (taskId: string, patch: Partial<Pick<ScheduleTask, 'title' | 'scheduledStart' | 'scheduledEnd' | 'category' | 'column' | 'priority'>>) => Promise<void>;
  unscheduleTask: (taskId: string) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  setTaskDue: (taskId: string, dueMmDd: string) => Promise<void>;
  removeBoardColumn: (id: string) => Promise<void>;

  pomoToggle: () => void;
  pomoReset: () => void;
  tickPomo: () => void;
  toast: (msg: string, action?: { label: string; run: () => void }) => void;
}

const POMO_WORK = 25 * 60;
const POMO_BREAK = 5 * 60;

function defaultPomo(): PomoState {
  return { mode: 'work', remaining: POMO_WORK, running: false, round: 1 };
}

/** 读取 noteDate 对应 daily note；不存在则用最小模板新建（不打开 tab）。 */
async function readNoteContent(noteDate: string): Promise<{ content: string; created: boolean }> {
  const vault = useVaultStore.getState();
  const settings = useSettingsStore.getState();
  const dir = settings.dailyNotesDir || '__daily__';
  const path = `${dir}/${noteDate}.md`;
  try {
    const content = await vault.readFile(path);
    return { content, created: false };
  } catch {
    // 不存在 → 新建
  }
  try {
    await vault.createDir(dir);
  } catch {
    // 目录可能已存在
  }
  const content = `---\ntitle: "${noteDate}"\ndate: ${noteDate}\ntags: [daily]\n---\n\n# ${noteDate}\n`;
  return { content, created: true };
}

async function writeNoteContent(noteDate: string, content: string) {
  const vault = useVaultStore.getState();
  const settings = useSettingsStore.getState();
  const dir = settings.dailyNotesDir || '__daily__';
  const path = `${dir}/${noteDate}.md`;
  await vault.writeFile(path, content);
}

/** 对单个 daily note 应用变更：读 → 解析 → fn(返回新 events/tasks) → 序列化 → 写 → 重新解析写回内容 → 刷新文件树。
 *  返回重新解析后的 ParsedDaily（真实 id/lineIndex，与磁盘一致），供调用方更新缓存。 */
async function mutateNote(
  noteDate: string,
  fn: (parsed: ParsedDaily) => { events: ScheduleEvent[]; tasks: ScheduleTask[] },
): Promise<ParsedDaily | null> {
  const { content } = await readNoteContent(noteDate);
  const parsed = parseDaily(content, noteDate);
  const next = fn(parsed);
  const out = serializeDaily(parsed, next.events, next.tasks);
  await writeNoteContent(noteDate, out);
  // 让新创建的 daily note 进入 fileTree，避免随后的 refresh() 因文件不在树中而把它从缓存丢掉。
  useVaultStore.getState().refreshFileTree().catch(() => {});
  // 重新解析写回内容：新增项获得真实 id/lineIndex，与磁盘及后续 refresh() 一致，避免缓存与磁盘错位。
  return parseDaily(out, noteDate);
}

export const useScheduleStore = create<ScheduleState>((set, get) => ({
  events: [],
  tasks: [],
  loading: false,
  lastScan: 0,
  calendarFilter: { work: true, personal: true, family: true, health: true, task: true },
  boardAnchorDate: dateToString(new Date()),
  pomo: defaultPomo(),
  toastMsg: '',
  toastAction: null,
  _toastTimer: null,

  refresh: async () => {
    const vault = useVaultStore.getState();
    const settings = useSettingsStore.getState();
    const dir = settings.dailyNotesDir || '__daily__';
    set({ loading: true });
    const allEvents: ScheduleEvent[] = [];
    const allTasks: ScheduleTask[] = [];
    // 直接列出日记目录，绕过 excludePatterns（__daily__ 默认被排除在 fileTree 之外，
    // 若从 fileTree 扫描会得到空集，导致新增项被随后的 refresh 冲掉）。
    try {
      const entries = await vault.manager.listFiles(dir, false);
      for (const entry of entries) {
        if (entry.type !== 'file') continue;
        const m = /^(\d{4}-\d{2}-\d{2})\.md$/.exec(entry.name);
        if (!m) continue;
        try {
          const content = await vault.readFile(entry.path);
          const parsed = parseDaily(content, m[1]);
          allEvents.push(...parsed.events);
          allTasks.push(...parsed.tasks);
        } catch {
          // 跳过不可读文件
        }
      }
    } catch {
      // 目录尚不存在 → 空状态
    }
    set({ events: allEvents, tasks: allTasks, loading: false, lastScan: Date.now() });
  },

  setCalendarFilter: (cat, on) =>
    set((s) => ({ calendarFilter: { ...s.calendarFilter, [cat]: on } })),

  setBoardAnchorDate: (date) => set({ boardAnchorDate: date }),

  addEvent: async (noteDate, e) => {
    const next = await mutateNote(noteDate, (parsed) => {
      const events = [...parsed.events, { ...e, id: '', noteDate, lineIndex: -1 } as ScheduleEvent];
      return { events, tasks: parsed.tasks };
    });
    if (!next) return;
    set((s) => ({
      events: [...s.events.filter((ev) => ev.noteDate !== noteDate), ...next.events],
    }));
    get().toast('事件已添加到日历');
  },

  moveEvent: async (eventId, newNoteDate, newStart, newEnd) => {
    const ev = get().events.find((e) => e.id === eventId);
    if (!ev) return;
    const oldNoteDate = ev.noteDate;
    const moved: ScheduleEvent = {
      ...ev,
      noteDate: newNoteDate,
      start: newStart,
      end: newEnd,
      id: '',
      lineIndex: -1,
    };
    if (oldNoteDate === newNoteDate) {
      // 同日改时间：原地改该事件行的 start/end
      const next = await mutateNote(oldNoteDate, (parsed) => {
        const events = parsed.events.map((e) =>
          e.id === eventId ? { ...e, start: newStart, end: newEnd } : e,
        );
        return { events, tasks: parsed.tasks };
      });
      if (!next) return;
      set((s) => ({
        events: [...s.events.filter((e) => e.noteDate !== oldNoteDate), ...next.events],
      }));
    } else {
      // 跨日：旧 note 删行 + 新 note 增行
      const oldNext = await mutateNote(oldNoteDate, (parsed) => ({
        events: parsed.events.filter((e) => e.id !== eventId),
        tasks: parsed.tasks,
      }));
      const newNext = await mutateNote(newNoteDate, (parsed) => ({
        events: [...parsed.events, moved],
        tasks: parsed.tasks,
      }));
      if (!oldNext || !newNext) return;
      set((s) => ({
        events: [
          ...s.events.filter((e) => e.noteDate !== oldNoteDate && e.noteDate !== newNoteDate),
          ...oldNext.events,
          ...newNext.events,
        ],
      }));
    }
    get().toast(`已移到 ${newNoteDate} ${formatTime(newStart)}`);
  },

  updateEvent: async (eventId, patch) => {
    const ev = get().events.find((e) => e.id === eventId);
    if (!ev) return;
    const noteDate = ev.noteDate;
    const next = await mutateNote(noteDate, (parsed) => {
      const events = parsed.events.map((e) =>
        e.id === eventId ? { ...e, ...patch } : e,
      );
      return { events, tasks: parsed.tasks };
    });
    if (!next) return;
    set((s) => ({
      events: [...s.events.filter((e) => e.noteDate !== noteDate), ...next.events],
    }));
    get().toast('事件已更新');
  },

  deleteEvent: async (eventId) => {
    const ev = get().events.find((e) => e.id === eventId);
    if (!ev) return;
    const removed: ScheduleEvent = { ...ev };
    const next = await mutateNote(ev.noteDate, (parsed) => ({
      events: parsed.events.filter((e) => e.id !== eventId),
      tasks: parsed.tasks,
    }));
    if (!next) return;
    set((s) => ({
      events: [...s.events.filter((e) => e.noteDate !== ev.noteDate), ...next.events],
    }));
    get().toast(`已删除「${removed.title}」`, {
      label: '撤销',
      run: () => {
        void mutateNote(removed.noteDate, (parsed) => ({
          events: [...parsed.events, { ...removed, id: '', lineIndex: -1 }],
          tasks: parsed.tasks,
        })).then((reparsed) => {
          if (!reparsed) return;
          set((s) => ({
            events: [
              ...s.events.filter((e) => e.noteDate !== removed.noteDate),
              ...reparsed.events,
            ],
          }));
        });
      },
    });
  },

  addTask: async (noteDate, t) => {
    const doneId = getDoneColumnId();
    const next = await mutateNote(noteDate, (parsed) => {
      const done = t.column === doneId;
      const task: ScheduleTask = {
        ...t,
        progress: done ? 100 : t.progress,
        done,
        id: '',
        noteDate,
        lineIndex: -1,
      };
      return { events: parsed.events, tasks: [...parsed.tasks, task] };
    });
    if (!next) return;
    set((s) => ({
      tasks: [...s.tasks.filter((tk) => tk.noteDate !== noteDate), ...next.tasks],
    }));
    get().toast('任务已添加');
  },

  quickAddTask: async (title) => {
    const noteDate = dateToString(new Date());
    await get().addTask(noteDate, {
      title,
      column: 'todo',
      category: 'dev',
      priority: 'med',
      progress: 0,
      subtasks: 0,
      assignees: ['YL'],
    });
  },

  toggleTask: async (taskId) => {
    const task = get().tasks.find((t) => t.id === taskId);
    if (!task) return;
    const doneId = getDoneColumnId() ?? 'done';
    const fallbackCol = getBoardColumns().find((c) => !c.isDone)?.id ?? 'todo';
    const next = await mutateNote(task.noteDate, (parsed) => {
      const tasks = parsed.tasks.map((t) => {
        if (t.id !== taskId) return t;
        const done = !t.done;
        return {
          ...t,
          done,
          column: done ? doneId : fallbackCol,
          progress: done ? 100 : 0,
        };
      });
      return { events: parsed.events, tasks };
    });
    if (!next) return;
    set((s) => ({
      tasks: [...s.tasks.filter((tk) => tk.noteDate !== task.noteDate), ...next.tasks],
    }));
    get().toast(task.done ? '已恢复' : '已标记完成');
  },

  moveTaskStatus: async (taskId, col) => {
    const task = get().tasks.find((t) => t.id === taskId);
    if (!task) return;
    const doneId = getDoneColumnId();
    const next = await mutateNote(task.noteDate, (parsed) => {
      const tasks = parsed.tasks.map((t) => {
        if (t.id !== taskId) return t;
        const done = col === doneId;
        return {
          ...t,
          column: col,
          done,
          progress: done ? 100 : t.progress,
        };
      });
      return { events: parsed.events, tasks };
    });
    if (!next) return;
    set((s) => ({
      tasks: [...s.tasks.filter((tk) => tk.noteDate !== task.noteDate), ...next.tasks],
    }));
  },

  scheduleTask: async (taskId, date, start, end) => {
    const task = get().tasks.find((t) => t.id === taskId);
    if (!task) return;
    const next = await mutateNote(task.noteDate, (parsed) => {
      const tasks = parsed.tasks.map((t) =>
        t.id === taskId ? { ...t, scheduledDate: date, scheduledStart: start, scheduledEnd: end } : t,
      );
      return { events: parsed.events, tasks };
    });
    if (!next) return;
    set((s) => ({
      tasks: [...s.tasks.filter((tk) => tk.noteDate !== task.noteDate), ...next.tasks],
    }));
  },

  updateTask: async (taskId, patch) => {
    const task = get().tasks.find((t) => t.id === taskId);
    if (!task) return;
    const noteDate = task.noteDate;
    const next = await mutateNote(noteDate, (parsed) => {
      const tasks = parsed.tasks.map((t) =>
        t.id === taskId ? { ...t, ...patch } : t,
      );
      return { events: parsed.events, tasks };
    });
    if (!next) return;
    set((s) => ({
      tasks: [...s.tasks.filter((tk) => tk.noteDate !== noteDate), ...next.tasks],
    }));
    get().toast('任务已更新');
  },

  unscheduleTask: async (taskId) => {
    const task = get().tasks.find((t) => t.id === taskId);
    if (!task) return;
    const prevDate = task.scheduledDate;
    const prevStart = task.scheduledStart;
    const prevEnd = task.scheduledEnd;
    if (!prevDate || prevStart == null || prevEnd == null) return;
    const next = await mutateNote(task.noteDate, (parsed) => {
      const tasks = parsed.tasks.map((t) =>
        t.id === taskId
          ? { ...t, scheduledDate: undefined, scheduledStart: undefined, scheduledEnd: undefined }
          : t,
      );
      return { events: parsed.events, tasks };
    });
    if (!next) return;
    set((s) => ({
      tasks: [...s.tasks.filter((tk) => tk.noteDate !== task.noteDate), ...next.tasks],
    }));
    get().toast('已取消排程', {
      label: '撤销',
      run: () => { void get().scheduleTask(taskId, prevDate, prevStart, prevEnd); },
    });
  },

  deleteTask: async (taskId) => {
    const task = get().tasks.find((t) => t.id === taskId);
    if (!task) return;
    const removed: ScheduleTask = { ...task };
    const noteDate = task.noteDate;
    const next = await mutateNote(noteDate, (parsed) => ({
      events: parsed.events,
      tasks: parsed.tasks.filter((t) => t.id !== taskId),
    }));
    if (!next) return;
    set((s) => ({
      tasks: [...s.tasks.filter((tk) => tk.noteDate !== noteDate), ...next.tasks],
    }));
    get().toast(`已删除「${removed.title}」`, {
      label: '撤销',
      run: () => {
        void mutateNote(noteDate, (parsed) => ({
          events: parsed.events,
          tasks: [...parsed.tasks, { ...removed, id: '', lineIndex: -1 }],
        })).then((reparsed) => {
          if (!reparsed) return;
          set((s) => ({
            tasks: [...s.tasks.filter((tk) => tk.noteDate !== noteDate), ...reparsed.tasks],
          }));
        });
      },
    });
  },

  setTaskDue: async (taskId, dueMmDd) => {
    const task = get().tasks.find((t) => t.id === taskId);
    if (!task) return;
    const next = await mutateNote(task.noteDate, (parsed) => {
      const tasks = parsed.tasks.map((t) => {
        if (t.id !== taskId) return t;
        const updated = { ...t, due: dueMmDd };
        // 设截止日时若已完成则恢复为非完成列
        if (t.done) {
          const fallbackCol = getBoardColumns().find((c) => !c.isDone)?.id ?? 'todo';
          updated.column = fallbackCol;
          updated.done = false;
          updated.progress = 50;
        }
        return updated;
      });
      return { events: parsed.events, tasks };
    });
    if (!next) return;
    set((s) => ({
      tasks: [...s.tasks.filter((tk) => tk.noteDate !== task.noteDate), ...next.tasks],
    }));
    get().toast(`截止日设为 ${dueMmDd}`);
  },

  removeBoardColumn: async (id) => {
    const cols = getBoardColumns();
    const col = cols.find((c) => c.id === id);
    if (!col) return;
    if (col.isDone) {
      get().toast('不能删除完成列');
      return;
    }
    const next = cols.filter((c) => c.id !== id);
    const fallback = next.find((c) => !c.isDone)?.id ?? next[0]?.id;
    if (!fallback) {
      get().toast('至少保留一列');
      return;
    }
    // 把该列所有任务重派到 fallback 列（按 noteDate 分组写回）
    const affected = get().tasks.filter((t) => t.column === id);
    const byNote = new Map<string, ScheduleTask[]>();
    for (const t of affected) {
      if (!byNote.has(t.noteDate)) byNote.set(t.noteDate, []);
      byNote.get(t.noteDate)!.push(t);
    }
    for (const [noteDate, tasks] of byNote) {
      const ids = new Set(tasks.map((t) => t.id));
      await mutateNote(noteDate, (parsed) => {
        const updated = parsed.tasks.map((t) =>
          ids.has(t.id) ? { ...t, column: fallback } : t,
        );
        return { events: parsed.events, tasks: updated };
      });
    }
    // 更新缓存：重派受影响任务的 column
    set((s) => ({
      tasks: s.tasks.map((t) => (t.column === id ? { ...t, column: fallback } : t)),
    }));
    // 从 settings 移除该列
    useSettingsStore.getState().setBoardColumns(next);
    get().toast(`已删除列「${col.name}」`);
  },

  pomoToggle: () =>
    set((s) => ({ pomo: { ...s.pomo, running: !s.pomo.running } })),

  pomoReset: () => set({ pomo: defaultPomo() }),

  tickPomo: () => {
    const p = get().pomo;
    if (!p.running) return;
    const remaining = p.remaining - 1;
    if (remaining > 0) {
      set({ pomo: { ...p, remaining } });
      return;
    }
    // 一轮结束
    if (p.mode === 'work') {
      set({ pomo: { ...p, mode: 'break', remaining: POMO_BREAK, running: true } });
      get().toast('工作时段结束，休息 5 分钟');
    } else {
      set({ pomo: { ...p, mode: 'work', remaining: POMO_WORK, round: p.round + 1, running: true } });
      get().toast(`休息结束，开始第 ${p.round + 1} 轮`);
    }
  },

  toast: (msg, action) => {
    const prev = get()._toastTimer;
    if (prev) clearTimeout(prev);
    const ttl = action ? 5000 : 1800;
    const timer = setTimeout(() => set({ toastMsg: '', toastAction: null }), ttl);
    set({ toastMsg: msg, toastAction: action ?? null, _toastTimer: timer });
  },
}));

// subscribeToFileTree lives in vaultStore now (shared with studyStore).
export { subscribeToFileTree } from './vaultStore';
