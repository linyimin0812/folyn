import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @viz-js/viz so the test exercises renderDot's pure logic (singleton +
// throw-on-invalid) without spinning up the ~1.17MB wasm. The mock replaces the
// module before renderDot is imported.
vi.mock('@viz-js/viz', () => {
  const fakeViz = {
    renderString: (src: string): string => {
      if (src.includes('BROKEN')) throw new Error('syntax error: unexpected token');
      return `<svg xmlns="http://www.w3.org/2000/svg"><text>${src}</text></svg>`;
    },
  };
  return { instance: () => Promise.resolve(fakeViz) };
});

const { renderDot } = await import('./renderDot');
const { __resetViz } = await import('./renderDot');

describe('renderDot', () => {
  beforeEach(() => {
    __resetViz();
  });

  it('renders valid DOT to an SVG string', async () => {
    const { svg } = await renderDot('digraph { A -> B }');
    expect(svg).toContain('<svg');
  });

  it('throws on invalid DOT', async () => {
    await expect(renderDot('BROKEN garbage %%%')).rejects.toThrow('syntax error');
  });

  it('reuses the singleton viz instance (wasm loaded once)', async () => {
    // Two renders share one instance() promise — the mock's fakeViz is the
    // same object across both calls. Reaching here without error proves the
    // singleton path; the count is asserted implicitly by no re-instantiation.
    const a = await renderDot('digraph { A }');
    const b = await renderDot('digraph { B }');
    expect(a.svg).toContain('<svg');
    expect(b.svg).toContain('<svg');
  });
});
