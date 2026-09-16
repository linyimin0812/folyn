import { describe, expect, it } from 'vitest';
import { codeBlockAlignPoint, codeBlockCloseLine } from './codeBlockAlign';

// blockOffset=0, padTop=12, lineHeight=19.2 ⇒ a block with N content rows is
// N*19.2 + 24 tall. blockHeight passed in reflects the rendered <pre>.
const PAD = 12;
const LH = 19.2;
const blockHeight = (rows: number) => rows * LH + 2 * PAD;

// srcLines are 0-indexed; blockSrcLine is 1-indexed (opening fence).
function src(lines: string[]): string[] {
  return lines;
}

describe('codeBlockAlignPoint', () => {
  it('maps the first content row to just past the top padding', () => {
    // line 1 (idx0) = ```js, lines 2-3 = content, line 4 = ```
    const lines = src(['```js', 'const a = 1;', 'const b = 2;', '```']);
    const ap = codeBlockAlignPoint(lines, 1, 2, 0, blockHeight(2), PAD);
    expect(ap).toBeCloseTo(PAD, 5);
  });

  it('maps the last content row to the top of that row (not the block bottom)', () => {
    const lines = src(['```js', 'const a = 1;', 'const b = 2;', '```']);
    const ap = codeBlockAlignPoint(lines, 1, 3, 0, blockHeight(2), PAD);
    // row 1 (0-indexed) top = padTop + 1*lineHeight
    expect(ap).toBeCloseTo(PAD + LH, 5);
  });

  it('does NOT clamp to the bottom when the code block has inner blank lines', () => {
    // The old span counter stopped at the first blank (line 3) and clamped
    // intraFrac to 1 for any cursor past it. Verify the cursor on line 4 (the
    // row after the blank) maps to its real row, not the block bottom.
    const lines = src(['```js', 'const a = 1;', '', 'const b = 2;', '```']);
    // content rows: 'const a = 1;', '', 'const b = 2;' = 3 rows
    const ap = codeBlockAlignPoint(lines, 1, 4, 0, blockHeight(3), PAD);
    // cursor on line 4 = content row 2 (0-indexed) top = padTop + 2*lineHeight
    expect(ap).toBeCloseTo(PAD + 2 * LH, 5);
    // and it must NOT equal the block bottom (the old bug)
    expect(ap).not.toBeCloseTo(blockHeight(3), 5);
  });

  it('handles many inner blank lines without clamping (the reported bug)', () => {
    // 50 content rows with blanks scattered; cursor on the last content row.
    const content: string[] = [];
    for (let i = 0; i < 50; i++) {
      content.push(i % 5 === 0 ? '' : `line ${i}`);
    }
    const lines = src(['```js', ...content, '```']);
    // opening fence = line 1, content = lines 2..51, closing = line 52
    const ap = codeBlockAlignPoint(lines, 1, 51, 0, blockHeight(50), PAD);
    // last content row (row 49) top = padTop + 49*lineHeight
    expect(ap).toBeCloseTo(PAD + 49 * LH, 5);
  });

  it('aligns opening-fence cursor to the block top', () => {
    const lines = src(['```js', 'x', '```']);
    expect(codeBlockAlignPoint(lines, 1, 1, 100, blockHeight(1), PAD)).toBe(100);
  });

  it('aligns closing-fence cursor to the block bottom', () => {
    const lines = src(['```js', 'x', '```']);
    const h = blockHeight(1);
    expect(codeBlockAlignPoint(lines, 1, 3, 100, h, PAD)).toBe(100 + h);
  });

  it('handles an empty fence (no content rows) without divide-by-zero', () => {
    const lines = src(['```js', '```']);
    // cursor on the closing fence (line 2) → bottom; cursor "inside" is impossible
    expect(codeBlockAlignPoint(lines, 1, 2, 0, 2 * PAD, PAD)).toBe(2 * PAD);
  });

  it('treats an unclosed fence as running to EOF', () => {
    const lines = src(['```js', 'a', 'b', 'c']);
    // no closing fence → content rows = 3, cursor on line 4 = row 2
    const ap = codeBlockAlignPoint(lines, 1, 4, 0, blockHeight(3), PAD);
    expect(ap).toBeCloseTo(PAD + 2 * LH, 5);
  });

  it('supports tilde fences', () => {
    const lines = src(['~~~py', 'a', 'b', '~~~']);
    expect(codeBlockAlignPoint(lines, 1, 2, 0, blockHeight(2), PAD)).toBeCloseTo(PAD, 5);
    expect(codeBlockAlignPoint(lines, 1, 3, 0, blockHeight(2), PAD)).toBeCloseTo(PAD + LH, 5);
  });

  it('does not mistake an opening fence with a language for the closing fence', () => {
    // ```js must not match FENCE_RE (it has trailing "js"), so the scan must
    // skip it and find the real closing ``` on the last line.
    const lines = src(['```js', 'const x = 1;', '```']);
    const ap = codeBlockAlignPoint(lines, 1, 2, 0, blockHeight(1), PAD);
    expect(ap).toBeCloseTo(PAD, 5); // first content row
  });
});

describe('codeBlockCloseLine', () => {
  it('returns the 1-indexed line of the closing fence', () => {
    // fence=1 (idx0), content=2-3, closing ```=4 (idx3).
    expect(codeBlockCloseLine(['```js', 'a', 'b', '```'], 1)).toBe(4);
  });

  it('skips the opening fence (it has a trailing language)', () => {
    // ```js must not be mistaken for the closing fence.
    expect(codeBlockCloseLine(['```js', '```'], 1)).toBe(2);
  });

  it('defaults to one past EOF when the fence is unclosed', () => {
    expect(codeBlockCloseLine(['```js', 'a', 'b'], 1)).toBe(4);
  });

  it('supports tilde fences', () => {
    expect(codeBlockCloseLine(['~~~py', 'a', '~~~'], 1)).toBe(3);
  });
});
