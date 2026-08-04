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
  // ponytail: when set, the item renders as a <label> wrapping a hidden
  // <input type="color"> instead of a <button>. The browser natively
  // forwards the click to the input AND anchors the OS color picker
  // popover to the label's screen position. Programmatic .click() on a
  // detached hidden input (the old approach) left the picker without an
  // anchor and macOS WKWebView fell back to the bottom-left corner.
  colorInput?: { onChange: (hex: string) => void };
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
  pickerActiveRef,
}: {
  it: TableMenuItem;
  hasSubmenu: boolean;
  onClick: () => void;
  pickerActiveRef: React.MutableRefObject<boolean>;
}) {
  // ponytail: colorInput items render as a <label> wrapping a hidden
  // <input type="color"> positioned absolutely over the label. The browser
  // forwards the click to the input AND anchors the native picker popover
  // to the label's real screen position. The input is in the DOM (inside
  // the menu) so the picker has a valid anchor — a detached input or
  // programmatic .click() falls back to the bottom-left corner on macOS.
  if (it.colorInput) {
    return (
      <label
        // ponytail: set pickerActive on mousedown so the parent menu's
        // onMouseLeave doesn't close the submenu (which would unmount
        // the label and close the native picker) while the user moves
        // the mouse from the label to the picker popover. Cleared on
        // onChange (user picked) or onBlur (user cancelled the picker).
        onMouseDown={(e) => {
          e.stopPropagation();
          pickerActiveRef.current = true;
        }}
        className={`relative flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer ${
          it.danger
            ? 'text-[#e05252] hover:bg-[rgba(224,82,52,.08)]'
            : 'text-t1 hover:bg-hov'
        }`}
      >
        {it.swatch && (
          <span
            className="inline-block w-3.5 h-3.5 rounded-sm border border-brd shrink-0"
            style={{ backgroundColor: it.swatch }}
          />
        )}
        {it.icon && !it.swatch && <it.icon size={14} />}
        <span className="flex-1">{it.label}</span>
        <input
          type="color"
          className="absolute inset-0 opacity-0 cursor-pointer"
          onChange={(e) => {
            it.colorInput!.onChange(e.target.value);
            pickerActiveRef.current = false;
            onClick();
          }}
          onBlur={() => {
            pickerActiveRef.current = false;
          }}
        />
      </label>
    );
  }
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

function Submenu({
  items,
  onClose,
  pickerActiveRef,
}: {
  items: TableMenuItem[];
  onClose: () => void;
  pickerActiveRef: React.MutableRefObject<boolean>;
}) {
  return (
    <div
      className="absolute top-0 left-full ml-0.5 min-w-[170px] py-1 bg-panel border border-brd rounded-lg shadow-[0_4px_16px_rgba(0,0,0,.12)] z-[1001]"
      ref={(el) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        // horizontal flip
        if (r.right > window.innerWidth - 8) {
          el.style.left = 'auto';
          el.style.right = '100%';
          el.style.marginRight = '2px';
        }
        // ponytail: vertical auto-flip. Measure available space below
        // (parent top → viewport bottom) and above (viewport top →
        // parent bottom). If the submenu fits below, keep top:0. Else
        // if it fits above, switch to bottom:0 (opens upward). Else
        // pick the larger side and cap height with internal scroll.
        // The bg-color submenu (12 rows) often doesn't fit either way
        // when the cell is mid-viewport, so the scroll fallback kicks
        // in — but the "Custom color" item is now reachable by scroll
        // from either direction.
        const parent = el.parentElement;
        const pr = parent?.getBoundingClientRect();
        const parentTop = pr?.top ?? r.top;
        const parentBottom = pr?.bottom ?? r.top;
        const availableBelow = window.innerHeight - parentTop - 8;
        const availableAbove = parentBottom - 8;
        if (r.height <= availableBelow) {
          // fits below — keep default top:0
        } else if (r.height <= availableAbove) {
          // fits above — open upward
          el.style.top = 'auto';
          el.style.bottom = '0';
        } else if (availableBelow >= availableAbove) {
          // more space below — cap and scroll
          el.style.maxHeight = `${Math.max(160, availableBelow)}px`;
          el.style.overflowY = 'auto';
        } else {
          // more space above — open upward, cap and scroll
          el.style.top = 'auto';
          el.style.bottom = '0';
          el.style.maxHeight = `${Math.max(160, availableAbove)}px`;
          el.style.overflowY = 'auto';
        }
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
            pickerActiveRef={pickerActiveRef}
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
  // ponytail: set true while the native color picker is open. The parent
  // item's onMouseLeave checks this and skips closing the submenu —
  // otherwise moving the mouse from the "Custom color…" label to the
  // native picker popover would unmount the label and dismiss the picker.
  const pickerActiveRef = useRef(false);

  useEffect(() => {
    const close = () => {
      if (pickerActiveRef.current) return;
      onCloseRef.current();
    };
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
            onMouseLeave={() => {
              if (pickerActiveRef.current) return;
              setOpenSubIdx((cur) => (cur === i ? null : cur));
            }}
          >
            <ItemButton
              it={it}
              hasSubmenu={!!it.submenu}
              onClick={() => {
                if (it.submenu) return;
                onCloseRef.current();
                it.onClick?.();
              }}
              pickerActiveRef={pickerActiveRef}
            />
            {it.submenu && openSubIdx === i && (
              <Submenu
                items={it.submenu}
                onClose={onCloseRef.current}
                pickerActiveRef={pickerActiveRef}
              />
            )}
          </div>
        ),
      )}
    </div>
  );
}
