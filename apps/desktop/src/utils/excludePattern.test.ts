import { describe, it, expect } from 'vitest';
import {
  patternToRegExp,
  matchesAnyPattern,
  findMatchedPattern,
  mergeGitignoreEntries,
} from './excludePattern';

describe('excludePattern: patternToRegExp', () => {
  it('matches literal names exactly', () => {
    expect(patternToRegExp('__wiki__').test('__wiki__')).toBe(true);
    expect(patternToRegExp('__wiki__').test('__wiki__x')).toBe(false);
  });

  it('translates * to .* and ? to .', () => {
    expect(patternToRegExp('*.log').test('app.log')).toBe(true);
    expect(patternToRegExp('*.log').test('app.txt')).toBe(false);
    expect(patternToRegExp('f?o').test('foo')).toBe(true);
    expect(patternToRegExp('f?o').test('fooo')).toBe(false);
  });

  it('escapes regex metacharacters in the pattern', () => {
    expect(patternToRegExp('a.b').test('axb')).toBe(false);
    expect(patternToRegExp('a.b').test('a.b')).toBe(true);
  });
});

describe('excludePattern: matchesAnyPattern', () => {
  it('matches literal patterns by equality', () => {
    expect(matchesAnyPattern('__wiki__', ['__clips__', '__wiki__'])).toBe(true);
    expect(matchesAnyPattern('foo', ['__wiki__'])).toBe(false);
  });

  it('matches wildcard patterns via regex', () => {
    expect(matchesAnyPattern('app.log', ['*.log', '__wiki__'])).toBe(true);
    expect(matchesAnyPattern('app.txt', ['*.log'])).toBe(false);
  });
});

describe('excludePattern: findMatchedPattern', () => {
  it('returns the matched pattern for a top-level path', () => {
    expect(findMatchedPattern('__wiki__', ['__wiki__'])).toBe('__wiki__');
  });

  it('matches a path segment under a subdirectory', () => {
    expect(findMatchedPattern('__wiki__/sub/foo.md', ['__wiki__'])).toBe('__wiki__');
    expect(findMatchedPattern('a/__clips__/b/c.md', ['__clips__'])).toBe('__clips__');
  });

  it('matches wildcard patterns against each segment', () => {
    expect(findMatchedPattern('app.log', ['*.log'])).toBe('*.log');
    expect(findMatchedPattern('src/debug.log', ['*.log'])).toBe('*.log');
  });

  it('returns null when no segment matches', () => {
    expect(findMatchedPattern('README.md', ['__wiki__', '*.log'])).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(findMatchedPattern('', ['__wiki__'])).toBeNull();
    expect(findMatchedPattern('__wiki__', [])).toBeNull();
  });
});

describe('excludePattern: mergeGitignoreEntries', () => {
  it('appends all entries when .gitignore is empty', () => {
    const r = mergeGitignoreEntries('', ['__wiki__', '__clips__']);
    expect(r.changed).toBe(true);
    expect(r.content).toBe('__wiki__\n__clips__\n');
  });

  it('preserves existing entries and only appends missing ones', () => {
    const r = mergeGitignoreEntries('__wiki__\n# comment\n', ['__wiki__', '__clips__']);
    expect(r.changed).toBe(true);
    expect(r.content).toBe('__wiki__\n# comment\n__clips__\n');
  });

  it('returns changed=false when all entries are already present', () => {
    const existing = '__wiki__\n__clips__\n';
    const r = mergeGitignoreEntries(existing, ['__wiki__']);
    expect(r.changed).toBe(false);
    expect(r.content).toBe(existing);
  });

  it('treats a commented-out entry as missing and appends the real one', () => {
    const r = mergeGitignoreEntries('# __wiki__\n', ['__wiki__']);
    expect(r.changed).toBe(true);
    expect(r.content).toBe('# __wiki__\n__wiki__\n');
  });

  it('handles wildcard patterns as plain lines', () => {
    const r = mergeGitignoreEntries('node_modules\n', ['*.log', '__wiki__']);
    expect(r.changed).toBe(true);
    expect(r.content).toBe('node_modules\n*.log\n__wiki__\n');
  });

  it('adds trailing newline to an existing file missing one', () => {
    const r = mergeGitignoreEntries('node_modules', ['__wiki__']);
    expect(r.content).toBe('node_modules\n__wiki__\n');
  });

  it('ignores blank and comment-only entries in input', () => {
    const r = mergeGitignoreEntries('__wiki__\n', ['', '  ', '# note', '__clips__']);
    expect(r.changed).toBe(true);
    expect(r.content).toBe('__wiki__\n__clips__\n');
  });
});
