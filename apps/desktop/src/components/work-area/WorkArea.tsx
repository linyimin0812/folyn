import { useRef, useState, useCallback, useEffect, useLayoutEffect, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore, type ViewMode } from '@/store/editorStore';
import { useDiffReviewStore } from '@/store/diffReviewStore';
import { useEditorPrefsStore } from '@/store/editorPrefsStore';
import { useEditorViewStateStore } from '@/store/editorViewState';
import { useVaultStore } from '@/store/vaultStore';
import { useSessionsUiStore } from '@/store/sessionsUiStore';
import { SessionDetailView } from '@/components/sessions/SessionDetailView';
import { EvidenceViewer } from '@/components/sessions/EvidenceViewer';
import { KnowledgeWorkbench } from '@/components/knowledge/KnowledgeWorkbench';
import { isTauri } from '@/utils/platform';
import type { FolynEditorHandle } from '@/editor/EditorView';
import { EditorView } from '@codemirror/view';
import { getHandlerById, getSupportedModes, getDefaultMode, getMode } from '../file-types/registry';
import type { PreviewProps } from '../file-types/types';
import { setActiveEditorHandle } from '@/services/editorHandleRegistry';
import { getWebviewLabels } from '../file-types/web/WebViewer';
import { TabBar } from './TabBar';
import { EditorPane } from './EditorPane';
import { PreviewPane } from './PreviewPane';
import { OutlineSidebar } from './OutlineSidebar';
import { navigateToHeadingLine, navigateToDocLine, snapshotComponentState } from '@/components/file-types/markdown/headingNav';
import { FindBar } from '@/components/file-types/markdown/FindBar';
import { useFindUiStore } from '@/store/findUiStore';
import { useSearchStore } from '@/store/searchStore';
import { useCommandPaletteStore } from '@/store/commandPaletteStore';
import { useDocLinkHistory } from '@/store/docLinkHistory';
import { VersionHistoryPanel, isVersionableTab } from './VersionHistoryPanel';
import { VersionHistoryContentView } from './VersionHistoryContentView';
import { PresentationOverlay } from './PresentationOverlay';
import { FileLoadingView } from './FileLoadingView';
import { closeTab as closeTabWithSnapshot } from '@/services/editorIoService';

// ponytail: inline `kind: 'component'` editors (Excalidraw / rich-text / web)
// currently have no per-tab abort lifecycle. A never-aborting signal keeps the
// FilePresentationContext shape complete for extensions that opt into it;
// host-owned editors simply ignore it. Upgrade: thread a real per-tab
// AbortController through EditorStore if a future editor needs cancellation.
const neverAborts: AbortSignal = new AbortController().signal;

/** The loading skeleton stays at least this long on every file open or tab switch. */
const MIN_SKELETON_MS = 100;
/** How many tabs' previews stay mounted (the shown one included). */
const KEPT_PREVIEWS = 8;

type ModeRegistration = ReturnType<typeof getMode>;
type Handler = ReturnType<typeof getHandlerById>;

/** For a 'component' mode: preview-pane (cursor-sync wrapper) vs inline. */
function componentVia(m: ModeRegistration): 'preview-pane' | 'inline' | null {
  if (!m || m.kind !== 'component') return null;
  return m.via ?? (m.id === 'preview' ? 'preview-pane' : 'inline');
}

/** The mode a file shows in the PreviewPane under `mode`: the right side of a
 *  split, or a preview-pane component mode. */
function previewModeOf(handler: Handler, mode: ViewMode): ModeRegistration | null {
  const m = handler ? getMode(handler, mode) : undefined;
  if (m?.kind === 'split') return getMode(handler, m.split!.right) ?? null;
  return componentVia(m) === 'preview-pane' ? m ?? null : null;
}
/** Length of the slide-in once the skeleton goes away. */
const REVEAL_MS = 300;

export function WorkArea({ focusMode }: { focusMode?: boolean }) {
  const { t } = useTranslation();
  const viewMode = useEditorStore((state) => state.viewMode);
  const setViewMode = useEditorStore((state) => state.setViewMode);
  const activePanel = useEditorStore((state) => state.activePanel);
  const activeTabId = useEditorStore((state) => state.activeTabId);
  const allTabs = useEditorStore((state) => state.tabs);
  const setActiveTab = useEditorStore((state) => state.setActiveTab);
  const mruOrder = useEditorStore((state) => state.mruOrder);
  const stepMru = useEditorStore((state) => state.stepMru);
  const togglePinAction = useEditorStore((state) => state.togglePin);
  const updateTabContent = useEditorStore((state) => state.updateTabContent);
  const markTabDirty = useEditorStore((state) => state.markTabDirty);
  const isFileLoading = useEditorStore((state) => state.isFileLoading);
  const externalContentVersion = useDiffReviewStore((state) => state.externalContentVersion);
  const setContentExternal = useDiffReviewStore((state) => state.setContentExternal);
  const versionHistoryVisible = useEditorViewStateStore((s) => s.versionHistoryVisible);
  const versionHistorySelectedKey = useEditorViewStateStore((s) => s.versionHistorySelection.selectedKey);
  const presentationMode = useEditorViewStateStore((s) => s.presentationMode);

  // Filter tabs by the active activity panel
  const tabs = allTabs.filter((t) => t.activity === activePanel);
  // The tab whose content is rendered. It trails activeTabId by a frame on a
  // switch so the loading skeleton paints before the new file renders (a large
  // markdown file blocks the main thread for a few hundred ms).
  const [shownTabId, setShownTabId] = useState(activeTabId);
  const activeTab = tabs.find((t) => t.id === shownTabId);
  const showLineNumbers = useEditorPrefsStore((s) => s.showLineNumbers);
  const settingsTabSize = useEditorPrefsStore((s) => s.tabSize);
  const wrapColumn = useEditorPrefsStore((s) => s.wrapColumn);
  const editorFont = useEditorPrefsStore((s) => s.editorFont);
  const editorFontSize = useEditorPrefsStore((s) => s.editorFontSize);
  const vaultRoot = useVaultStore((s) => s.currentVault?.basePath ?? '');

  // ── Sessions panel main-area views ─────────────────────────────────────
  // ponytail: the Sessions SIDEBAR is list-only (224px); the conversation
  // detail and the saved-evidence fallback render here in the work area
  // (VersionHistoryContentView precedent: a full-area view replacing the
  // empty state). No file tab ever gets activity === 'sessions' (detectActivity
  // always returns 'files'), so this branch only replaces the empty state.
  const sessionsDetail = useSessionsUiStore((s) => s.detail);
  const sessionsDetailLoading = useSessionsUiStore((s) => s.detailLoading);
  const sessionsEvidence = useSessionsUiStore((s) => s.evidence);
  const closeEvidence = useSessionsUiStore((s) => s.closeEvidence);
  const showSessionsEvidence = activePanel === 'sessions' && sessionsEvidence !== null;
  const showSessionsDetail = activePanel === 'sessions'
    && sessionsEvidence === null
    && (sessionsDetail !== null || sessionsDetailLoading);

  const editorRef = useRef<FolynEditorHandle>(null);
  // Preview body div (forwarded ref from PreviewPane) so the outline sidebar —
  // now a split-level sibling, not inside the preview — can still scroll the
  // preview to a heading on click.
  const previewBodyRef = useRef<HTMLDivElement>(null);

  // Register the active editor handle so the ExtensionApi's `editor`
  // capability can query/replace the selection without a direct view ref.
  useEffect(() => {
    setActiveEditorHandle(editorRef.current, activeTab?.id ?? null);
    return () => setActiveEditorHandle(null);
  }, [shownTabId, activePanel, viewMode, presentationMode, versionHistoryVisible]);

  // Get the handler for the active tab
  const handler = activeTab ? getHandlerById(activeTab.fileType) : undefined;

  // Hide all webviews when switching to a non-web tab
  const prevTabIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (activeTabId !== prevTabIdRef.current) {
      // Hide every native webview on ANY tab switch. The active web tab's
      // WebViewer re-shows itself via its position-sync effect, so nothing
      // stale can cover the newly selected file page.
      if (isTauri()) {
        const labels = getWebviewLabels();
        if (labels.length > 0) {
          import('@tauri-apps/api/core').then(({ invoke }) => {
            invoke('hide_all_webviews', { labels }).catch(() => {});
          });
        }
      }

      prevTabIdRef.current = activeTabId;
    }

    // Wait until the active tab is the one rendered: during a switch the store's
    // viewMode already belongs to the new tab while the old one is still shown.
    if (activeTabId && handler && shownTabId === activeTabId) {
      const supported = getSupportedModes(handler);
      if (supported.length > 0 && !supported.includes(viewMode)) {
        // 当前 viewMode 不被该文件类型支持（如从 HTML 的 'visual' 切到 markdown），
        // 重置为该 handler 的默认模式或首个支持模式，避免所有渲染门为 false 导致编辑区空白。
        setViewMode(getDefaultMode(handler) ?? supported[0]);
      } else if (getDefaultMode(handler) && !activeTab?.viewMode && viewMode !== getDefaultMode(handler)) {
        setViewMode(getDefaultMode(handler)!);
      }
    }
  }, [activeTabId, shownTabId, handler, viewMode, setViewMode, activeTab]);

  // Pane resize (editor vs preview split ratio)
  const [editorFlex, setEditorFlex] = useState(1);
  const [previewFlex, setPreviewFlex] = useState(1);
  const splitDragging = useRef(false);
  const splitContainerRef = useRef<HTMLDivElement>(null);

  // Loading skeleton on every file open and tab switch: it covers the content
  // area from the click, for at least MIN_SKELETON_MS and until the file has
  // loaded, while the new file renders underneath; then the content slides up
  // into place. Web tabs are native webviews drawn over the page and get none.
  const activeIsWeb = tabs.find((t) => t.id === activeTabId)?.fileType === 'web';
  const [skeletonSince, setSkeletonSince] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!activeTabId || activeIsWeb) {
      setShownTabId(activeTabId);
      if (!isFileLoading) setSkeletonSince(null);
      return;
    }
    // A newly opened file already shows it from the start of loading.
    setSkeletonSince((since) => since ?? performance.now());
    // Render the new tab after the skeleton has painted: the timeout queued
    // from a frame callback runs once that frame is on screen.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => setShownTabId(activeTabId), 0);
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [activeTabId]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (isFileLoading) setSkeletonSince((since) => since ?? performance.now());
  }, [isFileLoading]);
  useEffect(() => {
    if (skeletonSince === null || isFileLoading || shownTabId !== activeTabId) return;
    const timer = setTimeout(
      () => setSkeletonSince(null),
      Math.max(0, skeletonSince + MIN_SKELETON_MS - performance.now()),
    );
    return () => clearTimeout(timer);
  }, [skeletonSince, isFileLoading, shownTabId, activeTabId]);

  const showSkeleton = skeletonSince !== null;
  const skeletonWasShownRef = useRef(false);
  useLayoutEffect(() => {
    const wasShown = skeletonWasShownRef.current;
    skeletonWasShownRef.current = showSkeleton;
    const container = splitContainerRef.current;
    if (!wasShown || showSkeleton || !container || !activeTab || activeIsWeb) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const animation = container.animate(
      [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }],
      { duration: REVEAL_MS, easing: 'cubic-bezier(.2,.8,.2,1)' },
    );
    return () => animation.cancel();
  }, [showSkeleton]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!splitDragging.current || !splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      const clamped = Math.max(0.2, Math.min(0.8, ratio));
      setEditorFlex(clamped);
      setPreviewFlex(1 - clamped);
    };
    const handleMouseUp = () => {
      if (splitDragging.current) {
        splitDragging.current = false;
        document.body.style.cursor = '';
        document.documentElement.classList.remove('is-resizing');
      }
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // ponytail: preview-heading click → move the editor cursor to that
  // heading's source line + scroll it into view. Setting the selection
  // (not just scrolling) is what makes cursor-sync联动: the editor's
  // updateListener writes the new cursorLine/cursorViewportY into the
  // store, so PreviewPane's cursor-sync effect re-aligns the preview to
  // the same heading — both panes land on it together. When sync is off,
  // the cursor still lands on the heading (a cleaner "jump to content").
  // `focus: false` is for the find bar: jumping must NOT steal focus from
  // the find input, or keystrokes typed after a find-as-you-type jump land
  // in the editor instead of the query field.
  const scrollEditorToLine = useCallback((line: number, opts?: { focus?: boolean }) => {
    const view = editorRef.current?.getView();
    if (!view) return;
    const doc = view.state.doc;
    if (line < 1 || line > doc.lines) return;
    const from = doc.line(line).from;
    if (opts?.focus !== false) view.focus();
    view.dispatch({
      selection: { anchor: from },
      effects: EditorView.scrollIntoView(from, { y: 'start' }),
    });
  }, []);

  // Outline heading click (spec 4.4): record the current reading position
  // on the tab's navigation trail (Back returns to it), then jump the
  // preview precisely to the heading's source line — headingNav reveals
  // hidden containers (inactive tabs / closed collapsibles) and mounts far
  // windowed chunks on the way — and land the editor cursor on the same
  // line (in split mode that selection re-aligns cursor-sync to it).
  const handleOutlineHeadingClick = useCallback((line: number) => {
    const container = previewBodyRef.current;
    if (container) {
      useDocLinkHistory.getState().pushPosition(
        container.scrollTop,
        snapshotComponentState(container),
      );
      navigateToHeadingLine(container, line);
    }
    scrollEditorToLine(line);
  }, [scrollEditorToLine]);

  // ── Presentation resolution ─────────────────────────────────────────────
  // Resolve the active mode (provider.modes) for the current viewMode, then
  // derive what to render. The shell owns the split layout + resizer (doc §13.3);
  // 'shell-editor' = the host's built-in CodeMirror (EditorPane).
  const activeMode = handler ? getMode(handler, viewMode) : undefined;
  const showCodeMirror = activeMode?.kind === 'shell-editor';
  const showSplit = activeMode?.kind === 'split';
  const splitParts = showSplit && activeMode?.kind === 'split'
    ? { left: getMode(handler, activeMode.split!.left), right: getMode(handler, activeMode.split!.right) }
    : null;
  const inlineMode = componentVia(activeMode) === 'inline' && activeTab?.fileType !== 'web' ? activeMode : null;
  const previewMode = previewModeOf(handler, viewMode);
  const showPreview = !!previewMode && !!previewMode?.component;
  // Most recently shown first. Hidden panes of these tabs stay mounted (up to
  // KEPT_PREVIEWS, the shown one included); closed tabs drop out.
  const [recentPreviewIds, setRecentPreviewIds] = useState<string[]>([]);
  useEffect(() => {
    if (!showPreview || !shownTabId) return;
    setRecentPreviewIds((ids) => (ids[0] === shownTabId ? ids : [shownTabId, ...ids.filter((id) => id !== shownTabId)].slice(0, KEPT_PREVIEWS)));
  }, [shownTabId, showPreview]);
  const keptPreviewIds = new Set(
    [...(showPreview && activeTab ? [activeTab.id] : []), ...recentPreviewIds]
      .filter((id) => tabs.some((t) => t.id === id))
      .slice(0, KEPT_PREVIEWS),
  );
  const previewTabs = tabs.filter((t) => keptPreviewIds.has(t.id));
  const showSplitResizer = showSplit;
  // Split editor side: shell-editor (left) for codemirror types.
  const showCodeMirrorInSplit = showSplit && splitParts?.left?.kind === 'shell-editor';
  const inlineEditorInSplit = showSplit && splitParts?.left && componentVia(splitParts.left) === 'inline' && activeTab?.fileType !== 'web' ? splitParts.left : null;

  // ponytail: when the version-history side panel is open AND a snapshot is
  // selected, swap the entire editor area for the diff view. Single branch
  // covers CodeMirror + custom editors + preview split — the diff view fills
  // the area the editor normally would. Editor / preview / resizer all stay
  // unmounted for the duration so their scroll state and CodeMirror view
  // don't have to coexist with the diff. Selection clears on panel close /
  // restore / tab switch (handled in the panel) — this flag follows.
  const showVersionHistoryDiff = versionHistoryVisible
    && versionHistorySelectedKey !== null
    && isVersionableTab(activeTab);

  // ── In-document find (spec 5.3), shared by editor + preview ──────────────
  // One FindBar over the whole content area — ⌘F is the ONLY entry point
  // (the editor's old CodeMirror search bar is deleted). Visibility is
  // per-tab (findUiStore). Jump routing by what is on screen: a visible
  // markdown preview → navigateToDocLine (reveals hidden containers, mounts
  // far windowed chunks); editor-only → land the editor cursor + scroll.
  const activeTabIdForFind = activeTab?.id;
  const findOpen = useFindUiStore((s) => (activeTabIdForFind ? !!s.openByTab[activeTabIdForFind] : false));
  const findEligible = !!activeTab
    && activeTab.fileType === 'markdown'
    && !showVersionHistoryDiff;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'f') return;
      if (!findEligible) return;
      // Vault search is Cmd+Shift+F; modal layers / focus views own their keys.
      if (useSearchStore.getState().isOpen || useCommandPaletteStore.getState().isOpen) return;
      if (document.querySelector('.md-code-focus-overlay, .image-lightbox, .presentation-overlay')) return;
      // Markmap preview hides the markdown body — find jumps would dead-end,
      // so ⌘F falls through. Checked at event time: the pane's markmap
      // toggle doesn't re-render WorkArea, so a render-time read goes stale.
      if (document.querySelector('[data-markmap="on"]:not([data-preview-hidden])')) return;
      e.preventDefault();
      if (activeTabIdForFind) useFindUiStore.getState().open(activeTabIdForFind);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [activeTabIdForFind, findEligible]);
  // Drop the tab's entry when it goes away (tab closed / pane evicted).
  useEffect(() => () => {
    if (activeTabIdForFind) useFindUiStore.getState().close(activeTabIdForFind);
  }, [activeTabIdForFind]); // eslint-disable-line react-hooks/exhaustive-deps
  const handleFindNavigate = useCallback((line: number) => {
    const container = previewBodyRef.current;
    if (container && showPreview) {
      navigateToDocLine(container, line);
    } else {
      // focus:false — the find input must keep focus so typing continues
      // in the query field (the selection still moves + scrolls).
      scrollEditorToLine(line, { focus: false });
    }
  }, [showPreview, scrollEditorToLine]);

  // Spec 6.2 — close-others with the same dirty/auto-save protection as a
  // single close (each closed tab goes through closeTabWithSnapshot).
  const closeOthersWithSnapshot = useCallback((tabId: string) => {
    const state = useEditorStore.getState();
    for (const tab of state.tabs) {
      if (tab.id === tabId || tab.pinned) continue;
      closeTabWithSnapshot(tab.id);
    }
  }, []);

  const togglePin = useCallback((tabId: string) => {
    togglePinAction(tabId);
  }, [togglePinAction]);

  // Spec 6.2 — 最近使用标签页快速切换: Ctrl+Tab steps the MRU ring forward
  // (Ctrl+Shift+Tab backward). Cmd+Tab on macOS is OS-reserved and never
  // reaches the page, so the modifier is strictly ctrlKey. Skip when a
  // text field owns the keystroke (find input) or an overlay is up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      e.preventDefault();
      stepMru(e.shiftKey ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stepMru]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg relative">
      {/* File tabs — hidden in focus mode so only the editor/preview shows */}
      {tabs.length > 0 && !focusMode && (
        <TabBar
          tabs={tabs}
          mruOrder={mruOrder}
          activeTabId={activeTabId}
          onSelectTab={setActiveTab}
          onCloseTab={closeTabWithSnapshot}
          onCloseOthers={closeOthersWithSnapshot}
          onTogglePin={togglePin}
        />
      )}

      {/* Content area */}
      {/* ponytail: splitContainerRef on the INNER horizontal split container
          so rect.left/width match the actual split axis. The outer container
          is flex-col and includes TabBar; its rect happens to share the same
          horizontal extent, but pinning the ref here is the correct invariant
          if TabBar ever gets horizontal padding. */}
      <div className="flex-1 flex overflow-hidden relative" ref={splitContainerRef}>

      {showSkeleton && <FileLoadingView label={t('shell:workArea.loading')} />}

      {tabs.length === 0 ? (
        showSessionsEvidence ? (
          // Saved-evidence fallback (slice 6): the live source is gone — the
          // frozen capture from the vault is the basis. Back returns to the
          // list (the sidebar stays mounted either way).
          <EvidenceViewer record={sessionsEvidence!.record} onBack={closeEvidence} />
        ) : showSessionsDetail ? (
          // One open external conversation, full work-area width.
          <SessionDetailView />
        ) : activePanel === 'knowledge' ? (
          // Knowledge workbench (reading workbench layout): four pages in the
          // main area while the sidebar owns topic navigation + 待处理 entries.
          // No file tab ever gets activity === 'knowledge' (detectActivity is
          // always 'files'), so this branch only replaces the empty state.
          <KnowledgeWorkbench />
        ) : (
          <div className="flex-1 flex items-center justify-center text-t3 text-[13px] select-none">
            {t(`shell:workArea.empty.${activePanel === 'calendar' ? 'calendar' : 'files'}`)}
          </div>
        )
      ) : showVersionHistoryDiff ? (
        // ponytail: editor area swapped for the version-history content view.
        // Renders in place of CodeMirror / custom editor / preview split so
        // the snapshot content gets the full editor canvas. The side panel
        // still owns the snapshot list.
        <VersionHistoryContentView />
      ) : (<>

      {/* Shell-editor (CodeMirror) pane — either the active edit/source mode,
          or the left side of a split. */}
      {(showCodeMirror || showCodeMirrorInSplit) && (
        <EditorPane
          ref={editorRef}
          activeTab={activeTab}
          onContentChange={updateTabContent}
          onSave={(tabId) => markTabDirty(tabId, false)}
          externalContentVersion={externalContentVersion}
          showLineNumbers={showLineNumbers}
          tabSize={settingsTabSize}
          wrapColumn={wrapColumn}
          editorFont={editorFont}
          editorFontSize={editorFontSize}
          style={showSplit ? { flexGrow: editorFlex, flexBasis: 0 } : undefined}
        />
      )}

      {/* Inline component editor (full area) — e.g. Excalidraw / rich-text,
          or the left side of a split when the provider's edit mode is a custom
          component. border-r border-brd mirrors EditorPane's divider. */}
      {(inlineMode || inlineEditorInSplit) && activeTab && (inlineMode ?? inlineEditorInSplit)?.component && (
        <div
          className={`flex-1 flex flex-col overflow-hidden editor-${handler?.id} ${showSplit ? 'border-r border-brd' : ''}`}
          style={showSplit ? { flexGrow: editorFlex, flexBasis: 0 } : undefined}
        >
          {(() => {
            const InlineEditor = (inlineMode ?? inlineEditorInSplit)!.component!;
            return (
              <InlineEditor
                key={`${activeTab.id}-${externalContentVersion}`}
                content={activeTab.content}
                tabId={activeTab.id}
                filePath={activeTab.path}
                onChange={(content: string) => updateTabContent(activeTab.id, content)}
                onSave={() => markTabDirty(activeTab.id, false)}
                vaultRoot={vaultRoot}
                mode={viewMode}
                readonly={false}
                signal={neverAborts}
              />
            );
          })()}
        </div>
      )}

      {/* Split resizer — sits between editor pane and preview pane.
          ponytail: visible 2px bar via w-[2px] inside a w-[6px] hit area
          with -mx-[2px] so it overlaps neighbors without shifting layout. */}
      {showSplitResizer && (
        <div
          className="shrink-0 cursor-col-resize -mx-[2px] group relative z-10"
          style={{ width: '6px' }}
          onMouseDown={() => {
            splitDragging.current = true;
            document.body.style.cursor = 'col-resize';
            document.documentElement.classList.add('is-resizing');
          }}
        >
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[2px] bg-transparent transition-[background] duration-[140ms] group-hover:bg-acc group-hover:opacity-30" />
        </div>
      )}

      {/* Render only the active web tab - webviews are cached at module level */}
      {activeTab && activeTab.fileType === 'web' && (() => {
        const webMode = getMode(getHandlerById('web'), 'edit');
        const WebComp = webMode?.kind === 'component' ? webMode.component : undefined;
        return WebComp ? (
          <div className="flex-1 flex flex-col overflow-hidden editor-web">
            <WebComp
              content={activeTab.content}
              tabId={activeTab.id}
              filePath={activeTab.path}
              onChange={(content: string) => updateTabContent(activeTab.id, content)}
              onSave={() => markTabDirty(activeTab.id, false)}
            />
          </div>
        ) : null;
      })()}

      {/* Preview panes — the preview-mode component (cursor-sync wrapper).
          The shown tab's pane plus the panes of recently shown tabs, kept
          mounted and hidden so iframes (HTML, PDF and other extension
          viewers) keep their document and inner scroll across tab switches.
          Keyed by tab and rendered in tab order: React never moves a kept
          node, and moving an iframe in the DOM would reload it. */}
      {previewTabs.map((tab) => {
        const shown = tab.id === activeTab?.id && showPreview;
        const mode = shown ? viewMode : (tab.viewMode ?? getDefaultMode(getHandlerById(tab.fileType)) ?? viewMode);
        // Narrow the loosely-typed mode component to PreviewProps (preview
        // components implement it at runtime; the SDK keeps the mode
        // component loosely-typed to avoid a React dep).
        const Comp = (shown ? previewMode : previewModeOf(getHandlerById(tab.fileType), mode))?.component as unknown as ComponentType<PreviewProps> | undefined;
        if (!Comp) return null;
        return (
          <PreviewPane
            key={tab.id}
            ref={shown ? previewBodyRef : undefined}
            active={shown}
            activeTab={tab}
            Preview={Comp}
            vaultRoot={vaultRoot}
            viewMode={mode}
            previewFlex={previewFlex}
            onChange={(content) => setContentExternal(tab.id, content)}
            onHeadingClick={shown && viewMode === 'split' ? scrollEditorToLine : undefined}
          />
        );
      })}

      {/* In-document find (spec 5.3) — the ONE shared find bar, editor and
          preview alike. Floats over the content area (above whatever mode is
          on screen); ⌘F is its only entry point. */}
      {findOpen && findEligible && activeTab && (
        <FindBar
          content={activeTab.content}
          tabId={activeTab.id}
          initialQuery={useFindUiStore.getState().queryByTab[activeTab.id]}
          onNavigate={handleFindNavigate}
          onClose={() => {
            useFindUiStore.getState().close(activeTab.id);
            // Editor mode: the bar took focus from the editor on open —
            // hand it back so Esc drops the user straight into editing.
            if (!showPreview) editorRef.current?.getView()?.focus();
          }}
        />
      )}

      {/* Outline (大纲 / TOC) sidebar — markdown only. Sibling of editor +
          preview at the split level so opening it shrinks BOTH panes
          proportionally (was: nested inside PreviewPane, which ate only the
          preview). Always mounted while a markdown preview is showing; the
          component reads `outlineVisible` itself and eases its width 0 ↔
          preferred so the whole split layout animates in lockstep. */}
      {showPreview && activeTab?.fileType === 'markdown' && (
        <OutlineSidebar
          content={activeTab.content}
          previewBodyRef={previewBodyRef}
          minAreaWidth={viewMode === 'split' ? 1280 : 1040}
          onHeadingClick={handleOutlineHeadingClick}
        />
      )}

      </>)}
      </div>{/* end content area */}

      {/* Version-history side panel (PR3). Mounts as an absolute overlay on
          the right edge of the work area so it covers all editor types
          (CodeMirror + custom) uniformly — single mount point, no per-type
          integration. Visibility gated by useEditorViewStateStore; the panel
          itself no-ops when the active tab is not a Versionable File. */}
      <VersionHistoryPanel activeTab={activeTab} />

      {/* Presentation mode (演示模式) — fixed fullscreen overlay above the
          whole work area. Entry: command palette / preview toolbar / rebindable
          shortcut (default Cmd/Ctrl+Shift+F5). Esc exits. */}
      {presentationMode && activeTab?.fileType === 'markdown' && (
        <PresentationOverlay
          content={activeTab.content}
          filePath={activeTab.path}
          vaultRoot={vaultRoot}
        />
      )}
    </div>
  );
}
