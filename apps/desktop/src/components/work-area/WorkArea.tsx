import { useRef, useState, useCallback, useEffect } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useVaultStore } from '@/store/vaultStore';
import { isTauri } from '@/utils/platform';
import type { QuillEditorHandle } from '@/editor/EditorView';
import { EditorView } from '@codemirror/view';
import { getHandlerById } from '../file-types/registry';
import { WikiGraphView } from '../graph/WikiGraphView';
import { webviewCache } from '../file-types/web/WebViewer';
import { TabBar } from './TabBar';
import { EditorPane } from './EditorPane';
import { PreviewPane } from './PreviewPane';
import { DailyDigest } from '../editor/DailyDigest';


export function WorkArea() {
  const viewMode = useEditorStore((state) => state.viewMode);
  const setViewMode = useEditorStore((state) => state.setViewMode);
  const activePanel = useEditorStore((state) => state.activePanel);
  const activeTabId = useEditorStore((state) => state.activeTabId);
  const allTabs = useEditorStore((state) => state.tabs);
  const setActiveTab = useEditorStore((state) => state.setActiveTab);
  const closeTab = useEditorStore((state) => state.closeTab);
  const updateTabContent = useEditorStore((state) => state.updateTabContent);
  const markTabDirty = useEditorStore((state) => state.markTabDirty);
  const isFileLoading = useEditorStore((state) => state.isFileLoading);
  const externalContentVersion = useEditorStore((state) => state.externalContentVersion);

  // Filter tabs by the active activity panel
  const tabs = allTabs.filter((t) => t.activity === activePanel);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const showLineNumbers = useSettingsStore((s) => s.showLineNumbers);
  const settingsTabSize = useSettingsStore((s) => s.tabSize);
  const wrapColumn = useSettingsStore((s) => s.wrapColumn);
  const editorFont = useSettingsStore((s) => s.editorFont);
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  const vaultRoot = useVaultStore((s) => s.currentVault?.basePath ?? '');

  const editorRef = useRef<QuillEditorHandle>(null);
  const prevBodyRef = useRef<HTMLDivElement>(null);

  // Get the handler for the active tab
  const handler = activeTab ? getHandlerById(activeTab.fileType) : undefined;

  // Hide all webviews when switching to a non-web tab
  const prevTabIdRef = useRef<string | null>(null);
  const prevWasWebRef = useRef(false);

  useEffect(() => {
    if (activeTabId !== prevTabIdRef.current) {
      const wasWeb = prevWasWebRef.current;
      const isWeb = activeTab?.fileType === 'web';

      // Hide all webviews when switching away from a web tab or between web tabs
      if (wasWeb || isWeb) {
        if (isTauri()) {
          const labels = Array.from(webviewCache.values()).map(wv => wv.label);
          if (labels.length > 0) {
            import('@tauri-apps/api/core').then(({ invoke }) => {
              invoke('hide_all_webviews', { labels }).catch(() => {});
            });
          }
        }
      }

      prevTabIdRef.current = activeTabId;
      prevWasWebRef.current = isWeb;
    }

    if (activeTabId && handler?.defaultViewMode && !activeTab?.viewMode && viewMode !== handler.defaultViewMode) {
      setViewMode(handler.defaultViewMode);
    }
  }, [activeTabId, handler, viewMode, setViewMode, activeTab]);

  // Pane resize (editor vs preview split ratio)
  const [editorFlex, setEditorFlex] = useState(1);
  const [previewFlex, setPreviewFlex] = useState(1);
  const splitDragging = useRef(false);
  const splitContainerRef = useRef<HTMLDivElement>(null);

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

  // ── Synchronized scrolling between editor and preview (markdown split mode) ──
  const scrollSourceRef = useRef<'editor' | 'preview' | null>(null);
  const scrollResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (viewMode !== 'split' || activeTab?.fileType !== 'markdown') return;

    const scrollDOM = editorRef.current?.getScrollDOM();
    const previewDOM = prevBodyRef.current;
    if (!scrollDOM || !previewDOM) return;

    function resetScrollSource() {
      if (scrollResetTimer.current) clearTimeout(scrollResetTimer.current);
      scrollResetTimer.current = setTimeout(() => {
        scrollSourceRef.current = null;
      }, 150);
    }

    function handleEditorScroll() {
      if (scrollSourceRef.current === 'preview') return;
      scrollSourceRef.current = 'editor';
      resetScrollSource();

      const view = editorRef.current?.getView();
      if (!view || !previewDOM) return;

      const topBlock = view.lineBlockAtHeight(scrollDOM!.scrollTop);
      const topLine = view.state.doc.lineAt(topBlock.from).number;

      const anchors = previewDOM.querySelectorAll<HTMLElement>('[data-source-line]');
      if (anchors.length === 0) return;

      let lo = 0, hi = anchors.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (parseInt(anchors[mid].dataset.sourceLine!) <= topLine) lo = mid;
        else hi = mid - 1;
      }

      const anchorEl = anchors[lo];
      const anchorLine = parseInt(anchorEl.dataset.sourceLine!);

      if (lo + 1 < anchors.length) {
        const nextEl = anchors[lo + 1];
        const nextLine = parseInt(nextEl.dataset.sourceLine!);
        const progress = nextLine > anchorLine
          ? (topLine - anchorLine) / (nextLine - anchorLine)
          : 0;
        const anchorTop = anchorEl.offsetTop;
        const nextTop = nextEl.offsetTop;
        previewDOM.scrollTop = anchorTop + (nextTop - anchorTop) * progress;
      } else {
        previewDOM.scrollTop = anchorEl.offsetTop;
      }
    }

    function handlePreviewScroll() {
      if (scrollSourceRef.current === 'editor') return;
      scrollSourceRef.current = 'preview';
      resetScrollSource();

      const view = editorRef.current?.getView();
      if (!view || !previewDOM) return;

      const scrollTop = previewDOM.scrollTop;
      const anchors = previewDOM.querySelectorAll<HTMLElement>('[data-source-line]');
      if (anchors.length === 0) return;

      let target: HTMLElement | null = null;
      for (const anchor of anchors) {
        if (anchor.offsetTop <= scrollTop + 10) target = anchor;
        else break;
      }
      if (!target) target = anchors[0];

      const targetLine = parseInt(target.dataset.sourceLine!);
      const lineCount = view.state.doc.lines;
      if (targetLine < 1 || targetLine > lineCount) return;

      const lineInfo = view.state.doc.line(targetLine);
      const block = view.lineBlockAt(lineInfo.from);
      scrollDOM!.scrollTop = block.top;
    }

    let editorRaf = 0;
    let previewRaf = 0;

    const onEditorScroll = () => {
      cancelAnimationFrame(editorRaf);
      editorRaf = requestAnimationFrame(handleEditorScroll);
    };
    const onPreviewScroll = () => {
      cancelAnimationFrame(previewRaf);
      previewRaf = requestAnimationFrame(handlePreviewScroll);
    };

    scrollDOM.addEventListener('scroll', onEditorScroll, { passive: true });
    previewDOM.addEventListener('scroll', onPreviewScroll, { passive: true });

    return () => {
      scrollDOM.removeEventListener('scroll', onEditorScroll);
      previewDOM.removeEventListener('scroll', onPreviewScroll);
      cancelAnimationFrame(editorRaf);
      cancelAnimationFrame(previewRaf);
      if (scrollResetTimer.current) clearTimeout(scrollResetTimer.current);
    };
  }, [viewMode, activeTab?.fileType, activeTabId]);

  // Scroll editor to a heading (called from PreviewPane outline clicks)
  const scrollEditorToHeading = useCallback((headingText: string) => {
    const view = editorRef.current?.getView();
    if (!view) return;
    const doc = view.state.doc;
    for (let lineNum = 1; lineNum <= doc.lines; lineNum++) {
      const line = doc.line(lineNum);
      const headingMatch = line.text.match(/^(#{1,6})\s+(.*)/);
      if (headingMatch && headingMatch[2].trim() === headingText.trim()) {
        view.dispatch({
          effects: EditorView.scrollIntoView(line.from, { y: 'start' }),
        });
        break;
      }
    }
  }, []);

  // Determine what to show
  const showCodeMirror = handler?.useCodeMirror && (viewMode === 'edit' || viewMode === 'split' || !handler.Preview);
  const showCustomEditor = handler?.Editor && !handler.useCodeMirror && !(viewMode === 'preview' && handler?.Preview);
  const isPreviewOnly = handler?.Preview && !handler.useCodeMirror && !handler.Editor;
  const showPreview = handler?.Preview && (isPreviewOnly || viewMode === 'preview' || viewMode === 'split');
  const showSplitResizer = handler?.useCodeMirror && handler?.Preview && viewMode === 'split';

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg" ref={splitContainerRef}>
      {/* File tabs */}
      {tabs.length > 0 && (
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={setActiveTab}
          onCloseTab={closeTab}
        />
      )}

      {/* Content area */}
      <div className="flex-1 flex overflow-hidden">

      {activeTab && activeTab.path === 'wiki-graph' ? (
        <WikiGraphView />
      ) : tabs.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-t3 text-[13px] select-none">
          {activePanel === 'clips' ? '暂无剪藏' : activePanel === 'wiki' ? '暂无 Wiki 页面' : activePanel === 'calendar' ? '暂无日记' : activePanel === 'analyze' ? '暂无分析报告' : '暂无打开的文件'}
        </div>
      ) : (<>

      {/* CodeMirror editor pane */}
      {showCodeMirror && (
        <EditorPane
          ref={editorRef}
          activeTab={activeTab}
          onContentChange={updateTabContent}
          onSave={(tabId) => markTabDirty(tabId, false)}
          externalContentVersion={externalContentVersion}
          isFileLoading={isFileLoading}
          showLineNumbers={showLineNumbers}
          tabSize={settingsTabSize}
          wrapColumn={wrapColumn}
          editorFont={editorFont}
          editorFontSize={editorFontSize}
          style={handler?.Preview && viewMode === 'split' ? { flex: editorFlex } : undefined}
        />
      )}

      {/* Split resizer */}
      {showSplitResizer && (
        <div
          className="w-[2px] shrink-0 cursor-col-resize bg-transparent transition-[background] duration-[140ms] hover:bg-acc hover:opacity-30"
          onMouseDown={() => {
            splitDragging.current = true;
            document.body.style.cursor = 'col-resize';
            document.documentElement.classList.add('is-resizing');
          }}
        />
      )}

      {/* Custom editor (full area) — e.g. Excalidraw */}
      {showCustomEditor && activeTab && handler?.Editor && activeTab.fileType !== 'web' && (
        <div className={`flex-1 flex flex-col overflow-hidden editor-${handler.id}`}>
          <handler.Editor
            key={`${activeTab.id}-${externalContentVersion}`}
            content={activeTab.content}
            tabId={activeTab.id}
            filePath={activeTab.path}
            onChange={(content) => updateTabContent(activeTab.id, content)}
            onSave={() => markTabDirty(activeTab.id, false)}
          />
        </div>
      )}

      {/* Render only the active web tab - webviews are cached at module level */}
      {activeTab && activeTab.fileType === 'web' && (() => {
        const webHandler = getHandlerById(activeTab.fileType);
        return webHandler?.Editor ? (
          <div className="flex-1 flex flex-col overflow-hidden editor-web">
            <webHandler.Editor
              content={activeTab.content}
              tabId={activeTab.id}
              filePath={activeTab.path}
              onChange={(content) => updateTabContent(activeTab.id, content)}
              onSave={() => markTabDirty(activeTab.id, false)}
            />
          </div>
        ) : null;
      })()}

      {/* Preview pane */}
      {showPreview && activeTab && handler?.Preview && (
        <PreviewPane
          ref={prevBodyRef}
          activeTab={activeTab}
          Preview={handler.Preview}
          vaultRoot={vaultRoot}
          viewMode={viewMode}
          previewFlex={previewFlex}
          onScrollToHeading={scrollEditorToHeading}
        />
      )}

      </>)}
      </div>{/* end content area */}

      {activeTab?.fileType === 'markdown' && (
        <DailyDigest
          currentFilePath={activeTab.path}
          onInsertContent={(content) => {
            const view = editorRef.current?.getView();
            if (view) {
              const pos = view.state.doc.length;
              view.dispatch({
                changes: { from: pos, insert: content },
              });
            }
          }}
        />
      )}
    </div>
  );
}
