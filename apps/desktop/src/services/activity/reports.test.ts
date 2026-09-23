import { describe, expect, it } from 'vitest';
import {
  appendRegeneration,
  composeReportMarkdown,
  decideWriteMode,
  frontmatterBlock,
  hashContent,
  reportPeriodKey,
  reportRelPath,
  type ReportStrings,
} from './reports';

const ref = new Date(2026, 8, 23); // Wed 2026-09-23 (week 39 per period.ts)

const s: ReportStrings = {
  label: '日报',
  metricsHeading: '指标',
  metricCol: '指标',
  valueCol: '数值',
  timelineHeading: '时间线',
  emptyTimeline: '本期暂无活动记录',
  ongoingHeading: '进行中',
  updatedTask: (name) => `完成或更新了任务 ${name}`,
  ongoingTask: (name, current, total) => `推进中：${name}（第 ${current}/${total} 天，无新增更新）`,
  regeneratedAt: (time) => `重新生成于 ${time}`,
  notifyText: (label) => `${label}已生成`,
};

describe('report path rules (design §7.5)', () => {
  it('daily: 活动记录/日报/YYYY-MM-DD.md', () => {
    expect(reportRelPath('daily', ref)).toBe('活动记录/日报/2026-09-23.md');
  });

  it('weekly: 活动记录/周报/YYYY-WWW.md (zero-padded)', () => {
    // Week 1 of the year must pad to W01.
    expect(reportRelPath('weekly', new Date(2026, 0, 1))).toBe('活动记录/周报/2026-W01.md');
    expect(reportRelPath('weekly', ref)).toBe('活动记录/周报/2026-W39.md');
  });

  it('monthly: 活动记录/月报/YYYY-MM.md', () => {
    expect(reportRelPath('monthly', ref)).toBe('活动记录/月报/2026-09.md');
  });

  it('periodKey matches the filename key', () => {
    expect(reportPeriodKey('daily', ref)).toBe('2026-09-23');
    expect(reportPeriodKey('weekly', ref)).toBe('2026-W39');
    expect(reportPeriodKey('monthly', ref)).toBe('2026-09');
  });
});

describe('frontmatter', () => {
  it('carries type/period/date/generated_at', () => {
    const fm = frontmatterBlock('daily', '2026-09-23', '2026-09-23T08:52:00.000Z');
    expect(fm).toBe(
      [
        '---',
        'type: activity-report',
        'period: daily',
        'date: 2026-09-23',
        'generated_at: 2026-09-23T08:52:00.000Z',
        '---',
      ].join('\n'),
    );
  });
});

describe('composeReportMarkdown', () => {
  const base = {
    mode: 'daily' as const,
    periodKey: '2026-09-23',
    generatedAt: '2026-09-23T08:52:00.000Z',
    formatTime: (ms: number) => new Date(ms).toISOString().slice(11, 16),
    s,
  };

  it('§4.4 wording: updatedToday vs 推进中 branches', () => {
    const md = composeReportMarkdown({
      ...base,
      metrics: [{ label: '代码提交', value: 3 }],
      events: [{ occurredAt: Date.UTC(2026, 8, 23, 2, 30), type: 'task', title: 'T1' }],
      ongoingTasks: [
        { name: '采集器', current: 3, total: 10, updatedToday: true },
        { name: '周报', current: 1, total: 5, updatedToday: false },
      ],
    });
    expect(md).toContain('- 完成或更新了任务 采集器');
    expect(md).toContain('- 推进中：周报（第 1/5 天，无新增更新）');
    expect(md).toContain('## 指标');
    expect(md).toContain('| 代码提交 | 3 |');
    expect(md).toContain('# 日报 · 2026-09-23');
  });

  it('timeline bullets are chronological with time · type · title — summary', () => {
    const md = composeReportMarkdown({
      ...base,
      metrics: [],
      events: [
        { occurredAt: Date.UTC(2026, 8, 23, 9, 0), type: 'commit', title: 'b', summary: 's2' },
        { occurredAt: Date.UTC(2026, 8, 23, 2, 30), type: 'commit', title: 'a' },
      ],
      ongoingTasks: [],
    });
    const lines = md.split('\n').filter((l) => l.startsWith('- '));
    expect(lines).toEqual(['- 02:30 · commit · a', '- 09:00 · commit · b — s2']);
  });

  it('empty timeline renders the empty line', () => {
    const md = composeReportMarkdown({
      ...base, metrics: [], events: [], ongoingTasks: [],
    });
    expect(md).toContain('本期暂无活动记录');
    expect(md).not.toContain('| 指标');
  });

  it('weekly/monthly omit the ongoing section', () => {
    for (const mode of ['weekly', 'monthly'] as const) {
      const md = composeReportMarkdown({
        ...base, mode, metrics: [], events: [],
        ongoingTasks: [{ name: 'x', current: 1, total: 2, updatedToday: false }],
      });
      expect(md).not.toContain('## 进行中');
    }
  });
});

describe('overwrite-vs-append decision (design §7.5)', () => {
  it('no file → created', () => {
    expect(decideWriteMode(null, undefined)).toBe('created');
  });

  it('file matches recorded hash → overwritten', () => {
    const content = 'a';
    expect(decideWriteMode(content, hashContent(content))).toBe('overwritten');
  });

  it('hand-edited file (hash mismatch) → appended', () => {
    expect(decideWriteMode('edited', hashContent('original'))).toBe('appended');
  });

  it('existing file with no recorded hash → appended', () => {
    expect(decideWriteMode('anything', undefined)).toBe('appended');
  });

  it('hashContent is deterministic and distinguishes content', () => {
    expect(hashContent('x')).toBe(hashContent('x'));
    expect(hashContent('x')).not.toBe(hashContent('y'));
  });
});

describe('appendRegeneration', () => {
  it('preserves the original, strips the fresh frontmatter, adds the header', () => {
    const existing = '---\nperiod: daily\n---\n\n# 日报\n\nold body\n';
    const fresh = '---\ntype: activity-report\n---\n\n# 日报\n\nnew body\n';
    const out = appendRegeneration(existing, fresh, '16:52', s);
    expect(out.startsWith('---\nperiod: daily\n---\n\n# 日报\n\nold body')).toBe(true);
    expect(out).toContain('## 重新生成于 16:52');
    expect(out).toContain('new body');
    // Exactly one frontmatter block — the appended copy is stripped.
    expect(out.match(/^---$/gm)?.length).toBe(2); // opening + closing of the original
    expect(out.endsWith('\n')).toBe(true);
  });
});
