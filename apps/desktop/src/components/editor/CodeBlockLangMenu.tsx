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
      className="cbl-menu"
      style={{ top: adjustedPos.top, left: adjustedPos.left }}
      ref={listRef}
    >
      <div className="cbl-header">Select Language</div>
      {filtered.length === 0 ? (
        <div className="cbl-empty" onClick={handleSelectPlain}>
          No match — press Enter for plain block
        </div>
      ) : (
        filtered.map((lang, index) => (
          <div
            key={lang.name}
            className={`cbl-item ${index === menuState.selectedIndex ? 'active' : ''}`}
            onMouseDown={(event) => {
              event.preventDefault();
              handleSelect(lang.name);
            }}
          >
            <span className="cbl-name">{lang.label}</span>
            <span className="cbl-alias">{lang.name}</span>
          </div>
        ))
      )}
    </div>
  );
}
