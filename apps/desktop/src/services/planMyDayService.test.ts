import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Shared Tauri mocks are auto-loaded via test/setup.ts — no per-file vi.mock.

const {
  collectTextFromStream,
  fakeAdapter,
  scheduleState,
  quickAddTask,
  scheduleTask,
  addEvent,
} = vi.hoisted(() => {
  // Stateful scheduleStore mock: tasks array + action spies. quickAddTask appends
  // a task with a real id (`today#lineIndex`) so resolveNewTaskId can find it.
  const scheduleState = {
    today: '2026-03-04',
    events: [] as Array<{
      id: string;
      noteDate: string;
      start: number;
      end: number;
      category: string;
      title: string;
      note?: string;
      lineIndex: number;
    }>,
    tasks: [] as Array<{
      id: string;
      noteDate: string;
      title: string;
      column: string;
      category: string;
      priority: string;
      due?: string;
      scheduledDate?: string;
      scheduledStart?: number;
      scheduledEnd?: number;
      progress: number;
      subtasks: number;
      assignees: string[];
      done: boolean;
      lineIndex: number;
    }>,
  };

  const quickAddTask = vi.fn(async (title: string) => {
    const noteDate = scheduleState.today;
    const lineIndex = scheduleState.tasks.filter((t) => t.noteDate === noteDate).length;
    scheduleState.tasks.push({
      id: `${noteDate}#${lineIndex}`,
      noteDate,
      title,
      column: 'todo',
      category: 'dev',
      priority: 'med',
      progress: 0,
      subtasks: 0,
      assignees: ['YL'],
      done: false,
      lineIndex,
    });
  });

  const scheduleTask = vi.fn(async (taskId: string, date: string, start: number, end: number) => {
    const t = scheduleState.tasks.find((x) => x.id === taskId);
    if (!t) return;
    t.scheduledDate = date;
    t.scheduledStart = start;
    t.scheduledEnd = end;
  });

  const addEvent = vi.fn(
    async (noteDate: string, e: { title: string; start: number; end: number; category: string; note?: string }) => {
      const lineIndex = scheduleState.events.filter((x) => x.noteDate === noteDate).length;
      scheduleState.events.push({ id: `${noteDate}#${lineIndex}`, noteDate, lineIndex, ...e });
    },
  );

  const fakeAdapter = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    send: vi.fn(async (_prompt: string) => {}),
  };

  return {
    collectTextFromStream: vi.fn(),
    fakeAdapter,
    scheduleState,
    quickAddTask,
    scheduleTask,
    addEvent,
  };
});

vi.mock('@/store/scheduleStore', () => ({
  useScheduleStore: {
    getState: () => ({
      events: scheduleState.events,
      tasks: scheduleState.tasks,
      quickAddTask,
      scheduleTask,
      addEvent,
    }),
  },
}));

vi.mock('@/store/vaultStore', () => ({
  useVaultStore: {
    getState: () => ({ currentVault: { basePath: '/mock/vault', id: 'v1' } }),
  },
}));

vi.mock('@/store/aiConfigStore', () => ({
  useAiConfigStore: {
    getState: () => ({ cliAdapter: 'claude', cliPath: '/mock/claude' }),
  },
  getFeatureAdapter: () => 'claude',
  getFeatureCliPath: () => '/mock/claude',
}));

vi.mock('@quill/cli-adapter', () => ({
  createAdapter: () => fakeAdapter,
}));

vi.mock('./aiStreamUtils', async () => {
  const actual = await vi.importActual<typeof import('./aiStreamUtils')>('./aiStreamUtils');
  return { ...actual, collectTextFromStream };
});

vi.mock('@/utils/pathResolver', () => ({
  resolveBasePath: async (p: string) => p,
}));

import {
  gatherPlanContext,
  buildPlanPrompt,
  parsePlan,
  generatePlan,
  applyPlan,
} from './planMyDayService';

beforeEach(() => {
  vi.clearAllMocks();
  vi.setSystemTime(new Date('2026-03-04T10:00:00.000Z'));
  scheduleState.events.length = 0;
  scheduleState.tasks.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('gatherPlanContext', () => {
  it('collects today events + 7-day unfinished backlog', () => {
    scheduleState.today = '2026-03-04';
    // today's event (must be respected)
    scheduleState.events.push({
      id: '2026-03-04#0',
      noteDate: '2026-03-04',
      title: 'Standup',
      start: 9.5,
      end: 10.0,
      lineIndex: 0,
    });
    // an event on another day (should be excluded)
    scheduleState.events.push({
      id: '2026-03-01#0',
      noteDate: '2026-03-01',
      title: 'Old meeting',
      start: 14.0,
      end: 15.0,
      lineIndex: 0,
    });
    // backlog: unfinished, within 7 days (3 days ago)
    scheduleState.tasks.push({
      id: '2026-03-01#1',
      noteDate: '2026-03-01',
      title: 'Write tests',
      column: 'doing',
      category: 'dev',
      priority: 'high',
      progress: 30,
      subtasks: 0,
      assignees: ['YL'],
      done: false,
      lineIndex: 1,
    });
    // finished task (excluded)
    scheduleState.tasks.push({
      id: '2026-03-02#0',
      noteDate: '2026-03-02',
      title: 'Done task',
      column: 'done',
      category: 'dev',
      priority: 'med',
      progress: 100,
      subtasks: 0,
      assignees: ['YL'],
      done: true,
      lineIndex: 0,
    });
    // task older than 7 days (excluded)
    scheduleState.tasks.push({
      id: '2026-02-20#0',
      noteDate: '2026-02-20',
      title: 'Ancient',
      column: 'todo',
      category: 'dev',
      priority: 'low',
      progress: 0,
      subtasks: 0,
      assignees: ['YL'],
      done: false,
      lineIndex: 0,
    });

    const ctx = gatherPlanContext();
    expect(ctx.today).toBe('2026-03-04');
    expect(ctx.todayEvents).toHaveLength(1);
    expect(ctx.todayEvents[0]).toMatchObject({ title: 'Standup', start: 9.5, end: 10.0 });
    expect(ctx.backlog).toHaveLength(1);
    expect(ctx.backlog[0]).toMatchObject({
      id: '2026-03-01#1',
      title: 'Write tests',
      sourceDate: '2026-03-01',
      priority: 'high',
    });
  });

  it('excludes finished tasks even when within the 7-day window', () => {
    scheduleState.today = '2026-03-04';
    scheduleState.tasks.push({
      id: '2026-03-03#0',
      noteDate: '2026-03-03',
      title: 'Already done',
      column: 'done',
      category: 'dev',
      priority: 'med',
      progress: 100,
      subtasks: 0,
      assignees: ['YL'],
      done: true,
      lineIndex: 0,
    });
    const ctx = gatherPlanContext();
    expect(ctx.backlog).toHaveLength(0);
  });

  it('handles empty state (no events, no backlog)', () => {
    scheduleState.today = '2026-03-04';
    const ctx = gatherPlanContext();
    expect(ctx.todayEvents).toEqual([]);
    expect(ctx.backlog).toEqual([]);
  });
});

describe('buildPlanPrompt', () => {
  it('contains S2/T2 instructions, the JSON schema, today events, and backlog', () => {
    const ctx = {
      today: '2026-03-04',
      todayEvents: [{ title: 'Standup', start: 9.5, end: 10.0 }],
      backlog: [
        { id: '2026-03-01#1', title: 'Write tests', priority: 'high', sourceDate: '2026-03-01' },
      ],
    };
    const prompt = buildPlanPrompt(ctx);
    // S2 scope
    expect(prompt).toMatch(/不得移动或缩短/);
    expect(prompt).toMatch(/不得跨天/);
    // T2
    expect(prompt).toMatch(/不要双排|不可与已有事件冲突/);
    // JSON schema keys
    expect(prompt).toContain('scheduledTasks');
    expect(prompt).toContain('newTasks');
    expect(prompt).toContain('newEvents');
    expect(prompt).toContain('notes');
    // hour floating hint
    expect(prompt).toMatch(/小时浮点/);
    // context
    expect(prompt).toContain('Standup');
    expect(prompt).toContain('Write tests');
    expect(prompt).toContain('2026-03-04');
  });

  it('renders the empty-backlog hint when backlog is empty', () => {
    const prompt = buildPlanPrompt({ today: '2026-03-04', todayEvents: [], backlog: [] });
    expect(prompt).toMatch(/没有未完成任务|backlog 为空|起步任务/);
  });
});

describe('parsePlan', () => {
  it('parses a clean JSON plan', () => {
    const plan = parsePlan(
      '{"scheduledTasks":[{"taskId":"2026-03-01#1","start":10.5,"end":12.0}],"newTasks":[{"title":"Break down X","start":14.0,"end":15.0}],"newEvents":[{"title":"休息","start":12.0,"end":13.0}],"notes":"plan"}',
    );
    expect(plan.scheduledTasks).toHaveLength(1);
    expect(plan.scheduledTasks[0]).toMatchObject({ taskId: '2026-03-01#1', start: 10.5, end: 12.0 });
    expect(plan.newTasks).toHaveLength(1);
    expect(plan.newTasks[0].title).toBe('Break down X');
    expect(plan.newEvents).toHaveLength(1);
    expect(plan.notes).toBe('plan');
  });

  it('extracts JSON embedded in prose', () => {
    const plan = parsePlan('Here is the plan:\n{"scheduledTasks":[],"newTasks":[],"newEvents":[],"notes":"ok"}\nThanks');
    expect(plan.notes).toBe('ok');
  });

  it('throws the friendly Chinese error on non-JSON', () => {
    expect(() => parsePlan('the day looks busy')).toThrow(/AI 返回的计划无法解析/);
  });

  it('defaults missing/invalid fields to safe empties', () => {
    const plan = parsePlan('{"scheduledTasks":"oops","notes":123}');
    expect(plan.scheduledTasks).toEqual([]);
    expect(plan.newTasks).toEqual([]);
    expect(plan.newEvents).toEqual([]);
    expect(plan.notes).toBe('');
  });
});

describe('generatePlan', () => {
  it('parses clean JSON and stops the adapter on success', async () => {
    collectTextFromStream.mockResolvedValueOnce(
      '{"scheduledTasks":[{"taskId":"t1","start":10,"end":11}],"newTasks":[],"newEvents":[],"notes":"n"}',
    );
    const plan = await generatePlan({ today: '2026-03-04', todayEvents: [], backlog: [] });
    expect(plan.scheduledTasks).toHaveLength(1);
    expect(fakeAdapter.start).toHaveBeenCalledTimes(1);
    expect(fakeAdapter.send).toHaveBeenCalledTimes(1);
    expect(fakeAdapter.stop).toHaveBeenCalledTimes(1);
  });

  it('parses JSON embedded in prose', async () => {
    collectTextFromStream.mockResolvedValueOnce(
      'Plan:\n{"scheduledTasks":[],"newTasks":[],"newEvents":[],"notes":"embedded"}',
    );
    const plan = await generatePlan({ today: '2026-03-04', todayEvents: [], backlog: [] });
    expect(plan.notes).toBe('embedded');
  });

  it('throws the friendly error and applies nothing on non-JSON', async () => {
    collectTextFromStream.mockResolvedValueOnce('busy day, no json');
    await expect(
      generatePlan({ today: '2026-03-04', todayEvents: [], backlog: [] }),
    ).rejects.toThrow(/AI 返回的计划无法解析/);
  });

  it('stops the adapter in finally on both success and failure paths', async () => {
    // success
    collectTextFromStream.mockResolvedValueOnce(
      '{"scheduledTasks":[],"newTasks":[],"newEvents":[],"notes":""}',
    );
    await generatePlan({ today: '2026-03-04', todayEvents: [], backlog: [] });
    // failure
    collectTextFromStream.mockResolvedValueOnce('not json');
    await expect(
      generatePlan({ today: '2026-03-04', todayEvents: [], backlog: [] }),
    ).rejects.toThrow();
    expect(fakeAdapter.stop).toHaveBeenCalledTimes(2);
  });
});

describe('applyPlan', () => {
  function makePlan() {
    return {
      scheduledTasks: [
        { taskId: '2026-03-01#1', start: 10.0, end: 11.0 },
      ],
      newTasks: [{ title: 'New subtask', start: 14.0, end: 15.0 }],
      newEvents: [{ title: '休息', start: 12.0, end: 13.0 }],
      notes: '',
    };
  }

  it('creates new tasks then schedules them, schedules existing tasks, adds events', async () => {
    // Pre-existing backlog task to schedule.
    scheduleState.today = '2026-03-04';
    scheduleState.tasks.push({
      id: '2026-03-01#1',
      noteDate: '2026-03-01',
      title: 'Write tests',
      column: 'doing',
      category: 'dev',
      priority: 'high',
      progress: 30,
      subtasks: 0,
      assignees: ['YL'],
      done: false,
      lineIndex: 1,
    });

    const plan = makePlan();
    const result = await applyPlan(plan, {
      scheduledTaskIndices: [0],
      newTaskIndices: [0],
      newEventIndices: [0],
    });

    expect(result.failed).toHaveLength(0);
    // new task created with today's noteDate
    const created = scheduleState.tasks.find((t) => t.title === 'New subtask');
    expect(created).toBeTruthy();
    expect(created?.noteDate).toBe('2026-03-04');
    // new task scheduled
    expect(created?.scheduledDate).toBe('2026-03-04');
    expect(created?.scheduledStart).toBe(14.0);
    expect(created?.scheduledEnd).toBe(15.0);
    // existing task scheduled
    expect(scheduleTask).toHaveBeenCalledWith('2026-03-01#1', '2026-03-04', 10.0, 11.0);
    // event added
    expect(addEvent).toHaveBeenCalledWith(
      '2026-03-04',
      expect.objectContaining({ title: '休息', start: 12.0, end: 13.0 }),
    );
  });

  it('applies only accepted items (skips unaccepted)', async () => {
    scheduleState.today = '2026-03-04';
    const plan = makePlan();
    // Accept nothing.
    const result = await applyPlan(plan, {
      scheduledTaskIndices: [],
      newTaskIndices: [],
      newEventIndices: [],
    });
    expect(result.applied).toHaveLength(0);
    expect(quickAddTask).not.toHaveBeenCalled();
    expect(scheduleTask).not.toHaveBeenCalled();
    expect(addEvent).not.toHaveBeenCalled();
  });

  it('does not abort on a failing item; reports applied and failed', async () => {
    scheduleState.today = '2026-03-04';
    scheduleState.tasks.push({
      id: '2026-03-01#1',
      noteDate: '2026-03-01',
      title: 'Write tests',
      column: 'doing',
      category: 'dev',
      priority: 'high',
      progress: 30,
      subtasks: 0,
      assignees: ['YL'],
      done: false,
      lineIndex: 1,
    });
    // Make scheduleTask throw for the existing task only.
    scheduleTask.mockImplementationOnce(async () => {
      throw new Error('schedule boom');
    });

    const plan = makePlan();
    const result = await applyPlan(plan, {
      scheduledTaskIndices: [0],
      newTaskIndices: [0],
      newEventIndices: [0],
    });

    // new task + event still applied despite the schedule failure
    expect(result.applied.some((a) => a.includes('New subtask'))).toBe(true);
    expect(result.applied.some((a) => a.includes('休息'))).toBe(true);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toMatch(/schedule boom/);
  });

  it('reports out-of-range accepted indices as failed', async () => {
    const plan = makePlan();
    const result = await applyPlan(plan, {
      scheduledTaskIndices: [99],
      newTaskIndices: [99],
      newEventIndices: [99],
    });
    expect(result.failed).toHaveLength(3);
    expect(result.applied).toHaveLength(0);
  });

  it('resolves distinct ids for two new tasks sharing the same title', async () => {
    scheduleState.today = '2026-03-04';
    const plan = {
      scheduledTasks: [],
      newTasks: [
        { title: 'Dup', start: 9.0, end: 10.0 },
        { title: 'Dup', start: 11.0, end: 12.0 },
      ],
      newEvents: [],
      notes: '',
    };
    const result = await applyPlan(plan, {
      scheduledTaskIndices: [],
      newTaskIndices: [0, 1],
      newEventIndices: [],
    });
    expect(result.failed).toHaveLength(0);
    // Two distinct tasks created, each scheduled to its own slot.
    const dups = scheduleState.tasks.filter((t) => t.title === 'Dup');
    expect(dups).toHaveLength(2);
    expect(dups[0].id).not.toBe(dups[1].id);
    // scheduleTask called once per distinct id, with the right slots.
    const calls = scheduleTask.mock.calls.filter((c) => typeof c[0] === 'string' && c[0].endsWith('#') === false);
    const scheduledIds = new Set(calls.map((c) => c[0]));
    expect(scheduledIds.size).toBe(2);
    expect(dups.map((t) => t.id).sort()).toEqual([...scheduledIds].sort());
  });
});
