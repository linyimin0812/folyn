/**
 * Cursor-sync regression tests for SHORT documents (new-file typing) — the
 * reported 新建 Markdown 文件输入内容预览闪动 + 内容超过页面后不闪 +
 * 预览页面头部大片空白 + (round 2) 预览页为了对齐不断下移 + (round 3)
 * 只有超过一页才对齐.
 *
 * Root causes, in the order they were fixed:
 *  1. Trailing EOF blank lines had no preview representation — the gap path
 *     clamped the align point to the last block's bottom while the cursor
 *     kept descending → the old syncOffset transform engaged and bounced
 *     per keystroke (the flicker + top blank band). Fixed by extending the
 *     EOF gap at the editor's line rate + a trailing .md-blank-gap div.
 *  2. The transform push-down itself (the "fallback" for negative desired)
 *     grew a blank band at the top as structural drift accumulated. Fixed
 *     by removing it entirely — alignment must come from geometry, never
 *     from pushing content down.
 *  3. Structural re-wrap drift: long CJK paragraphs occupy 3 editor rows
 *     but re-wrap to 2 preview rows (the preview pane is wider) — each
 *     paragraph renders shorter than the editor and the shortfall
 *     ACCUMULATES. Removing the transform alone left short docs unaligned
 *     (only >1 page aligned). Fixed by RUNTIME GAP COMPENSATION: after each
 *     parse, re-size each .md-blank-gap so the block AFTER it lands exactly
 *     on the editor's line grid (first block's top + (line−1)×editorLineHeight).
 *     Every block then sits where its editor line sits → desiredRaw ≈ 0 →
 *     scrollTop 0 → aligned, no band, at ANY doc length.
 *
 * jsdom has no layout engine — geometry is stubbed at the PROTOTYPE level
 * with a mini layout engine: block heights are registered by
 * data-source-line; positions are computed by WALKING .md-preview's
 * children (blocks contribute their registered height, gap divs their live
 * style height — calc(N × var(--md-gap-line)) → N×LH before compensation,
 * absolute px after) — so the runtime compensation effect's writes are
 * reflected in subsequent rect reads, exactly like a real browser.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, act, cleanup, waitFor } from '@testing-library/react';
import { createElement } from 'react';

vi.mock('../excalidraw/ExcalidrawPreview', () => ({ ExcalidrawPreview: () => null }));

import { MarkdownPreview } from './MarkdownPreview';
import { useEditorViewStateStore } from '@/store/editorViewState';
import { registerMarkdownCodeRenderer } from '@/services/extension-host/markdownCodeRendererAdapter';

// ponytail: a unique-language dummy renderer — exercises map['pre']'s
// renderer branch (extension code fences) without mounting real mermaid.
registerMarkdownCodeRenderer('test', 'zzztestfence', 'zzztestfence',
  ({ source }: any) => createElement('div', null, source));

const LH = 24; // editor line height (14px × 1.7)
const EDITOR_PAD = 16; // .cm-content padding-top — editor line 1's top
const VIEWPORT_TOP = 100; // shared editor/preview pane top on screen
const VIEWPORT_H = 600;
const CONTENT_TOP = 16; // prev-body pt-2 + first p margin — matches EDITOR_PAD

// Block heights by data-source-line (the mini layout engine's registry).
const HEIGHTS = new Map<number, number>();
// The SkillMetaCard's height (frontmatter docs) — 0 = not modeled.
let CARD_H = 0;
let scrollContainerEl: HTMLElement | null = null;

/** A gap div's live height: 'NNpx' (compensated) or calc(N × var(…)) → N×LH. */
const gapHeightOf = (el: HTMLElement): number => {
  const s = el.style.height ?? '';
  if (s.endsWith('px')) return parseFloat(s) || 0;
  const m = s.match(/^calc\((\d+)/);
  return m ? Number(m[1]) * LH : 0;
};

const childHeight = (el: HTMLElement): number =>
  el.classList.contains('md-blank-gap')
    ? gapHeightOf(el)
    : el.classList.contains('skill-meta-card')
      ? CARD_H
      : (HEIGHTS.get(Number(el.getAttribute('data-source-line'))) ?? 0);

/** Content-space top of an element inside .md-preview: walk the children,
 *  accumulating block/gap heights (margin-collapsing is modeled by the
 *  gap's −8px margins, so block N's top = block N−1's bottom + gap). */
const topOf = (el: HTMLElement): number => {
  const rootEl = el.closest('.md-preview');
  if (!rootEl) return 0;
  let y = CONTENT_TOP;
  for (const kid of Array.from(rootEl.children) as HTMLElement[]) {
    if (kid === el) return y;
    y += childHeight(kid);
  }
  return CONTENT_TOP;
};

const zeroRect = (): DOMRect =>
  ({ top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);

let spies: ReturnType<typeof vi.spyOn>[] = [];

beforeAll(() => {
  spies.push(vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this === scrollContainerEl) {
      return { top: VIEWPORT_TOP, bottom: VIEWPORT_TOP + VIEWPORT_H, height: VIEWPORT_H, left: 0, right: 600, width: 600, x: 0, y: VIEWPORT_TOP, toJSON: () => ({}) } as DOMRect;
    }
    const isBlock = this.getAttribute('data-source-line') != null || this.classList.contains('md-blank-gap');
    if (!isBlock || !this.closest('.md-preview')) return zeroRect();
    const h = childHeight(this);
    const top = VIEWPORT_TOP + topOf(this) - (scrollContainerEl?.scrollTop ?? 0);
    return { top, bottom: top + h, height: h, left: 0, right: 600, width: 600, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  }));
  spies.push(vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    const isBlock = this.getAttribute('data-source-line') != null || this.classList.contains('md-blank-gap');
    return isBlock && this.closest('.md-preview') ? [this.getBoundingClientRect() as DOMRect] : [];
  }));
  (Element.prototype as any).scrollTo = function (this: Element, o?: ScrollToOptions) {
    (this as HTMLElement).scrollTop = o?.top ?? 0;
  };
  spies.push({ mockRestore: () => { delete (Element.prototype as any).scrollTo; } } as ReturnType<typeof vi.spyOn>);
});

afterAll(() => {
  spies.forEach((s) => s.mockRestore());
  spies = [];
});

/** One editor step: content + cursor line, editor metrics via the store
 *  (mirrors EditorView's setCursorViewportY publication). Geometry must be
 *  set BEFORE the act() — the effects run inside it against the fresh DOM. */
function drive(
  utils: ReturnType<typeof render>,
  content: string,
  line: number,
  opts: { blockOffsetY?: number; anchor?: number; cardH?: number } = {},
) {
  HEIGHTS.clear();
  CARD_H = opts.cardH ?? 0;
  const lines = content.split('\n');
  lines.forEach((t, i) => {
    if (t.trim() !== '') HEIGHTS.set(i + 1, LH); // one-line paragraphs
  });
  act(() => {
    // The editor's line-1 phase (cm-content padding-top) — the absolute
    // grid origin for the gap-compensation pin.
    useEditorViewStateStore.getState().setEditorContentPadTop(EDITOR_PAD);
    utils.rerender(
      <MarkdownPreview content={content} filePath="/tmp/note.md" vaultRoot="" onChange={() => {}} cursorLine={line} cursorViewportY={EDITOR_PAD + (line - 1) * LH} editorViewportTop={VIEWPORT_TOP} hasSelection={false} />,
    );
    useEditorViewStateStore.getState().setCursorViewportY(
      EDITOR_PAD + (line - 1) * LH, VIEWPORT_TOP, 0, LH, 0, opts.blockOffsetY ?? 0, opts.anchor ?? line,
    );
  });
}

const root = (utils: ReturnType<typeof render>) => utils.container.querySelector('.md-preview') as HTMLElement;
const scrollEl = (utils: ReturnType<typeof render>) => root(utils).parentElement as HTMLElement;
/** The .md-preview translateY px (0 when none) — a blank band must never exist. */
const transformY = (utils: ReturnType<typeof render>) =>
  Number(root(utils).style.transform.match(/-?\d+(?:\.\d+)?/)?.[0] ?? 0);

// Short doc: 5 blank-separated one-line paragraphs (lines 1,3,5,7,9).
const P5 = 'p1\n\np2\n\np3\n\np4\n\np5';

describe('MarkdownPreview cursor-sync — short doc typing (new file)', () => {
  it('typing through paragraphs + trailing EOF blanks stays aligned with no transform (no flicker, no top blank band)', () => {
    const utils = render(
      <MarkdownPreview content={P5} filePath="/tmp/note.md" vaultRoot="" onChange={() => {}} cursorLine={0} cursorViewportY={0} editorViewportTop={0} hasSelection={false} />,
    );
    scrollContainerEl = scrollEl(utils);

    // 1. Typing at the end of p5 (cursor line 9): aligned, no transform.
    drive(utils, P5, 9, { blockOffsetY: 0, anchor: 9 });
    expect(transformY(utils)).toBe(0);
    expect(scrollEl(utils).scrollTop).toBe(0);

    // 2. Enter×3: content ends with 3 trailing blanks, cursor on line 12.
    //    The EOF gap extends the align point by 2×LH (the editor-rate
    //    trailing region) → desiredRaw ≈ 0, no transform, no band.
    drive(utils, P5 + '\n\n\n', 12);
    expect(transformY(utils)).toBe(0);
    expect(scrollEl(utils).scrollTop).toBe(0);

    // 3. Type "p6" on line 12: paragraph + 2-blank gap appear. The align
    //    point lands on p6's top (280) = the cursor's editor position —
    //    still no transform, and the preview did NOT have to snap back.
    drive(utils, P5 + '\n\n\np6', 12);
    expect(transformY(utils)).toBe(0);
    expect(scrollEl(utils).scrollTop).toBe(0);
    // The block containing the cursor aligns to the cursor's screen Y.
    const p6 = root(utils).querySelector('[data-source-line="12"]') as HTMLElement;
    expect(Math.abs(p6.getBoundingClientRect().top - (VIEWPORT_TOP + EDITOR_PAD + 11 * LH))).toBeLessThan(4);

    cleanup();
  });

  it('rehypeBlankGap renders a trailing gap div sized to the trailing blank count', () => {
    const utils = render(
      <MarkdownPreview content={P5 + '\n\n\n'} filePath="/tmp/note.md" vaultRoot="" onChange={() => {}} cursorLine={12} cursorViewportY={EDITOR_PAD + 11 * LH} editorViewportTop={VIEWPORT_TOP} hasSelection={false} />,
    );
    const gaps = root(utils).querySelectorAll(':scope > .md-blank-gap');
    // Between-block gaps: 4 (one per blank line between the 5 paragraphs).
    // Trailing gap: 1, sized 3 × var(--md-gap-line) — the doc's trailing
    // blank count (lines 10-12), giving the EOF-gap scroll target room.
    expect(gaps.length).toBe(5);
    const trailing = gaps[gaps.length - 1] as HTMLElement;
    expect(trailing.getAttribute('style')).toContain('3 *');
    expect(trailing.style.height).toContain('var(--md-gap-line');

    cleanup();
  });

  it('tall doc + trailing EOF blanks: the extension scrolls (no transform), landing the content end K−1 lines above the cursor', () => {
    // 30 paragraphs (lines 1..59) + 3 trailing blanks: content ≈ 1424px —
    // exceeds the 600px viewport, so the scroll path is active.
    const paras = Array.from({ length: 30 }, (_, i) => `para ${i + 1}`);
    const doc = paras.join('\n\n') + '\n\n\n';
    const cursorLine = 62; // last trailing blank line
    const utils = render(
      <MarkdownPreview content={doc} filePath="/tmp/note.md" vaultRoot="" onChange={() => {}} cursorLine={0} cursorViewportY={0} editorViewportTop={0} hasSelection={false} />,
    );
    scrollContainerEl = scrollEl(utils);
    drive(utils, doc, cursorLine, { anchor: cursorLine });

    const r = root(utils);
    const sc = scrollEl(utils);
    expect(transformY(utils)).toBe(0);
    // Use a cursor depth the scroll CAN reach: cursor near the viewport top.
    const depth = 200; // editor scrolled so the cursor sits 200px into the pane
    act(() => {
      utils.rerender(
        <MarkdownPreview content={doc} filePath="/tmp/note.md" vaultRoot="" onChange={() => {}} cursorLine={cursorLine} cursorViewportY={depth} editorViewportTop={VIEWPORT_TOP} hasSelection={false} />,
      );
      useEditorViewStateStore.getState().setCursorViewportY(depth, VIEWPORT_TOP, 0, LH, 0, 0, cursorLine);
    });
    expect(transformY(utils)).toBe(0);
    // desiredRaw = 1480 − 200 = 1280 → the preview scrolls so the virtual
    // 2nd trailing blank line lands at the cursor: last block bottom sits
    // 2×LH above the cursor's screen Y.
    expect(Math.abs(sc.scrollTop - (1480 - depth))).toBeLessThan(4);
    const lastPara = r.querySelector('[data-source-line="59"]') as HTMLElement;
    expect(Math.abs(lastPara.getBoundingClientRect().bottom - (VIEWPORT_TOP + depth - 2 * LH))).toBeLessThan(4);

    cleanup();
  });

  // Long CJK paragraphs re-wrap: 3 source lines (joined, no blanks) are
  // 3 editor rows but re-wrap to 2 preview rows (the preview pane is wider)
  // — every paragraph renders 24px shorter than the editor, and the
  // shortfall ACCUMULATES down the doc (the structural drift behind the
  // round-2/round-3 reports). The runtime gap compensation must absorb it:
  // the gap after each paragraph grows by its shortfall, every block lands
  // on the editor's line grid, and the cursor's block aligns EXACTLY —
  // short docs included, with no push-down and no band.
  const REWRAP_DOC = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      `第${i + 1}段的很长中文内容，编辑器里占三行，\n在预览里因为更宽只折成两行，\n这就是重排漂移`)
      .join('\n\n');
  const REWRAP_BLOCK_H = 2 * LH; // 2 preview rows per 3 source lines
  const REWRAP_SPAN = 3; // source lines per paragraph (no internal blanks)
  const REWRAP_STRIDE = REWRAP_SPAN + 1; // paragraph + separating blank

  it('re-wrap drift: gap compensation lands every block on the editor line grid — aligned at any doc length, no band', () => {
    const utils = render(
      <MarkdownPreview content={REWRAP_DOC(1)} filePath="/tmp/note.md" vaultRoot="" onChange={() => {}} cursorLine={0} cursorViewportY={0} editorViewportTop={0} hasSelection={false} />,
    );
    scrollContainerEl = scrollEl(utils);

    // Type 4 paragraphs (3 editor lines + 1 blank each). Paragraph k's block
    // starts at source line (k−1)×4+1; the editor grid position of that line
    // is CONTENT_TOP + (line−1)×LH. After each step, the block must sit
    // EXACTLY there (RED pre-compensation: the natural stacking left each
    // paragraph 24px short per predecessor — only >1 page docs aligned).
    for (let k = 1; k <= 4; k++) {
      const content = REWRAP_DOC(k);
      const lastTextLine = k * REWRAP_STRIDE - 1; // e.g. 3, 7, 11, 15
      const blockLine = (k - 1) * REWRAP_STRIDE + 1; // data-source-line
      const blockOffsetY = (lastTextLine - blockLine) * LH;
      HEIGHTS.clear();
      for (let b = 0; b < k; b++) {
        HEIGHTS.set(b * REWRAP_STRIDE + 1, REWRAP_BLOCK_H);
      }
      act(() => {
        utils.rerender(
          <MarkdownPreview content={content} filePath="/tmp/note.md" vaultRoot="" onChange={() => {}} cursorLine={lastTextLine} cursorViewportY={EDITOR_PAD + (lastTextLine - 1) * LH} editorViewportTop={VIEWPORT_TOP} hasSelection={false} />,
        );
        useEditorViewStateStore.getState().setCursorViewportY(
          EDITOR_PAD + (lastTextLine - 1) * LH, VIEWPORT_TOP, 0, LH, 0, blockOffsetY, blockLine,
        );
      });
      // The block containing the cursor sits on the editor line grid: its
      // top = the editor position of the paragraph's first line.
      const blk = root(utils).querySelector(`[data-source-line="${blockLine}"]`) as HTMLElement;
      const desiredTop = CONTENT_TOP + (blockLine - 1) * LH;
      expect(Math.abs(blk.getBoundingClientRect().top - (VIEWPORT_TOP + desiredTop))).toBeLessThan(4);
      // No band, no scroll: alignment is pure geometry now.
      expect(transformY(utils)).toBe(0);
      expect(scrollEl(utils).scrollTop).toBe(0);
    }
    // The gaps absorbed the drift: each inter-block gap grew from the static
    // 1×LH (24) to 48 = 24 + the paragraph's 24px re-wrap shortfall.
    // (No trailing gap: the doc ends with text — zero trailing blanks.)
    const gaps = Array.from(root(utils).querySelectorAll(':scope > .md-blank-gap')) as HTMLElement[];
    expect(gaps.length).toBe(3);
    for (const g of gaps) expect(g.style.height).toBe('48px');

    cleanup();
  });

  // list → blank → capped code block → blank → paragraph: a 30-line fence
  // spans 32 editor lines (768px at LH=24) but renders capped at 420px. The
  // wrapper div must carry data-source-line so the grid loop sees it and the
  // planGapHeights code-block exemption applies — otherwise the gap before
  // the wrapper absorbs the whole ~348px shortfall as a giant blank band.
  const GAP_CODE_DOC = [
    '- item one',
    '- item two',
    '',
    '```',
    ...Array.from({ length: 30 }, (_, i) => `line ${i + 1}`),
    '```',
    '',
    'after the code block',
  ].join('\n');

  it('capped code block: both gaps keep their static 1-blank height (no giant blank band)', () => {
    const utils = render(
      <MarkdownPreview content={GAP_CODE_DOC} filePath="/tmp/note.md" vaultRoot="" onChange={() => {}} cursorLine={0} cursorViewportY={0} editorViewportTop={0} hasSelection={false} />,
    );
    scrollContainerEl = scrollEl(utils);
    HEIGHTS.clear();
    HEIGHTS.set(1, 2 * LH); // ul: 2 items, renders at the editor rate
    HEIGHTS.set(4, 420); // .code-block-wrapper: capped (source span is 32×24=768)
    HEIGHTS.set(37, LH); // paragraph
    act(() => {
      utils.rerender(
        <MarkdownPreview content={GAP_CODE_DOC} filePath="/tmp/note.md" vaultRoot="" onChange={() => {}} cursorLine={37} cursorViewportY={EDITOR_PAD + 36 * LH} editorViewportTop={VIEWPORT_TOP} hasSelection={false} />,
      );
      useEditorViewStateStore.getState().setCursorViewportY(EDITOR_PAD + 36 * LH, VIEWPORT_TOP, 0, LH, 0, 0, 37);
    });
    const gaps = Array.from(root(utils).querySelectorAll(':scope > .md-blank-gap')) as HTMLElement[];
    expect(gaps.length).toBe(2);
    // gap before the code wrapper (after the list) and gap after it: both
    // stay ≈ the static 1-blank height — the pre-fix run wrote ~792px into
    // the first gap (the reported 数百px 空白带).
    for (const g of gaps) {
      const h = gapHeightOf(g);
      expect(h).toBeGreaterThanOrEqual(8);
      expect(h).toBeLessThan(2 * LH);
    }

    cleanup();
  });

  it('leading blank lines: the first block pins onto the editor grid — aligned at the doc top (no clamp drift)', () => {
    // lines 1-2 blank, p1 at line 3, p2 at line 5. RED pre-fix: no leading
    // gap → p1 sat at content 16 while the cursor (line 3) was 2·LH deeper →
    // desiredRaw = −48 clamped at 0 → p1 48px ABOVE the cursor.
    const DOC = '\n\np1\n\np2';
    const utils = render(
      <MarkdownPreview content={DOC} filePath="/tmp/note.md" vaultRoot="" onChange={() => {}} cursorLine={0} cursorViewportY={0} editorViewportTop={0} hasSelection={false} />,
    );
    scrollContainerEl = scrollEl(utils);
    drive(utils, DOC, 3);
    expect(transformY(utils)).toBe(0);
    expect(scrollEl(utils).scrollTop).toBe(0);
    // p1's top sits at the editor grid position of line 3 = the cursor's
    // screen Y — aligned, not clamped.
    const p1 = root(utils).querySelector('[data-source-line="3"]') as HTMLElement;
    expect(Math.abs(p1.getBoundingClientRect().top - (VIEWPORT_TOP + EDITOR_PAD + 2 * LH))).toBeLessThan(4);

    cleanup();
  });

  it('frontmatter: the leading gap absorbs the SkillMetaCard so the first body block aligns', () => {
    // 3 frontmatter lines + SkillMetaCard (40px, shorter than 3·LH=72) +
    // body at line 4. The pin sizes the leading gap so the body block lands
    // on the editor grid (16 + 3·LH). RED pre-fix: no leading gap → block
    // top 56 vs cursor 88 → 32px off (desiredRaw clamped).
    const DOC = '---\nname: x\n---\nbody';
    const utils = render(
      <MarkdownPreview content={DOC} filePath="/tmp/note.md" vaultRoot="" onChange={() => {}} cursorLine={0} cursorViewportY={0} editorViewportTop={0} hasSelection={false} />,
    );
    scrollContainerEl = scrollEl(utils);
    drive(utils, DOC, 4, { cardH: 40 });
    expect(transformY(utils)).toBe(0);
    expect(scrollEl(utils).scrollTop).toBe(0);
    const body = root(utils).querySelector('[data-source-line="4"]') as HTMLElement;
    expect(Math.abs(body.getBoundingClientRect().top - (VIEWPORT_TOP + EDITOR_PAD + 3 * LH))).toBeLessThan(4);

    cleanup();
  });

  it('extension-rendered code fences carry data-source-line (cursor-sync target + grid exemption)', () => {
    // The map['pre'] renderer branch (mermaid/plantuml/…) used to DROP the
    // source line — those blocks had no alignment/highlight target.
    const DOC = 'p1\n\n```zzztestfence\na\nb\n```\n';
    const utils = render(
      <MarkdownPreview content={DOC} filePath="/tmp/note.md" vaultRoot="" onChange={() => {}} cursorLine={0} cursorViewportY={0} editorViewportTop={0} hasSelection={false} />,
    );
    const wrapper = root(utils).querySelector('.resizable-media') as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.getAttribute('data-source-line')).toBe('3');

    cleanup();
  });

  it('large-doc parse is debounced: keystrokes coalesce, the preview catches up after the pause', async () => {
    // > PARSE_DEBOUNCE_CHARS (6000): the first parse is immediate (mount),
    // but a content change is deferred — the OLD rendering stays until the
    // debounce fires (150ms), then the new text appears. Small docs (the
    // rest of this suite) parse per keystroke and stay synchronous.
    const BIG = 'x'.repeat(6001);
    const DOC1 = BIG + '\n\nold-marker';
    const DOC2 = BIG + '\n\nnew-marker';
    const utils = render(
      <MarkdownPreview content={DOC1} filePath="/tmp/note.md" vaultRoot="" onChange={() => {}} cursorLine={0} cursorViewportY={0} editorViewportTop={0} hasSelection={false} />,
    );
    scrollContainerEl = scrollEl(utils);
    // Immediate first parse: the marker block exists.
    const markerOf = () => root(utils).querySelector('[data-source-line="3"]')?.textContent ?? '';
    expect(markerOf()).toBe('old-marker');

    // A keystroke-equivalent rerender: the OLD parse is still shown (the
    // per-keystroke processSync is what lagged typing on long docs).
    act(() => {
      utils.rerender(
        <MarkdownPreview content={DOC2} filePath="/tmp/note.md" vaultRoot="" onChange={() => {}} cursorLine={0} cursorViewportY={0} editorViewportTop={0} hasSelection={false} />,
      );
    });
    expect(markerOf()).toBe('old-marker');

    // After the debounce window, the new parse lands.
    await waitFor(() => expect(markerOf()).toBe('new-marker'), { timeout: 1000 });

    cleanup();
  });
});
