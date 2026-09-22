import { describe, expect, it } from 'vitest';
import { isCodeBlockEl, planGapHeights } from './gapCompensation';

// Fake DOM-free blocks: predicate reads a plain flag, so the grid math is
// testable without jsdom rects.
interface FakeEl { tag?: string; isCode?: boolean }
interface FakeBlock { el: FakeEl; line: number; top: number }
interface FakeGap { el: FakeEl; curH: number }

const L = 20; // editorLineHeight
const isCode = (el: FakeEl) => !!el.isCode;

function plan(blocks: FakeBlock[], gaps: Map<number, FakeGap>) {
  return planGapHeights(blocks as any, gaps as any, L, isCode as any);
}

describe('planGapHeights', () => {
  it('absorbs an ordinary re-wrapped paragraph shortfall into the gap (old behavior)', () => {
    // A (line 1, top 0) renders 10px shorter than its editor span → B sits at 30
    // instead of grid target 40. Gap (1 blank line, 20px) must grow to 30.
    const gap = { el: {}, curH: 20 };
    const { writes, origin } = plan(
      [{ el: {}, line: 1, top: 0 }, { el: {}, line: 3, top: 30 }],
      new Map([[0, gap]])
    );
    expect(origin).toBe(0);
    expect(writes).toEqual([[gap.el, 30]]);
  });

  it('capped code block: the gap after it keeps its static height, no ~1800px dump', () => {
    // Code lines 1-100 (editor span 2000px) capped at 420px; blank 101 (20px);
    // B (line 102) at 440; blank 103 (20px); C (line 104) at 480.
    // Old math dumped 1600px into gap1. Now gap1 is untouched and the grid
    // re-anchors so C's target is 440 + 2*L = 480 → gap2 stays 20.
    const gap1 = { el: { id: 'gap1' }, curH: 20 };
    const gap2 = { el: { id: 'gap2' }, curH: 20 };
    const { writes, origin } = plan(
      [
        { el: { isCode: true }, line: 1, top: 0 },
        { el: {}, line: 102, top: 440 },
        { el: {}, line: 104, top: 480 },
      ],
      new Map([[0, gap1], [1, gap2]])
    );
    expect(writes).toEqual([[gap2.el, 20]]); // gap1 not written — static height kept
    expect(writes.every(([, h]) => h <= 40)).toBe(true);
    // re-anchored: origin moved so B's target equals its actual top (440)
    expect(origin).toBe(440 - 101 * L);
  });

  it('floors the gap at 8px when the next block renders past its grid target', () => {
    const gap = { el: {}, curH: 20 };
    const { writes } = plan(
      [{ el: {}, line: 1, top: 0 }, { el: {}, line: 3, top: 100 }],
      new Map([[0, gap]])
    );
    expect(writes).toEqual([[gap.el, 8]]);
  });

  it('adjacent blocks without a gap: shortfall is absorbed at the next (absolute) gap', () => {
    // A and B adjacent (no gap entry), C's gap carries the whole absolute grid math.
    const gap = { el: {}, curH: 20 };
    const { writes } = plan(
      [{ el: {}, line: 1, top: 0 }, { el: {}, line: 2, top: 30 }, { el: {}, line: 4, top: 50 }],
      new Map([[1, gap]])
    );
    // C target = 0 + 3*L = 60; C actual 50 → gap 20 + 10 = 30
    expect(writes).toEqual([[gap.el, 30]]);
  });

  it('code block followed ADJACENTLY (no gap): shortfall must not dump at a later gap', () => {
    // Code lines 1-100 (editor span 2000px) capped at 420px; B (line 101)
    // directly after with NO blank line, at top 420; blank 102 (20px); C
    // (line 103) at 460. Old math dumped ~1580px into the C gap. Now the
    // grid re-anchors at B (even with no gap) and the C gap stays 20.
    const gap = { el: {}, curH: 20 };
    const { writes } = plan(
      [
        { el: { isCode: true }, line: 1, top: 0 },
        { el: {}, line: 101, top: 420 },
        { el: {}, line: 103, top: 460 },
      ],
      new Map([[1, gap]])
    );
    expect(writes).toEqual([[gap.el, 20]]);
  });

  it('a non-code block after a re-anchor still gets relative compensation, not absolute', () => {
    // Same as the capped case, but B renders 10px SHORT of its post-anchor grid
    // span: C must be pulled down 10px via gap2 (relative to the new anchor),
    // not pushed to the pre-anchor absolute target (which would be huge).
    const gap1 = { el: {}, curH: 20 };
    const gap2 = { el: {}, curH: 20 };
    const { writes } = plan(
      [
        { el: { isCode: true }, line: 1, top: 0 },
        { el: {}, line: 102, top: 440 },
        { el: {}, line: 104, top: 470 }, // 10px above re-anchored target 480
      ],
      new Map([[0, gap1], [1, gap2]])
    );
    expect(writes).toEqual([[gap2.el, 30]]);
  });
});

describe('isCodeBlockEl', () => {
  it('matches .code-block-wrapper and top-level pre, not prose', () => {
    const mk = (html: string) => {
      const t = document.createElement('template');
      t.innerHTML = html;
      return t.content.firstElementChild as Element;
    };
    expect(isCodeBlockEl(mk('<div class="code-block-wrapper"></div>'))).toBe(true);
    expect(isCodeBlockEl(mk('<pre><code></code></pre>'))).toBe(true);
    expect(isCodeBlockEl(mk('<p>text</p>'))).toBe(false);
    expect(isCodeBlockEl(mk('<ul><li></li></ul>'))).toBe(false);
  });
});
