import { useState, useEffect, useRef, useCallback, forwardRef, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import type { FileTab, ViewMode } from '@/store/editorStore';
import type { PreviewProps } from '../file-types/types';
import { useEditorViewStateStore } from '@/store/editorViewState';
import { useEditorPrefsStore } from '@/store/editorPrefsStore';
import { debounce } from '@/utils/debounce';
import { MarkmapCanvas } from '../file-types/markmap/MarkmapCanvas';
import { resolveAssetBase } from '../file-types/previewPath';

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
}

export const PreviewPane = forwardRef<HTMLDivElement, PreviewPaneProps>(
  function PreviewPane(
    { activeTab, Preview, vaultRoot, viewMode, previewFlex, onChange },
    ref,
  ) {
    // ponytail: cursor line drives preview scroll-sync in split mode only.
    // In preview-only mode the editor is unmounted, so cursorLine never
    // changes; passing it would scroll to a stale position on tab switch.
    const cursorSyncPreview = useEditorPrefsStore((s) => s.cursorSyncPreview);
    const setCursorSyncPreview = useEditorPrefsStore((s) => s.setCursorSyncPreview);
    const { t } = useTranslation();
    const setPreviewScrollTop = useEditorViewStateStore((s) => s.setPreviewScrollTop);
    // ponytail: the .prev-body scroll container stays mounted across tab
    // switches (no key change), so without intervention it keeps the previous
    // file's scrollTop. Persist the scrollTop onto the active tab (throttled)
    // and restore the incoming tab's saved value on switch, mirroring the
    // editor's editorScrollTop. With cursorSyncPreview on, the restored value
    // equals the cursor-sync position (it was the sync that produced it), so
    // later cursor-sync effects keep it consistent instead of resetting.
    const bodyRef = useRef<HTMLDivElement | null>(null);
    const setBodyRef = useCallback((el: HTMLDivElement | null) => {
      bodyRef.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
    }, [ref]);
    const persistPreviewScrollRef = useRef<((top: number) => void) | null>(null);
    if (persistPreviewScrollRef.current === null) {
      persistPreviewScrollRef.current = debounce((top: number) => setPreviewScrollTop(top), 200);
    }
    const handleBodyScroll = useCallback(() => {
      persistPreviewScrollRef.current?.(bodyRef.current?.scrollTop ?? 0);
    }, []);
    const cursorLine = useEditorViewStateStore((s) => viewMode === 'split' && cursorSyncPreview ? s.cursorLine : 0);
    const cursorViewportY = useEditorViewStateStore((s) => viewMode === 'split' && cursorSyncPreview ? s.cursorViewportY : 0);
    const editorViewportTop = useEditorViewStateStore((s) => viewMode === 'split' && cursorSyncPreview ? s.editorViewportTop : 0);
    const hasSelection = useEditorViewStateStore((s) => viewMode === 'split' ? s.hasSelection : false);
    const outlineVisible = useEditorViewStateStore((s) => s.outlineVisible);
    const toggleOutline = useEditorViewStateStore((s) => s.toggleOutline);
    // Markmap preview toggle (markdown only). Default false = normal preview.
    const [markmapMode, setMarkmapMode] = useState(false);
    const [markmapAssetBase, setMarkmapAssetBase] = useState<string | null>(null);

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

    // ponytail: restore the saved preview scrollTop when switching tabs.
    // Layout (rendered markdown height, images) isn't settled until after a
    // frame, so apply on rAF — and re-apply on a second rAF to win against
    // late layout / cursor-sync scrolls that may reset it. Skipped on mount
    // (no prior position) when previewScrollTop is undefined.
    useEffect(() => {
      if (typeof activeTab.previewScrollTop !== 'number') return;
      const target = activeTab.previewScrollTop;
      const apply = () => { if (bodyRef.current) bodyRef.current.scrollTop = target; };
      requestAnimationFrame(() => {
        apply();
        requestAnimationFrame(apply);
      });
    }, [activeTab.id]);

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
    // the preview stays scrollable down to an empty doc.
    // Previously a hardcoded list of built-in ids gated this — that forced
    // every extension file-type to either inherit markdown's bottom pad
    // (broken) or edit host source to be added to the list.
    const fullBleed = activeTab.fileType !== 'markdown';

    return (
      <div
        className="flex-1 flex flex-col overflow-hidden min-w-[200px]"
        style={{ ...(viewMode === 'split' ? { flexGrow: previewFlex, flexBasis: 0 } : {}), position: 'relative' }}
      >
        {/* Preview-mode toggle (markmap) + outline toggle -- markdown only */}
        {activeTab.fileType === 'markdown' && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2 z-10 flex flex-col gap-1.5">
            <button
              className={`flex items-center justify-center w-7 h-7 rounded-[6px] cursor-pointer border transition-all duration-[140ms] shadow-[0_1px_4px_rgba(0,0,0,0.08)] ${markmapMode ? 'bg-act text-acc border-acc' : 'bg-panel border-brd text-t3 hover:bg-hov hover:text-t1 hover:border-brd2'}`}
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
              className={`flex items-center justify-center w-7 h-7 rounded-[6px] cursor-pointer border transition-all duration-[140ms] shadow-[0_1px_4px_rgba(0,0,0,0.08)] ${outlineVisible ? 'bg-act text-acc border-acc' : 'bg-panel border-brd text-t3 hover:bg-hov hover:text-t1 hover:border-brd2'}`}
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
            {viewMode === 'split' && (
              <button
                className={`flex items-center justify-center w-7 h-7 rounded-[6px] cursor-pointer border transition-all duration-[140ms] shadow-[0_1px_4px_rgba(0,0,0,0.08)] ${cursorSyncPreview ? 'bg-act text-acc border-acc' : 'bg-panel border-brd text-t3 hover:bg-hov hover:text-t1 hover:border-brd2'}`}
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
          {activeTab.fileType === 'markdown' ? (
            <>
              {/* ponytail: MarkdownPreview stays mounted across the markmap
                  toggle so switching back doesn't re-run the unified pipeline
                  (1-2s lag). Hidden via CSS instead of unmounted. MarkmapCanvas
                  still mounts on demand to avoid running markmap-lib transform
                  in the background for every markdown file. */}
              <div
                className={`prev-body flex-1 overflow-auto pt-2 px-8 pb-[100vh] ${markmapMode ? 'hidden' : 'block'}`}
                ref={setBodyRef}
                onScroll={handleBodyScroll}
              >
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
                <div className="prev-body flex-1 h-full overflow-hidden">
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
        </div>
      </div>
    );
  },
);
