import { useMemo, useRef, useEffect, useLayoutEffect, useCallback, useState, createElement, Fragment } from 'react';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkDirective from 'remark-directive';
import remarkDirectiveRehype from 'remark-directive-rehype';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeHighlight from 'rehype-highlight';
import { all as allLowlightGrammars } from 'lowlight';
import rehypeMathjax from 'rehype-mathjax';
import rehypeReact from 'rehype-react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { transformMathBrackets, unwrapInlineMath } from '@/services/markdown/renderMarkdown';
import { rehypeSourceLine } from './rehypeSourceLine';
import { rehypeBlankGap } from './rehypeBlankGap';
import { rehypeShowRawTags } from './rehypeShowRawTags';
import { planGapHeights } from './gapCompensation';
import { VaultContext } from '@folyn/container-extensions';
import { getHandlerByExtension, getHandlerById, getModeComponent } from "@/components/file-types/registry";
import { readFileByRoute } from '@/services/editorIoService';
import { useEditorViewStateStore } from '@/store/editorViewState';
import { FileIcon } from '@/components/icons/FileIcon';
import { rehypeRemoveCodeBreaks } from './rehypeRemoveCodeBreaks';
import { rehypeMarkResultBlock } from './rehypeMarkResultBlock';
import { parseFrontmatter, SkillMetaCard } from './frontmatter';
import { buildPreviewComponentMap } from './previewComponentMap';
import { usePreviewCursorSync } from './usePreviewCursorSync';

// ponytail: P2 — large-doc parse debounce knobs. Docs above
// PARSE_DEBOUNCE_CHARS re-parse at most every PARSE_DEBOUNCE_MS after the
// last keystroke, never stalling longer than PARSE_MAX_WAIT_MS during a
// continuous typing burst. Below the threshold, per-keystroke parsing is
// cheap and stays instant.
const PARSE_DEBOUNCE_CHARS = 6_000;
const PARSE_DEBOUNCE_MS = 150;
const PARSE_MAX_WAIT_MS = 500;

export function MarkdownPreview({ content, filePath, vaultRoot, onChange, cursorLine, cursorViewportY, editorViewportTop, hasSelection }: import('../types').PreviewProps) {
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
  const [parsedContent, setParsedContent] = useState(content);
  const parseRef = useRef(parsedContent);
  parseRef.current = parsedContent;
  const lastParsedPathRef = useRef(filePath);
  const pendingSinceRef = useRef(0);
  useEffect(() => {
    if (filePath !== lastParsedPathRef.current) {
      lastParsedPathRef.current = filePath;
      pendingSinceRef.current = 0;
      setParsedContent(content);
      return;
    }
    if (content === parsedContent) return;
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
  }, [content, filePath, parsedContent]);

  usePreviewCursorSync({
    containerRef,
    parseRef,
    parsedContent,
    cursorLine,
    cursorViewportY,
    editorViewportTop,
    hasSelection,
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

  // Parse frontmatter before building the component map so the directive
  // wrappers can stamp a frontmatter-offset-adjusted `data-source-line`
  // (matches rehypeSourceLine's offset, so cursor sync lines up).
  const { meta, body, frontmatterLineCount } = useMemo(() => parseFrontmatter(parsedContent), [parsedContent]);

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

  const reactContent = useMemo(() => {
    try {
      const pipeline = unified()
        .use(remarkParse)
        .use(remarkMath)
        .use(remarkGfm)
        .use(remarkBreaks)
        .use(remarkDirective)
        .use(remarkDirectiveRehype)
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeRaw)
        .use(rehypeShowRawTags, { extraKnownTags: Object.keys(componentMap) })
        .use(rehypeHighlight, { languages: allLowlightGrammars, ignoreMissing: true } as any)
        .use(rehypeRemoveCodeBreaks)
        .use(rehypeMarkResultBlock)
        .use(rehypeMathjax)
        .use(rehypeSourceLine, { offset: frontmatterLineCount });
      if (syncActive) pipeline.use(rehypeBlankGap, { offset: frontmatterLineCount, totalLines: parsedContent.split('\n').length });
      const result = pipeline
        .use(rehypeReact, {
          jsx,
          jsxs,
          Fragment,
          passNode: true,
          components: componentMap,
        } as any)
        .processSync(unwrapInlineMath(transformMathBrackets(body)));

      return result.result as React.ReactElement;
    } catch (error) {
      console.error('[MarkdownPreview] render error:', error);
      return createElement('p', null, '渲染错误');
    }
  }, [body, componentMap, frontmatterLineCount, syncActive, parsedContent]);

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
  }, [reactContent, editorLineHeight, syncActive, editorContentPadTop]);

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

  return (
    <VaultContext.Provider value={vaultContextValue}>
      <div className="md-preview" ref={containerRef} style={{ '--md-gap-line': editorLineHeight > 0 ? `${editorLineHeight}px` : undefined } as React.CSSProperties}>
        {meta && <SkillMetaCard meta={meta} />}
        {reactContent}
      </div>
    </VaultContext.Provider>
  );
}
