import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  revealHiddenAncestors,
  navigateToHeadingLine,
  navigateToHeadingId,
  navigateToDocLine,
  snapshotComponentState,
  restoreComponentState,
} from './headingNav';

/**
 * jsdom has no layout engine and a bare Element.scrollIntoView; rAF may be
 * absent too. Stub what headingNav touches and drive frames manually.
 */
const scrollIntoView = vi.fn();
let rafQueue: Array<() => void> = [];
const raf = (fn: () => void) => {
  rafQueue.push(fn);
  return rafQueue.length;
};
const flushRaf = () => {
  const q = rafQueue;
  rafQueue = [];
  for (const fn of q) fn();
};

beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView as unknown as () => void;
  // @ts-expect-error test stub
  window.requestAnimationFrame = raf;
  rafQueue = [];
  scrollIntoView.mockClear();
});
afterEach(() => {
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

/** A tabs container in the real DOM shape TabsExtension renders. */
function buildTabs(preview: HTMLElement, activePanel: number): { panels: HTMLElement[]; buttons: HTMLElement[] } {
  const tabs = document.createElement('div');
  tabs.className = 'docmd-tabs';
  const strip = document.createElement('div');
  const body = document.createElement('div');
  body.className = 'docmd-tabs-body';
  tabs.append(strip, body);
  const panels: HTMLElement[] = [];
  const buttons: HTMLElement[] = [];
  for (let i = 0; i < 2; i++) {
    const btn = document.createElement('button');
    btn.setAttribute('data-tab-button', String(i));
    btn.addEventListener('click', () => {
      // Mimic TabsComponent's display effect: flip panels.
      panels.forEach((p, j) => (p.style.display = j === i ? 'block' : 'none'));
    });
    strip.appendChild(btn);
    buttons.push(btn);
    const panel = document.createElement('div');
    panel.setAttribute('data-is-tab', 'true');
    panel.setAttribute('data-tab-label', `P${i}`);
    panel.style.display = i === activePanel ? 'block' : 'none';
    body.appendChild(panel);
    panels.push(panel);
  }
  preview.appendChild(tabs);
  return { panels, buttons };
}

function buildCollapse(preview: HTMLElement, open: boolean): { body: HTMLElement; head: HTMLElement } {
  const wrap = document.createElement('div');
  wrap.className = `docmd-collapse${open ? ' is-open' : ''}`;
  const head = document.createElement('div');
  head.className = 'docmd-collapse-head';
  head.addEventListener('click', () => wrap.classList.add('is-open'));
  const body = document.createElement('div');
  wrap.append(head, body);
  preview.appendChild(wrap);
  return { body, head };
}

function headingEl(preview: HTMLElement, line: number, level = 2, id?: string): HTMLElement {
  const h = document.createElement(`h${level}`);
  h.setAttribute('data-source-line', String(line));
  if (id) h.id = id;
  preview.appendChild(h);
  return h;
}

describe('revealHiddenAncestors', () => {
  it('clicks the closed collapsible head and the inactive tab panel button', () => {
    const preview = document.createElement('div');
    preview.className = 'md-preview';
    const { panels, buttons } = buildTabs(preview, 0);
    const h = headingEl(panels[1], 42);

    const headClick = vi.fn();
    buttons[1].addEventListener('click', headClick);
    expect(panels[1].style.display).toBe('none');

    revealHiddenAncestors(h);
    expect(headClick).toHaveBeenCalledTimes(1);
    expect(panels[1].style.display).toBe('block');
    expect(panels[0].style.display).toBe('none');
  });

  it('expands closed collapsibles around a heading, innermost chain', () => {
    const preview = document.createElement('div');
    preview.className = 'md-preview';
    const outer = buildCollapse(preview, false);
    const { body: outerBody, head: outerHead } = outer;
    const inner = buildCollapse(preview, false); // appended to preview; move under outer
    outerBody.appendChild(inner.body.parentElement!);
    const h = headingEl(inner.body as HTMLElement, 7);
    void outerHead;

    const innerClick = vi.fn();
    inner.head.addEventListener('click', innerClick);
    revealHiddenAncestors(h);
    // Both collapse wrappers now open.
    expect((inner.body.parentElement as HTMLElement).classList.contains('is-open')).toBe(true);
    expect(innerClick).toHaveBeenCalledTimes(1);
    expect(outerBody.parentElement!.classList.contains('is-open')).toBe(true);
  });

  it('leaves already-visible ancestors alone', () => {
    const preview = document.createElement('div');
    preview.className = 'md-preview';
    const { buttons } = buildTabs(preview, 1);
    const h = headingEl(preview, 9);
    const clicks = buttons.map(() => vi.fn());
    buttons.forEach((b, i) => b.addEventListener('click', clicks[i]));
    revealHiddenAncestors(h);
    clicks.forEach((c) => expect(c).not.toHaveBeenCalled());
  });
});

describe('navigateToHeadingLine', () => {
  it('reveals hidden ancestors and scrolls the heading into view', () => {
    const preview = document.createElement('div');
    preview.className = 'md-preview';
    const { panels, buttons } = buildTabs(preview, 0);
    const h = headingEl(panels[1], 42);

    navigateToHeadingLine(preview, 42);
    // reveal happened synchronously…
    expect(panels[1].style.display).toBe('block');
    // …then the scroll lands after the reveal commits (two frames).
    expect(scrollIntoView).not.toHaveBeenCalled();
    flushRaf();
    flushRaf();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect((scrollIntoView.mock.contexts[0] as unknown as HTMLElement).getAttribute('data-source-line')).toBe('42');
    void buttons;
  });

  it('nudges to the nearest mounted block when the heading is unmounted (far chunk), then jumps once mounted', async () => {
    const preview = document.createElement('div');
    preview.className = 'md-preview';
    const before = document.createElement('p');
    before.setAttribute('data-source-line', '10');
    preview.appendChild(before);

    navigateToHeadingLine(preview, 99);
    // Nudge: scrolled the nearest mounted block.
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect((scrollIntoView.mock.contexts[0] as unknown as HTMLElement)).toBe(before);

    // The windowed chunk mounts the heading asynchronously; the internal
    // MutationObserver fires and the jump completes without further input.
    headingEl(preview, 99);
    await new Promise((r) => setTimeout(r, 0));   // observer callback tick
    flushRaf();
    flushRaf();
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect((scrollIntoView.mock.contexts[1] as unknown as HTMLElement).getAttribute('data-source-line')).toBe('99');
  });
});

describe('navigateToHeadingId', () => {
  it('scrolls to the element with the id and reveals its container', () => {
    const preview = document.createElement('div');
    preview.className = 'md-preview';
    const { panels } = buildTabs(preview, 0);
    const h = headingEl(panels[1], 30, 2, 'setup-guide');

    expect(navigateToHeadingId(preview, 'setup-guide')).toBe(true);
    expect(panels[1].style.display).toBe('block');
    flushRaf();
    flushRaf();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('tries the percent-decoded id when the raw one misses', () => {
    const preview = document.createElement('div');
    preview.className = 'md-preview';
    const h = headingEl(preview, 1, 2, '安装指南');
    const ok = navigateToHeadingId(preview, '%E5%AE%89%E8%A3%85%E6%8C%87%E5%8D%97');
    expect(ok).toBe(true);
    flushRaf();
    flushRaf();
    expect((scrollIntoView.mock.contexts[0] as unknown as HTMLElement)).toBe(h);
  });

  it('returns false when no element matches', () => {
    const preview = document.createElement('div');
    expect(navigateToHeadingId(preview, 'missing')).toBe(false);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('component-state snapshot / restore (Phase 4.5)', () => {
  function scene(open: boolean, activePanel: number) {
    const preview = document.createElement('div');
    preview.className = 'md-preview';
    const collapse = document.createElement('div');
    collapse.className = `docmd-collapse${open ? ' is-open' : ''}`;
    collapse.setAttribute('data-source-line', '30');
    const head = document.createElement('div');
    head.className = 'docmd-collapse-head';
    head.addEventListener('click', () => collapse.classList.add('is-open'));
    collapse.appendChild(head);
    preview.appendChild(collapse);
    const { panels, buttons } = buildTabs(preview, activePanel);
    const tabs = preview.querySelector('.docmd-tabs')!;
    tabs.setAttribute('data-source-line', '10');
    return { preview, collapse, panels, buttons };
  }

  it('snapshots open collapsibles and active tabs selections', () => {
    const { preview } = scene(true, 1);
    const snap = snapshotComponentState(preview);
    expect(snap).toEqual({
      openCollapsibles: [30],
      tabsSelections: [{ line: 10, active: 1 }],
    });
  });

  it('snapshots an empty scene when everything is closed', () => {
    const { preview } = scene(false, 0);
    expect(snapshotComponentState(preview)).toEqual({
      openCollapsibles: [],
      tabsSelections: [{ line: 10, active: 0 }],
    });
  });

  it('restore replays the scene: reopens collapsibles, switches panels', () => {
    const { preview, panels, buttons } = scene(false, 0);
    const btnClick = vi.fn();
    buttons[1].addEventListener('click', btnClick);
    restoreComponentState(preview, { openCollapsibles: [30], tabsSelections: [{ line: 10, active: 1 }] });
    expect(preview.querySelector('.docmd-collapse')!.classList.contains('is-open')).toBe(true);
    expect(panels[1].style.display).toBe('block');
    expect(panels[0].style.display).toBe('none');
    expect(btnClick).toHaveBeenCalledTimes(1);
  });

  it('restore is a no-op when the scene already matches', () => {
    const { preview, buttons } = scene(true, 1);
    const btnClick = vi.fn();
    buttons.forEach((b) => b.addEventListener('click', btnClick));
    restoreComponentState(preview, { openCollapsibles: [30], tabsSelections: [{ line: 10, active: 1 }] });
    expect(btnClick).not.toHaveBeenCalled();
  });

  it('restore skips missing containers (far chunks) without throwing', () => {
    const preview = document.createElement('div');
    expect(() => restoreComponentState(preview, { openCollapsibles: [99], tabsSelections: [{ line: 77, active: 2 }] })).not.toThrow();
  });

  it('round-trips: snapshot → mutate → restore returns the same scene', () => {
    const { preview, panels } = scene(true, 1);
    const snap = snapshotComponentState(preview);
    // Reader collapses the section and flips back to panel 0.
    preview.querySelector('.docmd-collapse')!.classList.remove('is-open');
    panels[1].style.display = 'none';
    panels[0].style.display = 'block';
    restoreComponentState(preview, snap);
    expect(snapshotComponentState(preview)).toEqual(snap);
  });
});

describe('navigateToDocLine (in-document find, Phase 5.3)', () => {
  /** A paragraph stamped like preview blocks. */
  function para(parent: HTMLElement, line: number, text = ''): HTMLElement {
    const p = document.createElement('p');
    p.setAttribute('data-source-line', String(line));
    p.textContent = text;
    parent.appendChild(p);
    return p;
  }

  it('jumps to the innermost block at-or-before the line and flashes it', () => {
    const preview = document.createElement('div');
    preview.className = 'md-preview';
    para(preview, 10);
    const target = para(preview, 20, '命中');
    para(preview, 30);

    const before = target.classList.contains('md-find-flash');
    navigateToDocLine(preview, 21); // between 20 and 30 → block 20
    // reveal commits over two frames; flash + scroll land together in the
    // second one.
    expect(scrollIntoView).not.toHaveBeenCalled();
    flushRaf();
    expect(scrollIntoView).not.toHaveBeenCalled();
    flushRaf();
    expect(target.classList.contains('md-find-flash')).toBe(true);
    expect(before).toBe(false);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect((scrollIntoView.mock.contexts[0] as unknown as HTMLElement)).toBe(target);
    // and the flash cleans itself up on animationend
    target.dispatchEvent(new Event('animationend'));
    expect(target.classList.contains('md-find-flash')).toBe(false);
  });

  it('jumps to the exact line block when the match line has one', () => {
    const preview = document.createElement('div');
    preview.className = 'md-preview';
    const p10 = para(preview, 10);
    const p20 = para(preview, 20);
    navigateToDocLine(preview, 20);
    flushRaf();
    flushRaf();
    expect((scrollIntoView.mock.contexts[0] as unknown as HTMLElement)).toBe(p20);
    void p10;
  });

  it('reveals hidden containers (closed collapsible, inactive tab) before jumping', () => {
    const preview = document.createElement('div');
    preview.className = 'md-preview';
    const { panels, buttons } = buildTabs(preview, 0);
    const inner = buildCollapse(panels[1], false);
    const p = para(inner.body as HTMLElement, 55);

    navigateToDocLine(preview, 55);
    expect(panels[1].style.display).toBe('block'); // tab revealed
    expect(preview.querySelector('.docmd-collapse')!.classList.contains('is-open')).toBe(true);
    flushRaf();
    flushRaf();
    expect((scrollIntoView.mock.contexts[0] as unknown as HTMLElement)).toBe(p);
    void buttons;
  });

  it('nudges to the first mounted block when the target is in an unmounted far chunk, then lands', async () => {
    const preview = document.createElement('div');
    preview.className = 'md-preview';
    // Everything mounted is AFTER the target line — the window is scrolled
    // past the match's chunk (virtualized away). No block at-or-before 500.
    const later = para(preview, 600);

    navigateToDocLine(preview, 500);
    // Nudge: scroll to the FIRST mounted block so the windowing mounts the
    // region around 500 (content before 600).
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect((scrollIntoView.mock.contexts[0] as unknown as HTMLElement)).toBe(later);
    // The windowing mounts the target chunk; the observer completes the jump.
    const target = para(preview, 500);
    await new Promise((r) => setTimeout(r, 0)); // observer tick
    flushRaf();
    flushRaf();
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect((scrollIntoView.mock.contexts[1] as unknown as HTMLElement)).toBe(target);
    expect(target.classList.contains('md-find-flash')).toBe(true);
  });

  it('is a no-op (no flash, no scroll) when no block exists for the line and none mounts', async () => {
    const preview = document.createElement('div');
    preview.className = 'md-preview';
    navigateToDocLine(preview, 7, { waitMs: 20 });
    expect(scrollIntoView).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 30));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
