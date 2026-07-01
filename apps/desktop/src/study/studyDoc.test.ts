import { describe, it, expect } from 'vitest';
import { appendToNotesSection, ELABORATION_TEMPLATE } from './studyDoc';

const DOC_WITH_NOTES = `---
title: agent 开发
slug: agent-dev
---

## 资料

## 计划

## 笔记
- 已有笔记第一行
- 已有笔记第二行

## 复习
`;

const DOC_NO_NOTES = `---
title: x
slug: x
---

## 资料
`;

describe('appendToNotesSection', () => {
  it('appends a line to the notes section tail, preserving existing prose', () => {
    const out = appendToNotesSection(DOC_WITH_NOTES, ELABORATION_TEMPLATE);
    const lines = out.split('\n');
    // 模板行出现在 ## 笔记 段内、且在 ## 复习 段之前
    const notesIdx = lines.indexOf('## 笔记');
    const reviewIdx = lines.indexOf('## 复习');
    const tplIdx = lines.indexOf(ELABORATION_TEMPLATE);
    expect(notesIdx).toBeGreaterThanOrEqual(0);
    expect(tplIdx).toBeGreaterThan(notesIdx);
    expect(tplIdx).toBeLessThan(reviewIdx);
    // 已有笔记原样保留
    expect(out).toContain('- 已有笔记第一行');
    expect(out).toContain('- 已有笔记第二行');
  });

  it('creates the notes section at EOF when absent', () => {
    const out = appendToNotesSection(DOC_NO_NOTES, ELABORATION_TEMPLATE);
    expect(out).toContain('## 笔记');
    expect(out).toContain(ELABORATION_TEMPLATE);
    // 原资料段不受影响
    expect(out).toContain('## 资料');
  });

  it('is idempotent-safe: calling twice yields two template lines', () => {
    const once = appendToNotesSection(DOC_WITH_NOTES, ELABORATION_TEMPLATE);
    const twice = appendToNotesSection(once, ELABORATION_TEMPLATE);
    const count = (twice.match(new RegExp(ELABORATION_TEMPLATE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    expect(count).toBe(2);
  });

  it('appends to the notes section when it is the last section (no trailing heading)', () => {
    const doc = `---\ntitle: t\nslug: t\n---\n\n## 资料\n\n## 笔记\n- 只有一行笔记\n`;
    const out = appendToNotesSection(doc, ELABORATION_TEMPLATE);
    const lines = out.split('\n');
    const notesIdx = lines.indexOf('## 笔记');
    const tplIdx = lines.indexOf(ELABORATION_TEMPLATE);
    expect(notesIdx).toBeGreaterThanOrEqual(0);
    expect(tplIdx).toBeGreaterThan(notesIdx);
    // 原笔记行原样保留
    expect(out).toContain('- 只有一行笔记');
  });

  it('preserves a notes section that is empty (heading only) and appends after it', () => {
    const doc = `---\ntitle: t\nslug: t\n---\n\n## 笔记\n\n## 复习\n`;
    const out = appendToNotesSection(doc, '- 新笔记');
    const lines = out.split('\n');
    expect(lines[lines.indexOf('## 笔记') + 1]).toBe('- 新笔记');
    // 复习段标题仍在且位置不变
    expect(out).toContain('## 复习');
  });
});
