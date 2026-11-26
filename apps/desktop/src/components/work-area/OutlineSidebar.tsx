import { useState, useRef, useEffect, useMemo } from 'react';
import { useEditorViewStateStore } from '@/store/editorViewState';
import {
  computeOutlineSource,
  mergeOutlineVisibility,
  computeActiveHeading,
  type OutlineItem,
} from '@/components/file-types/markdown/outlineModel';

interface OutlineSidebarProps {
  content: string;
  previewBodyRef: React.RefObject<HTMLDivElement | null>;
  onHeadingClick: (line: number) => void;
  /** Split-area width below which the outline auto-collapses. */
  minAreaWidth: number;
}

/**
 * Markdown outline (大纲 / TOC) sidebar — refactor spec Phase 4. Rendered as
 * a shrink-0 flex sibling of the editor + preview at the split-container
 * level so opening it shrinks BOTH panes proportionally — it does not live
 * inside the preview pane (which would eat only the preview). Visibility is
 * toggled by the button in PreviewPane via the store `outlineVisible` flag;
 * this component reads it directly and eases its width 0 ↔ preferred so the
 * whole split layout animates in lockstep.
 *
 * The list is the DOM-merged outline model (outlineModel.ts): only headings
 * the reader can actually see — inactive tab panels and closed collapsibles
 * drop out, open containers keep theirs. A MutationObserver (style/class,
 * 150ms debounce) re-merges when React flips panels/collapsibles or the
 * windowed chunker mounts content.
 *
 * Scroll-spy: the preview body's passive scroll listener (rAF-throttled)
 * recomputes the active heading; the active entry is scrolled into view
 * within the sidebar (`nearest`). ResizeObserver on the split area drops
 * the outline below `minAreaWidth` (auto-collapse).
 *
 * Drag width is internal; the panel's right edge is pinned to the container
 * edge, so the drag handler reads that right edge off the panel's own rect —
 * no external container ref needed. The width transition is suppressed while
 * dragging so the edge tracks the cursor 1:1 instead of lagging.
 *
 * No header bar: the entries list runs edge-to-edge — the sidebar is
 * reading chrome, not a titled panel.
 */
export function OutlineSidebar({ content, previewBodyRef, onHeadingClick, minAreaWidth }: OutlineSidebarProps) {
  const visible = useEditorViewStateStore((s) => s.outlineVisible);
  const [width, setWidth] = useState(300);
  const [isDragging, setIsDragging] = useState(false);
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const draggingRef = useRef(false);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef(content);
  contentRef.current = content;

  // Source model (headings + directive spans) recomputed per content edit;
  // the DOM-visible merge runs on mutations below.
  const source = useMemo(() => computeOutlineSource(content), [content]);
  const [items, setItems] = useState<OutlineItem[]>(() =>
    mergeOutlineVisibility(source, previewBodyRef.current),
  );
  // Prime the list when the source changes (parse landed / doc switched).
  useEffect(() => {
    setItems(mergeOutlineVisibility(source, previewBodyRef.current));
  }, [source, previewBodyRef]);

  // Re-merge when React flips panels/collapsibles or chunks mount/unmount.
  useEffect(() => {
    const body = previewBodyRef.current;
    if (!body) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const remeasure = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        setItems(mergeOutlineVisibility(computeOutlineSource(contentRef.current), body));
      }, 150);
    };
    const obs = new MutationObserver(remeasure);
    obs.observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    return () => {
      obs.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [previewBodyRef, visible]);

  // Scroll-spy: passive + rAF-throttled recompute of the active heading.
  useEffect(() => {
    const body = previewBodyRef.current;
    if (!body) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      setActiveLine(computeActiveHeading(body, mergeOutlineVisibility(computeOutlineSource(contentRef.current), body))?.line ?? null);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    body.addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => {
      body.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [previewBodyRef, items, visible]);

  // Keep the active entry in view inside the sidebar itself.
  useEffect(() => {
    if (activeLine == null) return;
    const list = listRef.current;
    if (!list) return;
    list.querySelector(`[data-line="${activeLine}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeLine]);

  // Auto-collapse below minAreaWidth (one-way: re-opening is the reader's
  // call, never automatic).
  useEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (parent.clientWidth < minAreaWidth && useEditorViewStateStore.getState().outlineVisible) {
        useEditorViewStateStore.getState().setOutlineVisible(false);
      }
    });
    ro.observe(parent);
    return () => ro.disconnect();
  }, [minAreaWidth]);

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
      <div ref={listRef} className="pt-2 pb-2 px-1.5 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <p className="text-[11px] text-t3 py-5 px-3 text-center leading-[1.6]">暂无标题</p>
        ) : (
          items.map((item) => {
            const lvl = item.level;
            const size = lvl <= 1 ? 'text-[12.5px]' : lvl === 2 ? 'text-[11.5px]' : 'text-[11px]';
            const weight = lvl <= 2 ? 'font-semibold' : 'font-normal';
            const active = item.line === activeLine;
            const color = active ? 'text-t1' : lvl <= 1 ? 'text-t1' : lvl === 2 ? 'text-t2' : 'text-t3';
            return (
              <div
                key={item.line}
                data-line={item.line}
                className={`${size} ${weight} ${color} py-[5px] px-2.5 cursor-pointer transition-all duration-[120ms] rounded border-l-2 overflow-hidden text-ellipsis whitespace-nowrap my-px relative ${
                  active ? 'border-l-acc bg-hov' : 'border-l-transparent hover:bg-hov hover:text-t1 hover:border-l-acc'
                }`}
                style={{ paddingLeft: `${8 + (lvl - 1) * 12}px` }}
                title={`Ln ${item.line}`}
                onClick={() => onHeadingClick(item.line)}
              >
                {item.text}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
