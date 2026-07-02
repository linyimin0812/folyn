import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { InfographicView, BlockView } from './InfographicView';
import type { InfographicBlock, InfographicDoc } from '@/features/clips/clipParse';

/**
 * Component tests for the editorial-style infographic renderer.
 *
 * The repo has no @testing-library/react dependency, so we render via
 * `react-dom/server`'s sync `renderToString` (react-dom is already a core
 * dependency) and assert the resulting HTML string contains the expected
 * editorial structure: masthead, 3-column body, footer, eyebrow labels, serif
 * title class. This keeps the test pure-TS (no DOM act() / RTL plumbing)
 * while still exercising the real component tree — including the unknown-type
 * fallback path which must not throw.
 */

function render(block: InfographicBlock): string {
  return renderToString(<BlockView block={block} />);
}

function renderDoc(doc: InfographicDoc): string {
  return renderToString(<InfographicView doc={doc} />);
}

const stripTags = (html: string): string => html.replace(/<[^>]+>/g, '');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BlockView — known types', () => {
  it('renders hero with title and subtitle', () => {
    const html = render({ type: 'hero', title: 'AI 速览', subtitle: '副标题' });
    expect(html).toContain('AI 速览');
    expect(html).toContain('副标题');
    // Masthead structure: kicker + serif title + meta.
    expect(html).toContain('poster-kicker');
    expect(html).toContain('poster-title');
    expect(html).toContain('poster-serif-title');
    expect(html).toContain('poster-meta');
  });

  it('renders hero without subtitle', () => {
    const html = render({ type: 'hero', title: 'Only Title' });
    expect(html).toContain('Only Title');
    expect(html).toContain('poster-masthead');
  });

  it('renders stat items with value/label/unit', () => {
    const html = render({
      type: 'stat',
      items: [
        { value: '10x', label: '吞吐量', unit: 'x' },
        { value: '99%', label: '可用率' },
      ],
    });
    expect(html).toContain('10x');
    expect(html).toContain('吞吐量');
    expect(html).toContain('99%');
    expect(html).toContain('可用率');
    // Editorial stat block has eyebrow + bordered rows.
    expect(html).toContain('poster-stat');
    expect(html).toContain('poster-eyebrow');
  });

  it('renders keypoints as a numbered editorial list', () => {
    const html = render({ type: 'keypoints', items: ['要点一', '要点二'] });
    expect(html).toContain('要点一');
    expect(html).toContain('要点二');
    // Numerals render as zero-padded "01" / "02".
    expect(html).toContain('01');
    expect(html).toContain('02');
    expect(html).toContain('poster-keypoints');
  });

  it('renders timeline with time + title + detail', () => {
    const html = render({
      type: 'timeline',
      items: [
        { time: '2024 Q1', title: '立项', detail: '开始' },
        { time: '2024 Q3', title: '发布' },
      ],
    });
    expect(html).toContain('2024 Q1');
    expect(html).toContain('立项');
    expect(html).toContain('开始');
    expect(html).toContain('2024 Q3');
    expect(html).toContain('发布');
    expect(html).toContain('poster-timeline');
  });

  it('renders steps as an ordered flow', () => {
    const html = render({
      type: 'steps',
      steps: [{ title: '收集', detail: '抓取网页' }, { title: '生成' }],
    });
    expect(html).toContain('收集');
    expect(html).toContain('抓取网页');
    expect(html).toContain('生成');
    expect(html).toContain('STEP');
    expect(html).toContain('poster-steps');
  });

  it('renders comparison columns as vertical stack with dividers', () => {
    const html = render({
      type: 'comparison',
      columns: [
        { title: '旧', items: ['慢'] },
        { title: '新', items: ['快'] },
      ],
    });
    expect(html).toContain('旧');
    expect(html).toContain('新');
    expect(html).toContain('慢');
    expect(html).toContain('快');
    expect(html).toContain('poster-comparison');
  });

  it('renders quote with text and source', () => {
    const html = render({ type: 'quote', text: '少即是多', source: '设计原则' });
    expect(html).toContain('少即是多');
    expect(html).toContain('设计原则');
    expect(html).toContain('poster-quote');
  });

  it('renders tags as an inline mono list with separators', () => {
    const html = render({ type: 'tags', tags: ['ai', 'clip'] });
    expect(html).toContain('ai');
    expect(html).toContain('clip');
    expect(html).toContain('poster-tags');
  });

  it('renders source footer with url/hostname/clipped', () => {
    const html = render({
      type: 'source',
      url: 'https://example.com/a',
      hostname: 'example.com',
      clipped: '2026-07-02',
    });
    expect(html).toContain('example.com');
    expect(html).toContain('2026-07-02');
    expect(html).toContain('https://example.com/a');
    expect(html).toContain('poster-source');
  });
});

describe('BlockView — unknown type fallback', () => {
  it('does not throw on an unknown block type', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Cast: the discriminated union excludes bogus types, but the runtime
    // path must still handle LLM enum drift defensively.
    const bogus = { type: 'bogus', foo: 'bar' } as unknown as InfographicBlock;
    expect(() => render(bogus)).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });

  it('renders the fallback payload as text for unknown types', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bogus = { type: 'bogus', foo: 'bar' } as unknown as InfographicBlock;
    const html = render(bogus);
    // Fallback renders JSON.stringify(block) so the content is visible.
    // HTML-escapes quotes (`&quot;`); assert on the unquoted tokens.
    expect(stripTags(html)).toContain('bogus');
    expect(stripTags(html)).toContain('bar');
  });
});

describe('InfographicView — editorial poster layout', () => {
  it('renders all blocks in document order within a single poster container', () => {
    // Use distinctive strings so indexOf doesn't collide with class names.
    const doc: InfographicDoc = {
      version: 1,
      blocks: [
        { type: 'hero', title: 'HERO_TITLE' },
        { type: 'stat', items: [{ value: 'STAT_VAL', label: 'STAT_LBL' }] },
        { type: 'quote', text: 'QUOTE_TXT' },
      ],
    };
    const html = renderDoc(doc);
    const idxH = html.indexOf('HERO_TITLE');
    const idxStat = html.indexOf('STAT_VAL');
    const idxQuote = html.indexOf('QUOTE_TXT');
    expect(idxH).toBeGreaterThan(-1);
    expect(idxStat).toBeGreaterThan(-1);
    expect(idxQuote).toBeGreaterThan(-1);
    // Hero (masthead) → stat (body) → quote (footer).
    expect(idxH).toBeLessThan(idxStat);
    expect(idxStat).toBeLessThan(idxQuote);
  });

  it('renders an empty blocks array without throwing', () => {
    const doc: InfographicDoc = { version: 1, blocks: [] };
    expect(() => renderDoc(doc)).not.toThrow();
  });

  it('renders a single unified poster container (not per-block cards)', () => {
    const doc: InfographicDoc = {
      version: 1,
      blocks: [
        { type: 'hero', title: 'H' },
        { type: 'stat', items: [{ value: 'V', label: 'L' }] },
        { type: 'source', url: 'https://x.com' },
      ],
    };
    const html = renderDoc(doc);
    expect(html).toContain('poster-container');
    const posterCount = (html.match(/poster-container/g) || []).length;
    expect(posterCount).toBe(1);
  });

  it('renders masthead + 3-column body + footer structure', () => {
    const doc: InfographicDoc = {
      version: 1,
      blocks: [
        { type: 'hero', title: 'TITLE' },
        { type: 'keypoints', items: ['KP'] },
        { type: 'timeline', items: [{ time: 'T', title: 'TL' }] },
        { type: 'steps', steps: [{ title: 'S' }] },
        { type: 'tags', tags: ['t1'] },
        { type: 'source', url: 'https://x.com', hostname: 'x.com' },
      ],
    };
    const html = renderDoc(doc);
    expect(html).toContain('poster-masthead');
    expect(html).toContain('poster-body');
    expect(html).toContain('poster-col');
    expect(html).toContain('poster-footer');
    // 3-column grid template on the body.
    expect(html).toContain('md:grid-cols-[1.05fr_1.4fr_1fr]');
    // Serif title class on the masthead h1.
    expect(html).toContain('poster-serif-title');
    // Eyebrow labels present on body blocks.
    expect(html).toContain('poster-eyebrow');
    expect(html).toContain('KEY POINTS');
    expect(html).toContain('TIMELINE');
    expect(html).toContain('STEPS');
  });

  it('places source at the bottom (footer) and hero at the top (masthead)', () => {
    const doc: InfographicDoc = {
      version: 1,
      blocks: [
        { type: 'source', url: 'https://x.com', hostname: 'x.com' },
        { type: 'hero', title: 'HERO_TOP' },
        { type: 'stat', items: [{ value: 'V', label: 'L' }] },
        { type: 'source', url: 'https://y.com', hostname: 'y.com' },
      ],
    };
    const html = renderDoc(doc);
    // The renderer picks the first hero and first source for the header /
    // footer slots, regardless of input order.
    const idxHero = html.indexOf('HERO_TOP');
    const idxStat = html.indexOf('V');
    // First source (x.com) is picked as the footer; second source (y.com)
    // falls through to the body as a regular block.
    const idxX = html.indexOf('x.com');
    const idxY = html.indexOf('y.com');
    expect(idxHero).toBeGreaterThan(-1);
    expect(idxStat).toBeGreaterThan(-1);
    expect(idxX).toBeGreaterThan(-1);
    expect(idxY).toBeGreaterThan(-1);
    // Hero (masthead) → stat (body) → y.com (body fallback) → x.com (footer).
    expect(idxHero).toBeLessThan(idxStat);
    expect(idxStat).toBeLessThan(idxY);
    expect(idxY).toBeLessThan(idxX);
  });

  it('places quote in footer-left and tags in footer-right when present', () => {
    const doc: InfographicDoc = {
      version: 1,
      blocks: [
        { type: 'hero', title: 'H' },
        { type: 'quote', text: 'QUOTE_IN_FOOTER' },
        { type: 'tags', tags: ['TAG_IN_FOOTER'] },
        { type: 'source', url: 'https://x.com', hostname: 'x.com' },
      ],
    };
    const html = renderDoc(doc);
    // Footer has left (quote + source stacked), divider, right (tags).
    expect(html).toContain('poster-footer-left');
    expect(html).toContain('poster-footer-div');
    expect(html).toContain('poster-footer-right');
    expect(html).toContain('QUOTE_IN_FOOTER');
    expect(html).toContain('TAG_IN_FOOTER');
    // Source URL must NOT be dropped when quote is present — both render in
    // footer-left, stacked. This guards against a regression where source
    // was filtered from the body but never placed in the footer.
    expect(html).toContain('x.com');
    // Quote comes before tags in the footer (left slot before right slot).
    const idxQuote = html.indexOf('QUOTE_IN_FOOTER');
    const idxTag = html.indexOf('TAG_IN_FOOTER');
    expect(idxQuote).toBeGreaterThan(-1);
    expect(idxTag).toBeGreaterThan(-1);
    expect(idxQuote).toBeLessThan(idxTag);
  });

  it('distributes body blocks across 3 columns', () => {
    const doc: InfographicDoc = {
      version: 1,
      blocks: [
        { type: 'hero', title: 'H' },
        { type: 'keypoints', items: ['KP1'] },
        { type: 'timeline', items: [{ time: 'T', title: 'TL1' }] },
        { type: 'steps', steps: [{ title: 'S1' }] },
        { type: 'comparison', columns: [{ title: 'C', items: ['c1'] }] },
        { type: 'source', url: 'https://x.com' },
      ],
    };
    const html = renderDoc(doc);
    // 4 body blocks → col1 gets 2, col2 gets 2, col3 gets 0 (ceil(4/3)=2).
    // All 4 body block contents render.
    expect(html).toContain('KP1');
    expect(html).toContain('TL1');
    expect(html).toContain('S1');
    expect(html).toContain('c1');
    // 3 poster-col divs.
    const colCount = (html.match(/poster-col/g) || []).length;
    expect(colCount).toBe(3);
  });
});
