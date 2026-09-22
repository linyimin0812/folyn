/**
 * Cursor-sync regression tests: mount the real MarkdownPreview with ::::tabs
 * documents, stub element geometry (jsdom has no layout engine — block
 * tops/heights, hidden subtrees, scroll, and the .md-preview transform are
 * modeled), drive the cursor-sync effect through the editor-view-state store,
 * and assert where the preview actually lands.
 *
 * Two reported bugs locked down here:
 *  1. 只有首行对齐 / 预览整体偏下 — top-aligning the container to the cursor
 *     dragged the whole preview down as the cursor descended; the pin now
 *     holds the container top at the editor's ::::tabs line.
 *  2. 严重向下偏移 (regression) — the pin's line-arithmetic re-anchor missed
 *     soft-wrap rows (a row per wrap, accumulating across paragraph
 *     boundaries in containers with internal blanks); the pin now uses the
 *     editor's wrap-exact measured line Y (the syncTarget feedback channel).
 *
 * The harness simulates the editor feedback channel the real EditorView
 * publishes (setSyncTargetMeasure) — the wrap-exact screen Y of the
 * container's first line.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';

vi.mock('../excalidraw/ExcalidrawPreview', () => ({ ExcalidrawPreview: () => null }));

import { MarkdownPreview } from './MarkdownPreview';
import { useEditorViewStateStore } from '@/store/editorViewState';

const LH = 24; // editor line height used for all stubbed geometry
const VIEWPORT_TOP = 100; // editor pane top on screen (preview pane shares it)

interface Layout {
  tops: Map<HTMLElement, number>;
  heights: Map<HTMLElement, number>;
  hiddenRoot?: HTMLElement;
}

/**
 * Realistic geometry: wrap@1 = tab bar (45) + padding (24) + active content
 * (48 = 2 lines) + padding (24) = 141; the active tab's content starts 69px
 * below the wrap top; the hidden sibling wrapper is 0-height.
 */
function stubGeometry(root: HTMLElement, scrollContainer: HTMLElement, layout: Layout) {
  const { tops, heights, hiddenRoot } = layout;
  const hidden = new Set<HTMLElement>();
  const markHidden = (el: Element) => {
    hidden.add(el as HTMLElement);
    Array.from(el.children).forEach(markHidden);
  };
  if (hiddenRoot) markHidden(hiddenRoot);

  const rect = (el: HTMLElement): DOMRect => {
    // getBoundingClientRect returns SCREEN coords: containerTop + content
    // offset − scrollTop + the .md-preview transform (the effect cancels it
    // when measuring, so the stub must include it). HIDDEN elements (any
    // display:none ancestor) return the ZERO rect — real browsers do NOT
    // cascade display:none into descendants' computed styles, so the
    // selection loop detects them via getClientRects().length === 0.
    if (hidden.has(el)) {
      return { top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    }
    const transform = Number((root.style.transform || '').match(/-?\d+(?:\.\d+)?/)?.[0] ?? 0);
    const top = VIEWPORT_TOP + (tops.get(el) ?? 0) - scrollContainer.scrollTop + transform;
    const h = heights.get(el) ?? 0;
    return { top, bottom: top + h, height: h, left: 0, right: 600, width: 600, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  };
  const stubTree = (el: HTMLElement) => {
    el.getBoundingClientRect = () => rect(el);
    // jsdom returns [] for every element by default (no layout) — model the
    // real browser: rendered elements have one fragment rect, hidden ones none.
    el.getClientRects = () => (hidden.has(el) ? [] : [rect(el) as DOMRect]);
    Object.defineProperty(el, 'offsetHeight', { get: () => (hidden.has(el) ? 0 : heights.get(el) ?? 0), configurable: true });
    Array.from(el.children).forEach((c) => stubTree(c as HTMLElement));
  };
  stubTree(root);
  scrollContainer.getBoundingClientRect = () =>
    ({ top: VIEWPORT_TOP, bottom: VIEWPORT_TOP + 600, height: 600, left: 0, right: 600, width: 600, x: 0, y: VIEWPORT_TOP, toJSON: () => ({}) } as DOMRect);
  scrollContainer.scrollTo = ((o: ScrollToOptions) => {
    (scrollContainer as HTMLElement).scrollTop = o.top ?? 0;
  }) as typeof scrollContainer.scrollTo;
}

/** Drive one cursor position: props + store (incl. the simulated editor
 *  feedback measurement for the container's line). */
function driveCursor(
  utils: ReturnType<typeof render>,
  content: string,
  line: number,
  cursor: { offset: number; anchor: number; viewportY: number; blockHeight?: number; blockEndLine?: number },
  measured?: { line: number; screenY: number },
) {
  act(() => {
    utils.rerender(
      <MarkdownPreview content={content} filePath="/tmp/note.md" vaultRoot="" onChange={() => {}} cursorLine={line} cursorViewportY={cursor.viewportY} editorViewportTop={VIEWPORT_TOP} hasSelection={false} />,
    );
    const s = useEditorViewStateStore.getState();
    s.setCursorViewportY(cursor.viewportY, VIEWPORT_TOP, 0, LH, 0, cursor.offset, cursor.anchor, cursor.blockHeight ?? 0, cursor.blockEndLine ?? 0);
    if (measured) s.setSyncTargetMeasure(measured.line, measured.screenY);
  });
}


// TALL doc: 20 one-line paragraphs (blank-separated), then the tabs template,
// then a trailing para — exercises the SCROLL path (container deep in content).
const TALL_DOC = [
  ...Array.from({ length: 20 }, (_, i) => ['para ' + i, '']),
  '::::tabs',
  ':::tab{label="macOS"}',
  'macOS 安装说明',
  'more content',
  ':::',
  ':::tab{label="Windows"}',
  'Windows 安装说明',
  ':::',
  '::::',
  '',
  'after the container',
].flat().join('\n');

const TALL_TABS_LINE = 41; // 1-indexed line of ::::tabs (20 paras × 2 lines + 1)
const TALL_CONTAINER_TOP = 960; // 20 paras × (24 + 24 blank-gap)

function layoutTallDoc(root: HTMLElement): Layout {
  const tops = new Map<HTMLElement, number>();
  const heights = new Map<HTMLElement, number>();
  let y = 0;
  for (let i = 0; i < 20; i++) {
    const p = root.querySelector(`[data-source-line="${i * 2 + 1}"]`) as HTMLElement;
    if (!p) continue;
    tops.set(p, y); heights.set(p, LH);
    y += LH + LH; // para + one blank-line gap
  }
  const wrap = root.querySelector('[data-hides-inactive]') as HTMLElement;
  const tabA = root.querySelector('[data-container="tab"][data-source-line="42"]') as HTMLElement;
  const tabB = root.querySelector('[data-container="tab"][data-source-line="46"]') as HTMLElement;
  const p3 = root.querySelector('[data-source-line="43"]') as HTMLElement;
  const p7 = root.querySelector('[data-source-line="47"]') as HTMLElement;
  const pAfter = root.querySelector('[data-source-line="51"]') as HTMLElement;
  tops.set(wrap, y); heights.set(wrap, 141);
  if (tabA) { tops.set(tabA, y + 69); heights.set(tabA, 48); }
  if (p3) { tops.set(p3, y + 69); heights.set(p3, 48); }
  if (p7) { tops.set(p7, y + 69); heights.set(p7, 24); }
  if (tabB) { tops.set(tabB, y + 69); heights.set(tabB, 0); }
  if (pAfter) { tops.set(pAfter, y + 141 + LH); heights.set(pAfter, LH); }
  return { tops, heights, hiddenRoot: tabB ?? undefined };
}

// WRAP doc: tabs with INTERNAL BLANK LINES and content lines that soft-wrap
// in the editor into 2 visual rows each — the line-arithmetic pin missed the
// wrap rows (the severe downward offset).
const WRAP_DOC = [
  '::::tabs',
  ':::tab{label="A"}',
  'para1 a long wrapped line aaaa bbbb cccc dddd eeee ffff',
  '',
  'para2 a long wrapped line aaaa bbbb cccc dddd eeee ffff',
  ':::',
  ':::tab{label="B"}',
  'tab B content',
  ':::',
  '::::',
].join('\n');

// Editor line heights for WRAP_DOC: lines 3 and 5 wrap into 2 rows (48px),
// all others 24px. Y(line) = the cursor's doc-space top for each line.
const WRAP_EDITOR_LINE_TOP: Record<number, number> = {
  1: 0, 2: 24, 3: 48, 4: 96, 5: 120, 6: 168, 7: 192, 8: 216, 9: 240, 10: 264,
};

function layoutWrapDoc(root: HTMLElement): Layout {
  const tops = new Map<HTMLElement, number>();
  const heights = new Map<HTMLElement, number>();
  const set = (sel: string, top: number, h: number) => {
    const el = root.querySelector(sel) as HTMLElement;
    if (el) { tops.set(el, top); heights.set(el, h); }
    return el;
  };
  set('[data-hides-inactive]', 0, 45 + 24 + 48 + 24 + 48 + 24);
  set('[data-container="tab"][data-source-line="2"]', 69, 48);
  set('[data-source-line="3"]', 69, 48);
  set('[data-source-line="5"]', 141, 48);
  const hiddenRoot = set('[data-container="tab"][data-source-line="7"]', 141, 0) ?? undefined;
  set('[data-source-line="8"]', 141, 24);
  return { tops, heights, hiddenRoot };
}

describe('MarkdownPreview cursor-sync (tabs)', () => {
  it('TALL doc: active content pins to the cursor; hidden lines pin the container', () => {
    const utils = render(
      <MarkdownPreview content={TALL_DOC} filePath="/tmp/note.md" vaultRoot="" onChange={() => {}} cursorLine={0} cursorViewportY={0} editorViewportTop={0} hasSelection={false} />,
    );
    const root = utils.container.querySelector('.md-preview') as HTMLElement;
    const scrollContainer = root.parentElement as HTMLElement;
    const layout = layoutTallDoc(root);
    stubGeometry(root, scrollContainer, layout);
    const wrap = root.querySelector('[data-hides-inactive]') as HTMLElement;
    const p3 = root.querySelector('[data-source-line="43"]') as HTMLElement;
    const CURSOR_DEPTH = 200; // the editor keeps the cursor at 200px into the pane

    // Simulated editor feedback: wrap-exact screen Y of the container's
    // ::::tabs line (docY 960). line41ScreenY = VIEWPORT_TOP + 960 - editorScrollTop.
    const measure = (cursorLine: number) => {
      const cursorDocY = TALL_CONTAINER_TOP + (cursorLine - TALL_TABS_LINE) * LH;
      const editorScrollTop = cursorDocY - CURSOR_DEPTH;
      return { line: TALL_TABS_LINE, screenY: VIEWPORT_TOP + TALL_CONTAINER_TOP - editorScrollTop };
    };

    // Cursor on the ACTIVE tab's content line 43: the paragraph's top pins
    // to the cursor (its editor-paragraph top is at the cursor's screen Y).
    driveCursor(utils, TALL_DOC, 43, { offset: 48, anchor: TALL_TABS_LINE, viewportY: CURSOR_DEPTH }, measure(43));
    const paraTopDepth = p3.getBoundingClientRect().top - VIEWPORT_TOP;
    expect(Math.abs(paraTopDepth - CURSOR_DEPTH)).toBeLessThan(4);

    // Cursor on the HIDDEN tab's content line 47: the container top pins to
    // the editor's ::::tabs line (cursor depth 200 - 6 lines = 56), NOT
    // dragged to the cursor (the old top-align bug: 200).
    driveCursor(utils, TALL_DOC, 47, { offset: 144, anchor: TALL_TABS_LINE, viewportY: CURSOR_DEPTH }, measure(47));
    const wrapTopDepth = wrap.getBoundingClientRect().top - VIEWPORT_TOP;
    expect(Math.abs(wrapTopDepth - (CURSOR_DEPTH - 6 * LH))).toBeLessThan(4);

    cleanup();
  });

  it('TALL doc: multi-line paragraph maps the cursor\u2019s relative depth proportionally (editor px \u2192 fraction, not preview px)', () => {
    // Cursor on line 44 — the 2nd line of p3 (the ACTIVE tab paragraph
    // spanning source lines 43-44). Editor model: the whole directive run
    // 41-49 is ONE 216px paragraph (9 lines × LH — the editor parser is
    // directive-blind); offset (Y44−Y41) = 72, re-anchored to line 43 → 24;
    // height 216 re-anchored → 216 − 48 (scaffolding above) − 120 (lines
    // 45-49 below p3's span) = 48 → frac 0.5. The preview p3 (48px) sits
    // so its MIDPOINT (top+24) lands at the cursor's screen Y — the old
    // absolute-px step would put the block top 72 editor px above the
    // cursor, i.e. the mapped text sits a quarter of the block off.
    const utils = render(
      <MarkdownPreview content={TALL_DOC} filePath="/tmp/note.md" vaultRoot="" onChange={() => {}} cursorLine={0} cursorViewportY={0} editorViewportTop={0} hasSelection={false} />,
    );
    const root = utils.container.querySelector('.md-preview') as HTMLElement;
    const scrollContainer = root.parentElement as HTMLElement;
    const layout = layoutTallDoc(root);
    stubGeometry(root, scrollContainer, layout);
    const p3 = root.querySelector('[data-source-line="43"]') as HTMLElement;
    const CURSOR_DEPTH = 200;

    driveCursor(utils, TALL_DOC, 44, {
      offset: 72, anchor: TALL_TABS_LINE, viewportY: CURSOR_DEPTH,
      blockHeight: 9 * LH, blockEndLine: 49,
    });
    const midDepth = p3.getBoundingClientRect().top - VIEWPORT_TOP + 24;
    expect(Math.abs(midDepth - CURSOR_DEPTH)).toBeLessThan(4);

    cleanup();
  });

  it('WRAP doc: the pin uses the wrap-exact measured line Y, not line arithmetic', () => {
    const utils = render(
      <MarkdownPreview content={WRAP_DOC} filePath="/tmp/note.md" vaultRoot="" onChange={() => {}} cursorLine={0} cursorViewportY={0} editorViewportTop={0} hasSelection={false} />,
    );
    const root = utils.container.querySelector('.md-preview') as HTMLElement;
    const scrollContainer = root.parentElement as HTMLElement;
    const layout = layoutWrapDoc(root);
    stubGeometry(root, scrollContainer, layout);
    const wrap = root.querySelector('[data-hides-inactive]') as HTMLElement;

    // Cursor on line 8 (hidden tab B content). Editor model: the cursor's
    // paragraph (run 5..10) anchors at line 5, offset = Y(8)-Y(5) = 96
    // (wrap-exact); cursorScreenY at depth 200 → the editor scrolled 16px
    // (cursorDocY 216 - 200). The container's line 1 (docY 0) sits at
    // screen 84 — 16px ABOVE the pane top → the pin clamps the wrap top to
    // the pane top (the glue clamp).
    const line = 8;
    const CURSOR_DEPTH = 200;
    const editorScrollTop = WRAP_EDITOR_LINE_TOP[line] - CURSOR_DEPTH; // 16
    const measured = { line: 1, screenY: VIEWPORT_TOP - editorScrollTop };
    driveCursor(utils, WRAP_DOC, line, { offset: 96, anchor: 5, viewportY: CURSOR_DEPTH }, measured);

    const wrapTopDepth = wrap.getBoundingClientRect().top - VIEWPORT_TOP;
    // Wrap-exact expectation: line-1 depth = -16 (scrolled off) → glue at 0.
    // The line-arithmetic version landed +59 (75px too low — the reported
    // 严重向下偏移).
    const expectedLine1Depth = measured.screenY - VIEWPORT_TOP; // -16
    const expected = Math.max(0, expectedLine1Depth);
    expect(Math.abs(wrapTopDepth - expected)).toBeLessThan(4);
    cleanup();
  });
});
