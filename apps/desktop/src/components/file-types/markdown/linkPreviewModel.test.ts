// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  headingSlug,
  frontmatterLineCount,
  scanHeadings,
  findSection,
  extractExcerpt,
  buildLinkPreview,
  isPreviewableTarget,
} from './linkPreviewModel';

const DOC = [
  '---',              // 1
  'title: 目标文档',    // 2
  '---',              // 3
  '# 文档标题',        // 4
  '',                 // 5
  '开篇介绍段落。',      // 6
  '',                 // 7
  '## 安装指南',       // 8
  '',                 // 9
  '运行以下命令：',      // 10
  '',                 // 11
  '```bash',          // 12
  'npm i',            // 13
  '```',              // 14
  '',                 // 15
  ':::tabs',          // 16
  ':::tab A',         // 17
  '面板甲内容',         // 18
  ':::',              // 19
  ':::tab B',         // 20
  '面板乙内容',         // 21
  ':::',              // 22
  ':::',              // 23
  '',                 // 24
  '![截图](pic.png)',  // 25
  '',                 // 26
  '## 常见问题',       // 27
  '',                 // 28
  '问题一解答。',       // 29
].join('\n');

describe('linkPreviewModel', () => {
  it('headingSlug matches the preview HeadingWithId rule', () => {
    expect(headingSlug('安装指南')).toBe('安装指南');
    expect(headingSlug('Setup Guide 101!')).toBe('setup-guide-101');
    expect(headingSlug('A — B')).toBe('a--b');
  });

  it('frontmatterLineCount handles the --- block, absence and unterminated', () => {
    expect(frontmatterLineCount(DOC)).toBe(3);
    expect(frontmatterLineCount('正文')).toBe(0);
    expect(frontmatterLineCount('---\nnever closed')).toBe(0);
  });

  it('scanHeadings skips fenced code and reports level/line/text', () => {
    const hs = scanHeadings(DOC);
    expect(hs.map((h) => [h.line, h.level, h.text])).toEqual([
      [4, 1, '文档标题'],
      [8, 2, '安装指南'],
      [27, 2, '常见问题'],
    ]);
  });

  it('findSection matches by slug, percent-decodes, falls back to text', () => {
    expect(findSection(DOC, '安装指南')?.line).toBe(8);
    expect(findSection(DOC, '%E5%AE%89%E8%A3%85%E6%8C%87%E5%8D%97')?.line).toBe(8);
    // punctuation-stripped slug: 'Setup Guide!' → 'setup-guide'
    expect(findSection('# Setup Guide!\nbody', 'setup-guide')?.text).toBe('Setup Guide!');
    expect(findSection(DOC, undefined)).toBeNull();
    expect(findSection(DOC, 'missing-section')).toBeNull();
  });

  it('extractExcerpt with a section runs to the next same-or-higher heading', () => {
    const sec = findSection(DOC, '安装指南')!;
    const out = extractExcerpt(DOC, sec);
    // stops at line 27 (## 常见问题): no 问题一解答
    expect(out).not.toContain('问题一');
    expect(out).toContain('运行以下命令');
    expect(out).toContain('npm i');
  });

  it('extractExcerpt strips directive markers, keeps panel content, drops image-only lines', () => {
    const sec = findSection(DOC, '安装指南')!;
    const out = extractExcerpt(DOC, sec);
    expect(out).toContain('面板甲内容');
    expect(out).not.toMatch(/:::|tabs/);
    expect(out).not.toContain('pic.png');
  });

  it('extractExcerpt without a section starts after frontmatter and stops at the first heading', () => {
    const out = extractExcerpt(DOC, null);
    expect(out).toContain('开篇介绍段落');
    expect(out).not.toContain('运行以下命令');
  });

  it('extractExcerpt repairs a cut that lands inside a fence', () => {
    const longCode = ['## S', '', '```js', ...Array.from({ length: 60 }, (_, i) => `line${i};`), '```'].join('\n');
    const out = extractExcerpt(longCode, findSection(longCode, 's')!);
    // the closing fence was re-appended: the excerpt opens a fence and closes it
    const fences = out.split('\n').filter((l) => l.trim().startsWith('```'));
    expect(fences.length % 2).toBe(0);
    expect(out).toContain('line0;');
  });

  it('buildLinkPreview composes name / path / section / excerpt', () => {
    const m = buildLinkPreview('notes/setup.md', '安装指南', DOC);
    expect(m.name).toBe('setup.md');
    expect(m.displayPath).toBe('notes');
    expect(m.section).toBe('安装指南');
    expect(m.sectionLine).toBe(8);
    expect(m.excerpt).toContain('npm i');
    const root = buildLinkPreview('README.md', undefined, DOC);
    expect(root.displayPath).toBe('/');
    expect(root.section).toBeNull();
    expect(root.sectionLine).toBeNull();
  });

  it('isPreviewableTarget accepts md/markdown only', () => {
    expect(isPreviewableTarget('a/b.md')).toBe(true);
    expect(isPreviewableTarget('a/b.MARKDOWN')).toBe(true);
    expect(isPreviewableTarget('a/b.png')).toBe(false);
    expect(isPreviewableTarget('a/b.md.js')).toBe(false);
  });
});
