import { useEffect, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';

// ponytail: shared dropdown for table row/col hover handles and the cell
// right-click menu. Viewport-fixed positioning + viewport clamp + click-
// outside dismissal — mirrors sidebar/ContextMenu.tsx pattern. One
// component, two trigger integrations (hover handle, contextmenu event),
// both compute viewport coords and pass them in.

export interface TableMenuItem {
  label: string;
  icon?: LucideIcon;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}

interface TableMenuProps {
  items: TableMenuItem[];
  x: number;
  y: number;
  onClose: () => void;
}

export function TableMenu({ items, x, y, onClose }: TableMenuProps) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const close = () => onCloseRef.current();
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div
      className="fixed z-[1000] min-w-[170px] py-1 bg-panel border border-brd rounded-lg shadow-[0_4px_16px_rgba(0,0,0,.12)]"
      ref={(el) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        const maxY = window.innerHeight - r.height - 8;
        const maxX = window.innerWidth - r.width - 8;
        if (y > maxY) el.style.top = `${maxY}px`;
        if (x > maxX) el.style.left = `${maxX}px`;
      }}
      style={{ top: y, left: x }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((it, i) =>
        it.label === '---' ? (
          <div key={`sep-${i}`} className="h-px mx-2 my-1 bg-brd" />
        ) : (
          <button
            key={i}
            type="button"
            disabled={it.disabled}
            onClick={() => {
              onCloseRef.current();
              it.onClick();
            }}
            className={`flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none ${
              it.danger
                ? 'text-[#e05252] hover:bg-[rgba(224,82,82,.08)]'
                : 'text-t1 hover:bg-hov'
            } disabled:opacity-40 disabled:cursor-default`}
          >
            {it.icon && <it.icon size={14} />}
            {it.label}
          </button>
        ),
      )}
    </div>
  );
}
