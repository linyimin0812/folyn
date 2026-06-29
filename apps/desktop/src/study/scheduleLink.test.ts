import { describe, it, expect } from 'vitest';
import {
  buildStudyTaskLine,
  appendTaskLineToDaily,
  collectScheduleLinks,
} from './scheduleLink';
import type { ScheduleTask } from '@/schedule/types';
import type { StudyUnit } from '@/study/types';
import { parseDaily } from '@/schedule/markdown';

const UNIT: StudyUnit = {
  id: 'agent-dev#units-1',
  order: 1,
  title: '理解 agent 循环',
  done: false,
  prog: 0,
  lineIndex: -1,
};

describe('buildStudyTaskLine', () => {
  it('produces a cat:learn task line with study/unit回链 attrs', () => {
    const line = buildStudyTaskLine(UNIT, 'agent-dev', '06-29');
    expect(line).toBe(
      '- [ ] 理解 agent 循环 @{col:todo cat:learn study:agent-dev unit:1 due:06-29 prog:0}',
    );
  });
});

describe('appendTaskLineToDaily', () => {
  it('appends to existing ## 任务 section preserving散文 and other sections', () => {
    const content = [
      '# 2026-06-29',
      '',
      '今天要点散文。',
      '',
      '## 任务',
      '- [ ] 已有任务 @{col:todo cat:dev prio:med prog:0 sub:0 as:YL}',
      '',
      '## 笔记',
      '- 笔记内容',
    ].join('\n');
    const line = buildStudyTaskLine(UNIT, 'agent-dev', '06-29');
    const out = appendTaskLineToDaily(content, line);
    // 新行应落在 ## 任务 段尾、## 笔记 之前
    const taskIdx = out.indexOf(line);
    const noteIdx = out.indexOf('## 笔记');
    expect(taskIdx).toBeLessThan(noteIdx);
    // 散文与既有任务行原样保留
    expect(out).toContain('今天要点散文。');
    expect(out).toContain('- [ ] 已有任务');
    expect(out).toContain('- 笔记内容');
  });

  it('creates the ## 任务 section at EOF when absent', () => {
    const content = '# 2026-06-29\n\n只有散文。\n';
    const line = buildStudyTaskLine(UNIT, 'agent-dev', '06-29');
    const out = appendTaskLineToDaily(content, line);
    expect(out).toContain('## 任务');
    expect(out).toContain(line);
    expect(out).toContain('只有散文。');
  });

  it('produces a line parseable by schedule parseDaily (extraAttrs survive)', () => {
    const content = '# 2026-06-29\n\n## 任务\n';
    const line = buildStudyTaskLine(UNIT, 'agent-dev', '06-29');
    const out = appendTaskLineToDaily(content, line);
    const parsed = parseDaily(out, '2026-06-29');
    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.tasks[0].category).toBe('learn');
    expect(parsed.tasks[0].extraAttrs).toMatchObject({
      study: 'agent-dev',
      unit: '1',
    });
  });
});

describe('collectScheduleLinks', () => {
  const base = (over: Partial<ScheduleTask>): ScheduleTask => ({
    id: 'x',
    noteDate: '2026-06-29',
    title: '理解 agent 循环',
    column: 'todo',
    category: 'learn',
    priority: 'med',
    progress: 0,
    subtasks: 0,
    assignees: [],
    done: false,
    lineIndex: 0,
    ...over,
  });

  it('collects links keyed by unit order', () => {
    const tasks = [
      base({ extraAttrs: { study: 'agent-dev', unit: '1' }, due: '06-29', noteDate: '2026-06-29' }),
      base({ extraAttrs: { study: 'agent-dev', unit: '2' }, due: '06-30', noteDate: '2026-06-29' }),
    ];
    const links = collectScheduleLinks(tasks, 'agent-dev');
    expect(links.size).toBe(2);
    expect(links.get(1)).toMatchObject({ unit: 1, due: '06-29', done: false, noteDate: '2026-06-29' });
    expect(links.get(2)?.due).toBe('06-30');
  });

  it('ignores tasks without study回链 or with a different slug', () => {
    const tasks = [
      base({ extraAttrs: { study: 'other', unit: '1' } }),
      base({ extraAttrs: { unit: '1' } }), // no study
      base({ extraAttrs: { study: 'agent-dev', unit: '3' } }),
    ];
    const links = collectScheduleLinks(tasks, 'agent-dev');
    expect(links.size).toBe(1);
    expect(links.get(3)).toBeDefined();
  });

  it('picks the most recent noteDate when a unit is scheduled on multiple days', () => {
    const tasks = [
      base({ extraAttrs: { study: 'agent-dev', unit: '1' }, noteDate: '2026-06-28', done: true }),
      base({ extraAttrs: { study: 'agent-dev', unit: '1' }, noteDate: '2026-06-30', done: false }),
    ];
    const links = collectScheduleLinks(tasks, 'agent-dev');
    expect(links.size).toBe(1);
    expect(links.get(1)?.noteDate).toBe('2026-06-30');
    expect(links.get(1)?.done).toBe(false);
  });

  it('returns empty for empty task list', () => {
    expect(collectScheduleLinks([], 'agent-dev').size).toBe(0);
  });
});
