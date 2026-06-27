import { describe, it, expect } from 'vitest';
import { fuzzyMatch } from './fuzzyMatch';

describe('fuzzyMatch', () => {
  it('returns empty result for empty query (no filter)', () => {
    const r = fuzzyMatch('', 'anything');
    expect(r).toEqual({ score: 0, matches: [] });
  });

  it('returns null when query is not a subsequence of target', () => {
    expect(fuzzyMatch('xyz', 'hello')).toBeNull();
    expect(fuzzyMatch('ba', 'ab')).toBeNull(); // order matters for subsequence
  });

  it('returns null when query is longer than target', () => {
    expect(fuzzyMatch('longquery', 'ab')).toBeNull();
  });

  it('matches as a case-insensitive subsequence', () => {
    const r = fuzzyMatch('abc', 'AaBbCc');
    expect(r).not.toBeNull();
    expect(r!.matches).toEqual([0, 2, 4]);
  });

  it('records indices into the original (non-lowercased) target', () => {
    const r = fuzzyMatch('md', 'README.md');
    expect(r).not.toBeNull();
    // 'm' at index 5 (README[5]... actually README = R0 e1 a2 d3 m4 e5)
    // 'm' first appears at index 4, 'd' at index 3 (before m) -> need d after m.
    // target "README.md": R0 e1 a2 d3 m4 e5 .6 m7 d8 -> m at 4, d at... next d after 4 is 8
    expect(r!.matches).toEqual([4, 8]);
  });

  it('scores contiguous matches higher than non-contiguous', () => {
    const contiguous = fuzzyMatch('abc', 'abc')!;
    const scattered = fuzzyMatch('abc', 'aXbXc')!;
    expect(contiguous.score).toBeGreaterThan(scattered.score);
  });

  it('scores word-boundary matches higher than mid-word matches', () => {
    const boundary = fuzzyMatch('cat', 'my cat')!; // 'cat' starts at a word boundary
    const midword = fuzzyMatch('cat', 'concatenate')!; // 'cat' inside a word
    expect(boundary.score).toBeGreaterThan(midword.score);
  });

  it('scores earlier matches higher than later matches (same structure)', () => {
    const early = fuzzyMatch('ab', 'ab____')!;
    const late = fuzzyMatch('ab', '____ab')!;
    expect(early.score).toBeGreaterThan(late.score);
  });

  it('treats /, _, -, space as word separators', () => {
    const afterSlash = fuzzyMatch('foo', 'x/foo')!;
    const midword = fuzzyMatch('foo', 'xfoo')!; // 'f' after 'x' (not a separator)
    expect(afterSlash.score).toBeGreaterThan(midword.score);
  });

  it('supports CJK / unicode targets', () => {
    const r = fuzzyMatch('笔记', '我的笔记本');
    expect(r).not.toBeNull();
    expect(r!.matches.length).toBe(2);
  });

  it('matches indices point back into the original target string', () => {
    const target = 'App.tsx';
    const r = fuzzyMatch('ats', target);
    expect(r).not.toBeNull();
    // Verify each index reconstructs the matched character from the original target.
    const reconstructed = r!.matches.map((i) => target[i]).join('').toLowerCase();
    expect(reconstructed).toBe('ats');
  });

  it('prefers the first valid subsequence (greedy leftmost)', () => {
    const r = fuzzyMatch('a', 'banana');
    expect(r).not.toBeNull();
    expect(r!.matches).toEqual([1]); // first 'a' in "banana" is at index 1
  });
});
