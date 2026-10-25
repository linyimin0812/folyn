import { describe, it, expect, vi } from 'vitest';
import { validateIndexNodes, chunkContent } from './sourceIngest';

describe('validateIndexNodes — 行范围校验（程序写入前）', () => {
  it('keeps valid nodes, drops out-of-bounds / non-integer / inverted ranges', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const nodes = [
      { title: 'A', summary: 'a', startLine: 1, endLine: 10 },
      { title: 'B', summary: 'b', startLine: 5, endLine: 999 }, // 越界
      { title: 'C', summary: 'c', startLine: 2.5, endLine: 4 }, // 非整数
      { title: 'D', summary: 'd', startLine: 8, endLine: 3 }, // start > end
      { title: '', summary: 'e', startLine: 1, endLine: 2 }, // 空 title
      'not-an-object',
    ];
    const kept = validateIndexNodes(nodes, 100);
    expect(kept).toEqual([{ title: 'A', summary: 'a', startLine: 1, endLine: 10 }]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('drops overlapping nodes (sorted, first-kept wins)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const kept = validateIndexNodes(
      [
        { title: 'late', summary: '', startLine: 20, endLine: 30 },
        { title: 'early', summary: '', startLine: 1, endLine: 10 },
        { title: 'overlap', summary: '', startLine: 8, endLine: 12 },
      ],
      100,
    );
    expect(kept.map((n) => n.title)).toEqual(['early', 'late']);
    warn.mockRestore();
  });

  it('returns empty for non-array input', () => {
    expect(validateIndexNodes(undefined, 10)).toEqual([]);
    expect(validateIndexNodes({ nodes: [] }, 10)).toEqual([]);
  });
});

describe('chunkContent — 长文按行边界分块', () => {
  it('returns a single chunk for short content', () => {
    const chunks = chunkContent('a\nb\nc');
    expect(chunks).toEqual([{ text: 'a\nb\nc', firstLine: 1 }]);
  });

  it('splits at line boundaries and reports absolute first lines', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line-${i + 1}`);
    const content = lines.join('\n');
    const chunks = chunkContent(content, 30 * 'line-1'.length);
    expect(chunks.length).toBeGreaterThan(1);
    // 拼回去与原文一致（无损）。
    expect(chunks.map((c) => c.text).join('\n')).toBe(content);
    // firstLine 与块内容真实对应。
    for (const c of chunks) {
      const chunkLines = c.text.split('\n');
      expect(chunkLines[0]).toBe(`line-${c.firstLine}`);
      expect(chunkLines[chunkLines.length - 1]).toBe(`line-${c.firstLine + chunkLines.length - 1}`);
    }
  });
});
