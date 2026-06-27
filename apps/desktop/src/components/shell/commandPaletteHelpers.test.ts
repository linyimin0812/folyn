import { describe, it, expect } from 'vitest';
import { buildHighlightSegments, groupLabelZh } from './commandPaletteHelpers';
import type { PaletteGroup } from '@/store/commandPaletteStore';

describe('buildHighlightSegments', () => {
  it('returns a single unmatched segment for an empty matches array', () => {
    expect(buildHighlightSegments('New File', [])).toEqual([
      { text: 'New File', matched: false },
    ]);
  });

  it('returns no segments for an empty title', () => {
    expect(buildHighlightSegments('', [0, 1])).toEqual([]);
  });

  it('ignores out-of-bounds match indices', () => {
    expect(buildHighlightSegments('ab', [0, 5, 10])).toEqual([
      { text: 'a', matched: true },
      { text: 'b', matched: false },
    ]);
  });

  it('groups contiguous matched chars into one segment', () => {
    // matches at 0,1 -> "Ne"; rest unmatched
    const segs = buildHighlightSegments('New File', [0, 1]);
    expect(segs).toEqual([
      { text: 'Ne', matched: true },
      { text: 'w File', matched: false },
    ]);
  });

  it('handles non-contiguous matches with alternating segments', () => {
    // 'New File': N=0 e=1 w=2 ' '=3 F=4 i=5 l=6 e=7
    // matches at 0 and 4 -> "N" matched, "ew " unmatched, "F" matched, "ile" unmatched
    const segs = buildHighlightSegments('New File', [0, 4]);
    expect(segs).toEqual([
      { text: 'N', matched: true },
      { text: 'ew ', matched: false },
      { text: 'F', matched: true },
      { text: 'ile', matched: false },
    ]);
  });

  it('deduplicates and sorts match indices', () => {
    const segs = buildHighlightSegments('abc', [2, 0, 2, 1]);
    expect(segs).toEqual([{ text: 'abc', matched: true }]);
  });
});

describe('groupLabelZh', () => {
  const mk = (label: string): PaletteGroup => ({ id: label, label, items: [] });

  it('maps known English store labels to Chinese', () => {
    expect(groupLabelZh(mk('Actions'))).toBe('动作');
    expect(groupLabelZh(mk('Panels / Modes'))).toBe('面板与模式');
    expect(groupLabelZh(mk('Recent Files'))).toBe('最近文件');
    expect(groupLabelZh(mk('All Files'))).toBe('全部文件');
  });

  it('falls back to the original label for unknown groups', () => {
    expect(groupLabelZh(mk('Something Else'))).toBe('Something Else');
  });
});
