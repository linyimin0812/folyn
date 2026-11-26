import { useMemo, useRef, useEffect, useLayoutEffect, useCallback, useState, createElement, Fragment } from 'react';
import { VaultContext } from '@folyn/container-extensions';
import { getHandlerByExtension, getHandlerById, getModeComponent } from "@/components/file-types/registry";
import { readFileByRoute } from '@/services/editorIoService';
import { useEditorViewStateStore } from '@/store/editorViewState';
import { FileIcon } from '@/components/icons/FileIcon';
import { planGapHeights } from './gapCompensation';
import { parseFrontmatter, SkillMetaCard } from './frontmatter';
import { buildPreviewComponentMap } from './previewComponentMap';
import { usePreviewCursorSync } from './usePreviewCursorSync';
import { installPreviewWordSelection } from './previewWordSelection';
import { chunkMarkdown } from './chunkMarkdown';
import { renderMarkdownBody } from './markdownPipeline';
import { LinkPreviewPopover } from './LinkPreviewPopover';
import { useWindowedChunks, CHUNK_ESTIMATE_LINE_HEIGHT } from './useWindowedChunks';
import type { PreviewProps } from '../types';

// ponytail: P2 — large-doc parse debounce knobs. Docs above
// PARSE_DEBOUNCE_CHARS re-parse at most every PARSE_DEBOUNCE_MS after the
// last keystroke, never stalling longer than PARSE_MAX_WAIT_MS during a
// continuous typing burst. Below the threshold, per-keystroke parsing is
// cheap and stays instant.
const PARSE_DEBOUNCE_CHARS = 6_000;
const PARSE_DEBOUNCE_MS = 150;
const PARSE_MAX_WAIT_MS = 500;

// ponytail: chunked-rendering thresholds (the markdown-open-lag fix).
// Documents at or below BOTH limits render exactly as before (single
// pipeline pass, identical DOM). Above them the body is split into
// blank-line chunks (chunkMarkdown) and only the chunks near the viewport
// are mounted; the rest render as height-estimated spacers. Chunking kicks
// in only for genuinely large docs — where the cost of a full parse +
// reconcile of ~100KB+ of markdown dominates first-open latency.
const CHUNKED_MAX_CHUNKS = 200;
const CHUNKED_MIN_CHARS = 100_000;

export interface MarkdownPreviewProps extends PreviewProps {
  /**
   * ponytail: render the whole document even above the chunked threshold.
   * The export service (innerHTML extraction) and presentation mode need
   * the complete DOM in one pass; live preview panes default to windowed
   * chunked rendering for large docs. Untouched call sites keep the
   * historical full render only while their docs stay under the thresholds.
   */
  fullRender?: boolean;
}

export function MarkdownPreview({
  content,
  filePath,
  vaultRoot,
  onChange,
  cursorLine,
  cursorViewportY,
  editorViewportTop,
  hasSelection,
  fullRender = false,
}: MarkdownPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [resolvedVaultRoot, setResolvedVaultRoot] = useState('');
  const [assetBase, setAssetBase] = useState('');
  // ponytail: editor line height lets headings center on the cursor LINE
  // center, not just its top (coordsAtPos gives the line top). Read from
  // the store directly so no new prop threads through PreviewProps.
  const editorLineHeight = useEditorViewStateStore((s) => s.editorLineHeight);
  // ponytail: the editor's line-1 phase in content space (cm-content
  // padding-top) — the gap-compensation grid's absolute origin. With it,
  // leading blank lines / frontmatter lines render as a leading gap and
  // block 0 pins onto the editor's line grid, so doc tops align instead of
  // clamping desiredRaw at 0 (the reported 短文档/文档顶部对不齐).
  const editorContentPadTop = useEditorViewStateStore((s) => s.editorContentPadTop);

  // ponytail: P2 — deferred markdown parse for LARGE docs. Per-keystroke
  // processSync + a full React reconcile of the preview tree is what made
  // typing lag on long docs; small docs (< PARSE_DEBOUNCE_CHARS) parse per
  // keystroke (cheap, keeps the preview instantly live). Large docs:
  // trailing debounce (150ms after the last edit) capped by a max wait
  // (500ms — a long typing burst still updates ~2×/sec instead of stalling
  // indefinitely). Tab switches / different files parse immediately — never
  // flash the previous doc while a debounce window runs. parsedContent is
  // what the DOM shows, so the cursor-sync effect and its srcLines read it
  // (not the live content, which can be a few keystrokes ahead).
  const [parsedState, setParsedContent] = useState(content);
  // Another file: show its content in this same render instead of after an
  // effect, so a tab switch parses once rather than old text, then new text.
  const [parsedPath, setParsedPath] = useState(filePath);
  const switchedFile = filePath !== parsedPath;
  if (switchedFile) {
    setParsedPath(filePath);
    setParsedContent(content);
  }
  const parsedContent = switchedFile ? content : parsedState;
  const parseRef = useRef(parsedContent);
  parseRef.current = parsedContent;
  const pendingSinceRef = useRef(0);
  useEffect(() => {
    if (content === parsedContent) {
      pendingSinceRef.current = 0;
      return;
    }
    if (content.length <= PARSE_DEBOUNCE_CHARS) {
      pendingSinceRef.current = 0;
      setParsedContent(content);
      return;
    }
    const now = Date.now();
    if (!pendingSinceRef.current) pendingSinceRef.current = now;
    const wait = Math.max(0, Math.min(
      PARSE_DEBOUNCE_MS,
      PARSE_MAX_WAIT_MS - (now - pendingSinceRef.current),
    ));
    const t = setTimeout(() => {
      pendingSinceRef.current = 0;
      setParsedContent(content);
    }, wait);
    return () => clearTimeout(t);
  }, [content, parsedContent]);

  // Parse frontmatter early — the chunking + cursor-sync wiring below
  // needs body/frontmatterLineCount, and the directive wrappers stamp
  // frontmatter-offset-adjusted `data-source-line` with it (matches
  // rehypeSourceLine's offset, so cursor sync lines up).
  const { meta, body, frontmatterLineCount } = useMemo(() => parseFrontmatter(parsedContent), [parsedContent]);

  // ponytail: split the body into blank-line chunks and window-mount them.
  // chunkMarkdown is a cheap O(lines) line scan — safe to run on every
  // debounced parse (it is also what decides useChunked, so it always runs).
  const chunkDoc = useMemo(() => chunkMarkdown(body), [body]);
  const chunks = chunkDoc.chunks;
  const docTotalLines = useMemo(() => parsedContent.split('\n').length, [parsedContent]);
  // Link reference definitions ([label]: /url) resolve DOCUMENT-WIDE in
  // CommonMark — a usage in one chunk could reference a definition living
  // in a far-away chunk, and the per-chunk parse can't see it (the shortcut
  // link would render as literal text instead of a link). Reference-def
  // docs are rare; the conservative Phase A call is to keep them on the
  // full render (the chunker reports the flag for exactly this).
  const useChunked = !fullRender
    && !chunkDoc.hasReferenceDefinitions
    && chunks.length > CHUNKED_MAX_CHUNKS
    && body.length > CHUNKED_MIN_CHARS;

  const windowed = useWindowedChunks({
    enabled: useChunked,
    chunks,
    containerRef,
    frontmatterLineCount,
    lineHeight: editorLineHeight,
  });

  // ponytail: content/onChange change every keystroke. componentMap below
  // used to close over them, which forced a full map rebuild + unified re-parse
  // + VaultContext value churn on each character — every :::file-preview block
  // re-fetched and re-mounted. Refs let the pre wrapper read live values
  // without being a closure dependency of the memoized componentMap.
  const contentRef = useRef(content);
  contentRef.current = content;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!vaultRoot) return;
    import('@tauri-apps/api/path').then(({ homeDir, join }) => {
      if (vaultRoot.startsWith('~')) {
        homeDir().then((h) => join(h, vaultRoot.slice(2))).then(setResolvedVaultRoot);
      } else {
        setResolvedVaultRoot(vaultRoot);
      }
    });
  }, [vaultRoot]);

  // ponytail: precompute the directory that relative asset references
  // (e.g. `![](pic.png)`) should resolve against. For vault files this is
  // `<vaultRoot>/<fileDir>` (legacy); for EXTERNAL files it's the file's own
  // directory — so images embedded next to an external markdown file load.
  useEffect(() => {
    let cancelled = false;
    import('../previewPath').then(({ resolveAssetBase }) =>
      resolveAssetBase(filePath, vaultRoot).then((base) => {
        if (!cancelled) setAssetBase(base.replace(/\/+$/, ''));
      }),
    );
    return () => { cancelled = true; };
  }, [filePath, vaultRoot]);

  const renderFile = useCallback((path: string, content: string) => {
    const ext = path.toLowerCase().match(/\.([^.]+)$/)?.[1] || '';
    const handler = ext ? getHandlerByExtension(ext) : undefined;
    // ponytail: only fall back to code viewer when no handler matched (unknown
    // ext). A matched handler with no Preview (e.g. rich-text .richtext) returns null
    // so FilePreviewExtension shows its "暂无预览" UI instead of dumping the raw
    // disk JSON as code.
    const Preview = getModeComponent(handler, 'preview') ?? (handler ? null : getModeComponent(getHandlerById('code'), 'preview'));
    if (!Preview) return null;
    // ponytail: no recursion-depth guard — a markdown file that embeds itself
    // via :::file-preview will stack-overflow. Add a depth counter if it bites.
    return createElement(Preview, { content, filePath: path, vaultRoot: resolvedVaultRoot });
  }, [resolvedVaultRoot]);

  const openFile = useCallback((path: string) => {
    const name = path.substring(path.lastIndexOf('/') + 1) || path;
    void import('@/services/editorIoService').then(({ openFile: open }) => open(path, name));
  }, []);

  const componentMap = useMemo(() => {
    return buildPreviewComponentMap({ filePath, assetBase, contentRef, onChangeRef, frontmatterLineCount });
  }, [filePath, vaultRoot, resolvedVaultRoot, assetBase, frontmatterLineCount]);

  // ponytail: blank-line gaps exist ONLY for cursor-sync alignment — they make
  // the preview descend at the editor's line rate past blank lines so the
  // synced block tracks the cursor. When sync is off (preview-only reading,
  // or split with sync toggled off, cursorLine===0) the gaps are pure noise,
  // so the gap plugin is skipped and the preview reads like normal markdown.
  // syncActive is a primitive boolean — it flips only on the sync on/off
  // transition, NOT on every cursor move (once sync is on, cursorLine stays
  // ≥1), so this does not re-parse per keystroke or per cursor move; only
  // one re-parse when the user toggles sync.
  const syncActive = (cursorLine ?? 0) > 0;

  // ponytail: full-document render — the exact pipeline that used to live
  // inline here, now shared with the chunked path (markdownPipeline.ts) so
  // the two can never diverge. Below the chunked thresholds this is the ONLY
  // render path — DOM identical to the historical behavior.
  const reactContent = useMemo(() => {
    if (useChunked) return null;
    return renderMarkdownBody(body, {
      componentMap,
      sourceLineOffset: frontmatterLineCount,
      blankGap: syncActive
        ? { offset: frontmatterLineCount, totalLines: parsedContent.split('\n').length }
        : undefined,
    });
  }, [useChunked, body, componentMap, frontmatterLineCount, syncActive, parsedContent]);

  // ponytail: chunked rendering (A2/A5) — each chunk is padded with
  // (startLine − 1) newlines so the parser's line positions are
  // BODY-absolute, then run through the SAME pipeline with offset 0 → the
  // stamped data-source-line values are doc-absolute and identical to a
  // full render of the same doc (no post-hoc DOM stamping pass).
  //
  // Per-chunk blank-gap config: a chunk's LEADING gap = the blank lines
  // since the previous chunk's last content line — expressed as
  // offset = −prevEnd (chunk 0: frontmatterLineCount, so its leading gap
  // also covers the frontmatter lines above the body). Inter-block gaps
  // are offset-invariant. Only the LAST chunk gets totalLines (the EOF
  // gap), computed against the doc total like the full render's.
  //
  // A5: the cache is keyed by render-affecting inputs (component-map
  // inputs, frontmatter, sync mode, gap config, startLine) with the chunk
  // text stored in the entry for verification. Each pass rebuilds the map
  // with only the current chunks' entries (stale entries drop out — no
  // unbounded growth), so typing re-renders only the chunks whose text or
  // line position changed — the tail-below-the-edit case.
  const chunkCacheRef = useRef<Map<string, { text: string; el: React.ReactElement }>>(new Map());
  const mapCacheKey = `${filePath}|${resolvedVaultRoot}|${assetBase}|${vaultRoot}`;
  const mountedChunkEls = useMemo(() => {
    const els = new Map<number, React.ReactElement>();
    if (!useChunked) return els;
    const prevCache = chunkCacheRef.current;
    const nextCache = new Map<string, { text: string; el: React.ReactElement }>();
    for (const i of windowed.mounted) {
      const c = chunks[i];
      if (!c) continue;
      const isLast = i === chunks.length - 1;
      const prevEnd = i === 0 ? 0 : chunks[i - 1].startLine + chunks[i - 1].lineCount - 1;
      const gapOffset = i === 0 ? frontmatterLineCount : -prevEnd;
      const totalLines = isLast
        ? Math.max(0, docTotalLines - frontmatterLineCount - (i === 0 ? 0 : prevEnd))
        : undefined;
      const key = `${mapCacheKey}|${frontmatterLineCount}|${syncActive}|${gapOffset}|${totalLines ?? ''}|${c.startLine}`;
      let entry = prevCache.get(key);
      if (!entry || entry.text !== c.text) {
        entry = {
          text: c.text,
          el: renderMarkdownBody('\n'.repeat(c.startLine - 1) + c.text, {
            componentMap,
            sourceLineOffset: frontmatterLineCount,
            blankGap: syncActive ? { offset: gapOffset, totalLines } : undefined,
          }),
        };
      }
      nextCache.set(key, entry);
      els.set(i, entry.el);
    }
    chunkCacheRef.current = nextCache;
    return els;
  }, [useChunked, windowed.mounted, chunks, componentMap, frontmatterLineCount, syncActive, docTotalLines, mapCacheKey]);

  // ponytail: unmounted chunks render as height-estimated spacers — sized
  // from the measured height of the chunk's last mount (leading gap
  // included) when available, else from editor-line arithmetic. The height
  // cache is identity-keyed (startLine + text), so typing elsewhere leaves
  // these measurements intact (no per-flush reset to estimates).
  const spacerHeight = useCallback((i: number): number => {
    const measured = windowed.measuredHeight(i);
    if (measured != null && measured > 0) return measured;
    const c = chunks[i];
    const lh = editorLineHeight > 0 ? editorLineHeight : CHUNK_ESTIMATE_LINE_HEIGHT;
    const prevEnd = i === 0 ? 0 : chunks[i - 1].startLine + chunks[i - 1].lineCount - 1;
    const leadingGapLines = i === 0
      ? c.startLine - 1 + frontmatterLineCount
      : c.startLine - prevEnd - 1;
    return Math.max(8, (leadingGapLines + c.lineCount) * lh + 16);
  }, [chunks, windowed, editorLineHeight, frontmatterLineCount]);

  // ponytail: runtime blank-gap compensation — the last piece of the
  // "preview descends at the editor's rate" design. rehypeBlankGap sizes
  // gap divs statically (blank lines × editor line height), which is exact
  // only when every block renders at the editor's per-line rate. Blocks
  // that render SHORTER (long CJK paragraphs re-wrap to fewer rows in the
  // wider preview; a bigger editor font; capped code blocks) leave the
  // preview falling behind the editor's descent rate, and the shortfall
  // ACCUMULATES down the doc — that is why short docs sat unaligned (only
  // >1-page docs aligned: 只有超过一页才对齐) and why the old transform
  // push-down grew a blank band at the top. Fix the geometry instead:
  // measure each top-level block and re-size the gap div BEFORE the next
  // block so every block lands on the editor's line grid. The grid is
  // ABSOLUTE when the editor publishes its line-1 phase (editorContentPadTop
  // — grid.top + (line−1)·editorLineHeight): the leading blank / frontmatter
  // gap renders above block 0 and gets pinned so the FIRST block also sits
  // on the grid (doc tops + short docs with leading blanks align); without
  // the phase (not yet measured) it falls back to the relative grid (first
  // block's measured top as origin). Then the cursor-sync desiredRaw stays
  // ≈ 0 at any doc length: scrollTop 0, every block aligned to its editor
  // line, no content pushed down, no band.
  // useLayoutEffect (pre-paint) so per-keystroke re-parses never flash the
  // static gap before the compensated height — that would flicker. One
  // rect pass, cumulative in-memory adjustment, one write pass (single
  // reflow). Floor 8px: a block rendering TALLER than its editor span
  // (tables, code) only shrinks the gap so far — its positive drift is
  // handled by the normal scroll path, and the natural separation stays.
  // Gaps only exist between blocks (rehypeBlankGap); adjacency without a
  // blank line is absorbed at the next gap (the grid math is absolute).
  useLayoutEffect(() => {
    if (!syncActive || editorLineHeight == null || editorLineHeight <= 0) return;
    const rootEl = containerRef.current;
    const sc = rootEl?.parentElement;
    if (!rootEl || !sc) return;
    const contentTop = (el: HTMLElement) =>
      el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
    const blocks: { el: HTMLElement; line: number; top: number }[] = [];
    const gapAfter = new Map<number, { el: HTMLElement; curH: number }>(); // block index → the .md-blank-gap following it (measured)
    // The leading .md-blank-gap (before block 0 — leading blanks /
    // frontmatter lines; rehypeBlankGap inserts it). Resized by the grid pin
    // so block 0 lands on the editor's line-1 phase, absorbing whatever sits
    // above (the SkillMetaCard for frontmatter docs).
    let leadingGap: { el: HTMLElement; curH: number } | null = null;
    for (const kid of Array.from(rootEl.children) as HTMLElement[]) {
      if (kid.classList.contains('md-blank-gap')) {
        if (blocks.length === 0) {
          if (!leadingGap) leadingGap = { el: kid, curH: kid.getBoundingClientRect().height };
        } else if (!gapAfter.has(blocks.length - 1)) {
          gapAfter.set(blocks.length - 1, { el: kid, curH: kid.getBoundingClientRect().height });
        }
        continue;
      }
      const line = Number(kid.getAttribute('data-source-line'));
      if (Number.isFinite(line) && line > 0) blocks.push({ el: kid, line, top: contentTop(kid) });
    }
    if (blocks.length < 1) return;
    // Absolute grid (editor's line-1 phase) when the editor has published
    // it; before that (or non-split) fall back to the relative grid.
    const grid = editorContentPadTop > 0 ? { top: editorContentPadTop, leadingGap: leadingGap ?? undefined } : undefined;
    const { writes } = planGapHeights(blocks, gapAfter, editorLineHeight, undefined, grid);
    for (const [el, h] of writes) (el as HTMLElement).style.height = `${h}px`;
    // ponytail: mountedChunkEls in the deps re-runs compensation whenever the
    // windowed chunk set changes — newly mounted chunks bring new blocks and
    // gaps that must be pinned to the grid (reactContent stays null in
    // chunked mode, so it alone would never re-trigger).
  }, [reactContent, mountedChunkEls, editorLineHeight, syncActive, editorContentPadTop]);

  // ponytail: cursor sync — called AFTER the gap-compensation layout effect
  // on purpose. Its effect is itself a useLayoutEffect (pre-paint: mounts,
  // drift corrections, and alignment writes land in the same paint — no
  // intermediate drifted frame; WKWebView has no native scroll anchoring
  // to mask one), and within one component layout effects run in hook
  // order: this call's position makes the sync measure the POST-gap-
  // compensation geometry (the leading gap pinned to the grid above), not
  // the pre-compensation static gap heights. Both still run before paint,
  // so the compensated gaps and the aligned scrollTop ship in ONE paint.
  // ponytail: chunked rendering — mount the chunk owning the cursor line
  // before target selection; mountVersion re-triggers this effect once
  // the mount commits (the selection below reads the live DOM).
  usePreviewCursorSync({
    containerRef,
    parseRef,
    parsedContent,
    cursorLine,
    cursorViewportY,
    editorViewportTop,
    hasSelection,
    ensureChunkMountedForLine: windowed.ensureChunkMountedForLine,
    chunkMountVersion: windowed.mountVersion,
  });

  // ponytail: memoize VaultContext value — without this, every keystroke
  // (content change → MarkdownPreview re-renders) creates a fresh value object,
  // which made every FilePreviewComponent's useEffect([src, ctx]) re-fire and
  // re-read + re-mount the preview. readFile is a stable module import; only
  // filePath/resolvedVaultRoot/renderFile actually vary.
  const vaultContextValue = useMemo(() => ({
    vaultRoot: resolvedVaultRoot,
    filePath,
    readFile: (p: string) => readFileByRoute(p),
    renderFile,
    openFile,
    getFileIcon: (path: string) => createElement(FileIcon, { filename: path }),
  }), [resolvedVaultRoot, filePath, renderFile, openFile]);

  useEffect(() => {
    const root = containerRef.current;
    if (root) return installPreviewWordSelection(root);
  }, []);

  return (
    <VaultContext.Provider value={vaultContextValue}>
      <div
        className="md-preview"
        ref={containerRef}
        style={{ '--md-gap-line': editorLineHeight > 0 ? `${editorLineHeight}px` : undefined } as React.CSSProperties}
      >
        {meta && <SkillMetaCard meta={meta} />}
        {useChunked ? (
          // ponytail: chunked body — mounted chunks' elements and estimated
          // spacers, all hoisted as DIRECT children of .md-preview (the
          // gap-compensation walk, cursor-sync block queries, word selection
          // and image-resize writeback see the same child sequence as a full
          // render; spacers carry no data-source-line and are inert).
          chunks.map((_c, i) => {
            const el = mountedChunkEls.get(i);
            if (el) return <Fragment key={i}>{el}</Fragment>;
            return (
              <div
                key={i}
                className="md-chunk-spacer"
                data-md-chunk={i}
                aria-hidden="true"
                style={{ height: `${spacerHeight(i)}px` }}
              />
            );
          })
        ) : reactContent}
        {/* Internal-link hover preview (spec 5.2) — one popover per preview
            instance; PreviewActiveContext (inherited through the tree, also
            across its body portal) keeps parked panes from floating it. */}
        <LinkPreviewPopover />
      </div>
    </VaultContext.Provider>
  );
}
