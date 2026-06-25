import { describe, it, expect } from 'vitest';
import { extractFrontmatterSources } from './wikiLintService';

describe('extractFrontmatterSources', () => {
  it('returns an empty array when there is no frontmatter', () => {
    expect(extractFrontmatterSources('# just a heading\n\nbody')).toEqual([]);
  });

  it('returns an empty array when frontmatter has no sources field', () => {
    const md = `---\ntitle: Foo\ntype: entity\n---\n\nbody`;
    expect(extractFrontmatterSources(md)).toEqual([]);
  });

  it('collects a single YAML list source', () => {
    const md = `---\ntitle: Foo\nsources:\n  - notes/a.md\n  - notes/b.md\n---\n\nbody`;
    expect(extractFrontmatterSources(md)).toEqual(['notes/a.md', 'notes/b.md']);
  });

  it('ignores sources listed outside the frontmatter block', () => {
    const md = `---\ntitle: Foo\nsources:\n  - in-fm.md\n---\n\nsources:\n  - outside.md`;
    expect(extractFrontmatterSources(md)).toEqual(['in-fm.md']);
  });

  it('trims whitespace and drops empty entries', () => {
    const md = `---\nsources:\n  -   spaced.md   \n  -\n  - real.md\n---\n`;
    expect(extractFrontmatterSources(md)).toEqual(['spaced.md', 'real.md']);
  });
});
