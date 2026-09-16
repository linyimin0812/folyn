import { describe, expect, it } from 'vitest';
import { blockAlignPoint, blockLastSrcLine, gapAlignPoint } from './blockAlignPoint';

// srcLines are 0-indexed; blockSrcLine is 1-indexed (data-source-line).
// Signature: (tagName, srcLines, blockSrcLine, cursorLine, blockOffset, blockHeight).
function src(lines: string[]): string[] {
  return lines;
}

describe('blockAlignPoint', () => {
  describe('headings (h1-h6)', () => {
    it('centers an h1 on the cursor line', () => {
      // line 1 = "# Heading" (single source line). blockOffset=200, tall block.
      const lines = src(['# Heading', '', 'body text']);
      const ap = blockAlignPoint('H1', lines, 1, 1, 200, 60);
      expect(ap).toBe(200 + 60 / 2); // block center
    });

    it('centers every heading level on the cursor line', () => {
      const lines = src(['## Sub', '', 'x']);
      for (const tag of ['H1', 'H2', 'H3', 'H4', 'H5', 'H6']) {
        const ap = blockAlignPoint(tag, lines, 1, 1, 100, 40);
        expect(ap).toBe(100 + 40 / 2);
      }
    });
  });

  describe('multi-line blocks', () => {
    // 3-row paragraph (N=3); blockHeight=90 ⇒ each rendered row is 30px.
    // Row K (1-indexed from block start) top = (K-1)/N * blockHeight.
    const lines = src(['line one', 'line two', 'line three', '']);

    it('maps the first source line to the block top (row top, no offset)', () => {
      const ap = blockAlignPoint('P', lines, 1, 1, 0, 90);
      expect(ap).toBeCloseTo(0, 5); // (0)/3*90 = 0
    });

    it('maps the second source line to the second row top (not the block middle)', () => {
      // The old (blockLineSpan-1) denominator mapped line 2 to 1/2 of the
      // block (45) — half a row below its true top — the per-line drift.
      const ap = blockAlignPoint('P', lines, 1, 2, 0, 90);
      expect(ap).toBeCloseTo(30, 5); // (1)/3*90 = 30 = row 2 top
    });

    it('maps the last source line to its row top, not the block bottom', () => {
      // The old denominator mapped line 3 to the block BOTTOM (90) — one
      // row + margins below where it should be. The fix lands it on row 3
      // top (2/3 of the block).
      const ap = blockAlignPoint('P', lines, 1, 3, 0, 90);
      expect(ap).toBeCloseTo(60, 5); // (2)/3*90 = 60 = row 3 top
    });

    it('does not drift downward as the cursor moves down the rows', () => {
      // Each row top should advance by exactly one row height (30px); the
      // old code accelerated (0, 45, 90) because it mapped to the whole
      // block height instead of N row tops.
      const tops = [1, 2, 3].map((l) => blockAlignPoint('P', lines, 1, l, 0, 90));
      expect(tops[1] - tops[0]).toBeCloseTo(30, 5);
      expect(tops[2] - tops[1]).toBeCloseTo(30, 5);
    });
  });

  describe('single-line non-heading blocks', () => {
    it('top-aligns a single-line paragraph when not soft-wrapped (lineFrac≈0)', () => {
      // Unwrapped line: the cursor stays on the only visual line, so
      // lineFrac is ~0 → top-align to the cursor line.
      const lines = src(['a short para', '']);
      const ap = blockAlignPoint('P', lines, 1, 1, 0, 20);
      expect(ap).toBe(0);
    });

    it('does not drift as the cursor moves horizontally on an unwrapped line', () => {
      // Horizontal movement on a single (unwrapped) visual line never
      // changes the cursor's screen Y, so lineFrac stays ~0 and the align
      // point is fixed — no vertical preview sweep on the same line.
      const lines = src(['a short para', '']);
      const points = [0, 3, 6, 9, 12].map(() =>
        blockAlignPoint('P', lines, 1, 1, 0, 20), // lineFrac defaults to 0
      );
      expect(new Set(points).size).toBe(1);
      expect(points[0]).toBe(0);
    });

    it('tracks the cursor down a soft-wrapped line via lineFrac', () => {
      // The reported bug: a long single-line paragraph soft-wraps in the
      // editor into N visual lines; top-aligning (lineFrac=0) left the
      // preview stuck at the block top while the cursor drifted down the
      // wraps. lineFrac interpolates the align point down the preview
      // block so it follows the cursor.
      const lines = src(['a long paragraph that soft wraps', '']);
      const top = blockAlignPoint('P', lines, 1, 1, 100, 60, 0); // 1st visual line
      const mid = blockAlignPoint('P', lines, 1, 1, 100, 60, 0.5); // middle wrap
      const bot = blockAlignPoint('P', lines, 1, 1, 100, 60, 1); // last visual line
      expect(top).toBe(100); // block top
      expect(mid).toBeCloseTo(100 + 30, 5); // halfway down
      expect(bot).toBeCloseTo(100 + 60, 5); // block bottom
    });
  });

  it('treats a block with no trailing blank line as spanning to EOF', () => {
    // No blank line terminates the paragraph → span runs to the last line.
    // 2-row block, H=60 ⇒ row top = 30. Cursor on line 2 (row 2 top), not
    // the block bottom.
    const lines = src(['line one', 'line two']);
    const ap = blockAlignPoint('P', lines, 1, 2, 0, 60);
    expect(ap).toBeCloseTo(30, 5);
  });

  describe('list items (li)', () => {
    it('top-aligns each item to the cursor line (no whole-list span)', () => {
      // Tight list: no blank lines between items. The blockLineSpan loop
      // would count all 3 items (span=3) if li used the fraction path,
      // re-merging the list. li must top-align regardless.
      const lines = src(['- a', '- b', '- c', '']);
      // cursor on item a (line 1) → its own top; never the list fraction.
      const a = blockAlignPoint('LI', lines, 1, 1, 100, 24);
      // cursor on item b (line 2) → li b top.
      const b = blockAlignPoint('LI', lines, 2, 2, 200, 24);
      // cursor on item c (line 3) → li c top.
      const c = blockAlignPoint('LI', lines, 3, 3, 300, 24);
      expect(a).toBe(100);
      expect(b).toBe(200);
      expect(c).toBe(300);
    });
  });
});

describe('blockLastSrcLine', () => {
  it('returns the block start when followed immediately by a blank line', () => {
    // line 1 = 'para', line 2 = blank → block is just line 1.
    expect(blockLastSrcLine(['para', '', 'next'], 1)).toBe(1);
  });

  it('returns the last non-blank line of a multi-line block', () => {
    // lines 1-3 content, line 4 blank → lastSrcLine = 3.
    expect(blockLastSrcLine(['a', 'b', 'c', '', 'd'], 1)).toBe(3);
  });

  it('runs to EOF when no trailing blank line terminates the block', () => {
    expect(blockLastSrcLine(['a', 'b', 'c'], 1)).toBe(3);
  });

  it('respects blockSrcLine (block not at the document top)', () => {
    // block starts at line 3 (idx 2); lines 3-4 content, line 5 blank.
    expect(blockLastSrcLine(['x', '', 'a', 'b', ''], 3)).toBe(4);
  });

  it('clamps a start inside blanks to at least one line', () => {
    // blockSrcLine points at a blank line itself → span floors at 1.
    expect(blockLastSrcLine(['', ''], 1)).toBe(1);
  });
});

describe('gapAlignPoint', () => {
  it('aligns to the next block top when one exists', () => {
    // The reported bug: cursor on a blank line below a block left the
    // preview stuck on the current block bottom (drifting one line per
    // blank line). Aligning to the next block top makes the preview advance
    // to the content that follows the cursor's blank line.
    expect(gapAlignPoint(/*prevBottom*/ 100, /*nextOffset*/ 250)).toBe(250);
  });

  it('stays on the current block bottom when there is no next block', () => {
    // Cursor on trailing blank lines at EOF — nothing below to advance to.
    expect(gapAlignPoint(100, null)).toBe(100);
    expect(gapAlignPoint(100, undefined as unknown as null)).toBe(100);
  });

  it('picks the next top even when it sits below a large gap', () => {
    // Multiple blank lines between blocks → next top is the right anchor
    // regardless of how many blank lines the cursor is into the gap.
    expect(gapAlignPoint(100, 999)).toBe(999);
  });
});
