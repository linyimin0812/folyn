import { useEffect, useRef, useState } from 'react';
import {
  getFilteredLanguages,
  selectLanguage,
  selectPlainBlock,
  type CodeBlockMenuState,
} from '@/editor/extensions/CodeBlockExtension';
import type { EditorView } from '@codemirror/view';

interface CodeBlockLangMenuProps {
  visible: boolean;
  menuState: CodeBlockMenuState;
  position: { top: number; left: number };
  getView: () => EditorView | null;
}

export function CodeBlockLangMenu({ visible, menuState, position, getView }: CodeBlockLangMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [adjustedPos, setAdjustedPos] = useState(position);

  useEffect(() => {
    if (!visible || !listRef.current) {
      setAdjustedPos(position);
      return;
    }
    requestAnimationFrame(() => {
      const menu = listRef.current;
      if (!menu) return;
      const menuHeight = menu.offsetHeight;
      const spaceBelow = window.innerHeight - position.top;
      if (spaceBelow < menuHeight && position.top > menuHeight) {
        setAdjustedPos({ top: position.top - menuHeight - 8, left: position.left });
      } else {
        setAdjustedPos(position);
      }
    });
  }, [visible, position]);

  // Scroll the active item into view
  useEffect(() => {
    if (!visible || !listRef.current) return;
    const activeItem = listRef.current.querySelector('.cbl-item.active');
    activeItem?.scrollIntoView({ block: 'nearest' });
  }, [visible, menuState.selectedIndex]);

  if (!visible) return null;

  const filtered = getFilteredLanguages(menuState.filter);

  const handleSelect = (langName: string) => {
    const view = getView();
    if (!view) return;
    selectLanguage(view, menuState, langName);
  };

  const handleSelectPlain = () => {
    const view = getView();
    if (!view) return;
    selectPlainBlock(view, menuState);
  };

  return (
    <div
      className="cbl-menu fixed z-[45] bg-panel border border-brd2 rounded-lg shadow-[0_8px_32px_rgba(0,0,0,.12)] min-w-[200px] max-w-[260px] max-h-[280px] overflow-y-auto p-1 animate-[fadeIn_.12s]"
      style={{ top: adjustedPos.top, left: adjustedPos.left }}
      ref={listRef}
    >
      <div className="text-[9px] font-semibold text-t3 uppercase tracking-[.1em] py-1.5 px-2">Select Language</div>
      {filtered.length === 0 ? (
        <div className="py-2 px-2.5 text-[11px] text-t3 cursor-pointer rounded-[5px] hover:bg-hov" onClick={handleSelectPlain}>
          No match — press Enter for plain block
        </div>
      ) : (
        filtered.map((lang, index) => (
          <div
            key={lang.name}
            className={`cbl-item flex items-center justify-between py-[5px] px-2 rounded-[5px] cursor-pointer transition-[background] duration-100 ${index === menuState.selectedIndex ? 'active bg-hov' : 'hover:bg-hov'}`}
            onMouseDown={(event) => {
              event.preventDefault();
              handleSelect(lang.name);
            }}
          >
            <span className="text-xs font-medium text-t1">{lang.label}</span>
            <span className="text-[10px] text-t3 font-mono">{lang.name}</span>
          </div>
        ))
      )}
    </div>
  );
}
