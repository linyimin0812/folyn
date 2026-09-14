import { useState, useRef, useEffect } from 'react';
import { useEditorViewStateStore } from '@/store/editorViewState';
import { extractHeadings } from '@/utils/markdownUtils';

interface OutlineSidebarProps {
  content: string;
  onHeadingClick: (headingText: string) => void;
}

/**
 * Markdown outline (大纲 / TOC) sidebar. Rendered as a shrink-0 flex sibling
 * of the editor + preview at the split-container level so opening it shrinks
 * BOTH panes proportionally — it does not live inside the preview pane (which
 * would eat only the preview). Visibility is toggled by the button in
 * PreviewPane via the store `outlineVisible` flag; this component reads it
 * directly and animates its width 0 ↔ preferred so the whole split layout
 * (editor + preview) eases in/out in lockstep, since the flex container
 * relayouts every animation frame off the sidebar's transitioning width.
 *
 * Drag width is internal; the panel's right edge is pinned to the container
 * edge, so the drag handler reads that right edge off the panel's own rect —
 * no external container ref needed. The width transition is suppressed while
 * dragging so the edge tracks the cursor 1:1 instead of lagging.
 */
export function OutlineSidebar({ content, onHeadingClick }: OutlineSidebarProps) {
  const visible = useEditorViewStateStore((s) => s.outlineVisible);
  const [width, setWidth] = useState(300);
  const [isDragging, setIsDragging] = useState(false);
  const draggingRef = useRef(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!draggingRef.current || !ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      setWidth(Math.max(200, Math.min(560, rect.right - e.clientX)));
    };
    const handleUp = () => {
      if (draggingRef.current) {
        draggingRef.current = false;
        setIsDragging(false);
        document.body.style.cursor = '';
        document.documentElement.classList.remove('is-resizing');
      }
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, []);

  const headings = extractHeadings(content);

  return (
    <div
      ref={ref}
      className={`shrink-0 overflow-hidden bg-panel relative flex flex-col ${visible ? 'border-l border-brd pointer-events-auto' : 'pointer-events-none'}`}
      style={{
        width: visible ? `${width}px` : 0,
        transition: isDragging ? 'none' : 'width 240ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <div
        className="absolute -left-[3px] top-0 bottom-0 w-1.5 cursor-col-resize z-[5]"
        onMouseDown={() => {
          draggingRef.current = true;
          setIsDragging(true);
          document.body.style.cursor = 'col-resize';
          document.documentElement.classList.add('is-resizing');
        }}
      />
      <div className="text-[10px] font-semibold text-t3 uppercase tracking-[0.08em] pt-3 px-[14px] pb-2 border-b border-brd flex items-center gap-1.5 before:content-[''] before:inline-block before:w-[3px] before:h-2.5 before:bg-acc before:rounded-[2px] before:shrink-0">大纲</div>
      <div className="py-2 px-1.5 flex-1 overflow-y-auto">
        {headings.length === 0 ? (
          <p className="text-[11px] text-t3 py-5 px-3 text-center leading-[1.6]">暂无标题</p>
        ) : (
          headings.map((heading, index) => {
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
                onClick={() => onHeadingClick(heading.text)}
              >
                {heading.text}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
