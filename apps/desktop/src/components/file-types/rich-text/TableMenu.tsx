import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';

// ponytail: shared dropdown for table row/col hover handles and the cell
// right-click menu. Viewport-fixed positioning + viewport clamp + click-
// outside dismissal — mirrors sidebar/ContextMenu.tsx pattern. One
// component, two trigger integrations (hover handle, contextmenu event),
// both compute viewport coords and pass them in.
//
// Submenu: items with a `submenu` array render a nested dropdown on hover
// (mouseenter on the parent item opens it; mouseleave to a sibling closes).
// The submenu is positioned absolutely within the parent item's `relative`
// wrapper — left:100% by default, flips to right:100% when there's no
// room on the right (measured via ref callback). No open delay (ponytail:
// skip until users report diagonal-mouse jank; the submenu is adjacent to
// the parent so the path is short and straight).
//
// Swatch: items with a `swatch` hex render a small colored square before
// the label. Used by the bg-color submenu so colors are visible without
// icon glyphs.

export interface TableMenuItem {
  label: string;
  icon?: LucideIcon;
  disabled?: boolean;
  danger?: boolean;
  swatch?: string;
  submenu?: TableMenuItem[];
  onClick?: () => void;
}

interface TableMenuProps {
  items: TableMenuItem[];
  x: number;
  y: number;
  onClose: () => void;
}

function ItemButton({
  it,
  hasSubmenu,
  onClick,
}: {
  it: TableMenuItem;
  hasSubmenu: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={it.disabled}
      onClick={onClick}
      className={`flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none ${
        it.danger
          ? 'text-[#e05252] hover:bg-[rgba(224,82,82,.08)]'
          : 'text-t1 hover:bg-hov'
      } disabled:opacity-40 disabled:cursor-default`}
    >
      {it.swatch && (
        <span
          className="inline-block w-3.5 h-3.5 rounded-sm border border-brd shrink-0"
          style={{ backgroundColor: it.swatch }}
        />
      )}
      {it.icon && !it.swatch && <it.icon size={14} />}
      <span className="flex-1">{it.label}</span>
      {hasSubmenu && <span className="text-t3 text-[10px]">▸</span>}
    </button>
  );
}

function Submenu({ items, onClose }: { items: TableMenuItem[]; onClose: () => void }) {
  return (
    <div
      className="absolute top-0 left-full ml-0.5 min-w-[170px] py-1 bg-panel border border-brd rounded-lg shadow-[0_4px_16px_rgba(0,0,0,.12)] z-[1001]"
      ref={(el) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (r.right > window.innerWidth - 8) {
          el.style.left = 'auto';
          el.style.right = '100%';
          el.style.marginRight = '2px';
        }
        const maxY = window.innerHeight - r.height - 8;
        const top = parseFloat(el.style.top || '0');
        if (top > maxY) el.style.top = `${Math.max(0, maxY)}px`;
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((it, i) =>
        it.label === '---' ? (
          <div key={`sep-${i}`} className="h-px mx-2 my-1 bg-brd" />
        ) : (
          <ItemButton
            key={i}
            it={it}
            hasSubmenu={!!it.submenu}
            onClick={() => {
              if (it.submenu) return;
              onClose();
              it.onClick?.();
            }}
          />
        ),
      )}
    </div>
  );
}

export function TableMenu({ items, x, y, onClose }: TableMenuProps) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [openSubIdx, setOpenSubIdx] = useState<number | null>(null);

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
          <div
            key={i}
            className="relative"
            onMouseEnter={() => setOpenSubIdx(it.submenu ? i : null)}
            onMouseLeave={() => setOpenSubIdx((cur) => (cur === i ? null : cur))}
          >
            <ItemButton
              it={it}
              hasSubmenu={!!it.submenu}
              onClick={() => {
                if (it.submenu) return;
                onCloseRef.current();
                it.onClick?.();
              }}
            />
            {it.submenu && openSubIdx === i && (
              <Submenu items={it.submenu} onClose={onCloseRef.current} />
            )}
          </div>
        ),
      )}
    </div>
  );
}
