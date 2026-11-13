import { describe, it, expect } from 'vitest';
import { addPattern, parsePatterns, removePattern } from './excludePatterns';

describe('parsePatterns', () => {
  it('trims, and drops blank lines and # comments', () => {
    expect(parsePatterns('# managed\n node_modules \n\n*.tmp\n')).toEqual(['node_modules', '*.tmp']);
  });

  it('is empty for an unset or empty value', () => {
    expect(parsePatterns(undefined)).toEqual([]);
    expect(parsePatterns('')).toEqual([]);
  });
});

describe('addPattern', () => {
  it('appends on a new line', () => {
    expect(addPattern('node_modules\n', '*.tmp')).toBe('node_modules\n*.tmp');
  });

  it('starts the list when it is unset or blank', () => {
    expect(addPattern(undefined, '*.tmp')).toBe('*.tmp');
    expect(addPattern('  \n', '*.tmp')).toBe('*.tmp');
  });
});

describe('removePattern', () => {
  it('drops the matching line and keeps the rest, comments included', () => {
    expect(removePattern('# managed\nnode_modules\n*.tmp', 'node_modules')).toBe('# managed\n*.tmp');
  });

  it('leaves the list alone when nothing matches', () => {
    expect(removePattern('a\nb', 'c')).toBe('a\nb');
  });
});
