import { describe, it, expect } from 'vitest';
import { extractHeadings } from './markdownUtils';

describe('extractHeadings', () => {
  it('collects ATX headings with level and 1-based line number', () => {
    const md = '# Title\n\nsome text\n## Section\n\nbody\n### Sub';
    expect(extractHeadings(md)).toEqual([
      { level: 1, text: 'Title', line: 1 },
      { level: 2, text: 'Section', line: 4 },
      { level: 3, text: 'Sub', line: 7 },
    ]);
  });

  it('supports levels 1 through 6', () => {
    const md = '# h1\n## h2\n### h3\n#### h4\n##### h5\n###### h6';
    const result = extractHeadings(md);
    expect(result.map((h) => h.level)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('ignores hash sequences that are not followed by whitespace', () => {
    expect(extractHeadings('##NotAHeading')).toEqual([]);
  });

  it('ignores headings inside fenced code blocks (backtick fences)', () => {
    const md = '# Real\n\n```text\n# not a heading\n## also not\n```\n\n## Real again';
    expect(extractHeadings(md).map((h) => h.text)).toEqual(['Real', 'Real again']);
  });

  it('ignores headings inside tilde-fenced code blocks', () => {
    const md = '# Real\n\n~~~text\n# not a heading\n~~~\n\n## After';
    expect(extractHeadings(md).map((h) => h.text)).toEqual(['Real', 'After']);
  });

  it('tolerates up to 3 leading spaces before a fence', () => {
    const md = '# Real\n   ```text\n# ignored\n   ```\n## After';
    expect(extractHeadings(md).map((h) => h.text)).toEqual(['Real', 'After']);
  });

  it('returns an empty array for plain text', () => {
    expect(extractHeadings('just some\nplain text\nnothing else')).toEqual([]);
  });

  it('returns an empty array for empty input', () => {
    expect(extractHeadings('')).toEqual([]);
  });
});
