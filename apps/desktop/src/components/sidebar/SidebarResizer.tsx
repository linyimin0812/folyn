import { useState, useRef, useEffect, useCallback } from 'react';

const DEFAULT_WIDTH = 224;

export interface SidebarResizerProps {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  width: number;
  onWidthChange: (width: number) => void;
  onResizingChange?: (isResizing: boolean) => void;
}

export function SidebarResizer({
  collapsed,
  onCollapsedChange,
  width,
  onWidthChange,
  onResizingChange,
}: SidebarResizerProps): React.JSX.Element {
  const [resizerHovered, setResizerHovered] = useState(false);
  const isDragging = useRef(false);
  const widthRef = useRef(width);
  widthRef.current = width;

  // Use a ref to avoid stale closures in the global mousemove/mouseup handlers
  const callbacksRef = useRef({ onWidthChange, onCollapsedChange, onResizingChange });
  callbacksRef.current = { onWidthChange, onCollapsedChange, onResizingChange };

  const handleMouseDown = useCallback(() => {
    isDragging.current = true;
    callbacksRef.current.onResizingChange?.(true);
    document.body.style.cursor = 'col-resize';
    document.documentElement.classList.add('is-resizing');
  }, []);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!isDragging.current) return;
      const newWidth = Math.max(0, event.clientX);
      callbacksRef.current.onWidthChange(newWidth);
    };

    const handleMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      callbacksRef.current.onResizingChange?.(false);
      document.body.style.cursor = '';
      document.documentElement.classList.remove('is-resizing');
      if (widthRef.current < 60) {
        callbacksRef.current.onCollapsedChange(true);
        callbacksRef.current.onWidthChange(DEFAULT_WIDTH);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return (
    <div
      className={`relative shrink-0 flex items-center group${collapsed ? ' w-1.5 cursor-pointer' : ''}`}
      onMouseEnter={() => setResizerHovered(true)}
      onMouseLeave={() => setResizerHovered(false)}
    >
      <div className={`resizer w-0.5 shrink-0 bg-brd transition-colors duration-[140ms] h-full group-hover:bg-acc group-hover:opacity-30${collapsed ? ' cursor-default' : ' cursor-col-resize'}`} onMouseDown={collapsed ? undefined : handleMouseDown} />
      {(resizerHovered || collapsed) && (
        <button
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 w-5 h-5 flex items-center justify-center rounded-full border border-brd2 bg-panel text-t3 cursor-pointer transition-all duration-[140ms] shadow-[0_1px_4px_rgba(0,0,0,.12)]"
          onClick={() => onCollapsedChange(!collapsed)}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
            {collapsed ? (
              <polyline points="6,3 11,8 6,13" />
            ) : (
              <polyline points="10,3 5,8 10,13" />
            )}
          </svg>
        </button>
      )}
    </div>
  );
}
