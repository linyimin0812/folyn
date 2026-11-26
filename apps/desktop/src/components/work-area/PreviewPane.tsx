import { useState, useEffect, useLayoutEffect, useRef, useCallback, forwardRef, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import type { FileTab, ViewMode } from '@/store/editorStore';
import type { PreviewProps } from '../file-types/types';
import { useEditorViewStateStore, type PreviewComponents } from '@/store/editorViewState';
import { useEditorPrefsStore } from '@/store/editorPrefsStore';
import { debounce } from '@/utils/debounce';
import { MarkmapCanvas } from '../file-types/markmap/MarkmapCanvas';
import { resolveAssetBase } from '../file-types/previewPath';
import { usePreviewZoom } from '../file-types/markdown/usePreviewZoom';
import { navigateToHeadingId, restoreComponentState, snapshotComponentState } from '../file-types/markdown/headingNav';
import { computeOutlineSource, computeActiveHeading, mergeOutlineVisibility } from '../file-types/markdown/outlineModel';
import { useEditorStore } from '@/store/editorStore';
import { PreviewActiveContext } from '../file-types/markdown/PreviewActiveContext';

// Quiet floating preview tools: bare icons, faint at rest, clearer while the
// preview pane is hovered (`group/prev` on the pane root), full + hover fill on
// the button itself. Active state = accent icon at full opacity.
function previewToolClass(active = false): string {
  return `flex items-center justify-center w-7 h-7 rounded-[6px] cursor-pointer transition-[opacity,color,background-color] duration-[140ms] hover:opacity-100 hover:bg-hov ${active ? 'opacity-100 text-acc' : 'opacity-35 group-hover/prev:opacity-70 text-t2 hover:text-t1'}`;
}

/** How long a tab switch holds the restored preview position against late layout. */
const RESTORE_HOLD_MS = 1500;
/** How long a navigation restore waits for an async-parsed #fragment heading. */
const NAV_ANCHOR_WAIT_MS = 3000;
/** Input that hands the preview position back to the reader during a restore. */
const READER_INPUT_EVENTS = ['wheel', 'pointerdown', 'keydown', 'touchstart'] as const;

interface PreviewPaneProps {
  activeTab: FileTab;
  Preview: ComponentType<PreviewProps>;
  vaultRoot: string;
  viewMode: ViewMode;
  previewFlex?: number;
  /**
   * Optional write-back for preview components that support in-place editing
   * (e.g. JSON file viewer). Forwarded to the rendered `<Preview>`.
   */
  onChange?: (content: string) => void;
  /**
   * Split-mode only: a heading in the preview was clicked. Fires with the
   * heading's `data-source-line` (1-based editor line) so the caller can
   * scroll the editor to it. Left undefined in preview-only mode (no
   * editor to scroll to).
   */
  onHeadingClick?: (sourceLine: number) => void;
  /**
   * False while this pane is kept alive behind another tab (WorkArea keeps
   * recent previews mounted so iframes — HTML, PDF and other extension
   * viewers — keep their document and inner scroll). A hidden pane is parked
   * outside the work area, ignores the editor cursor and saves no
   * scroll. Defaults to true.
   */
  active?: boolean;
}

export const PreviewPane = forwardRef<HTMLDivElement, PreviewPaneProps>(
  function PreviewPane(
    { activeTab, Preview, vaultRoot, viewMode, previewFlex, onChange, onHeadingClick, active = true },
    ref,
  ) {
    // ponytail: cursor line drives preview scroll-sync in split mode only.
    // In preview-only mode the editor is unmounted, so cursorLine never
    // changes; passing it would scroll to a stale position on tab switch.
    const cursorSyncPreview = useEditorPrefsStore((s) => s.cursorSyncPreview);
    const setCursorSyncPreview = useEditorPrefsStore((s) => s.setCursorSyncPreview);
    const { t } = useTranslation();
    const setPreviewScrollTopForTab = useEditorViewStateStore((s) => s.setPreviewScrollTopForTab);
    // ponytail: the .prev-body scroll container keeps its scrollTop while the
    // pane lives (WorkArea keeps one pane per tab; the version-history view
    // reuses one pane across snapshots). Persist the scrollTop onto the tab
    // this pane SHOWS (throttled) and restore it when the pane shows a tab,
    // mirroring the editor's editorScrollTop — it survives restarts and the
    // pane being dropped from the kept set. The tab id is taken when the
    // scroll happens, not from the store's activeTabId: that already names
    // the next tab while the work area still shows this one (it trails the
    // switch by a frame) and while the trailing debounce is pending.
    const bodyRef = useRef<HTMLDivElement | null>(null);
    const setBodyRef = useCallback((el: HTMLDivElement | null) => {
      const prev = bodyRef.current;
      bodyRef.current = el;
      if (typeof ref === 'function') ref(el);
      // Detaching clears the shared ref only if it still points here: when
      // another kept pane takes the ref over, it may have attached first.
      else if (ref && (el || ref.current === prev)) (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
    }, [ref]);
    const shownTabIdRef = useRef(activeTab.id);
    shownTabIdRef.current = activeTab.id;
    const persistPreviewScrollRef = useRef<((tabId: string, top: number) => void) | null>(null);
    if (persistPreviewScrollRef.current === null) {
      persistPreviewScrollRef.current = debounce((tabId: string, top: number) => setPreviewScrollTopForTab(tabId, top), 200);
    }
    // True while a tab switch restores the saved position: scrolls then come
    // from the restore itself, the content swap clamping scrollTop, or late
    // layout — none of them is the reader moving, so none is persisted.
    const restoringRef = useRef(false);
    const activeRef = useRef(active);
    activeRef.current = active;
    const handleBodyScroll = useCallback(() => {
      if (restoringRef.current || !activeRef.current) return;
      persistPreviewScrollRef.current?.(shownTabIdRef.current, bodyRef.current?.scrollTop ?? 0);
      persistReadingHeadingRef.current?.(shownTabIdRef.current, bodyRef.current);
    }, []);

    // Phase 4.5: keep the shown tab's reading-scene snapshot fresh. The same
    // signals the outline sidebar listens to (panel display flips, collapse
    // is-open class toggles, content remounts) drive a debounced
    // snapshotComponentState → setPreviewComponentsForTab(shownTabId) — the
    // exact scene Back/Forward replays. Snapshots are cheap (a couple of
    // querySelectorAll scans) and shallow-equal writes are skipped in the
    // store, so the debounce fires at most once per interaction.
    const isMarkdown = activeTab.fileType === 'markdown';
    const setPreviewComponentsForTab = useEditorViewStateStore((s) => s.setPreviewComponentsForTab);

    // Phase 6.2 — per-tab reading section: the nearest heading above the
    // viewport, written onto the tab record (debounced with the scroll
    // writes). The tab switcher shows it to tell two reading scenes of the
    // SAME document apart (spec: 通过必要的章节上下文区分同一文件的不同阅读现场).
    // outlineModel is the same model the outline sidebar's scroll-spy uses,
    // minus the visibility merge (switcher labels work even for headings
    // hidden inside collapsibles — they're still the reader's position).
    const persistReadingHeadingRef = useRef<(((tabId: string, body: HTMLElement | null) => void) & { cancel: () => void }) | null>(null);
    const contentForHeadingRef = useRef(activeTab.content);
    contentForHeadingRef.current = activeTab.content;
    useEffect(() => {
      if (!isMarkdown) return;
      if (persistReadingHeadingRef.current === null) {
        persistReadingHeadingRef.current = debounce((tabId: string, body: HTMLElement | null) => {
          if (!body) return;
          const items = mergeOutlineVisibility(computeOutlineSource(contentForHeadingRef.current), body);
          const active = computeActiveHeading(body, items);
          if (!active) return;
          useEditorStore.setState((state) => {
            const prev = state.tabs.find((t) => t.id === tabId)?.readingHeading;
            if (prev && prev.line === active.line && prev.text === active.text) return state;
            return {
              tabs: state.tabs.map((t) =>
                t.id === tabId ? { ...t, readingHeading: { line: active.line, text: active.text } } : t,
              ),
            };
          });
        }, 300);
      }
      // Snapshot once on attach so a tab that never scrolled still labels
      // its current scene (fresh open → document lead section).
      persistReadingHeadingRef.current?.(shownTabIdRef.current, bodyRef.current);
      return () => { persistReadingHeadingRef.current?.cancel(); };
    }, [isMarkdown, activeTab.id]); // eslint-disable-line react-hooks/exhaustive-deps

    const persistComponentsRef = useRef<((tabId: string, body: HTMLElement) => void) | null>(null);
    useEffect(() => {
      if (!isMarkdown) return;
      if (persistComponentsRef.current === null) {
        persistComponentsRef.current = debounce((tabId: string, body: HTMLElement) => {
          setPreviewComponentsForTab(tabId, snapshotComponentState(body));
        }, 250);
      }
      const body = bodyRef.current;
      if (!body) return;
      const obs = new MutationObserver(() => {
        persistComponentsRef.current?.(shownTabIdRef.current, bodyRef.current ?? body);
      });
      obs.observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
      // Snapshot once on attach: content parsed before this pane mounted
      // (a tab return, a chunk mount) has already changed the scene.
      persistComponentsRef.current?.(shownTabIdRef.current, body);
      return () => obs.disconnect();
    }, [isMarkdown, setPreviewComponentsForTab, activeTab.id]); // eslint-disable-line react-hooks/exhaustive-deps

    // ponytail: split-mode preview→editor jump. Click a rendered heading in
    // the preview and the editor scrolls to that heading's source line.
    // Headings carry `data-source-line` (rehypeSourceLine), so no text
    // matching — works even when the heading contains inline formatting
    // (`## Hello *world*`) where rendered textContent would diverge from the
    // source text. Skips when the click lands on a link inside the heading
    // (let the link navigate) and when the user is mid text-selection (let
    // them copy the heading).
    const handlePreviewClick = useCallback((e: React.MouseEvent) => {
      if (!onHeadingClick) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('a')) return;
      const heading = target.closest('h1,h2,h3,h4,h5,h6');
      if (!heading) return;
      const lineAttr = heading.getAttribute('data-source-line');
      if (!lineAttr) return;
      const line = Number(lineAttr);
      if (!Number.isFinite(line) || line <= 0) return;
      onHeadingClick(line);
    }, [onHeadingClick]);
    // A hidden pane keeps the cursor values it last had: dropping them to 0
    // would flip MarkdownPreview's sync gaps and re-parse it in the background.
    const syncLive = viewMode === 'split' && cursorSyncPreview;
    const frozenCursorRef = useRef({ cursorLine: 0, cursorViewportY: 0, editorViewportTop: 0, hasSelection: false });
    const frozen = frozenCursorRef.current;
    const cursorLine = useEditorViewStateStore((s) => !active ? frozen.cursorLine : syncLive ? s.cursorLine : 0);
    const cursorViewportY = useEditorViewStateStore((s) => !active ? frozen.cursorViewportY : syncLive ? s.cursorViewportY : 0);
    const editorViewportTop = useEditorViewStateStore((s) => !active ? frozen.editorViewportTop : syncLive ? s.editorViewportTop : 0);
    const hasSelection = useEditorViewStateStore((s) => !active ? frozen.hasSelection : viewMode === 'split' ? s.hasSelection : false);
    if (active) frozenCursorRef.current = { cursorLine, cursorViewportY, editorViewportTop, hasSelection };
    const outlineVisible = useEditorViewStateStore((s) => s.outlineVisible);
    const toggleOutline = useEditorViewStateStore((s) => s.toggleOutline);
    const pendingNavRestore = useEditorViewStateStore((s) => s.pendingNavRestore);

    // ponytail: the scroll-hold controller. A restore (tab switch, reader
    //  navigation) holds the .prev-body's scrollTop against late layout for
    //  RESTORE_HOLD_MS — images load, the asset base re-renders the tree,
    //  split-mode cursor-sync republishes — each of which would clamp or
    //  drag the scroll away from the restored position. Only the first real
    //  reader input (wheel/click/key/touch) releases the hold early. One
    //  controller at a time: a new apply supersedes the previous hold.
    const stopHoldRef = useRef<(() => void) | null>(null);
    const applyScrollHold = useCallback((target: number) => {
      stopHoldRef.current?.();
      const apply = () => {
        const el = bodyRef.current;
        if (el && Math.abs(el.scrollTop - target) > 1) el.scrollTop = target;
      };
      let frame = 0;
      const hold = () => {
        apply();
        frame = requestAnimationFrame(hold);
      };
      // Marks the scroll container for usePreviewCursorSync, which leaves the
      // scroll alone while it is set.
      const body = bodyRef.current;
      let timer: ReturnType<typeof setTimeout>;
      const stop = () => {
        restoringRef.current = false;
        delete body?.dataset.restoringScroll;
        cancelAnimationFrame(frame);
        clearTimeout(timer);
        for (const type of READER_INPUT_EVENTS) window.removeEventListener(type, stop, true);
        if (stopHoldRef.current === stop) stopHoldRef.current = null;
      };
      restoringRef.current = true;
      if (body) body.dataset.restoringScroll = '';
      hold();
      timer = setTimeout(stop, RESTORE_HOLD_MS);
      for (const type of READER_INPUT_EVENTS) window.addEventListener(type, stop, true);
      stopHoldRef.current = stop;
    }, []);
    // Release any live hold when the pane unmounts.
    useEffect(() => () => stopHoldRef.current?.(), []);

    // ponytail: reader-navigation restore (docLinkHistory back/forward / a
    //  link with a #fragment). The docLinkHistory store writes a single-slot
    //  pending request keyed by path; this pane applies it when the path it
    //  shows matches — either on activation (tab switch/open, covered by the
    //  layout effect below which runs pre-paint) or live, when the target is
    //  the tab already on screen (Back within one document). Reads fresh
    //  state (getState) so the two paths never double-apply: whoever runs
    //  first consumes the slot, the other sees null.
    const runNavRestore = useCallback((nav: { scrollTop?: number; anchorId?: string; components?: PreviewComponents }) => {
      const body = bodyRef.current;
      // Replay the leaving position's container state first (Phase 4.5): Back
      // must land in the same reading scene — tabs on the panel the reader
      // was on, collapsibles they had open — not just the scroll offset.
      // Replay before the scroll so layout settles once. anchorId jumps
      // still auto-reveal whatever else the fragment needs.
      if (nav.components && activeTab.fileType === 'markdown' && body) {
        restoreComponentState(body, nav.components);
      }
      if (nav.anchorId && activeTab.fileType === 'markdown' && body) {
        // #fragment target: settle the scroll near the snapshot first (the
        //  pipeline's parse is async), then poll for the heading id and
        //  reveal-and-scroll onto it. navigateToHeadingId returns false until
        //  the heading exists — retry on a rAF loop, capped.
        if (nav.scrollTop !== undefined) applyScrollHold(nav.scrollTop);
        const started = Date.now();
        const tryAnchor = () => {
          const el = bodyRef.current;
          if (!el) return;
          const ok = navigateToHeadingId(el, nav.anchorId!, { smooth: false });
          if (!ok && Date.now() - started < NAV_ANCHOR_WAIT_MS) {
            requestAnimationFrame(tryAnchor);
          }
        };
        requestAnimationFrame(tryAnchor);
      } else {
        applyScrollHold(nav.scrollTop ?? 0);
      }
    }, [activeTab.fileType, applyScrollHold]);

    useEffect(() => {
      if (!active) return;
      const nav = useEditorViewStateStore.getState().pendingNavRestore;
      if (!nav || nav.path !== activeTab.path) return;
      useEditorViewStateStore.getState().consumePreviewNav();
      runNavRestore(nav);
    }, [pendingNavRestore, active, activeTab.id, activeTab.path, runNavRestore]); // eslint-disable-line react-hooks/exhaustive-deps
    const togglePresentationMode = useEditorViewStateStore((s) => s.togglePresentationMode);
    // Markmap preview toggle (markdown only). Default false = normal preview.
    const [markmapMode, setMarkmapMode] = useState(false);
    const [markmapAssetBase, setMarkmapAssetBase] = useState<string | null>(null);
    // In-document find (spec 5.3) lives at the WorkArea level now — editor
    // and preview share the one FindBar, and its Cmd+F listener is bound
    // there. The pane only exposes the markmap flag for that listener
    // (data-markmap on the root below).
    // ponytail: preview visual zoom (pinch/ctrl+wheel + Cmd±/0) —
    // preview-only mode: split mode must stay 1:1 with the editor so the
    // cursor-sync / gap-compensation line grid stays exact.
    const zoomEnabled = active && viewMode === 'preview' && activeTab.fileType === 'markdown' && !markmapMode;
    usePreviewZoom(zoomEnabled, bodyRef);

    // Resolve the markdown file's asset base so markmap nodes can inline
    // relative `![](img.png)` references (mirrors MarkdownPreview's own
    // resolution). Only needed when the markmap toggle is on, but resolved
    // eagerly so the switch renders without a flash.
    useEffect(() => {
      if (activeTab.fileType !== 'markdown') return;
      let cancelled = false;
      resolveAssetBase(activeTab.path, vaultRoot)
        .then((base) => { if (!cancelled) setMarkmapAssetBase(base); })
        .catch(() => { if (!cancelled) setMarkmapAssetBase(null); });
      return () => { cancelled = true; };
    }, [activeTab.fileType, activeTab.path, vaultRoot]);

    // ponytail: restore the saved preview scrollTop when this pane shows a
    // tab — a tab switch, or a kept-alive pane coming back to the front.
    // The position is held every frame for RESTORE_HOLD_MS, until the reader
    // first scrolls, clicks or types: the layout keeps growing after the
    // switch (images load, the asset base resolves and re-renders the tree,
    // split-mode gap compensation), so a one-shot apply got clamped short,
    // and split-mode cursor-sync re-aligned the preview to the editor cursor
    // as soon as the editor republished its metrics — the preview a reader
    // had scrolled on its own jumped back to the cursor (often line 1). The
    // preview now stays where it was left until the cursor actually moves.
    // On MOUNT the DOM is fresh (scrollTop 0), so
    // nothing needs resetting — only a saved value is restored. When the
    // pane is handed another tab (the version-history view reuses one pane
    // across snapshots), reset to 0 if that tab has no saved position:
    // otherwise the shared DOM keeps the previous file's scrollTop and the
    // browser clamps it into the markdown 100vh bottom pad → a blank preview
    // page (the reported "新打开一个Markdown文件，预览页留有一大片空白"). A
    // layout effect, so restoringRef is set before the browser fires the
    // scroll event of the content swap clamping scrollTop.
    const lastShownIdRef = useRef<string | null>(null);
    useLayoutEffect(() => {
      if (!active) return;
      // A pending reader-navigation restore (back/forward, link #fragment)
      // takes priority over the reshow/saved logic — the passive effect
      // above would also pick it up, but the layout effect runs pre-paint
      // so the reader never sees the un-navigated frame.
      const nav = useEditorViewStateStore.getState().pendingNavRestore;
      if (nav && nav.path === activeTab.path) {
        useEditorViewStateStore.getState().consumePreviewNav();
        lastShownIdRef.current = activeTab.id;
        runNavRestore(nav);
        return;
      }
      // Coming back to the front with the same tab: the DOM kept its scroll,
      // which is fresher than the debounced saved value — hold that.
      const reshow = lastShownIdRef.current === activeTab.id;
      const isMount = lastShownIdRef.current === null;
      lastShownIdRef.current = activeTab.id;
      const saved = reshow ? bodyRef.current?.scrollTop : activeTab.previewScrollTop;
      if (saved === undefined && isMount) return;
      applyScrollHold(saved ?? 0);
    }, [activeTab.id, active, runNavRestore, applyScrollHold]); // eslint-disable-line react-hooks/exhaustive-deps

    // ponytail: full-bleed is the DEFAULT (zero host padding — the preview
    // component manages its own padding). Only markdown needs the host's
    // pt-2 px-8 pb-[100vh] padding. The large bottom space lets (1) outline
    // heading clicks park the last heading at the top of the viewport, and
    // (2) the cursor-sync effect keep scrolling the preview so the active
    // block aligns to the editor cursor's screen Y even when the document
    // is SHORT — with 80vh the preview's maxScroll dropped to ≤0 once content
    // fell below ~20% of the viewport, so the alignment scroll was clamped
    // to 0 and the highlight drifted far below the cursor (the reported
    // "内容较少时光标对齐效果很少，高亮偏移光标很远"). 100vh guarantees
    // the preview stays scrollable down to an empty doc. 100vh is applied
    // ONLY in split mode (cursor-sync lives there); pure preview mode has no
    // cursor to sync, so a full-viewport pad is dead whitespace — it gets a
    // small pb-[20vh] breathing room instead (用户反馈: 预览模式底部空白过大).
    // Previously a hardcoded list of built-in ids gated this — that forced
    // every extension file-type to either inherit markdown's bottom pad
    // (broken) or edit host source to be added to the list.
    const fullBleed = activeTab.fileType !== 'markdown';

    // A hidden pane keeps the width it was shown at, so its content does not
    // re-wrap behind the other tab and the kept scroll still points at the
    // same text when it comes back. It is parked outside the (overflow-
    // clipped) work area rather than hidden in place: WebKit stops painting
    // an iframe under visibility:hidden and shows it blank on return (HTML
    // previews came back white), and a transparent pane left in place still
    // took the wheel — macOS WebKit routes scrolls to an iframe under the
    // pointer regardless of pointer-events, so the shown PDF stopped
    // scrolling. `inert` keeps the parked pane out of focus and Tab.
    const rootRef = useRef<HTMLDivElement>(null);
    const shownWidthRef = useRef<number | undefined>(undefined);
    useLayoutEffect(() => {
      const el = rootRef.current;
      if (!el) return;
      if (active) shownWidthRef.current = el.offsetWidth || undefined;
      el.toggleAttribute('inert', !active);
    });

    return (
      <div
        ref={rootRef}
        className={`group/prev flex-1 flex flex-col overflow-hidden min-w-[200px] ${active ? '' : 'absolute inset-y-0 pointer-events-none'}`}
        style={active ? { ...(viewMode === 'split' ? { flexGrow: previewFlex, flexBasis: 0 } : {}), position: 'relative' } : { width: shownWidthRef.current ?? '100%', left: '-200vw' }}
        data-preview-hidden={active ? undefined : ''}
        data-markmap={activeTab.fileType === 'markdown' && markmapMode ? 'on' : undefined}
        aria-hidden={active ? undefined : true}
      >
        {/* Preview-mode toggle (markmap) + outline toggle -- markdown only */}
        {activeTab.fileType === 'markdown' && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2 z-10 flex flex-col gap-1.5">
            <button
              className={previewToolClass(markmapMode)}
              onClick={() => setMarkmapMode((v) => !v)}
              title={markmapMode ? '正常预览' : '思维导图预览'}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                <circle cx="8" cy="8" r="1.8" />
                <circle cx="2.5" cy="3" r="1.4" />
                <circle cx="13.5" cy="3" r="1.4" />
                <circle cx="2.5" cy="13" r="1.4" />
                <circle cx="13.5" cy="13" r="1.4" />
                <line x1="7" y1="7" x2="3.2" y2="3.8" />
                <line x1="9" y1="7" x2="12.8" y2="3.8" />
                <line x1="7" y1="9" x2="3.2" y2="12.2" />
                <line x1="9" y1="9" x2="12.8" y2="12.2" />
              </svg>
            </button>
            <button
              className={previewToolClass(outlineVisible)}
              onClick={toggleOutline}
              title="大纲"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                <line x1="2" y1="3.5" x2="14" y2="3.5" />
                <line x1="4" y1="6.5" x2="14" y2="6.5" />
                <line x1="4" y1="9.5" x2="14" y2="9.5" />
                <line x1="2" y1="12.5" x2="14" y2="12.5" />
              </svg>
            </button>
            <button
              className={previewToolClass()}
              onClick={togglePresentationMode}
              title={t('editor:presentation.enter')}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1.5" y="2.5" width="13" height="9" rx="1" />
                <line x1="5.5" y1="7" x2="6.5" y2="7" />
                <line x1="8.5" y1="7" x2="9.5" y2="7" />
                <line x1="11.5" y1="7" x2="12" y2="7" />
                <path d="M 4 14 L 12 14" />
              </svg>
            </button>
            {viewMode === 'split' && (
              <button
                className={previewToolClass(cursorSyncPreview)}
                onClick={() => setCursorSyncPreview(!cursorSyncPreview)}
                title={cursorSyncPreview ? t('editor:previewToolbar.cursorSyncOn') : t('editor:previewToolbar.cursorSyncOff')}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="1.5" y="1.5" width="6" height="13" rx="1" />
                  <rect x="8.5" y="1.5" width="6" height="13" rx="1" />
                  <line x1="4.5" y1="4.5" x2="4.5" y2="11.5" strokeDasharray="1.6 1.8" />
                  <line x1="11.5" y1="5.5" x2="11.5" y2="10.5" strokeDasharray="1.6 1.8" />
                </svg>
              </button>
            )}
          </div>
        )}
        <div className="flex-1 flex overflow-hidden">
          {/* Portaled focus views (code/table/diagram focus, image lightbox)
              read this to unmount while another tab is shown — parking this
              pane offscreen does not hide portals (body children). */}
          <PreviewActiveContext.Provider value={active}>
          {activeTab.fileType === 'markdown' ? (
            <>
              {/* ponytail: MarkdownPreview stays mounted across the markmap
                  toggle so switching back doesn't re-run the unified pipeline
                  (1-2s lag). Hidden via CSS instead of unmounted. MarkmapCanvas
                  still mounts on demand to avoid running markmap-lib transform
                  in the background for every markdown file. */}
              <div
                className={`prev-body doc-surface flex-1 overflow-auto pt-2 px-8 ${viewMode === 'split' ? 'pb-[100vh] is-jumpable is-split' : 'pb-[20vh]'} ${markmapMode ? 'hidden' : 'block'}`}
                ref={setBodyRef}
                onScroll={handleBodyScroll}
                onClick={handlePreviewClick}
              >
                {/* ponytail: no zoom wrapper div — cursor-sync and gap
                    compensation walk `.md-preview`.parentElement for the
                    scroll container; an extra layer broke that chain (split
                    alignment regression). Zoom is the --md-zoom CSS var,
                    owned exclusively by usePreviewZoom (NOT React-rendered —
                    a React write mid-animation caused snap-back flicker). */}
                <Preview
                  content={activeTab.content}
                  filePath={activeTab.path}
                  vaultRoot={vaultRoot}
                  cursorLine={cursorLine}
                  cursorViewportY={cursorViewportY}
                  editorViewportTop={editorViewportTop}
                  hasSelection={hasSelection}
                  onChange={onChange}
                />
              </div>
              {markmapMode && (
                <div className="prev-body doc-surface flex-1 h-full overflow-hidden">
                  <MarkmapCanvas
                    content={activeTab.content}
                    assetBase={markmapAssetBase}
                    className="h-full w-full"
                  />
                </div>
              )}
            </>
          ) : (
            <div
              className={fullBleed ? 'prev-body flex-1 h-full overflow-auto' : 'prev-body flex-1 overflow-auto pt-2 px-8 pb-[100vh]'}
              ref={setBodyRef}
              onScroll={handleBodyScroll}
            >
              <Preview
                content={activeTab.content}
                filePath={activeTab.path}
                vaultRoot={vaultRoot}
                cursorLine={cursorLine}
                cursorViewportY={cursorViewportY}
                hasSelection={hasSelection}
                onChange={onChange}
              />
            </div>
          )}
          </PreviewActiveContext.Provider>
        </div>
      </div>
    );  },
);
