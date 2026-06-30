import { describe, it, expect } from 'vitest';
import {
  buildStudyTaskLine,
  appendTaskLineToDaily,
  collectScheduleLinks,
  buildStudyPrompt,
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

describe('buildStudyPrompt (PR8: research/plan 返回建议文本；feynman/selftest/sq3r 直编+diff)', () => {
  const topicPath = '学习/agent-dev.md';
  const baseCtx = { topicName: 'agent 开发', topicPath };

  it('research: 返回资料建议文本，不直编文件', () => {
    const p = buildStudyPrompt('research', baseCtx);
    expect(p).toContain(topicPath);
    // 行语法与 markdown.ts BOOK_RE/WEB_RE 严格一致
    expect(p).toContain('- @book <书名> | <作者> | <简介> | 难度:<易|中|难> | <链接>');
    expect(p).toContain('- @web <标题> | <链接> | <简介>');
    // 不再要求用 Edit 工具直编文件
    expect(p).not.toMatch(/Edit 工具直接编辑(附件)?文件/);
    expect(p).toMatch(/不要用 Edit 工具改文件/);
  });

  it('feynman: instructs AI to append a warning callout to ## 笔记', () => {
    const p = buildStudyPrompt('feynman', baseCtx);
    expect(p).toContain(topicPath);
    expect(p).toMatch(/Edit 工具直接编辑(附件)?文件/);
    expect(p).toContain('## 笔记');
    expect(p).toContain(':::callout{type="warning" title="盲区"}');
    expect(p).toContain(':::');
  });

  it('selftest: instructs AI to append a tip callout with folded answers', () => {
    const p = buildStudyPrompt('selftest', baseCtx);
    expect(p).toContain(topicPath);
    expect(p).toMatch(/Edit 工具直接编辑(附件)?文件/);
    expect(p).toContain('## 笔记');
    expect(p).toContain(':::callout{type="tip" title="自测题"}');
    expect(p).toContain('<details>');
  });

  it('sq3r: instructs AI to append an info callout with pre-read questions', () => {
    const p = buildStudyPrompt('sq3r', {
      ...baseCtx,
      materialTitle: 'Building LLM Apps',
      materialUrl: 'https://example.com/x',
    });
    expect(p).toContain(topicPath);
    expect(p).toMatch(/Edit 工具直接编辑(附件)?文件/);
    expect(p).toContain('## 笔记');
    expect(p).toContain(':::callout{type="info" title="预读问题"}');
    expect(p).toContain('Building LLM Apps');
    expect(p).toContain('https://example.com/x');
  });

  it('plan: 返回学习单元建议文本，不直编文件', () => {
    const p = buildStudyPrompt('plan', baseCtx);
    expect(p).toContain(topicPath);
    expect(p).toContain('## 计划');
    // 行语法与 markdown.ts UNIT_RE 严格一致
    expect(p).toContain('- [ ] 1. 入门概览 @{est:2h dep:- prog:0}');
    expect(p).toContain('- [ ] 2. 核心概念 @{est:4h dep:1 prog:0}');
    expect(p).toMatch(/5-10/);
    expect(p).toMatch(/由浅入深/);
    expect(p).not.toMatch(/Edit 工具直接编辑(附件)?文件/);
    expect(p).toMatch(/不要用 Edit 工具改文件/);
  });

  it('plan: 传入 selectedMaterials 时提示词含选中资料信息', () => {
    const selected = [
      { id: 'a', kind: 'book' as const, title: '《LLM 书》', author: '作者甲', url: 'https://x', summary: '讲 Agent', lineIndex: 0 },
      { id: 'b', kind: 'web' as const, title: 'Agent 入门', url: 'https://y', summary: '好文', lineIndex: 1 },
    ];
    const p = buildStudyPrompt('plan', { ...baseCtx, selectedMaterials: selected });
    expect(p).toContain('《LLM 书》');
    expect(p).toContain('作者甲');
    expect(p).toContain('https://x');
    expect(p).toContain('Agent 入门');
    expect(p).toContain('依据以下资料');
  });

  it('plan: 未传 selectedMaterials 时不出现"依据以下资料"', () => {
    const p = buildStudyPrompt('plan', baseCtx);
    expect(p).not.toContain('依据以下资料');
  });

  it('直编动作(feynman/selftest/sq3r)强调只追加不改写已有内容', () => {
    for (const action of ['feynman', 'selftest', 'sq3r'] as const) {
      const p = buildStudyPrompt(action, baseCtx);
      expect(p).toMatch(/不要删除或改写已有行|不要改写已有内容/);
    }
  });
});
