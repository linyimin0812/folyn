import { describe, it, expect } from 'vitest';
import { parseDaily, serializeDaily, buildEventLine, buildTaskLine, dueState, parseTime, formatTime } from './markdown';
import type { ScheduleEvent, ScheduleTask } from './types';

const NOTE = `---
title: "2026-06-27"
date: 2026-06-27
tags: [daily]
---

# 2026-06-27

今天随便写点散文。

## 日程
- @event 09:00-10:00 | work | 晨会同步 | Zoom · 团队频道
- @event 18:00-19:00 | health | 健身房

## 任务
- [ ] 设计日程工作台 v2 @{col:todo cat:design prio:high due:06-29 prog:0 sub:0 as:YL,Li}
- [x] now-line 实时刷新 @{col:done cat:dev prio:high due:06-25 prog:100 sub:0 as:YL}

## 笔记
- 普通未托管复选框 - [ ] 不应被改写
`;

describe('parseTime / formatTime', () => {
  it('parses HH:MM to float hours', () => {
    expect(parseTime('09:30')).toBe(9.5);
    expect(parseTime('9:00')).toBe(9);
    expect(parseTime('18:00')).toBe(18);
  });
  it('formats float to HH:MM', () => {
    expect(formatTime(9.5)).toBe('09:30');
    expect(formatTime(18)).toBe('18:00');
  });
});

describe('parseDaily', () => {
  const parsed = parseDaily(NOTE, '2026-06-27');

  it('extracts events with line index', () => {
    expect(parsed.events).toHaveLength(2);
    expect(parsed.events[0]).toMatchObject({
      noteDate: '2026-06-27',
      start: 9,
      end: 10,
      category: 'work',
      title: '晨会同步',
      note: 'Zoom · 团队频道',
    });
    expect(parsed.events[1].note).toBeUndefined();
  });

  it('extracts tasks with derived done', () => {
    expect(parsed.tasks).toHaveLength(2);
    expect(parsed.tasks[0].done).toBe(false);
    expect(parsed.tasks[0].column).toBe('todo');
    expect(parsed.tasks[0].assignees).toEqual(['YL', 'Li']);
    expect(parsed.tasks[1].done).toBe(true);
    expect(parsed.tasks[1].column).toBe('done');
    expect(parsed.tasks[1].progress).toBe(100);
  });

  it('preserves raw lines including prose and unmanaged checkboxes', () => {
    expect(parsed.rawLines).toContain('今天随便写点散文。');
    expect(parsed.rawLines.some((l) => l.includes('普通未托管复选框'))).toBe(true);
  });

  it('parses scheduled tag', () => {
    const note = `## 任务
- [ ] 排程任务 @{col:todo cat:dev prio:med sched:2026-06-28T14:00-15:30 prog:0 sub:0 as:YL}
`;
    const t = parseDaily(note, '2026-06-27').tasks[0];
    expect(t.scheduledDate).toBe('2026-06-28');
    expect(t.scheduledStart).toBe(14);
    expect(t.scheduledEnd).toBe(15.5);
  });
});

describe('buildEventLine / buildTaskLine', () => {
  it('builds canonical event line', () => {
    const e: ScheduleEvent = {
      id: 'x', noteDate: '2026-06-27', start: 9, end: 10,
      category: 'work', title: '晨会', note: '备注', lineIndex: -1,
    };
    expect(buildEventLine(e)).toBe('- @event 09:00-10:00 | work | 晨会 | 备注');
  });
  it('omits note segment when absent', () => {
    const e: ScheduleEvent = {
      id: 'x', noteDate: '2026-06-27', start: 18, end: 19,
      category: 'health', title: '健身房', lineIndex: -1,
    };
    expect(buildEventLine(e)).toBe('- @event 18:00-19:00 | health | 健身房');
  });
  it('builds canonical task line with sched', () => {
    const t: ScheduleTask = {
      id: 'x', noteDate: '2026-06-27', title: '排程任务', column: 'todo',
      category: 'dev', priority: 'med', scheduledDate: '2026-06-28',
      scheduledStart: 14, scheduledEnd: 15.5, progress: 0, subtasks: 0,
      assignees: ['YL'], done: false, lineIndex: -1,
    };
    expect(buildTaskLine(t)).toBe(
      '- [ ] 排程任务 @{col:todo cat:dev prio:med sched:2026-06-28T14:00-15:30 prog:0 sub:0 as:YL}',
    );
  });
});

describe('serializeDaily', () => {
  it('round-trips a canonical note unchanged', () => {
    const parsed = parseDaily(NOTE, '2026-06-27');
    const out = serializeDaily(parsed, parsed.events, parsed.tasks);
    expect(out).toBe(NOTE);
  });

  it('removes an event line when it is deleted from the events array', () => {
    const parsed = parseDaily(NOTE, '2026-06-27');
    const keep = parsed.events.slice(1); // 删掉第一个事件
    const out = serializeDaily(parsed, keep, parsed.tasks);
    expect(out).not.toContain('晨会同步');
    // 第二个事件仍在
    expect(out).toContain('健身房');
    // 任务行与散文仍在
    expect(out).toContain('今天随便写点散文。');
    expect(out).toContain('- [ ] 设计日程工作台 v2');
  });

  it('removes a task line when it is deleted from the tasks array', () => {
    const parsed = parseDaily(NOTE, '2026-06-27');
    const keep = parsed.tasks.slice(1); // 删掉第一个任务
    const out = serializeDaily(parsed, parsed.events, keep);
    expect(out).not.toContain('设计日程工作台 v2');
    expect(out).toContain('- [x] now-line 实时刷新');
  });

  it('rewrites only the toggled task line, preserves everything else', () => {
    const parsed = parseDaily(NOTE, '2026-06-27');
    const tasks = parsed.tasks.map((t) =>
      t.id.endsWith(parsed.tasks[0].id.split('#')[1])
        ? { ...t, done: true, column: 'done' as const, progress: 100 }
        : t,
    );
    const out = serializeDaily(parsed, parsed.events, tasks);
    const lines = out.split('\n');
    const toggled = lines.find((l) => l.startsWith('- [x] 设计日程工作台'));
    expect(toggled).toContain('col:done');
    expect(toggled).toContain('prog:100');
    // 未托管行仍在
    expect(out).toContain('普通未托管复选框 - [ ] 不应被改写');
    // 散文仍在
    expect(out).toContain('今天随便写点散文。');
    // 另一个任务行未被改动
    expect(out).toContain('- [x] now-line 实时刷新');
  });

  it('appends a new task to the 任务 section', () => {
    const parsed = parseDaily(NOTE, '2026-06-27');
    const newTask: ScheduleTask = {
      id: 'new', noteDate: '2026-06-27', title: '新任务', column: 'todo',
      category: 'growth', priority: 'low', progress: 0, subtasks: 0,
      assignees: ['WQ'], done: false, lineIndex: -1,
    };
    const out = serializeDaily(parsed, parsed.events, [...parsed.tasks, newTask]);
    expect(out).toContain('- [ ] 新任务 @{col:todo cat:growth prio:low prog:0 sub:0 as:WQ}');
    // 新任务应出现在 ## 任务 段内（在 ## 笔记 之前）
    const taskIdx = out.indexOf('- [ ] 新任务');
    const noteIdx = out.indexOf('## 笔记');
    expect(taskIdx).toBeLessThan(noteIdx);
  });

  it('appends a new event when section missing', () => {
    const bare = `# 2026-06-27\n\n只有散文。\n`;
    const parsed = parseDaily(bare, '2026-06-27');
    const newEv: ScheduleEvent = {
      id: 'new', noteDate: '2026-06-27', start: 9, end: 10,
      category: 'work', title: '晨会', lineIndex: -1,
    };
    const out = serializeDaily(parsed, [newEv], []);
    expect(out).toContain('## 日程');
    expect(out).toContain('- @event 09:00-10:00 | work | 晨会');
    expect(out).toContain('只有散文。');
  });

  it('adding sched preserves existing tags and ordering', () => {
    const parsed = parseDaily(NOTE, '2026-06-27');
    const tasks = parsed.tasks.map((t) =>
      t.title.startsWith('设计日程工作台')
        ? { ...t, scheduledDate: '2026-06-28', scheduledStart: 15, scheduledEnd: 16 }
        : t,
    );
    const out = serializeDaily(parsed, parsed.events, tasks);
    expect(out).toContain(
      '- [ ] 设计日程工作台 v2 @{col:todo cat:design prio:high due:06-29 sched:2026-06-28T15:00-16:00 prog:0 sub:0 as:YL,Li}',
    );
  });

  it('does not crash on malformed attr block', () => {
    const note = `## 任务\n- [ ] 坏任务 @{col:todo cat:dev prio:med prog:0 sub:0 as:YL\n`;
    const parsed = parseDaily(note, '2026-06-27');
    // 缺少闭合 } → 不匹配 TASK_RE，视为未托管行
    expect(parsed.tasks).toHaveLength(0);
    // 序列化不应抛错
    expect(() => serializeDaily(parsed, [], [])).not.toThrow();
  });
});

describe('dueState', () => {
  const today = new Date(2026, 5, 27); // 2026-06-27
  it('returns over for past dates', () => {
    expect(dueState('06-25', today)).toBe('over');
  });
  it('returns soon for today/tomorrow', () => {
    expect(dueState('06-27', today)).toBe('soon');
    expect(dueState('06-28', today)).toBe('soon');
  });
  it('returns empty for far future', () => {
    expect(dueState('07-05', today)).toBe('');
  });
  it('handles cross-year due (e.g. 12-31 in June)', () => {
    // 12-31 from June 2026 is ~6 months away, not over
    expect(dueState('12-31', today)).toBe('');
  });
});
