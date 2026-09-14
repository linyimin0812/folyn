import { describe, expect, it } from 'vitest';
import { blockAlignPoint } from './blockAlignPoint';

// srcLines are 0-indexed; blockSrcLine is 1-indexed (data-source-line).
function src(lines: string[]): string[] {
  return lines;
}

describe('blockAlignPoint', () => {
  describe('headings (h1-h6)', () => {
    it('centers an h1 on the cursor line regardless of cursor column', () => {
      // line 1 = "# Heading" (single source line). blockOffset=200, tall block.
      const lines = src(['# Heading', '', 'body text']);
      // cursor at col 1 (start) — old code gave blockOffset + 0.1*H (drift).
      const start = blockAlignPoint('H1', lines, 1, 1, 1, 10, 200, 60);
      // cursor at col 10 (end) — old code gave blockOffset + 1.0*H (bottom).
      const end = blockAlignPoint('H1', lines, 1, 1, 10, 10, 200, 60);
      const want = 200 + 60 / 2; // block center
      expect(start).toBe(want);
      expect(end).toBe(want);
    });

    it('centers every heading level on the cursor line (no column drift)', () => {
      const lines = src(['## Sub', '', 'x']);
      for (const tag of ['H1', 'H2', 'H3', 'H4', 'H5', 'H6']) {
        const ap = blockAlignPoint(tag, lines, 1, 1, 8, 8, 100, 40);
        expect(ap).toBe(100 + 40 / 2);
      }
    });

    it('does not drift vertically as the cursor moves horizontally', () => {
      // The reported bug: moving the cursor right across an h1 swept the
      // align point from the block top to its bottom. Verify it stays at
      // the block center.
      const lines = src(['# Hello World', '']);
      const points = [1, 3, 5, 7, 9, 13].map((col) =>
        blockAlignPoint('H1', lines, 1, 1, col, 13, 0, 60),
      );
      expect(new Set(points).size).toBe(1);
      expect(points[0]).toBe(60 / 2);
    });
  });

  describe('multi-line blocks', () => {
    it('maps the first source line of a paragraph to the block top', () => {
      // 3-line paragraph starting at line 1; cursor on line 1.
      const lines = src(['line one', 'line two', 'line three', '']);
      const ap = blockAlignPoint('P', lines, 1, 1, 1, 9, 0, 90);
      expect(ap).toBeCloseTo(0, 5);
    });

    it('maps the last source line near the block bottom', () => {
      const lines = src(['line one', 'line two', 'line three', '']);
      const ap = blockAlignPoint('P', lines, 1, 3, 1, 11, 0, 90);
      expect(ap).toBeCloseTo(90, 5);
    });

    it('maps the middle source line to the block middle', () => {
      const lines = src(['line one', 'line two', 'line three', '']);
      const ap = blockAlignPoint('P', lines, 1, 2, 1, 9, 0, 90);
      expect(ap).toBeCloseTo(45, 5);
    });
  });

  describe('single-line non-heading blocks', () => {
    it('falls back to cursor-column fraction for a single-line paragraph', () => {
      // one source line, blockHeight = one rendered line (~20px)
      const lines = src(['a short para', '']);
      // cursorCol/lineLength drives a vertical fraction across one line.
      const start = blockAlignPoint('P', lines, 1, 1, 0, 12, 0, 20);
      const end = blockAlignPoint('P', lines, 1, 1, 12, 12, 0, 20);
      expect(start).toBeCloseTo(0, 5);
      expect(end).toBeCloseTo(20, 5);
    });

    it('clamps the fraction to [0, 1]', () => {
      const lines = src(['para', '']);
      expect(blockAlignPoint('P', lines, 1, 1, -5, 4, 0, 20)).toBe(0);
      expect(blockAlignPoint('P', lines, 1, 1, 99, 4, 0, 20)).toBe(20);
    });
  });

  it('treats a block with no trailing blank line as spanning to EOF', () => {
    // No blank line terminates the paragraph → span runs to the last line.
    const lines = src(['line one', 'line two']);
    const ap = blockAlignPoint('P', lines, 1, 2, 1, 9, 0, 60);
    expect(ap).toBeCloseTo(60, 5);
  });

  describe('list items (li)', () => {
    it('top-aligns each item to the cursor line (no whole-list span)', () => {
      // Tight list: no blank lines between items. The blockLineSpan loop
      // would count all 3 items (span=3) if li used the fraction path,
      // re-merging the list. li must top-align regardless.
      const lines = src(['- a', '- b', '- c', '']);
      // cursor on item a (line 1) → its own top; never the list fraction.
      const a = blockAlignPoint('LI', lines, 1, 1, 1, 3, 100, 24);
      // cursor on item b (line 2) → li b top.
      const b = blockAlignPoint('LI', lines, 2, 2, 1, 3, 200, 24);
      // cursor on item c (line 3) → li c top (not a cursor-column sweep).
      const c = blockAlignPoint('LI', lines, 3, 3, 5, 3, 300, 24);
      expect(a).toBe(100);
      expect(b).toBe(200);
      expect(c).toBe(300);
    });

    it('does not drift with cursor column', () => {
      const lines = src(['- a', '- b', '']);
      const start = blockAlignPoint('LI', lines, 1, 1, 1, 3, 0, 24);
      const end = blockAlignPoint('LI', lines, 1, 1, 3, 3, 0, 24);
      expect(start).toBe(0);
      expect(end).toBe(0);
    });
  });
});
