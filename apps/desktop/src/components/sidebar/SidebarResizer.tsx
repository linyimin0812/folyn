import { useRef, useState } from 'react';

const DEFAULT_WIDTH = 224;

export interface SidebarResizerProps {
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  width: number;
  onWidthChange: (width: number) => void;
  onResizingChange?: (isResizing: boolean) => void;
}

/**
 * The sidebar boundary: a zero-width edge carrying the drag handle and the
 * round fold toggle. The aside's own `border-r` is the only visible line, so
 * there is no gap column between sidebar and content.
 *
 * The drag uses pointer capture: every pointer event goes to the handle until
 * release, even over iframes or outside the window, so a missed release can't
 * leave the sidebar following the mouse.
 */
export function SidebarResizer({
  collapsed,
  onCollapsedChange,
  width,
  onWidthChange,
  onResizingChange,
}: SidebarResizerProps): React.JSX.Element {
  const drag = useRef<{ x: number; width: number; last: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const end = (el: HTMLElement, pointerId: number) => {
    const state = drag.current;
    if (!state) return;
    drag.current = null;
    setDragging(false);
    if (el.hasPointerCapture?.(pointerId)) el.releasePointerCapture(pointerId);
    onResizingChange?.(false);
    document.body.style.cursor = '';
    document.documentElement.classList.remove('is-resizing');
    // Dragged nearly shut: fold it, and reopen at the default width later.
    if (state.last < 60) {
      onCollapsedChange(true);
      onWidthChange(DEFAULT_WIDTH);
    }
  };

  return (
    <div className={`resizer sidebar-edge${collapsed ? ' collapsed' : ''}`}>
      {!collapsed && (
        <div
          className={`sidebar-edge-handle${dragging ? ' on' : ''}`}
          role="separator"
          aria-orientation="vertical"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture?.(e.pointerId);
            drag.current = { x: e.clientX, width, last: width };
            setDragging(true);
            onResizingChange?.(true);
            document.body.style.cursor = 'col-resize';
            document.documentElement.classList.add('is-resizing');
          }}
          onPointerMove={(e) => {
            const state = drag.current;
            if (!state) return;
            if (e.buttons === 0) return end(e.currentTarget, e.pointerId);
            state.last = Math.max(0, state.width + e.clientX - state.x);
            onWidthChange(state.last);
          }}
          onPointerUp={(e) => end(e.currentTarget, e.pointerId)}
          onPointerCancel={(e) => end(e.currentTarget, e.pointerId)}
        />
      )}
      <button
        type="button"
        className="sidebar-edge-btn"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!collapsed}
        onClick={() => onCollapsedChange(!collapsed)}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points={collapsed ? '6,3 11,8 6,13' : '10,3 5,8 10,13'} />
        </svg>
      </button>
    </div>
  );
}
