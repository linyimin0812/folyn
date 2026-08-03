import { describe, it, expect } from 'vitest';
import { computeDiffHunks } from './InlineDiffExtension';

// ponytail: the bug — diffLines merges a no-trailing-newline last line with
// the next change. Regression case: appending a line used to mark the
// unchanged last line as removed and duplicate it in added.
describe('computeDiffHunks', () => {
  it('append line without trailing newline does not mark the unchanged last line as changed', () => {
    const { hunks, mergedContent } = computeDiffHunks('hello\nworld', 'hello\nworld\nextra');
    expect(mergedContent).toBe('hello\nworld\nextra');
    expect(hunks).toHaveLength(1);
    expect(hunks[0].type).toBe('add');
    expect(hunks[0].fromLine).toBe(3);
    expect(hunks[0].toLine).toBe(3);
  });

  it('modify single line mid-content emits one remove + one add hunk', () => {
    const { hunks, mergedContent } = computeDiffHunks('a\nb\nc\n', 'a\nX\nc\n');
    expect(mergedContent).toBe('a\nb\nX\nc');
    expect(hunks).toEqual([
      expect.objectContaining({ type: 'remove', fromLine: 2, toLine: 2 }),
      expect.objectContaining({ type: 'add', fromLine: 3, toLine: 3 }),
    ]);
  });

  it('identical content produces no hunks', () => {
    const { hunks } = computeDiffHunks('same\ncontent\n', 'same\ncontent\n');
    expect(hunks).toEqual([]);
  });

  it('empty old to single-line new produces one add hunk (no phantom removed empty line)', () => {
    const { hunks } = computeDiffHunks('', 'new content\n');
    expect(hunks).toHaveLength(1);
    expect(hunks[0].type).toBe('add');
  });
});
