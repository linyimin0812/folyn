// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { findInDoc, excerptParts } from './findInDoc';

const DOC = [
  '# 标题一',            // 1
  '',                    // 2
  '正文里有苹果。',       // 3
  '',                    // 4
  '```js',               // 5
  'const apple = 1;',    // 6
  '```',                 // 7
  '',                    // 8
  '## 小节',             // 9
  '',                    // 10
  ':::tabs',             // 11
  ':::tab 苹果',         // 12
  '苹果详情 A',          // 13
  ':::',                 // 14
  ':::tab 香蕉',         // 15
  '香蕉里有 apple 字样',  // 16
  ':::',                 // 17
  ':::',                 // 18
  '',                    // 19
  ':::collapsible 折叠的苹果',  // 20
  '折叠正文 apple',      // 21
  ':::',                 // 22
].join('\n');

describe('findInDoc', () => {
  it('finds every occurrence across headings, text and code, case-insensitively', () => {
    const ms = findInDoc(DOC, '苹果');
    // line 3, tab title 12, body 13, collapsible title 20 (line 21 has the
    // english word, not the hanzi)
    expect(ms.map((m) => m.line)).toEqual([3, 12, 13, 20]);
    const en = findInDoc(DOC, 'apple');
    // code 6, tab body 16, collapsible body 21
    expect(en.map((m) => m.line)).toEqual([6, 16, 21]);
    expect(en.every((m) => m.colEnd - m.colStart === 5)).toBe(true);
  });

  it('attaches the nearest preceding heading as context', () => {
    const ms = findInDoc(DOC, '苹果');
    expect(ms[0].heading).toBe('标题一');
    expect(ms.find((m) => m.line === 13)!.heading).toBe('小节');
  });

  it('attaches the enclosing container chain outer → inner', () => {
    const m = findInDoc(DOC, '详情').find((x) => x.line === 13)!;
    expect(m.containers).toEqual(['Tabs', 'Tab · 苹果']);
    const c = findInDoc(DOC, '折叠正文').find((x) => x.line === 21)!;
    expect(c.containers).toEqual(['折叠 · 折叠的苹果']);
    expect(c.inHiddenContainer).toBe(true);
  });

  it('marks matches inside tab panels / collapsibles as hidden-container hits', () => {
    const m = findInDoc(DOC, 'apple').find((x) => x.line === 16)!;
    expect(m.inHiddenContainer).toBe(true);
    const plain = findInDoc(DOC, '正文里有').find((x) => x.line === 3)!;
    expect(plain.inHiddenContainer).toBe(false);
    expect(plain.containers).toEqual([]);
  });

  it('reports multiple hits per line with correct columns', () => {
    const ms = findInDoc('aXa Xb Xa', 'x');
    expect(ms.length).toBe(3);
    expect(ms.map((m) => m.colStart)).toEqual([1, 4, 7]);
    expect(excerptParts(ms[1])).toEqual(['aXa ', 'X', 'b Xa']);
  });

  it('is case-sensitive only when asked', () => {
    const ci = findInDoc('Apple apple APPLE', 'apple');
    expect(ci.length).toBe(3);
    const cs = findInDoc('Apple apple APPLE', 'apple', { caseSensitive: true });
    expect(cs.length).toBe(1);
    expect(cs[0].colStart).toBe(6);
  });

  it('returns nothing for empty or whitespace-only queries', () => {
    expect(findInDoc(DOC, '')).toEqual([]);
  });

  it('skips pure fence delimiter lines but not fence content', () => {
    const ms = findInDoc(DOC, '```');
    expect(ms.map((m) => m.line)).toEqual([5]);
    // line 5 is `js`-suffixed (length > 4) so it is still searched — the
    // bare ``` on line 7 is skipped. Query that only matches the bare one:
    const bare = findInDoc('```\nplain\n```', '```');
    expect(bare.length).toBe(0);
  });

  it('respects the match limit', () => {
    const doc = Array.from({ length: 30 }, (_, i) => `hit number ${i}`).join('\n');
    expect(findInDoc(doc, 'hit', { limit: 5 }).length).toBe(5);
  });
});
