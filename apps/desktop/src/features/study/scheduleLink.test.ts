import { describe, it, expect } from 'vitest';
import {
  buildStudyTaskLine,
  appendTaskLineToDaily,
  collectScheduleLinks,
  buildStudyInstruction,
} from './scheduleLink';
import type { ScheduleTask } from '@/features/schedule/types';
import type { StudyUnit } from '@/features/study/types';
import { parseDaily } from '@/features/schedule/markdown';

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

describe('buildStudyInstruction (PR9: 动态指令；静态契约由 study-agent.md 承载)', () => {
  const topicPath = '__study__/agent-dev.md';
  const baseCtx = { topicName: 'agent 开发', topicPath };

  it('research: 产出含主题路径、动作关键字与行格式契约的指令', () => {
    const p = buildStudyInstruction('research', baseCtx);
    expect(p).toContain(topicPath);
    expect(p).toContain('agent 开发');
    expect(p).toContain('动作：research');
    // 运行时指令内嵌资料行格式契约（保证旧 vault 内 agent prompt 未更新时仍输出正确格式）
    expect(p).toContain('- @book');
    expect(p).toContain('- @web');
    expect(p).toContain('难度:<易|中|难>');
    expect(p).toMatch(/省略|可选|无在线链接/);
    expect(p).toMatch(/不要.*Edit|不用.*Edit/);
  });

  it('feynman: 含主题路径与动作关键字，可带聚焦单元', () => {
    const p = buildStudyInstruction('feynman', { ...baseCtx, unitTitle: '理解 agent 循环' });
    expect(p).toContain(topicPath);
    expect(p).toContain('动作：feynman');
    expect(p).toContain('聚焦单元：理解 agent 循环');
    // callout 格式契约已移入 study-agent.md
    expect(p).not.toContain(':::callout');
  });

  it('selftest: 含动作关键字，不含 callout 契约', () => {
    const p = buildStudyInstruction('selftest', baseCtx);
    expect(p).toContain(topicPath);
    expect(p).toContain('动作：selftest');
    expect(p).not.toContain(':::callout');
    expect(p).not.toContain('<details>');
  });

  it('sq3r: 含资料标题/链接与动作关键字', () => {
    const p = buildStudyInstruction('sq3r', {
      ...baseCtx,
      materialTitle: 'Building LLM Apps',
      materialUrl: 'https://example.com/x',
    });
    expect(p).toContain(topicPath);
    expect(p).toContain('动作：sq3r');
    expect(p).toContain('Building LLM Apps');
    expect(p).toContain('https://example.com/x');
    expect(p).not.toContain(':::callout');
  });

  it('plan: 含动作关键字与由浅入深要求，不含行语法契约', () => {
    const p = buildStudyInstruction('plan', baseCtx);
    expect(p).toContain(topicPath);
    expect(p).toContain('动作：plan');
    expect(p).toContain('由浅入深');
    expect(p).not.toContain('@{est:2h');
  });

  it('plan: 传入 selectedMaterials 时指令含选中资料信息', () => {
    const selected = [
      { id: 'a', kind: 'book' as const, title: '《LLM 书》', author: '作者甲', url: 'https://x', summary: '讲 Agent', lineIndex: 0 },
      { id: 'b', kind: 'web' as const, title: 'Agent 入门', url: 'https://y', summary: '好文', lineIndex: 1 },
    ];
    const p = buildStudyInstruction('plan', { ...baseCtx, selectedMaterials: selected });
    expect(p).toContain('《LLM 书》');
    expect(p).toContain('作者甲');
    expect(p).toContain('https://x');
    expect(p).toContain('Agent 入门');
    expect(p).toContain('依据以下资料');
  });

  it('plan: 未传 selectedMaterials 时不出现"依据以下资料"', () => {
    const p = buildStudyInstruction('plan', baseCtx);
    expect(p).not.toContain('依据以下资料');
  });
});
