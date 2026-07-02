import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { InfographicView, BlockView } from './InfographicView';
import type { InfographicBlock, InfographicDoc } from '@/features/clips/clipParse';

/**
 * Component tests for the infographic renderer.
 *
 * The repo has no @testing-library/react dependency, so we render via
 * `react-dom/server`'s sync `renderToString` (react-dom is already a core
 * dependency) and assert the resulting HTML string contains the expected
 * content. This keeps the test pure-TS (no DOM act() / RTL plumbing) while
 * still exercising the real component tree — including the unknown-type
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
  });

  it('renders hero without subtitle', () => {
    const html = render({ type: 'hero', title: 'Only Title' });
    expect(html).toContain('Only Title');
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
  });

  it('renders keypoints as a numbered list', () => {
    const html = render({ type: 'keypoints', items: ['要点一', '要点二'] });
    expect(html).toContain('要点一');
    expect(html).toContain('要点二');
    // Numbered pills render the indices.
    expect(html).toContain('1');
    expect(html).toContain('2');
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
  });

  it('renders steps as an ordered flow', () => {
    const html = render({
      type: 'steps',
      steps: [{ title: '收集', detail: '抓取网页' }, { title: '生成' }],
    });
    expect(html).toContain('收集');
    expect(html).toContain('抓取网页');
    expect(html).toContain('生成');
  });

  it('renders comparison columns side by side', () => {
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
  });

  it('renders quote with text and source', () => {
    const html = render({ type: 'quote', text: '少即是多', source: '设计原则' });
    expect(html).toContain('少即是多');
    expect(html).toContain('设计原则');
  });

  it('renders tags as pills', () => {
    const html = render({ type: 'tags', tags: ['ai', 'clip'] });
    expect(html).toContain('ai');
    expect(html).toContain('clip');
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

describe('InfographicView — multi-block doc', () => {
  it('renders all blocks in document order within a single poster container', () => {
    // Use distinctive strings so indexOf doesn't collide with class names
    // (e.g. a stat value of "1" would match `grid-cols-1`).
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
    // Hero appears before stat which appears before quote.
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
    // The poster container class is the single outer wrapper.
    expect(html).toContain('poster-container');
    // Each block renderer no longer wraps in its own `rounded-xl border ... bg-panel`
    // chrome — stat renders as a bare grid, source as a bare footer div.
    // Count outer card wrappers: there should be exactly one poster container.
    const posterCount = (html.match(/poster-container/g) || []).length;
    expect(posterCount).toBe(1);
  });

  it('places source at the bottom (full-width footer) and hero at the top', () => {
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
    // falls through to the middle region as a regular block.
    const idxX = html.indexOf('x.com');
    const idxY = html.indexOf('y.com');
    expect(idxHero).toBeGreaterThan(-1);
    expect(idxStat).toBeGreaterThan(-1);
    expect(idxX).toBeGreaterThan(-1);
    expect(idxY).toBeGreaterThan(-1);
    // Hero (header) comes before stat (middle), which comes before x.com
    // (footer). y.com (middle fallback) appears between stat and x.com.
    expect(idxHero).toBeLessThan(idxStat);
    expect(idxStat).toBeLessThan(idxY);
    expect(idxY).toBeLessThan(idxX);
  });

  it('pairs two narrow blocks (keypoints + timeline) into a 2-col row', () => {
    const doc: InfographicDoc = {
      version: 1,
      blocks: [
        { type: 'hero', title: 'H' },
        { type: 'keypoints', items: ['KP_ONE'] },
        { type: 'timeline', items: [{ time: 'T1', title: 'TL_TITLE' }] },
      ],
    };
    const html = renderDoc(doc);
    expect(html).toContain('KP_ONE');
    expect(html).toContain('TL_TITLE');
    // The 2-col grid wrapper is rendered (md:grid-cols-2).
    expect(html).toContain('md:grid-cols-2');
  });
});
