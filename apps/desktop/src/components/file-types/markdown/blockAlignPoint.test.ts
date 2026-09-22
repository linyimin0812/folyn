import { describe, expect, it } from 'vitest';
import {
  blockAlignPoint,
  blockLastSrcLine,
  blockRelativeOffsetY,
  containerAlignPoint,
  directiveCloseLine,
  gapAlignPoint,
  tableRowAnchor,
} from './blockAlignPoint';

// srcLines are 0-indexed; blockSrcLine is 1-indexed (data-source-line).
// Signature: (tagName, srcLines, blockSrcLine, blockOffset, blockHeight,
// lineFrac, cursorBlockOffsetY, cursorBlockHeight).
// cursorBlockOffsetY = the cursor's MEASURED Y below its block's first
// line in the editor (EditorView publishes it — includes earlier lines'
// soft-wrap rows). cursorBlockHeight = the same block's MEASURED height
// (first line top → last line bottom) — the multi-line fraction's
// denominator. Both default to 0 (→ top-align).
function src(lines: string[]): string[] {
  return lines;
}

describe('blockAlignPoint', () => {
  describe('headings (h1-h6)', () => {
    it('centers an h1 on the cursor line', () => {
      // line 1 = "# Heading" (single source line). blockOffset=200, tall block.
      const lines = src(['# Heading', '', 'body text']);
      const ap = blockAlignPoint('H1', lines, 1, 200, 60);
      expect(ap).toBe(200 + 60 / 2); // block center
    });

    it('centers every heading level on the cursor line', () => {
      const lines = src(['## Sub', '', 'x']);
      for (const tag of ['H1', 'H2', 'H3', 'H4', 'H5', 'H6']) {
        const ap = blockAlignPoint(tag, lines, 1, 100, 40);
        expect(ap).toBe(100 + 40 / 2);
      }
    });
  });

  describe('multi-line blocks (pixel-fraction mapping)', () => {
    const lines = src(['line one', 'line two', 'line three', '']);

    it('top-aligns when the cursor is on the first line (offset 0)', () => {
      // Editor block 90px tall; cursor on line 1 → offset 0 → frac 0.
      expect(blockAlignPoint('P', lines, 1, 0, 90, 0, 0, 90)).toBe(0);
    });

    it('maps the cursor\u2019s relative depth proportionally (1/3 down → 1/3 of the block)', () => {
      // Editor: 3-line block, 90px; cursor 30px below the top (line 2).
      // Preview renders 90px → the point at 30px.
      expect(blockAlignPoint('P', lines, 1, 0, 90, 0, 30, 90)).toBe(30);
    });

    it('is scale-free: editor 200px, preview 60px — 50% depth lands at 30px', () => {
      // The old absolute-px step applied 100 EDITOR px to the PREVIEW,
      // overshooting a 60px block (the two panes re-wrap differently —
      // editor px has no valid scale in preview px). The fraction lands
      // the halfway point at the halfway point.
      expect(blockAlignPoint('P', lines, 1, 0, 60, 0, 100, 200)).toBe(30);
    });

    it('keeps the point inside the block when the editor wraps more than the preview', () => {
      // 3 source lines: 5 editor rows (150px — soft-wrap), 2 preview rows
      // (48px). Cursor on the 3rd row (60px down) → frac 0.4 → 19.2px: the
      // preview text at the cursor's height corresponds to the cursor's
      // relative place in the paragraph (the reported 没完全对齐).
      expect(blockAlignPoint('P', lines, 1, 100, 48, 0, 60, 150)).toBeCloseTo(100 + 19.2, 5);
    });

    it('clamps the fraction to [0, 1]', () => {
      // Offset past the block end (stale measurement) → bottom; negative → top.
      expect(blockAlignPoint('P', lines, 1, 100, 40, 0, 500, 200)).toBe(140);
      expect(blockAlignPoint('P', lines, 1, 100, 40, 0, -12, 200)).toBe(100);
    });

    it('top-aligns when the editor block height is unknown (0)', () => {
      // Unknown denominator → the fallback is the first-line fraction (0).
      expect(blockAlignPoint('P', lines, 1, 0, 90, 0, 30, 0)).toBe(0);
      expect(blockAlignPoint('P', lines, 1, 0, 90)).toBe(0);
    });
  });

  describe('single-line non-heading blocks', () => {
    it('top-aligns a single-line paragraph when not soft-wrapped (lineFrac≈0)', () => {
      // Unwrapped line: the cursor stays on the only visual line, so
      // lineFrac is ~0 → top-align to the cursor line.
      const lines = src(['a short para', '']);
      const ap = blockAlignPoint('P', lines, 1, 0, 20);
      expect(ap).toBe(0);
    });

    it('does not drift as the cursor moves horizontally on an unwrapped line', () => {
      // Horizontal movement on a single (unwrapped) visual line never
      // changes the cursor's screen Y, so lineFrac stays ~0 and the align
      // point is fixed — no vertical preview sweep on the same line.
      const lines = src(['a short para', '']);
      const points = [0, 3, 6, 9, 12].map(() =>
        blockAlignPoint('P', lines, 1, 0, 20), // lineFrac defaults to 0
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
      const top = blockAlignPoint('P', lines, 1, 100, 60, 0); // 1st visual line
      const mid = blockAlignPoint('P', lines, 1, 100, 60, 0.5); // middle wrap
      const bot = blockAlignPoint('P', lines, 1, 100, 60, 1); // last visual line
      expect(top).toBe(100); // block top
      expect(mid).toBeCloseTo(100 + 30, 5); // halfway down
      expect(bot).toBeCloseTo(100 + 60, 5); // block bottom
    });
  });

  it('treats a block with no trailing blank line as spanning to EOF', () => {
    // No blank line terminates the paragraph → span runs to the last line
    // (multi-line path). Editor block 60px, cursor halfway (30px) → the
    // preview point at 30px of 60.
    const lines = src(['line one', 'line two']);
    const ap = blockAlignPoint('P', lines, 1, 0, 60, 0, 30, 60);
    expect(ap).toBeCloseTo(30, 5);
  });

  describe('list items (li)', () => {
    it('top-aligns each item to the cursor line (no whole-list span)', () => {
      // Tight list: no blank lines between items. The blockLineSpan loop
      // would count all 3 items (span=3) if li used the multi-line path,
      // re-merging the list. li must top-align regardless.
      const lines = src(['- a', '- b', '- c', '']);
      const a = blockAlignPoint('LI', lines, 1, 100, 24);
      const b = blockAlignPoint('LI', lines, 2, 200, 24);
      const c = blockAlignPoint('LI', lines, 3, 300, 24);
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

describe('tableRowAnchor', () => {
  it('maps the header line to the thead row', () => {
    expect(tableRowAnchor(0)).toEqual({ kind: 'thead-row' });
  });

  it('maps the |---| separator line to the thead bottom (the border it renders as)', () => {
    expect(tableRowAnchor(1)).toEqual({ kind: 'thead-bottom' });
  });

  it('maps body lines to their tbody row index', () => {
    // line 3 (first body row) → index 0; each further line steps one row.
    expect(tableRowAnchor(2)).toEqual({ kind: 'tbody-row', index: 0 });
    expect(tableRowAnchor(3)).toEqual({ kind: 'tbody-row', index: 1 });
    expect(tableRowAnchor(7)).toEqual({ kind: 'tbody-row', index: 5 });
  });

  it('clamps non-positive deltas to the header row', () => {
    expect(tableRowAnchor(-1)).toEqual({ kind: 'thead-row' });
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

describe('directiveCloseLine', () => {
  // The ::::tabs template (TabsExtension / Carousel manifests). 1-indexed
  // source lines: line 1 opens the container, inner :::tab open at 2/6,
  // closing fences at 5/8, the container closes at line 9.
  const tabs = [
    '::::tabs',
    ':::tab{label="macOS"}',
    'macOS 安装说明',
    'more content',
    ':::',
    ':::tab{label="Windows"}',
    'Windows 安装说明',
    ':::',
    '::::',
    'after the container',
  ];

  it('closes an outer :::: container at its matching fence (inner ::: do not close it)', () => {
    expect(directiveCloseLine(tabs, 1)).toBe(9);
  });

  it('closes an inner ::: directive at its own fence', () => {
    expect(directiveCloseLine(tabs, 2)).toBe(5);
    expect(directiveCloseLine(tabs, 6)).toBe(8);
  });

  it('falls back to the document end when the fence is unmatched', () => {
    expect(directiveCloseLine(['::::tabs', ':::tab', 'content'], 1)).toBe(3);
  });
});

describe('blockLastSrcLine (directive-aware)', () => {
  it('stops at a directive fence line even without a blank line', () => {
    // A paragraph's span used to run through the ::: scaffolding below it;
    // remark-directive ends the block at the fence.
    expect(blockLastSrcLine(['para', ':::callout', 'content', ':::'], 1)).toBe(1);
  });

  it('keeps the block own opening line when the block IS the directive', () => {
    // A directive-wrapper target's own opening line must not terminate it.
    expect(blockLastSrcLine([':::tab{label="A"}', 'content', ':::'], 1)).toBe(2);
  });

  it('is unchanged for plain blank-terminated paragraphs', () => {
    expect(blockLastSrcLine(['a', 'b', '', 'c'], 1)).toBe(2);
  });
});

describe('blockRelativeOffsetY', () => {
  it('is a no-op when the editor anchor equals the block line', () => {
    expect(blockRelativeOffsetY(48, 3, 3, 24)).toBe(48);
  });

  it('subtracts the scaffolding lines between the anchor and an inner block', () => {
    // The editor anchors the whole no-blank directive run at line 1 (offset
    // 96 = 4 lines); the inner paragraph starts at line 3 → its frame
    // offset is 2 lines = 48.
    expect(blockRelativeOffsetY(96, 1, 3, 24)).toBe(48);
  });

  it('adds the lines above the anchor when the block starts above it', () => {
    // Blank line inside a container: the editor anchors the block ABOVE
    // (line 3, offset 72); the container pin (line 1) needs 5 lines = 120.
    expect(blockRelativeOffsetY(72, 3, 1, 24)).toBe(120);
  });
});

describe('containerAlignPoint (tabs / carousel pin)', () => {
  it('top-aligns when the cursor is on the container first line (rel 0)', () => {
    expect(containerAlignPoint(100, 0, 400)).toBe(100);
  });

  it('pins the container top to the editor first-line position for deeper cursor lines', () => {
    // The reported bug: only the first line aligned; every other line
    // top-aligned the container to the CURSOR (alignPoint = blockOffset),
    // dragging the preview down. The pin holds the container top at the
    // editor's ::::tabs line: cursor 6 lines in → +5 lines of offset.
    expect(containerAlignPoint(100, 5 * 24, 400)).toBe(100 + 5 * 24);
  });

  it('clamps the step at the cursor viewport depth (scrolled-off container glues to the viewport top)', () => {
    expect(containerAlignPoint(100, 5 * 24, 60)).toBe(100 + 60);
  });

  it('clamps a negative rel to a top-align (measured Y below the container line)', () => {
    expect(containerAlignPoint(100, -48, 400)).toBe(100);
  });
});
