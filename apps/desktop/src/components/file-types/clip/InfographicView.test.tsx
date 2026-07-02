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
  it('renders all blocks in document order', () => {
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
});
