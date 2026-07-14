import { useRef, useState, useEffect, useCallback, forwardRef, type ComponentType } from 'react';
import type { FileTab, ViewMode } from '@/store/editorStore';
import type { PreviewProps } from '../file-types/types';
import { extractHeadings } from '@/utils/markdownUtils';

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
    const [outlineVisible, setOutlineVisible] = useState(false);
    const [outlineWidth, setOutlineWidth] = useState(180);
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
          document.body.style.userSelect = '';
        }
      };
      document.addEventListener('mousemove', handleOutlineMove);
      document.addEventListener('mouseup', handleOutlineUp);
      return () => {
        document.removeEventListener('mousemove', handleOutlineMove);
        document.removeEventListener('mouseup', handleOutlineUp);
      };
    }, []);

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

    const fullBleed = ['csv', 'office', 'dbml', 'json', 'mmap'].includes(activeTab.fileType);

    return (
      <div
        className="flex-1 flex flex-col overflow-hidden min-w-[200px]"
        ref={paneRef}
        style={{ ...(viewMode === 'split' ? { flex: previewFlex } : {}), position: 'relative' }}
      >
        {/* Outline toggle -- markdown only */}
        {activeTab.fileType === 'markdown' && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2 z-10">
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
          <div
            className={
              fullBleed
                ? 'prev-body flex-1 h-full overflow-auto'
                : 'prev-body flex-1 overflow-auto pt-2 px-8 pb-[80vh]'
            }
            ref={setBodyRef}
          >
            <Preview
              content={activeTab.content}
              filePath={activeTab.path}
              vaultRoot={vaultRoot}
              onChange={onChange}
            />
          </div>
          {activeTab.fileType === 'markdown' && outlineVisible && (
            <div className="shrink-0 overflow-y-auto border-l border-brd bg-panel relative flex flex-col" style={{ width: `${outlineWidth}px` }}>
              <div
                className="absolute -left-[3px] top-0 bottom-0 w-1.5 cursor-col-resize z-[5]"
                onMouseDown={() => {
                  outlineDragging.current = true;
                  document.body.style.cursor = 'col-resize';
                  document.body.style.userSelect = 'none';
                }}
              />
              <div className="text-[10px] font-semibold text-t3 uppercase tracking-[0.08em] pt-3 px-[14px] pb-2 border-b border-brd flex items-center gap-1.5 before:content-[''] before:inline-block before:w-[3px] before:h-2.5 before:bg-acc before:rounded-[2px] before:shrink-0">大纲</div>
              <div className="py-2 px-1.5 flex-1 overflow-y-auto">
                {(() => {
                  const headings = extractHeadings(activeTab?.content ?? '');
                  if (headings.length === 0) {
                    return <p className="text-[11px] text-t3 py-5 px-3 text-center leading-[1.6]">暂无标题</p>;
                  }
                  return headings.map((heading, index) => (
                    <div
                      key={index}
                      className="text-[11.5px] text-t2 py-[5px] px-2.5 cursor-pointer transition-all duration-[120ms] rounded border-l-2 border-l-transparent overflow-hidden text-ellipsis whitespace-nowrap my-px relative hover:bg-hov hover:text-t1 hover:border-l-acc"
                      style={{ paddingLeft: `${8 + (heading.level - 1) * 12}px` }}
                      title={`Ln ${heading.line}`}
                      onClick={() => handleHeadingClick(heading.text)}
                    >
                      {heading.text}
                    </div>
                  ));
                })()}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  },
);
