import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import {
  computeOutlineSource,
  mergeOutlineVisibility,
  computeOutline,
  computeActiveHeading,
  type VisibilityProbe,
} from './outlineModel';

/**
 * jsdom has no layout engine: getBoundingClientRect returns all zeros. The
 * visibility merge accepts an injected probe, so tests decide per element
 * whether it "has layout". Only computeActiveHeading needs real rect math —
 * those tests stub getBoundingClientRect/getClientRects on specific elements.
 */
const probeOf = (visible: Element[]): VisibilityProbe => (el) => visible.includes(el);

function headingEl(parent: Element, level: number, line: number, text = `h${level}@${line}`) {
  const h = document.createElement(`h${level}`);
  h.setAttribute('data-source-line', String(line));
  h.textContent = text;
  parent.appendChild(h);
  return h;
}

/** Realistic 4-colon tabs source (TabsExtension template shape). */
const tabsSource = [
  '# Title',
  '',
  '::::tabs',
  ':::tab{label="macOS"}',
  '## Install',
  'macOS text',
  ':::',
  ':::tab{label="Windows"}',
  '## Install on Windows',
  'windows text',
  ':::',
  '::::',
  '',
  '## After tabs',
].join('\n');

describe('computeOutlineSource', () => {
  it('collects ATX headings with editor-absolute lines and skips fences', () => {
    const src = computeOutlineSource(['# A', '', '```md', '# not a heading', '```', '## B'].join('\n'));
    expect(src.headings).toEqual([
      { line: 1, level: 1, text: 'A' },
      { line: 6, level: 2, text: 'B' },
    ]);
  });

  it('scans directive spans with nesting; ::: inside a fence never closes', () => {
    const src = computeOutlineSource(tabsSource);
    // Outer tabs span + two tab panel spans (sibling indices 0 and 1).
    const tabs = src.spans.find((s) => s.name === 'tabs')!;
    expect(tabs.startLine).toBe(3);
    expect(tabs.endLine).toBe(12); // :::: close
    const panels = src.spans.filter((s) => s.name === 'tab');
    expect(panels.map((p) => p.tabPanelIndex)).toEqual([0, 1]);
    expect(panels[0].endLine).toBe(7);
    expect(panels[1].endLine).toBe(11);
  });

  it('counts tab panel indices only when the parent is a tabs container', () => {
    const src = computeOutlineSource([
      ':::card',
      ':::tab{label="x"}',
      '## inside',
      ':::',
      ':::tab{label="y"}',
      '## inside 2',
      ':::',
      ':::',
    ].join('\n'));
    const panels = src.spans.filter((s) => s.name === 'tab');
    // Parent is card, not tabs — no panel index.
    expect(panels.every((p) => p.tabPanelIndex === null)).toBe(true);
    const card = src.spans.find((s) => s.name === 'card')!;
    expect(card.endLine).toBe(8);
  });

  it('closes unclosed directives at EOF', () => {
    const src = computeOutlineSource([':::collapsible', '## swallowed', 'tail'].join('\n'));
    const span = src.spans.find((s) => s.name === 'collapsible')!;
    expect(span.endLine).toBe(3); // last line
    expect(src.headings).toEqual([{ line: 2, level: 2, text: 'swallowed' }]);
  });

  it('fence with ::: inside does not close the open directive', () => {
    const src = computeOutlineSource([
      '::::tabs',
      ':::tab{label="a"}',
      '```',
      ':::',
      '```',
      ':::',
      '::::',
    ].join('\n'));
    const panels = src.spans.filter((s) => s.name === 'tab');
    expect(panels).toHaveLength(1);
    expect(panels[0].endLine).toBe(6); // the real close after the fence
  });
});

describe('mergeOutlineVisibility', () => {
  it('keeps headings with layout, drops display:none ones (inactive tab panel)', () => {
    const preview = document.createElement('div');
    preview.className = 'md-preview';
    const h1 = headingEl(preview, 1, 1, 'A');
    const h2 = headingEl(preview, 2, 5, 'Install'); // inside inactive panel
    h2.style.display = 'none';
    const items = mergeOutlineVisibility(
      computeOutlineSource(tabsSource),
      preview,
      probeOf([h1]),
    );
    expect(items.map((i) => i.line)).toEqual([1, 9, 14]);
  });

  it('hides headings inside a closed collapsible (unmounted children)', () => {
    const content = '# A\n\n:::collapsible\n## hidden\n:::\n\n## B';
    const preview = document.createElement('div');
    preview.className = 'md-preview';
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-container', 'collapsible');
    wrapper.setAttribute('data-source-line', '3');
    wrapper.className = 'docmd-collapse';
    preview.appendChild(wrapper);
    const h1 = headingEl(preview, 1, 1, 'A');
    const hB = headingEl(preview, 2, 8, 'B');
    // "## hidden" has no element — closed collapsible unmounts it.
    const items = mergeOutlineVisibility(computeOutlineSource(content), preview, probeOf([h1, hB]));
    expect(items.map((i) => i.line)).toEqual([1, 7]);
  });

  it('keeps an open collapsible with a far-chunk heading inside', () => {
    const content = '# A\n\n:::collapsible{title="t"}\n## far\n:::\n\n## B';
    const preview = document.createElement('div');
    preview.className = 'md-preview';
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-container', 'collapsible');
    wrapper.setAttribute('data-source-line', '3');
    wrapper.className = 'docmd-collapse is-open';
    preview.appendChild(wrapper);
    const h1 = headingEl(preview, 1, 1, 'A');
    const hB = headingEl(preview, 2, 8, 'B');
    const items = mergeOutlineVisibility(computeOutlineSource(content), preview, probeOf([h1, hB]));
    expect(items.map((i) => i.line)).toEqual([1, 4, 7]);
  });

  it('hides when the collapsible wrapper is missing (nested closed outer)', () => {
    const content = ':::collapsible\n:::collapsible\n## deep\n:::\n:::';
    const preview = document.createElement('div');
    preview.className = 'md-preview'; // no wrappers at all
    const items = mergeOutlineVisibility(computeOutlineSource(content), preview, probeOf([]));
    expect(items).toEqual([]);
  });

  it('keeps plain-flow far headings when no container is rendered at all', () => {
    const content = '# A\n\n:::collapsible\n## in-collapsible\n:::\n\n# Far';
    const preview = document.createElement('div');
    preview.className = 'md-preview';
    const hFar = headingEl(preview, 1, 8, 'Far');
    const items = mergeOutlineVisibility(computeOutlineSource(content), preview, probeOf([hFar]));
    expect(items.map((i) => i.line)).toEqual([1, 7]);
  });

  it('computeOutline merges source + DOM in one call', () => {
    const preview = document.createElement('div');
    preview.className = 'md-preview';
    const h1 = headingEl(preview, 1, 1, 'A');
    const items = computeOutline(tabsSource, preview, probeOf([h1, preview.querySelector('h2')!]));
    expect(items.map((i) => i.line)).toEqual([1, 5, 9, 14]);
  });
});

describe('computeActiveHeading', () => {
  let rectsRestore: () => void;
  beforeEach(() => {
    const proto = Element.prototype as unknown as {
      getBoundingClientRect: () => DOMRect;
      getClientRects: () => DOMRectList;
    };
    const origRect = proto.getBoundingClientRect;
    const origRects = proto.getClientRects;
    proto.getBoundingClientRect = () => ({ top: 0, height: 0, bottom: 0 } as DOMRect);
    proto.getClientRects = () => ({ length: 1 } as unknown as DOMRectList);
    rectsRestore = () => {
      proto.getBoundingClientRect = origRect;
      proto.getClientRects = origRects;
    };
  });
  afterEach(() => rectsRestore());
  afterAll(() => vi.restoreAllMocks());

  it('returns the last heading above the offset line', () => {
    const preview = document.createElement('div');
    preview.className = 'md-preview';
    const a = headingEl(preview, 1, 1, 'A');
    const b = headingEl(preview, 2, 3, 'B');
    // Container top at 0; offset default 96. A@50 visible, B@200 past.
    vi.spyOn(a, 'getBoundingClientRect').mockReturnValue({ top: 50 } as DOMRect);
    vi.spyOn(b, 'getBoundingClientRect').mockReturnValue({ top: 200 } as DOMRect);
    const items = computeOutline('# A\n\n## B', preview, () => true);
    expect(computeActiveHeading(preview, items)?.line).toBe(1);
    // B crosses above the line → active moves.
    vi.spyOn(b, 'getBoundingClientRect').mockReturnValue({ top: 40 } as DOMRect);
    expect(computeActiveHeading(preview, items)?.line).toBe(3);
  });

  it('returns null before the first heading', () => {
    const preview = document.createElement('div');
    preview.className = 'md-preview';
    const b = headingEl(preview, 2, 1, 'B');
    vi.spyOn(b, 'getBoundingClientRect').mockReturnValue({ top: 500 } as DOMRect);
    const items = computeOutline('## B', preview, () => true);
    expect(computeActiveHeading(preview, items)).toBeNull();
  });

  it('skips headings with no client rects, recovers when the panel becomes visible', () => {
    const preview = document.createElement('div');
    preview.className = 'md-preview';
    const a = headingEl(preview, 1, 1, 'A');
    const b = headingEl(preview, 2, 2, 'B');
    vi.spyOn(a, 'getBoundingClientRect').mockReturnValue({ top: 10 } as DOMRect);
    const bRect = vi.spyOn(b, 'getBoundingClientRect').mockReturnValue({ top: 20 } as DOMRect);
    const bRects = vi.spyOn(b, 'getClientRects').mockReturnValue({ length: 0 } as unknown as DOMRectList);
    const items = computeOutline('# A\n## B', preview, () => true);
    // B hidden (inactive panel): active stays A even though B is above it.
    expect(computeActiveHeading(preview, items)?.line).toBe(1);
    // Panel becomes visible → B takes over.
    bRects.mockReturnValue({ length: 1 } as unknown as DOMRectList);
    bRect.mockReturnValue({ top: 20 } as DOMRect);
    expect(computeActiveHeading(preview, items)?.line).toBe(2);
  });
});
