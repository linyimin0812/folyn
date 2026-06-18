import { useEffect, useRef } from 'react';

interface RectLike {
  top: number;
  left: number;
  bottom: number;
  right: number;
  width?: number;
  height?: number;
}

interface FloatingToolbarProps {
  rect: RectLike;
  iframeRect: RectLike;
  tagName: string;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEditAttrs: () => void;
  onEditStyle: () => void;
}

export function FloatingToolbar({
  rect,
  iframeRect,
  tagName,
  onDelete,
  onMoveUp,
  onMoveDown,
  onEditAttrs,
  onEditStyle,
}: FloatingToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);

  // Calculate position: element rect relative to iframe + iframe position on page
  const top = iframeRect.top + rect.top;
  const left = iframeRect.left + rect.left;
  const toolbarHeight = 36; // approximate toolbar height
  const spaceBelow = window.innerHeight - (iframeRect.top + rect.bottom);
  const flipUp = spaceBelow < toolbarHeight + 8;

  const toolbarTop = flipUp
    ? top - toolbarHeight - 4
    : iframeRect.top + rect.bottom + 4;

  const toolbarLeft = Math.max(8, Math.min(left, window.innerWidth - 200));

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        // Don't deselect when clicking on edit panels (attr/style)
        if ((e.target as HTMLElement).closest?.('[data-quill-panel]')) return;
        onDelete(); // Close by deselecting
      }
    }
    // Delay to avoid immediate trigger from the click that opened it
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onDelete]);

  const buttonClass =
    'w-7 h-7 flex items-center justify-center rounded hover:bg-hov text-t2 hover:text-t1 transition-colors duration-100';

  return (
    <div
      ref={toolbarRef}
      className="fixed bg-panel border border-brd2 rounded-lg shadow-lg z-40 flex items-center gap-0.5 p-0.5"
      style={{
        top: toolbarTop,
        left: toolbarLeft,
      }}
    >
      {/* Tag name indicator */}
      <span className="text-[10px] text-t3 px-1.5 py-0.5 font-mono select-none">{tagName}</span>
      <div className="w-px h-4 bg-brd2 mx-0.5" />
      <button className={buttonClass} onClick={onDelete} title="删除元素">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 011.34-1.34h2.66a1.33 1.33 0 011.34 1.34V4m2 0v9.33a1.33 1.33 0 01-1.34 1.34H4.67a1.33 1.33 0 01-1.34-1.34V4h9.34z" />
        </svg>
      </button>
      <button className={buttonClass} onClick={onMoveUp} title="上移">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M8 12V4M4 7l4-4 4 4" />
        </svg>
      </button>
      <button className={buttonClass} onClick={onMoveDown} title="下移">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M8 4v8M4 9l4 4 4-4" />
        </svg>
      </button>
      <button className={buttonClass} onClick={onEditAttrs} title="编辑属性">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <circle cx="8" cy="8" r="2.5" />
          <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
        </svg>
      </button>
      <button className={buttonClass} onClick={onEditStyle} title="编辑样式">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
          <path d="M2 12.5l3-1L13.5 3a1.4 1.4 0 00-2-2L3 9.5l-1 3z" />
          <path d="M10 4.5l2 2" />
        </svg>
      </button>
    </div>
  );
}
