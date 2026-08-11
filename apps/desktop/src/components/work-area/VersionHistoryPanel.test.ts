import { describe, it, expect } from 'vitest';
import { parsePatchLines } from './VersionHistoryPanel';

// ponytail: parsePatchLines is the only non-trivial pure logic in the panel —
// a line classifier that drives the diff coloring. One small test file covers
// the four line kinds; the rest of the panel is React glue + store IO covered
// by manual smoke (per jsdom ceiling on real editors). No framework, no
// fixtures.
describe('parsePatchLines', () => {
  it('classifies hunk headers, additions, deletions, and context lines', () => {
    const patch = [
      '--- a.md',
      '+++ b.md',
      '@@ -1,3 +1,3 @@',
      ' unchanged',
      '-old line',
      '+new line',
      '\\ No newline at end of file',
    ].join('\n');
    const lines = parsePatchLines(patch);
    expect(lines).toHaveLength(7);
    expect(lines[0]).toEqual({ text: '--- a.md', kind: 'meta' });
    expect(lines[1]).toEqual({ text: '+++ b.md', kind: 'meta' });
    expect(lines[2]).toEqual({ text: '@@ -1,3 +1,3 @@', kind: 'hunk' });
    expect(lines[3]).toEqual({ text: 'unchanged', kind: 'context' });
    expect(lines[4]).toEqual({ text: 'old line', kind: 'del' });
    expect(lines[5]).toEqual({ text: 'new line', kind: 'add' });
    expect(lines[6]).toEqual({ text: '\\ No newline at end of file', kind: 'meta' });
  });

  it('treats a bare non-prefixed line as context (defensive — `diff` always prefixes)', () => {
    const lines = parsePatchLines('bare text without prefix');
    expect(lines[0]).toEqual({ text: 'bare text without prefix', kind: 'context' });
  });

  it('returns a single context line for empty input (`"".split("\\n") === [""]`)', () => {
    expect(parsePatchLines('')).toEqual([{ text: '', kind: 'context' }]);
  });
});
