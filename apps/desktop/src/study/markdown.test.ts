import { describe, it, expect } from 'vitest';
import {
  parseStudy,
  serializeStudy,
  buildMaterialLine,
  buildUnitLine,
  buildReviewLine,
} from './markdown';
import type { StudyMaterial, StudyUnit, ReviewAtom } from './types';

const SLUG = 'agent-dev';

const NOTE = `---
title: agent 开发
slug: agent-dev
created: 2026-06-29
---

## 资料
- @book 《大模型应用开发》 | 张三 | 系统讲 Agent | 难度:中 | https://example.com/book
- @web Agent 入门 | https://example.com/web | 不错的入门

## 计划
- [ ] 1. 入门概览 @{est:2h dep:- prog:0}
- [x] 2. 核心 API @{est:4h dep:1 prog:100}

## 笔记
- **概念**: Agent = 感知→决策→行动 | 因为: ... | 例子: ... | 类比: [[react-agent]]
- 普通未托管复选框 - [ ] 不应被改写

## 复习
- [ ] Agent 三要素 @{next:2026-07-02 rep:2 ef:2.36 ivl:6 lapses:0 topic:agent-dev src:[[agent-三要素]]}
`;

describe('parseStudy', () => {
  const parsed = parseStudy(NOTE, SLUG);

  it('parses front-matter', () => {
    expect(parsed.frontmatter.title).toBe('agent 开发');
    expect(parsed.frontmatter.slug).toBe('agent-dev');
    expect(parsed.frontmatter.created).toBe('2026-06-29');
  });

  it('parses materials (book + web) with line index', () => {
    expect(parsed.materials).toHaveLength(2);
    expect(parsed.materials[0]).toMatchObject({
      kind: 'book',
      title: '《大模型应用开发》',
      author: '张三',
      summary: '系统讲 Agent',
      difficulty: 'medium',
      url: 'https://example.com/book',
    });
    expect(parsed.materials[1]).toMatchObject({
      kind: 'web',
      title: 'Agent 入门',
      url: 'https://example.com/web',
      summary: '不错的入门',
    });
    expect(parsed.materials[0].lineIndex).toBeGreaterThanOrEqual(0);
  });

  it('parses units with order/est/dep/prog and done', () => {
    expect(parsed.units).toHaveLength(2);
    expect(parsed.units[0]).toMatchObject({
      order: 1,
      title: '入门概览',
      done: false,
      est: '2h',
      dep: '-',
      prog: 0,
    });
    expect(parsed.units[1]).toMatchObject({
      order: 2,
      title: '核心 API',
      done: true,
      prog: 100,
    });
  });

  it('parses review atoms with SM-2 attrs', () => {
    expect(parsed.reviewAtoms).toHaveLength(1);
    expect(parsed.reviewAtoms[0]).toMatchObject({
      summary: 'Agent 三要素',
      next: '2026-07-02',
      rep: 2,
      ef: 2.36,
      ivl: 6,
      lapses: 0,
      topic: 'agent-dev',
      src: '[[agent-三要素]]',
    });
  });

  it('preserves raw lines including prose, notes section, and unmanaged checkboxes', () => {
    expect(parsed.rawLines.some((l) => l.includes('感知→决策→行动'))).toBe(true);
    expect(parsed.rawLines.some((l) => l.includes('普通未托管复选框'))).toBe(true);
  });
});

describe('buildMaterialLine / buildUnitLine / buildReviewLine', () => {
  it('builds canonical book line', () => {
    const m: StudyMaterial = {
      id: 'x', kind: 'book', title: '《书》', author: '作者', summary: '简介',
      difficulty: 'medium', url: 'https://x', lineIndex: -1,
    };
    expect(buildMaterialLine(m)).toBe('- @book 《书》 | 作者 | 简介 | 难度:中 | https://x');
  });

  it('builds canonical web line', () => {
    const m: StudyMaterial = {
      id: 'x', kind: 'web', title: '标题', url: 'https://x', summary: '简介', lineIndex: -1,
    };
    expect(buildMaterialLine(m)).toBe('- @web 标题 | https://x | 简介');
  });

  it('builds canonical unit line', () => {
    const u: StudyUnit = {
      id: 'x', order: 3, title: '新单元', done: false, est: '2h', dep: '1', prog: 0, lineIndex: -1,
    };
    expect(buildUnitLine(u)).toBe('- [ ] 3. 新单元 @{est:2h dep:1 prog:0}');
  });

  it('builds canonical review line', () => {
    const r: ReviewAtom = {
      id: 'x', summary: '摘要', done: false, next: '2026-07-02', rep: 2, ef: 2.36,
      ivl: 6, lapses: 0, topic: 'agent-dev', src: '[[子]]', lineIndex: -1,
    };
    expect(buildReviewLine(r)).toBe(
      '- [ ] 摘要 @{next:2026-07-02 rep:2 ef:2.36 ivl:6 lapses:0 topic:agent-dev src:[[子]]}',
    );
  });
});

describe('serializeStudy', () => {
  it('round-trips a canonical note unchanged', () => {
    const parsed = parseStudy(NOTE, SLUG);
    const out = serializeStudy(parsed, parsed.materials, parsed.units, parsed.reviewAtoms);
    expect(out).toBe(NOTE);
  });

  it('appends a new material to the 资料 section', () => {
    const parsed = parseStudy(NOTE, SLUG);
    const newM: StudyMaterial = {
      id: 'new', kind: 'web', title: '新资料', url: 'https://x', summary: '好文', lineIndex: -1,
    };
    const out = serializeStudy(parsed, [...parsed.materials, newM], parsed.units, parsed.reviewAtoms);
    expect(out).toContain('- @web 新资料 | https://x | 好文');
    // 出现在 ## 资料 段内（## 计划 之前）
    const mIdx = out.indexOf('- @web 新资料');
    const planIdx = out.indexOf('## 计划');
    expect(mIdx).toBeLessThan(planIdx);
  });

  it('appends a new unit to the 计划 section', () => {
    const parsed = parseStudy(NOTE, SLUG);
    const newU: StudyUnit = {
      id: 'new', order: 3, title: '实战', done: false, est: '6h', dep: '2', prog: 0, lineIndex: -1,
    };
    const out = serializeStudy(parsed, parsed.materials, [...parsed.units, newU], parsed.reviewAtoms);
    expect(out).toContain('- [ ] 3. 实战 @{est:6h dep:2 prog:0}');
    const uIdx = out.indexOf('- [ ] 3. 实战');
    const noteIdx = out.indexOf('## 笔记');
    expect(uIdx).toBeLessThan(noteIdx);
  });

  it('appends a new review atom to the 复习 section', () => {
    const parsed = parseStudy(NOTE, SLUG);
    const newR: ReviewAtom = {
      id: 'new', summary: '新原子', done: false, next: '2026-06-30', rep: 0, ef: 2.5,
      ivl: 1, lapses: 0, topic: 'agent-dev', lineIndex: -1,
    };
    const out = serializeStudy(parsed, parsed.materials, parsed.units, [...parsed.reviewAtoms, newR]);
    expect(out).toContain('- [ ] 新原子 @{next:2026-06-30 rep:0 ef:2.5 ivl:1 lapses:0 topic:agent-dev}');
  });

  it('creates missing sections at EOF when appending', () => {
    const bare = `# 仅散文\n\n没有任何托管段。\n`;
    const parsed = parseStudy(bare, SLUG);
    const newM: StudyMaterial = {
      id: 'new', kind: 'web', title: '资料', url: 'https://x', summary: 's', lineIndex: -1,
    };
    const out = serializeStudy(parsed, [newM], [], []);
    expect(out).toContain('## 资料');
    expect(out).toContain('- @web 资料 | https://x | s');
    expect(out).toContain('没有任何托管段。');
  });

  it('rewrites only the toggled unit, preserves everything else', () => {
    const parsed = parseStudy(NOTE, SLUG);
    const units = parsed.units.map((u) =>
      u.order === 1 ? { ...u, done: true, prog: 100 } : u,
    );
    const out = serializeStudy(parsed, parsed.materials, units, parsed.reviewAtoms);
    const toggled = out.split('\n').find((l) => l.startsWith('- [x] 1. 入门概览'));
    expect(toggled).toBeDefined();
    expect(toggled).toContain('prog:100');
    // 未托管行仍在
    expect(out).toContain('普通未托管复选框 - [ ] 不应被改写');
    // 笔记段散文仍在
    expect(out).toContain('感知→决策→行动');
    // 另一单元未变
    expect(out).toContain('- [x] 2. 核心 API @{est:4h dep:1 prog:100}');
  });

  it('removes a managed line when deleted from its array', () => {
    const parsed = parseStudy(NOTE, SLUG);
    const keep = parsed.materials.slice(1);
    const out = serializeStudy(parsed, keep, parsed.units, parsed.reviewAtoms);
    expect(out).not.toContain('《大模型应用开发》');
    expect(out).toContain('Agent 入门');
    expect(out).toContain('感知→决策→行动');
  });

  it('preserves unmanaged lines verbatim (prose, plain checkbox, whole 笔记 section)', () => {
    const noteWithExtra = `## 资料
- @web A | https://a | 简介

## 计划
- [ ] 1. 单元 @{est:1h dep:- prog:0}
- 普通散文行，不应改写
- [ ] 不是托管单元（无序号点）

## 笔记
任意散文
- [ ] 笔记里的复选框也不动

## 复习
- [ ] 原子 @{next:2026-07-02 rep:0 ef:2.5 ivl:1 lapses:0}
`;
    const parsed = parseStudy(noteWithExtra, SLUG);
    const out = serializeStudy(parsed, parsed.materials, parsed.units, parsed.reviewAtoms);
    expect(out).toBe(noteWithExtra);
    expect(out).toContain('普通散文行，不应改写');
    expect(out).toContain('不是托管单元');
  });

  it('does not crash on malformed managed lines (preserved verbatim)', () => {
    const malformed = `## 资料
- @book 缺字段 | 只有作者

## 计划
- [ ] 没有序号点 @{est:1h dep:- prog:0}
- [ ] 1. 缺属性块

## 复习
- [ ] 缺 next 属性 @{rep:0 ef:2.5}
`;
    const parsed = parseStudy(malformed, SLUG);
    // 畸形行不匹配托管正则 → 不进结构
    expect(parsed.materials).toHaveLength(0);
    expect(parsed.units).toHaveLength(0);
    expect(parsed.reviewAtoms).toHaveLength(0);
    // 序列化不抛错，原样保留
    expect(() => serializeStudy(parsed, [], [], [])).not.toThrow();
    const out = serializeStudy(parsed, [], [], []);
    expect(out).toContain('- @book 缺字段 | 只有作者');
    expect(out).toContain('没有序号点');
    expect(out).toContain('缺 next 属性');
  });

  it('does not crash on missing sections', () => {
    const bare = `---\ntitle: 空\n---\n\n只有 front-matter 和散文。\n`;
    const parsed = parseStudy(bare, SLUG);
    expect(() => serializeStudy(parsed, [], [], [])).not.toThrow();
    expect(serializeStudy(parsed, [], [], [])).toBe(bare);
  });

  it('round-trips an empty document', () => {
    const parsed = parseStudy('', SLUG);
    expect(parsed.materials).toHaveLength(0);
    expect(parsed.units).toHaveLength(0);
    expect(parsed.reviewAtoms).toHaveLength(0);
    expect(serializeStudy(parsed, [], [], [])).toBe('');
  });

  it('round-trips a front-matter-only document', () => {
    const fm = `---\ntitle: x\nslug: y\n---\n`;
    const parsed = parseStudy(fm, SLUG);
    expect(parsed.frontmatter.title).toBe('x');
    expect(serializeStudy(parsed, [], [], [])).toBe(fm);
  });

  it('handles duplicate unit orders without crashing', () => {
    const dup = `## 计划\n- [ ] 1. A @{est:1h dep:- prog:0}\n- [ ] 1. B @{est:2h dep:- prog:0}\n`;
    const parsed = parseStudy(dup, SLUG);
    expect(parsed.units).toHaveLength(2);
    expect(parsed.units[0].order).toBe(1);
    expect(parsed.units[1].order).toBe(1);
    // 切换第一个 done，第二个原样保留
    const units = parsed.units.map((u, i) => (i === 0 ? { ...u, done: true } : u));
    const out = serializeStudy(parsed, parsed.materials, units, parsed.reviewAtoms);
    expect(out).toContain('- [x] 1. A @{est:1h dep:- prog:0}');
    expect(out).toContain('- [ ] 1. B @{est:2h dep:- prog:0}');
  });
});
