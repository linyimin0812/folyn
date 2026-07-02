import { describe, it, expect } from 'vitest';
import {
  parseClipContent,
  parseInfographic,
  serializeInfographicSection,
  writeInfographicSection,
  normalizeInfographicDoc,
  type InfographicDoc,
} from './clipParse';

const sampleDoc: InfographicDoc = {
  version: 1,
  blocks: [
    { type: 'hero', title: 'AI 速览' },
    { type: 'stat', items: [{ value: '10x', label: '吞吐量提升', unit: 'x' }] },
    { type: 'keypoints', items: ['要点一', '要点二'] },
    {
      type: 'timeline',
      items: [
        { time: '2024 Q1', title: '立项', detail: '开始' },
        { time: '2024 Q3', title: '发布' },
      ],
    },
    {
      type: 'steps',
      steps: [{ title: '收集', detail: '抓取网页' }, { title: '生成' }],
    },
    {
      type: 'comparison',
      columns: [
        { title: '旧', items: ['慢'] },
        { title: '新', items: ['快'] },
      ],
    },
    { type: 'quote', text: '少即是多', source: '设计原则' },
    { type: 'tags', tags: ['ai', 'clip'] },
    { type: 'source', url: 'https://example.com/a', hostname: 'example.com', clipped: '2026-07-02' },
  ],
};

describe('parseInfographic', () => {
  it('parses a present ## 信息图 fenced-json section', () => {
    const md = [
      '---',
      'title: "T"',
      'url: "https://example.com/a"',
      '---',
      '',
      '## 摘要',
      '',
      's',
      '',
      '## 要点',
      '',
      '- p1',
      '',
      '## 信息图',
      '',
      '```json',
      JSON.stringify(sampleDoc, null, 2),
      '```',
      '',
    ].join('\n');
    const doc = parseInfographic(md);
    expect(doc).not.toBeNull();
    expect(doc!.version).toBe(1);
    expect(doc!.blocks).toHaveLength(9);
    expect(doc!.blocks[0]).toEqual({ type: 'hero', title: 'AI 速览' });
    expect(doc!.blocks[8]).toEqual({
      type: 'source',
      url: 'https://example.com/a',
      hostname: 'example.com',
      clipped: '2026-07-02',
    });
  });

  it('returns null when the section is missing', () => {
    const md = '## 摘要\n\ns\n\n## 要点\n\n- p1\n';
    expect(parseInfographic(md)).toBeNull();
  });

  it('returns null when the section exists but the fence is missing', () => {
    const md = '## 信息图\n\nnot json here\n';
    expect(parseInfographic(md)).toBeNull();
  });

  it('returns null when the fenced JSON is invalid', () => {
    const md = '## 信息图\n\n```json\n{ not valid json\n```\n';
    expect(parseInfographic(md)).toBeNull();
  });

  it('returns null for an empty fence', () => {
    const md = '## 信息图\n\n```json\n```\n';
    expect(parseInfographic(md)).toBeNull();
  });

  it('parses only up to the next ## section (does not swallow later sections)', () => {
    const md = [
      '## 信息图',
      '',
      '```json',
      JSON.stringify(sampleDoc),
      '```',
      '',
      '## 附录',
      '',
      'later content',
    ].join('\n');
    const doc = parseInfographic(md);
    expect(doc).not.toBeNull();
    expect(doc!.blocks).toHaveLength(9);
  });

  it('accepts an unsuffixed ``` fence', () => {
    const md = `## 信息图\n\n\`\`\`\n${JSON.stringify(sampleDoc)}\n\`\`\`\n`;
    const doc = parseInfographic(md);
    expect(doc).not.toBeNull();
    expect(doc!.blocks).toHaveLength(9);
  });

  it('does not throw on non-object input', () => {
    const md = '## 信息图\n\n```json\n[1,2,3]\n```\n';
    expect(parseInfographic(md)).toBeNull();
  });
});

describe('normalizeInfographicDoc', () => {
  it('returns null for non-object', () => {
    expect(normalizeInfographicDoc(null)).toBeNull();
    expect(normalizeInfographicDoc('string')).toBeNull();
    expect(normalizeInfographicDoc(42)).toBeNull();
  });

  it('returns null when blocks is not an array', () => {
    expect(normalizeInfographicDoc({ version: 1, blocks: 'nope' })).toBeNull();
  });

  it('defaults version to 1 when missing', () => {
    const doc = normalizeInfographicDoc({ blocks: [{ type: 'hero', title: 'x' }] });
    expect(doc?.version).toBe(1);
  });

  it('drops blocks without a type field', () => {
    const doc = normalizeInfographicDoc({
      blocks: [{ type: 'hero', title: 'x' }, { title: 'no type' }, null, 5],
    });
    expect(doc?.blocks).toHaveLength(1);
  });
});

describe('writeInfographicSection + parseInfographic round-trip', () => {
  it('appends a new section when absent and re-parses stably', () => {
    const original = [
      '---',
      'title: "T"',
      'url: "https://example.com/a"',
      '---',
      '',
      '## 摘要',
      '',
      'summary text',
      '',
      '## 要点',
      '',
      '- p1',
      '- p2',
      '',
    ].join('\n');

    const written = writeInfographicSection(original, sampleDoc);
    // Original content preserved.
    expect(written).toContain('title: "T"');
    expect(written).toContain('## 摘要');
    expect(written).toContain('summary text');
    expect(written).toContain('## 要点');
    expect(written).toContain('- p1');

    // New section present and parseable.
    expect(written).toContain('## 信息图');
    const reparsed = parseInfographic(written);
    expect(reparsed).not.toBeNull();
    expect(reparsed!.blocks).toHaveLength(9);
  });

  it('writes ## 信息图 at the TOP position (before ## 摘要) on new insertion', () => {
    const original = [
      '---',
      'title: "T"',
      'url: "https://example.com/a"',
      '---',
      '',
      '> **来源**: [example.com](https://example.com/a)',
      '',
      '## 摘要',
      '',
      'summary text',
      '',
      '## 要点',
      '',
      '- p1',
      '',
    ].join('\n');

    const written = writeInfographicSection(original, sampleDoc);
    const idxInfo = written.indexOf('## 信息图');
    const idxSummary = written.indexOf('## 摘要');
    const idxPoints = written.indexOf('## 要点');
    const idxQuote = written.indexOf('> **来源**');
    expect(idxQuote).toBeGreaterThan(-1);
    expect(idxInfo).toBeGreaterThan(idxQuote);
    expect(idxInfo).toBeLessThan(idxSummary);
    expect(idxSummary).toBeLessThan(idxPoints);
  });

  it('moves an existing bottom ## 信息图 to the TOP position on regenerate', () => {
    // Legacy clip with ## 信息图 at the bottom (after ## 正文).
    const original = [
      '---',
      'title: "T"',
      '---',
      '',
      '> **来源**: [x.com](https://x.com)',
      '',
      '## 摘要',
      '',
      's',
      '',
      '## 要点',
      '',
      '- p1',
      '',
      '## 正文',
      '',
      'body text',
      '',
      '## 信息图',
      '',
      '```json',
      JSON.stringify({ version: 1, blocks: [{ type: 'hero', title: 'OLD' }] }),
      '```',
      '',
    ].join('\n');

    const newDoc: InfographicDoc = {
      version: 1,
      blocks: [{ type: 'hero', title: 'NEW' }, { type: 'source', url: 'https://x.com' }],
    };
    const written = writeInfographicSection(original, newDoc);

    // Old infographic payload gone, new present.
    expect(written).not.toContain('OLD');
    expect(written).toContain('NEW');
    // Exactly one ## 信息图 heading.
    expect((written.match(/## 信息图/g) || []).length).toBe(1);

    // Top-position: 信息图 is before 摘要, which is before 要点, which is before 正文.
    const idxInfo = written.indexOf('## 信息图');
    const idxSummary = written.indexOf('## 摘要');
    const idxPoints = written.indexOf('## 要点');
    const idxBody = written.indexOf('## 正文');
    expect(idxInfo).toBeGreaterThan(-1);
    expect(idxInfo).toBeLessThan(idxSummary);
    expect(idxSummary).toBeLessThan(idxPoints);
    expect(idxPoints).toBeLessThan(idxBody);

    // Surrounding content preserved.
    expect(written).toContain('body text');
    expect(written).toContain('> **来源**');
  });

  it('replaces an existing section in-place, preserving other sections', () => {
    const original = [
      '---',
      'title: "T"',
      'url: "https://example.com/a"',
      '---',
      '',
      '## 摘要',
      '',
      's',
      '',
      '## 信息图',
      '',
      '```json',
      JSON.stringify({ version: 1, blocks: [{ type: 'hero', title: 'OLD' }] }),
      '```',
      '',
      '## 要点',
      '',
      '- p1',
      '',
    ].join('\n');

    const newDoc: InfographicDoc = {
      version: 1,
      blocks: [{ type: 'hero', title: 'NEW' }, { type: 'source', url: 'https://example.com/a' }],
    };
    const written = writeInfographicSection(original, newDoc);

    // Old infographic payload gone, new present.
    expect(written).not.toContain('OLD');
    expect(written).toContain('NEW');
    // Surrounding sections preserved.
    expect(written).toContain('## 摘要');
    expect(written).toContain('## 要点');
    expect(written).toContain('- p1');
    // Only one ## 信息图 heading.
    expect((written.match(/## 信息图/g) || []).length).toBe(1);

    const reparsed = parseInfographic(written);
    expect(reparsed).not.toBeNull();
    expect(reparsed!.blocks).toHaveLength(2);
    expect(reparsed!.blocks[0]).toEqual({ type: 'hero', title: 'NEW' });
  });

  it('round-trips the full 9-type doc without loss', () => {
    const written = writeInfographicSection('', sampleDoc);
    const reparsed = parseInfographic(written);
    expect(reparsed).toEqual(sampleDoc);
  });
});

describe('serializeInfographicSection', () => {
  it('produces a fenced-json ## 信息图 section', () => {
    const section = serializeInfographicSection(sampleDoc);
    expect(section.startsWith('## 信息图\n\n```json\n')).toBe(true);
    expect(section.endsWith('```')).toBe(true);
  });
});

describe('parseClipContent (infographic integration)', () => {
  it('exposes infographic via parseClipContent when present', () => {
    const md = [
      '---',
      'title: "T"',
      'type: clip',
      'url: "https://example.com/a"',
      'tags: ["ai"]',
      'clipped: 2026-07-02',
      '---',
      '',
      '## 摘要',
      '',
      's',
      '',
      '## 要点',
      '',
      '- p1',
      '',
      '## 信息图',
      '',
      '```json',
      JSON.stringify(sampleDoc),
      '```',
      '',
    ].join('\n');
    const data = parseClipContent(md);
    expect(data.title).toBe('T');
    expect(data.summary).toBe('s');
    expect(data.keyPoints).toEqual(['p1']);
    expect(data.infographic).not.toBeNull();
    expect(data.infographic!.blocks).toHaveLength(9);
  });

  it('sets infographic to null when section absent', () => {
    const md = '---\ntitle: "T"\nurl: "https://x.com"\n---\n\n## 摘要\n\ns\n';
    const data = parseClipContent(md);
    expect(data.infographic).toBeNull();
  });

  it('sets infographic to null when section is invalid, without throwing', () => {
    const md = '---\ntitle: "T"\n---\n\n## 信息图\n\n```json\n{bad\n```\n';
    const data = parseClipContent(md);
    expect(data.infographic).toBeNull();
    expect(data.title).toBe('T');
  });
});

describe('parseClipContent — ## 正文 section', () => {
  it('parses the ## 正文 section when present', () => {
    const md = [
      '---',
      'title: "T"',
      'url: "https://x.com"',
      '---',
      '',
      '> **来源**: [x.com](https://x.com)',
      '',
      '## 摘要',
      '',
      's',
      '',
      '## 要点',
      '',
      '- p1',
      '',
      '## 正文',
      '',
      '# Page Title',
      '',
      'Some body text with **bold**.',
      '',
      '- list item',
    ].join('\n');
    const data = parseClipContent(md);
    expect(data.pageContent).toContain('# Page Title');
    expect(data.pageContent).toContain('Some body text');
    expect(data.pageContent).toContain('- list item');
  });

  it('sets pageContent to empty string when ## 正文 absent', () => {
    const md = '---\ntitle: "T"\n---\n\n## 摘要\n\ns\n\n## 要点\n\n- p1\n';
    const data = parseClipContent(md);
    expect(data.pageContent).toBe('');
  });

  it('is order-agnostic: parses ## 正文 even when ## 信息图 sits between 摘要 and 要点', () => {
    // New poster-first ordering: 信息图 before 摘要.
    const md = [
      '---',
      'title: "T"',
      '---',
      '',
      '## 信息图',
      '',
      '```json',
      JSON.stringify(sampleDoc),
      '```',
      '',
      '## 摘要',
      '',
      's',
      '',
      '## 要点',
      '',
      '- p1',
      '',
      '## 正文',
      '',
      'body text',
    ].join('\n');
    const data = parseClipContent(md);
    expect(data.summary).toBe('s');
    expect(data.keyPoints).toEqual(['p1']);
    expect(data.pageContent).toBe('body text');
    expect(data.infographic).not.toBeNull();
    expect(data.infographic!.blocks).toHaveLength(9);
  });

  it('is order-agnostic: parses sections when ## 信息图 sits at the bottom (legacy order)', () => {
    // Old clip layout with 信息图 at the end (after 正文).
    const md = [
      '---',
      'title: "T"',
      '---',
      '',
      '## 摘要',
      '',
      's',
      '',
      '## 要点',
      '',
      '- p1',
      '',
      '## 正文',
      '',
      'body text',
      '',
      '## 信息图',
      '',
      '```json',
      JSON.stringify(sampleDoc),
      '```',
      '',
    ].join('\n');
    const data = parseClipContent(md);
    expect(data.summary).toBe('s');
    expect(data.keyPoints).toEqual(['p1']);
    expect(data.pageContent).toBe('body text');
    expect(data.infographic).not.toBeNull();
    expect(data.infographic!.blocks).toHaveLength(9);
  });
});
