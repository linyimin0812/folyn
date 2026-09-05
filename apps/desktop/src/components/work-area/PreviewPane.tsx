import { useRef, useState, useEffect, useCallback, forwardRef, type ComponentType } from 'react';
import type { FileTab, ViewMode } from '@/store/editorStore';
import type { PreviewProps } from '../file-types/types';
import { useEditorViewStateStore } from '@/store/editorViewState';
import { extractHeadings } from '@/utils/markdownUtils';
import { MarkmapCanvas } from '../file-types/markmap/MarkmapCanvas';
import { resolveAssetBase } from '../file-types/previewPath';

interface PreviewPaneProps {
  activeTab: FileTab;
  Preview: ComponentType<PreviewProps>;
  vaultRoot: string;
  viewMode: ViewMode;
  previewFlex?: number;
  onScrollToHeading: (headingText: string) => void;
  /**
   * Optional write-back for preview components that support in-place editing
   * (e.g. JSON file viewer). Forwarded to the rendered `<Preview>`.
   */
  onChange?: (content: string) => void;
}

export const PreviewPane = forwardRef<HTMLDivElement, PreviewPaneProps>(
  function PreviewPane(
    { activeTab, Preview, vaultRoot, viewMode, previewFlex, onScrollToHeading, onChange },
    ref,
  ) {
    // ponytail: cursor line drives preview scroll-sync in split mode only.
    // In preview-only mode the editor is unmounted, so cursorLine never
    // changes; passing it would scroll to a stale position on tab switch.
    const cursorLine = useEditorViewStateStore((s) => viewMode === 'split' ? s.cursorLine : 0);
    const cursorViewportY = useEditorViewStateStore((s) => viewMode === 'split' ? s.cursorViewportY : 0);
    const editorViewportTop = useEditorViewStateStore((s) => viewMode === 'split' ? s.editorViewportTop : 0);
    const cursorCol = useEditorViewStateStore((s) => viewMode === 'split' ? s.cursorCol : 1);
    const lineLength = useEditorViewStateStore((s) => viewMode === 'split' ? s.lineLength : 1);
    const hasSelection = useEditorViewStateStore((s) => viewMode === 'split' ? s.hasSelection : false);
    const [outlineVisible, setOutlineVisible] = useState(false);
    const [outlineWidth, setOutlineWidth] = useState(180);
    // Markmap preview toggle (markdown only). Default false = normal preview.
    const [markmapMode, setMarkmapMode] = useState(false);
    const [markmapAssetBase, setMarkmapAssetBase] = useState<string | null>(null);
    const outlineDragging = useRef(false);
    const paneRef = useRef<HTMLDivElement>(null);
    const localBodyRef = useRef<HTMLDivElement | null>(null);

    // Merge local and forwarded refs on the prev-body div
    const setBodyRef = useCallback(
      (node: HTMLDivElement | null) => {
        localBodyRef.current = node;
        if (typeof ref === 'function') {
          ref(node);
        } else if (ref) {
          (ref as { current: HTMLDivElement | null }).current = node;
        }
      },
      [ref],
    );

    // Outline resize drag handling
    useEffect(() => {
      const handleOutlineMove = (e: MouseEvent) => {
        if (!outlineDragging.current || !paneRef.current) return;
        const rect = paneRef.current.getBoundingClientRect();
        const newWidth = Math.max(120, Math.min(400, rect.right - e.clientX));
        setOutlineWidth(newWidth);
      };
      const handleOutlineUp = () => {
        if (outlineDragging.current) {
          outlineDragging.current = false;
          document.body.style.cursor = '';
          document.documentElement.classList.remove('is-resizing');
        }
      };
      document.addEventListener('mousemove', handleOutlineMove);
      document.addEventListener('mouseup', handleOutlineUp);
      return () => {
        document.removeEventListener('mousemove', handleOutlineMove);
        document.removeEventListener('mouseup', handleOutlineUp);
      };
    }, []);

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

    const handleHeadingClick = useCallback(
      (headingText: string) => {
        // Scroll preview to the heading element
        const container = localBodyRef.current;
        if (container) {
          const headingId = headingText
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^\w一-鿿-]/g, '');
          const target = container.querySelector(`#${CSS.escape(headingId)}`);
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
        // Notify parent to scroll the editor as well
        onScrollToHeading(headingText);
      },
      [onScrollToHeading],
    );

    // ponytail: full-bleed is the DEFAULT (zero host padding — the preview
    // component manages its own padding). Only markdown needs the host's
    // pt-2 px-8 pb-[80vh] padding (the 80vh bottom space lets outline heading
    // clicks park the last heading at the top of the viewport).
    // Previously a hardcoded list of built-in ids gated this — that forced
    // every plugin file-type to either inherit markdown's 80vh bottom pad
    // (broken) or edit host source to be added to the list.
    const fullBleed = activeTab.fileType !== 'markdown';

    return (
      <div
        className="flex-1 flex flex-col overflow-hidden min-w-[200px]"
        ref={paneRef}
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
              onClick={() => setOutlineVisible((v) => !v)}
              title="大纲"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                <line x1="2" y1="3.5" x2="14" y2="3.5" />
                <line x1="4" y1="6.5" x2="14" y2="6.5" />
                <line x1="4" y1="9.5" x2="14" y2="9.5" />
                <line x1="2" y1="12.5" x2="14" y2="12.5" />
              </svg>
            </button>
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
                className={`prev-body flex-1 overflow-auto pt-2 px-8 pb-[80vh] ${markmapMode ? 'hidden' : 'block'}`}
                ref={setBodyRef}
              >
                <Preview
                  content={activeTab.content}
                  filePath={activeTab.path}
                  vaultRoot={vaultRoot}
                  cursorLine={cursorLine}
                  cursorViewportY={cursorViewportY}
                  editorViewportTop={editorViewportTop}
                  cursorCol={cursorCol}
                  lineLength={lineLength}
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
              className={fullBleed ? 'prev-body flex-1 h-full overflow-auto' : 'prev-body flex-1 overflow-auto pt-2 px-8 pb-[80vh]'}
              ref={setBodyRef}
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
          {activeTab.fileType === 'markdown' && outlineVisible && (
            <div className="shrink-0 overflow-y-auto border-l border-brd bg-panel relative flex flex-col" style={{ width: `${outlineWidth}px` }}>
              <div
                className="absolute -left-[3px] top-0 bottom-0 w-1.5 cursor-col-resize z-[5]"
                onMouseDown={() => {
                  outlineDragging.current = true;
                  document.body.style.cursor = 'col-resize';
                  document.documentElement.classList.add('is-resizing');
                }}
              />
              <div className="text-[10px] font-semibold text-t3 uppercase tracking-[0.08em] pt-3 px-[14px] pb-2 border-b border-brd flex items-center gap-1.5 before:content-[''] before:inline-block before:w-[3px] before:h-2.5 before:bg-acc before:rounded-[2px] before:shrink-0">大纲</div>
              <div className="py-2 px-1.5 flex-1 overflow-y-auto">
                {(() => {
                  const headings = extractHeadings(activeTab?.content ?? '');
                  if (headings.length === 0) {
                    return <p className="text-[11px] text-t3 py-5 px-3 text-center leading-[1.6]">暂无标题</p>;
                  }
                  return headings.map((heading, index) => {
                    const lvl = heading.level;
                    const size = lvl <= 1 ? 'text-[12.5px]' : lvl === 2 ? 'text-[11.5px]' : 'text-[11px]';
                    const weight = lvl <= 2 ? 'font-semibold' : 'font-normal';
                    const color = lvl <= 1 ? 'text-t1' : lvl === 2 ? 'text-t2' : 'text-t3';
                    return (
                    <div
                      key={index}
                      className={`${size} ${weight} ${color} py-[5px] px-2.5 cursor-pointer transition-all duration-[120ms] rounded border-l-2 border-l-transparent overflow-hidden text-ellipsis whitespace-nowrap my-px relative hover:bg-hov hover:text-t1 hover:border-l-acc`}
                      style={{ paddingLeft: `${8 + (lvl - 1) * 12}px` }}
                      title={`Ln ${heading.line}`}
                      onClick={() => handleHeadingClick(heading.text)}
                    >
                      {heading.text}
                    </div>
                    );
                  });
                })()}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  },
);
