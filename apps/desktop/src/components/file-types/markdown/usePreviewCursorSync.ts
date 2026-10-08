import { useEffect, useRef } from 'react';
import { codeBlockAlignPoint, codeBlockCloseLine } from './codeBlockAlign';
import { blockAlignPoint, blockLastSrcLine, blockRelativeOffsetY, containerAlignPoint, directiveCloseLine, gapAlignPoint, tableRowAnchor } from './blockAlignPoint';
import { useEditorViewStateStore } from '@/store/editorViewState';

/**
 * Find the next visible [data-source-line] block after `current` in DOM order,
 * for cursor-sync gap alignment + highlight. Mirrors the selection filter
 * (skip display:none and 0-height data-container wrappers) so the gap
 * aligns to a block the user actually sees. Returns the element, or null
 * if there is none (cursor on trailing EOF blanks). `current` itself is
 * excluded. Returns the ELEMENT only — its offset must be measured by the
 * caller AFTER the cursor-sync highlight swap (the swap changes layout:
 * an active code block re-caps, shifting everything below).
 */
function findNextBlockEl(root: HTMLElement, current: HTMLElement): HTMLElement | null {
  const blocks = Array.from(root.querySelectorAll('[data-source-line]')) as HTMLElement[];
  const startIdx = blocks.indexOf(current);
  for (let i = startIdx + 1; i < blocks.length; i++) {
    const el = blocks[i];
    // Same visibility model as the selection loop: no client rects = the
    // element itself or an ancestor is display:none (a hidden sibling
    // tab/slide's blocks must never be the gap's next block).
    if (el.getClientRects().length === 0) continue;
    if (el.hasAttribute('data-container') && el.offsetHeight === 0) continue;
    return el;
  }
  return null;
}

export interface PreviewCursorSyncParams {
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Live ref to the content the DOM currently shows (may lag the editor). */
  parseRef: React.MutableRefObject<string>;
  /** parsedContent re-triggers the sync effect once per actual re-parse. */
  parsedContent: string;
  cursorLine: number | undefined;
  cursorViewportY: number | undefined;
  editorViewportTop: number | undefined;
  hasSelection: boolean | undefined;
}

/**
 * ponytail: cursor-driven preview scroll (split mode only). When the
 * editor cursor moves, scroll the preview so the point in the matched
 * block that corresponds to the cursor line aligns to the same
 * vertical viewport position as the cursor. Both panes share the same
 * flex-row height. Scroll-sync (preview scroll -> editor) is NOT
 * implemented; only cursor -> preview. The effect never parses anything
 * itself — it re-runs on parsedContent, i.e. once per actual re-parse,
 * not per keystroke (see the deferred-parse effect in MarkdownPreview).
 */
export function usePreviewCursorSync({
  containerRef,
  parseRef,
  parsedContent,
  cursorLine,
  cursorViewportY,
  editorViewportTop,
  hasSelection,
}: PreviewCursorSyncParams) {
  // ponytail: editor line height lets headings center on the cursor LINE
  // center, not just its top (coordsAtPos gives the line top). Read from
  // the store directly so no new prop threads through PreviewProps.
  const editorLineHeight = useEditorViewStateStore((s) => s.editorLineHeight);
  const cursorLineFrac = useEditorViewStateStore((s) => s.cursorLineFrac);
  // ponytail: the cursor's MEASURED Y below its paragraph's first line
  // (wrap-exact — includes earlier lines' soft-wrap rows); the multi-line
  // align-point step. Read from the store directly like cursorLineFrac, no
  // prop threading.
  const cursorBlockOffsetY = useEditorViewStateStore((s) => s.cursorBlockOffsetY);
  // ponytail: the cursor's block MEASURED HEIGHT + last line — the
  // multi-line align-point's DENOMINATOR. The preview maps the cursor's
  // relative depth (offset / height) onto the preview block because the
  // two panes re-wrap the same paragraph at different widths: an absolute
  // editor-px offset has no valid scale in preview px.
  const cursorBlockHeight = useEditorViewStateStore((s) => s.cursorBlockHeight);
  const cursorBlockEndLine = useEditorViewStateStore((s) => s.cursorBlockEndLine);
  // ponytail: the editor-side line cursorBlockOffsetY is measured from (the
  // syntax-tree block's first line). The effect re-anchors the offset into
  // each target block's frame with it (blockRelativeOffsetY) — inside
  // ::::tabs / ::::carousel the anchor and the target block's first line
  // differ by the directive scaffolding lines between them.
  const cursorBlockLine = useEditorViewStateStore((s) => s.cursorBlockLine);
  // ponytail: the wrap-exact editor screen Y of the container line the pin
  // targets (editor-measured via lineBlockAt on request — see
  // setSyncTargetLine). The pin subtracts it from the cursor's screen Y
  // instead of line arithmetic, which missed soft-wrap rows and drifted the
  // container top a row per wrap (the reported 严重偏下).
  const syncTargetLine = useEditorViewStateStore((s) => s.syncTargetLine);
  const syncTargetScreenY = useEditorViewStateStore((s) => s.syncTargetScreenY);
  const syncTargetMeasuredLine = useEditorViewStateStore((s) => s.syncTargetMeasuredLine);

  const activeBlockRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (cursorLine == null || cursorLine <= 0) {
      // sync disabled (cursorSyncPreview off or left split mode) → drop the
      // highlight that the last active run stamped, so toggling off clears it.
      if (activeBlockRef.current) {
        activeBlockRef.current.classList.remove('cursor-sync-active');
        activeBlockRef.current = null;
      }
      return;
    }
    if (hasSelection) return;
    const root = containerRef.current;
    if (!root) return;
    const blocks = root.querySelectorAll('[data-source-line]');
    if (blocks.length === 0) return;
    let target: Element | null = null;
    let bestLine = 0;
    for (const el of blocks) {
      const raw = el.getAttribute('data-source-line');
      if (raw == null) continue;
      const line = Number(raw);
      if (!Number.isFinite(line)) continue;
      // Skip blocks that render hidden OR collapse to 0 height.
      // - getClientRects() === []: the element generates NO boxes — either
      //   itself display:none OR any display:none ANCESTOR (the hidden
      //   :::tab/:::slide wrappers). getComputedStyle(el).display can't
      //   catch the ancestor case — display isn't inherited, so a <p> inside
      //   display:none computes display:block while rendering nothing.
      //   Selecting such a block (a hidden sibling's paragraph — the
      //   greatest line ≤ cursorLine once the cursor is in the hidden
      //   child) aligned to its ZERO rect and shoved the whole preview
      //   down via the sync-offset transform (the reported 严重向下偏移;
      //   the old unconditional promote-to-container papered over it).
      // - offsetHeight===0 on a [data-container] wrapper: the `:::slide` /
      //   `:::tab` DirectiveWrapper div itself is NOT display:none (so the
      //   box check above misses it — it generates a 0×W box), but its only
      //   child (the component's data-is-slide/data-is-tab root) is
      //   display:none → the wrapper has 0 height. Selecting it lands the
      //   cursor on a 0-height block → line-proportional interpolation
      //   drifts. Skipping it falls back to the visible `carousel`/`tabs`
      //   parent (promoted below).
      if (el.getClientRects().length === 0) continue;
      if (el.hasAttribute('data-container') && (el as HTMLElement).offsetHeight === 0) continue;
      if (line <= cursorLine && line >= bestLine) {
        bestLine = line;
        target = el;
      }
    }
    const scrollContainer = root.parentElement;
    if (!scrollContainer) return;
    if (!target) {
      scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    // A show-one-at-a-time container (tabs / carousel). Two cursor kinds:
    // (a) the cursor's line maps to the ACTIVE child's visible content —
    // keep the block and align it directly, exactly like a block outside a
    // container (paragraph pin / code / table paths below); (b) the cursor's
    // line has no visible counterpart — directive scaffolding, a hidden
    // sibling's lines, a blank between children — promote to the container
    // wrapper and PIN it (the data-hides-inactive branch below). The old
    // unconditional promotion top-aligned the container to the cursor's
    // line, dragging the whole preview down as the cursor descended (the
    // reported 只有首行对齐 / 预览整体偏下). Keep the target only when it
    // is a content block (NOT a directive wrapper) whose source span
    // reaches the cursor's line, or when the gap's next visible block is
    // still inside this container (an in-child blank advances to the next
    // paragraph via the gap path). Driven by the declaration
    // (data-hides-inactive), not names.
    const srcLines = parseRef.current.split('\n');
    const containerWrap = (target as HTMLElement).closest('[data-hides-inactive][data-source-line]');
    if (containerWrap && target !== containerWrap) {
      const tLine = Number(target.getAttribute('data-source-line'));
      const tIsCode = target.tagName === 'PRE' && target.closest('.code-block-wrapper') != null;
      // A raw-tag block's span comes from data-raw-line-span — the blank-run
      // scanner stops at the region's FIRST internal blank line (same root
      // cause as the main lastSrcLine below).
      const tRawSpan = Number(target.getAttribute('data-raw-line-span'));
      const tClose = tIsCode
        ? codeBlockCloseLine(srcLines, tLine)
        : Number.isFinite(tRawSpan) && tRawSpan >= 1
          ? tLine + tRawSpan - 1
          : blockLastSrcLine(srcLines, tLine);
      const covered = !target.hasAttribute('data-container') && cursorLine <= tClose;
      let nextInside = false;
      if (!covered && cursorLine > tClose) {
        const next = findNextBlockEl(root, target as HTMLElement);
        nextInside = next != null && containerWrap.contains(next);
      }
      if (!covered && !nextInside) target = containerWrap;
    }
    const el = target as HTMLElement;
    const blockSrcLine = Number(el.getAttribute('data-source-line'));

    // ponytail: when the cursor sits on a blank line below the selected block
    // (the gap between this block and the next), blank lines render no preview
    // height, so the in-block align functions can't place the cursor. Align to
    // the NEXT block's top instead — the preview advances to the content that
    // follows the cursor's blank line (the cursor is on the separator before
    // the next block), so the preview visibly tracks the cursor instead of
    // clamping to the current block bottom and drifting one line per blank
    // line. If there is no next block (cursor on trailing blanks at EOF),
    // stay on the current block bottom — nothing below to advance to.
    // Covers every block kind (paragraph/heading/list, code, container) so the
    // gap is handled once, in one place, with the live DOM (no editor line
    // height needed — editor vs preview line heights differ, and a guessed
    // value drifted).
    const isCodeBlock = el.tagName === 'PRE' && el.closest('.code-block-wrapper');
    // p.md-raw-tag-block carries its source-line span: the blank-run scanner
    // below stops at the region's FIRST internal blank line, so a cursor
    // anywhere past it misdetected as a gap and jumped the preview past the
    // whole region (the reported 标签预览光标对齐效果很不好). The span is
    // exact — one line per source line, blank lines included.
    const rawSpan = Number(el.getAttribute('data-raw-line-span'));
    const isRawTagBlock = Number.isFinite(rawSpan) && rawSpan >= 1;
    const lastSrcLine = isRawTagBlock
      ? blockSrcLine + rawSpan - 1
      : el.hasAttribute('data-container')
      ? directiveCloseLine(srcLines, blockSrcLine) // a directive block's span = open..closing fence (inner ::: fences don't close it)
      : isCodeBlock
        ? codeBlockCloseLine(srcLines, blockSrcLine) // closing fence: cursor on/after it is the gap
        : blockLastSrcLine(srcLines, blockSrcLine);
    const inGap = cursorLine > lastSrcLine;
    const nextBlockEl = inGap ? findNextBlockEl(root, el) : null;

    // The highlight target: when in a gap with a next block, highlight the
    // NEXT block (the content the cursor is about to enter / the separator
    // sits before it), not the block above the blank line — otherwise the
    // .cursor-sync-active highlight stayed on the previous block after a
    // line break while the user typed into the new one. When the cursor sits
    // on TRAILING blank lines at EOF (in a gap with NO next block), clear the
    // highlight — the cursor is past all content, no block corresponds to
    // it, and keeping the highlight on the last block left it stuck ABOVE
    // the cursor (the reported "光标所在的行没有对齐高亮" / "高亮块在光标
    // 上方"). For short content the preview also can't scroll the block down
    // to the cursor (desired clamps to 0), so the highlight-above drift was
    // unavoidable with a block highlight — clearing it is the honest fix.
    // NOTE: `nextBlockEl` is non-null ONLY when inGap (findNextBlockEl runs
    // in the gap branch); when not in a gap (cursor inside a block) it is
    // null, so the fallback must be the current block `el` — not null — or
    // the normal in-block highlight gets cleared too.
    const highlightEl = inGap ? (nextBlockEl ?? null) : el;
    // ponytail: swap the highlight BEFORE measuring any rect. The swap
    // changes layout: the ACTIVE code block is uncapped (CSS
    // .code-block-wrapper:has(.cursor-sync-active) → max-height:none), so
    // when the cursor LEAVES it the block re-caps and everything below
    // shifts up by hundreds of px — a rect measured before the swap is
    // stale by exactly that amount, and the scroll overshot, landing the
    // new block ABOVE the cursor (the reported 从代码块移到段落预览偏上).
    // (And entering a code block uncaps it — the block's own rect must be
    // the post-swap full height too.) Measuring after the swap reads the
    // final layout; the paragraph highlight itself is layout-neutral
    // (background only).
    const blockChanged = activeBlockRef.current !== highlightEl;
    if (blockChanged) {
      activeBlockRef.current?.classList.remove('cursor-sync-active');
      activeBlockRef.current = highlightEl;
      highlightEl?.classList.add('cursor-sync-active');
    }

    // Align the preview block to the cursor's screen position (measured in
    // the post-swap layout).
    const containerRect = scrollContainer.getBoundingClientRect();
    const blockRect = el.getBoundingClientRect();
    // Cancel nothing: no transform exists (see the desiredRaw comment
    // below) — rects are already in un-transformed content space.
    const blockOffset = blockRect.top - containerRect.top + scrollContainer.scrollTop;
    const blockHeight = blockRect.height;
    const blockBottom = blockOffset + blockHeight;
    // The next block's top, also un-transformed (mirrors blockOffset).
    const nextBlockOffset = nextBlockEl
      ? nextBlockEl.getBoundingClientRect().top - containerRect.top + scrollContainer.scrollTop
      : null;

    // Where the cursor line top sits on screen (editor frame) — the align
    // target: the scroll puts the preview's align point at this screen Y
    // (both panes' scroll containers share the viewport top in split mode).
    const cursorScreenY = (editorViewportTop ?? 0) + (cursorViewportY ?? 0);
    // The editor-side line cursorBlockOffsetY is measured from (0/unknown →
    // the cursor's own line, making the re-anchoring below a no-op).
    const anchorLine = cursorBlockLine > 0 ? cursorBlockLine : cursorLine;
    // The wrap-exact screen Y of the pin target's first line, when the
    // editor has measured it for THIS container (stale-guard: measured for a
    // different line → not trustworthy → null → line-arithmetic fallback).
    const targetLineY =
      syncTargetMeasuredLine === blockSrcLine && syncTargetScreenY > 0 ? syncTargetScreenY : null;
    let alignPoint: number;
    if (inGap) {
      // EOF trailing blanks: no next block exists, so the align point has
      // no rendered target — extend into the virtual trailing region at the
      // EDITOR's line rate (the same rate .md-blank-gap renders between
      // blocks) so the cursor's blank line exists in preview content space.
      // The base is the block's EDITOR-RATE bottom: the rendered bottom
      // extended by the block's own shortfall (its source-line span ×
      // editorLH − rendered height — a re-wrapped paragraph renders fewer
      // rows than the editor; its gap compensation below only benefits the
      // NEXT block, so the virtual EOF region must start where the editor's
      // block ends, not where the shorter preview rendering ends).
      // Clamping to the rendered bottom left desiredRaw negative by
      // K×lineHeight → the old syncOffset transform pushed the whole
      // preview down — the blank band at the preview top + per-keystroke
      // bounce (the reported 新建文件输入闪动 + 头部大片空白). The
      // trailing .md-blank-gap div (rehypeBlankGap) extends the scroll
      // height so the scroll can actually reach the extension.
      const lh = editorLineHeight > 0 ? editorLineHeight : 0;
      const span = lastSrcLine - blockSrcLine + 1;
      const eofSteps = nextBlockOffset == null
        ? Math.max(0, cursorLine - lastSrcLine - 1)
        : 0;
      const gapBase = nextBlockOffset == null
        ? blockBottom + Math.max(0, span * lh - blockHeight)
        : blockBottom; // unused when a next block exists (gapAlignPoint takes it)
      alignPoint = gapAlignPoint(gapBase, nextBlockOffset) + eofSteps * lh;
    } else if (isCodeBlock) {
      const codeEl = el.querySelector('code');
      const padTop = codeEl ? parseFloat(getComputedStyle(codeEl).paddingTop) || 0 : 0;
      alignPoint = codeBlockAlignPoint(srcLines, blockSrcLine, cursorLine, blockOffset, blockHeight, padTop);
    } else if (el.tagName === 'TABLE') {
      // Tables render one <tr> per source line, but the |---| separator
      // line renders as the thead/tbody border (~0 height) and cell
      // padding makes rows taller than editor lines. Neither the
      // editor-line step (pins the table top → rows drift below the
      // cursor, growing per row: the reported "表格预览偏下") nor a
      // height fraction (mis-maps the separator) fits — map the cursor's
      // source line to its MEASURED row top in the live DOM instead:
      // header line → thead row 0; separator → thead bottom (the border
      // it renders as); body line K → tbody row K-3's top. A row index
      // past the rendered rows (content directly after the table with no
      // blank line, counted into the span by blockLastSrcLine) falls back
      // to the table bottom.
      const table = el as HTMLTableElement;
      const anchor = tableRowAnchor(cursorLine - blockSrcLine);
      let anchorEl: Element | null = null;
      let useBottom = false;
      if (anchor.kind === 'thead-row') {
        anchorEl = table.tHead?.rows[0] ?? null;
      } else if (anchor.kind === 'thead-bottom') {
        anchorEl = table.tHead;
        useBottom = true;
      } else {
        const tbody = table.tBodies[0];
        anchorEl = tbody ? (tbody.rows[anchor.index] ?? null) : null;
      }
      if (anchorEl) {
        const ar = anchorEl.getBoundingClientRect();
        alignPoint =
          ar.top - containerRect.top + scrollContainer.scrollTop +
          (useBottom ? ar.height : 0);
      } else {
        alignPoint = anchor.kind === 'tbody-row' ? blockBottom : blockOffset;
      }
    } else if (el.hasAttribute('data-hides-inactive')) {
      // A show-one-at-a-time container (carousel/tabs) with the cursor on a
      // line its visible content doesn't map to (scaffolding / hidden
      // sibling / blank between children): only ONE child renders, so there
      // is no per-line pixel map — PIN the container top to the editor
      // position of its first line: the cursor's screen Y minus the editor's
      // wrap-exact screen Y of that line (measured via the syncTarget
      // feedback channel — line arithmetic missed soft-wrap rows and drifted
      // the container a row per wrap: the reported 严重偏下; it accumulates
      // across paragraph boundaries when the container has internal blanks).
      // Falls back to the line-arithmetic re-anchor for the first move into
      // a container (the measurement lands on the next cursor update).
      // Top-aligning the container to the cursor's line instead dragged the
      // whole preview down as the cursor descended (the original 预览整体
      // 偏下); the pin keeps the container glued to the editor's ::::tabs
      // line while the cursor walks the container's lines (mirrors the
      // paragraph pin: the pane doesn't move).
      // Request the measurement for THIS container (idempotent — the store
      // write only re-renders selectors that read these fields).
      if (syncTargetLine !== blockSrcLine) {
        useEditorViewStateStore.getState().setSyncTargetLine(blockSrcLine);
      }
      const rel = targetLineY != null ? cursorScreenY - targetLineY : blockRelativeOffsetY(cursorBlockOffsetY, anchorLine, blockSrcLine, editorLineHeight ?? 0);
      alignPoint = containerAlignPoint(blockOffset, rel, cursorScreenY - containerRect.top);
    } else if (isRawTagBlock) {
      // The CSS line-height pin (.md-preview .md-raw-tag-block) renders ONE
      // line height per source line (brs + blank lines included), so the
      // mapping is per-line EXACT — no editor metrics (the editor's markdown
      // parser is raw-tag-blind, so its blank-delimited block fraction
      // mis-maps the region). Step = blockHeight / span ≈ the pinned line
      // height; clamped to the last line (cursor on the close-tag line and
      // below ride at the block bottom). inGap is false here by construction
      // (lastSrcLine already covers the whole region).
      alignPoint = blockOffset +
        Math.min(Math.max(0, cursorLine - blockSrcLine), rawSpan - 1) * (blockHeight / rawSpan);
    } else {
      // Non-code block: headings center on the cursor line (block center,
      // so the highlight box is symmetric around the cursor instead of
      // top-aligned with the box hanging below); list items top-align to
      // the cursor line (one line each, independent — the whole <ul> is
      // no longer treated as one block); multi-line blocks map the
      // cursor's RELATIVE depth in its editor block (offset / height,
      // both wrap-exact editor measurements) proportionally onto the
      // preview block — first line pins the tops together, last line
      // rides at the block bottom, middle lands at the matching relative
      // place, so the text at the cursor's screen height corresponds to
      // the cursor's line even when the panes re-wrap differently (the
      // old absolute-px step had no valid scale and drifted — the
      // reported 没完全对齐 on long paragraphs). A single source line
      // that renders tall tracks the cursor's soft-wrap fraction.
      //
      // Both editor metrics are re-anchored into THIS block's frame first:
      // the editor parser is directive-blind, so inside ::::tabs / ::::carousel
      // its paragraph run starts ABOVE the preview block's first line
      // (scaffolding — subtract via blockRelativeOffsetY) and ends BELOW
      // the preview block's span (fences + hidden siblings — subtract at
      // one editor line height per line, so the fraction's denominator
      // matches the preview block's own line range). Outside containers
      // both corrections are 0.
      const relOffsetY = blockRelativeOffsetY(cursorBlockOffsetY, anchorLine, blockSrcLine, editorLineHeight ?? 0);
      const belowScaffolding = cursorBlockEndLine > 0
        ? Math.max(0, cursorBlockEndLine - lastSrcLine) * (editorLineHeight ?? 0)
        : 0;
      const relHeight = Math.max(0,
        blockRelativeOffsetY(cursorBlockHeight, anchorLine, blockSrcLine, editorLineHeight ?? 0) - belowScaffolding);
      alignPoint = blockAlignPoint(
        el.tagName, srcLines, blockSrcLine, blockOffset, blockHeight, cursorLineFrac,
        relOffsetY,
        relHeight,
      );
    }

    // After setting scrollTop=desired, the align point appears at
    // screen y = containerRect.top + (alignPoint - desired).
    // For headings (cursor on the heading line, not in a gap below it), align
    // the block CENTER to the cursor LINE center (cursorScreenY +
    // editorLineHeight/2) so the highlight is symmetric around the cursor
    // line; coordsAtPos gives the line top, so half the editor line height
    // offsets to the line center. The gap path aligns the NEXT block's TOP
    // to the cursor line top (not center), so it must not apply the heading
    // center offset. Other blocks align to the line top.
    const headingCenter = !inGap && /^H[1-6]$/.test(el.tagName);
    const targetY = headingCenter ? cursorScreenY + (editorLineHeight ?? 0) / 2 : cursorScreenY;
    // Raw align target: the content offset that should land at the cursor's
    // screen Y. scrollTop = desired scrolls the preview so the block aligns
    // to the cursor. desiredRaw < 0 means the preview content above the
    // cursor is SHORTER than the editor's (re-wrapped CJK paragraphs render
    // fewer rows in the wider preview; a bigger editor font; capped code
    // blocks) — geometry scrollTop cannot fix (it can't go below 0). Degrade
    // gracefully: clamp to 0 and let the highlight ride above the cursor.
    // The old fallback pushed the whole preview down via a translateY
    // transform, but that traded the misalignment for a blank band at the
    // preview top that GREW as the drift accumulated (the reported
    // 预览页为了对齐不断下移/头部大片空白) — alignment-by-blank-band is
    // rejected; a short doc simply sits at its natural top.
    const desiredRaw = alignPoint - (targetY - containerRect.top);
    const desired = Math.max(0, desiredRaw);
    if (Math.abs(scrollContainer.scrollTop - desired) > 2) {
      scrollContainer.scrollTop = desired;
    }
  }, [cursorLine, cursorViewportY, editorViewportTop, hasSelection, editorLineHeight, cursorLineFrac, cursorBlockOffsetY, cursorBlockLine, cursorBlockHeight, cursorBlockEndLine, syncTargetLine, syncTargetScreenY, syncTargetMeasuredLine, parsedContent, containerRef, parseRef]);

  // Clean up the active-block marker on unmount.
  useEffect(() => {
    return () => activeBlockRef.current?.classList.remove('cursor-sync-active');
  }, []);
}
