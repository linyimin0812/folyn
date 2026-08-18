import { useEffect, useRef } from 'react';
import { useCommandPaletteStore, type PaletteItem } from '@/store/commandPaletteStore';
import { buildHighlightSegments, groupLabelZh } from './commandPaletteHelpers';
import { useTranslation } from 'react-i18next';

/**
 * Unified command palette (⌘P / Ctrl+P).
 *
 * Renders only when {@link useCommandPaletteStore.isOpen} is true. Reuses the
 * existing `.dlg` overlay/dialog styling rather than introducing new overlay CSS.
 *
 * Keyboard handling lives on the input element (stopPropagation so the global
 * `App.tsx` keydown handler does not double-trigger while the palette is open).
 * The global Cmd/Ctrl+P toggle-close still works because the input does not
 * handle that key combo.
 */
export function CommandPalette() {
  const { t } = useTranslation();
  const isOpen = useCommandPaletteStore((s) => s.isOpen);
  const query = useCommandPaletteStore((s) => s.query);
  const selectedIndex = useCommandPaletteStore((s) => s.selectedIndex);
  const groups = useCommandPaletteStore((s) => s.list.groups);
  const items = useCommandPaletteStore((s) => s.list.items);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus + select input when the palette opens.
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isOpen]);

  // Scroll the selected row into view as the selection moves.
  useEffect(() => {
    if (!isOpen) return;
    const container = listRef.current;
    if (!container) return;
    const row = container.querySelector<HTMLElement>(`[data-palette-idx="${selectedIndex}"]`);
    if (row) {
      const top = row.offsetTop;
      const bottom = top + row.offsetHeight;
      if (top < container.scrollTop) container.scrollTop = top;
      else if (bottom > container.scrollTop + container.clientHeight) {
        container.scrollTop = bottom - container.clientHeight;
      }
    }
  }, [selectedIndex, isOpen, items.length]);

  if (!isOpen) return null;

  const close = () => useCommandPaletteStore.getState().close();
  const setQuery = (q: string) => useCommandPaletteStore.getState().setQuery(q);
  const moveSelection = (delta: number) =>
    useCommandPaletteStore.getState().moveSelection(delta);
  const runSelected = () => useCommandPaletteStore.getState().runSelected();
  const select = (index: number) => useCommandPaletteStore.getState().select(index);
  const runCommand = (id: string) => useCommandPaletteStore.getState().runCommand(id);

  // Track the flat index across groups so keyboard nav aligns with `selectedIndex`.
  let flatIndex = -1;

  return (
    <div
      className="dlg-overlay"
      onMouseDown={close}
      style={{ background: 'transparent', backdropFilter: 'none', animation: 'none', alignItems: 'flex-start', paddingTop: '25vh' }}
    >
      <div
        className="dlg"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: 560, maxHeight: '50vh', boxShadow: 'none', animation: 'none', overflow: 'hidden' }}
      >
        <div className="dlg-body" style={{ gap: 0, padding: 0 }}>
          <input
            ref={inputRef}
            className="dlg-input"
            style={{ borderRadius: 0, border: 'none', borderBottom: '1px solid var(--brd)' }}
            placeholder={t('shell:commandPalette.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Stop propagation so the global App handler doesn't also fire.
              switch (e.key) {
                case 'ArrowDown':
                  e.preventDefault();
                  e.stopPropagation();
                  moveSelection(1);
                  break;
                case 'ArrowUp':
                  e.preventDefault();
                  e.stopPropagation();
                  moveSelection(-1);
                  break;
                case 'Enter':
                  e.preventDefault();
                  e.stopPropagation();
                  runSelected();
                  break;
                case 'Escape':
                  e.preventDefault();
                  e.stopPropagation();
                  close();
                  break;
                default:
                  break;
              }
            }}
          />
          <div
            ref={listRef}
            className="overflow-y-auto scrollbar-thin"
            style={{ maxHeight: 'calc(50vh - 48px)' }}
          >
            {items.length === 0 ? (
              <div className="py-6 px-4 text-center text-t2 text-[13px]">{t('shell:commandPalette.noMatch')}</div>
            ) : (
              groups.map((group) => {
                if (group.items.length === 0) return null;
                return (
                  <div key={group.id} className="py-1">
                    <div className="px-3 py-1.5 text-[11px] font-semibold text-t3 uppercase tracking-wide">
                      {groupLabelZh(group)}
                    </div>
                    {group.items.map((item) => {
                      flatIndex += 1;
                      const idx = flatIndex;
                      const isSelected = idx === selectedIndex;
                      return (
                        <PaletteRow
                          key={item.command.id}
                          item={item}
                          index={idx}
                          selected={isSelected}
                          onSelect={() => select(idx)}
                          onRun={() => runCommand(item.command.id)}
                        />
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface PaletteRowProps {
  item: PaletteItem;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onRun: () => void;
}

function PaletteRow({ item, index, selected, onSelect, onRun }: PaletteRowProps) {
  const segments = buildHighlightSegments(item.command.title, item.matches);
  return (
    <div
      data-palette-idx={index}
      className={`flex items-center gap-2 px-3 py-1.5 text-[13px] cursor-pointer transition-[background] duration-100 ${
        selected ? 'bg-accdim text-t1' : 'text-t2 hover:bg-hov'
      }`}
      onMouseEnter={onSelect}
      onClick={onRun}
    >
      {item.command.icon && <span className="text-t3 text-[13px]">{item.command.icon}</span>}
      <span className="flex-1 truncate">
        {segments.map((seg, i) =>
          seg.matched ? (
            <span key={i} className="text-acc font-semibold">{seg.text}</span>
          ) : (
            <span key={i}>{seg.text}</span>
          ),
        )}
      </span>
    </div>
  );
}
