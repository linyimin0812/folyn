import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Editor } from '@tiptap/react';
import type { LucideIcon } from 'lucide-react';
import {
  Heading1,
  Heading2,
  Heading3,
  Quote,
  Code2,
  Minus,
  List,
  ListOrdered,
  ListChecks,
} from 'lucide-react';
import type { SlashCommandState } from './RichTextSlashExtension';
import { applySlashCommand } from './RichTextSlashExtension';

// ponytail: separate component from the CodeMirror SlashMenu.tsx — that one's
// `onSelect(plugin: ContainerPlugin)` is typed for markdown-directive plugins
// (ContainerRegistry), but Tiptap slash items map to `editor.chain().<cmd>()`
// calls on native node types. Forcing both into one component would require a
// generic MenuItem<T> abstraction with two adapters — more indirection than
// the 9 hard-coded items here warrant. Visual style (grouped list, arrow nav,
// viewport flip) is mirrored from SlashMenu.tsx; the shape differs.

export type SlashCategory = 'blocks' | 'lists';

export interface SlashMenuItem {
  id: string;
  icon: LucideIcon;
  /** i18n key under editor:slashMenu.richText.items.<id> */
  labelKey: string;
  category: SlashCategory;
  /** Chain callback — receives the chain after the "/<filter>" range is deleted. */
  run: (chain: ReturnType<Editor['chain']>) => void;
}

const CATEGORY_KEYS: Record<SlashCategory, string> = {
  blocks: 'editor:slashMenu.richText.categories.blocks',
  lists: 'editor:slashMenu.richText.categories.lists',
};

const ITEMS: SlashMenuItem[] = [
  { id: 'heading1', icon: Heading1, labelKey: 'editor:slashMenu.richText.items.heading1', category: 'blocks', run: (c) => c.toggleHeading({ level: 1 }) },
  { id: 'heading2', icon: Heading2, labelKey: 'editor:slashMenu.richText.items.heading2', category: 'blocks', run: (c) => c.toggleHeading({ level: 2 }) },
  { id: 'heading3', icon: Heading3, labelKey: 'editor:slashMenu.richText.items.heading3', category: 'blocks', run: (c) => c.toggleHeading({ level: 3 }) },
  { id: 'blockquote', icon: Quote, labelKey: 'editor:slashMenu.richText.items.blockquote', category: 'blocks', run: (c) => c.toggleBlockquote() },
  { id: 'codeBlock', icon: Code2, labelKey: 'editor:slashMenu.richText.items.codeBlock', category: 'blocks', run: (c) => c.toggleCodeBlock() },
  { id: 'horizontalRule', icon: Minus, labelKey: 'editor:slashMenu.richText.items.horizontalRule', category: 'blocks', run: (c) => c.setHorizontalRule() },
  { id: 'bulletList', icon: List, labelKey: 'editor:slashMenu.richText.items.bulletList', category: 'lists', run: (c) => c.toggleBulletList() },
  { id: 'orderedList', icon: ListOrdered, labelKey: 'editor:slashMenu.richText.items.orderedList', category: 'lists', run: (c) => c.toggleOrderedList() },
  { id: 'taskList', icon: ListChecks, labelKey: 'editor:slashMenu.richText.items.taskList', category: 'lists', run: (c) => c.toggleTaskList() },
];

export interface RichTextSlashMenuProps {
  editor: Editor;
  state: SlashCommandState;
  onClose: () => void;
}

/**
 * Filter items by case-insensitive substring match against the translated
 * label. Pure — exported for unit testing.
 */
export function filterItems(items: SlashMenuItem[], filter: string): SlashMenuItem[] {
  // ponytail: O(n) over 9 items; no fuzzy ranking. Add when item count grows.
  if (!filter) return items;
  const f = filter.toLowerCase();
  return items.filter((it) => {
    const label = it.id.toLowerCase();
    return label.includes(f);
  });
}

export function RichTextSlashMenu({ editor, state, onClose }: RichTextSlashMenuProps) {
  const { t } = useTranslation();
  const [activeIndex, setActiveIndex] = useState(0);
  const [adjustedPos, setAdjustedPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const menuRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => filterItems(ITEMS, state.filter), [state.filter]);

  // Group preserving the ITEMS order within each category.
  const grouped = useMemo(() => {
    const map = new Map<SlashCategory, SlashMenuItem[]>();
    for (const it of filtered) {
      const list = map.get(it.category) ?? [];
      list.push(it);
      map.set(it.category, list);
    }
    return map;
  }, [filtered]);

  const flatList = filtered;

  // Always start on the first item: reset when the menu reopens AND when the
  // filter changes, so a previous selection never carries across triggers.
  useEffect(() => {
    setActiveIndex(0);
  }, [state.visible, state.filter]);

  // Position the menu at the cursor; flip above if viewport-bottom space is short.
  useEffect(() => {
    if (!state.visible) {
      setAdjustedPos({ top: 0, left: 0 });
      return;
    }
    const coords = editor.view.coordsAtPos(state.rangeTo);
    const baseTop = coords.bottom + 4;
    const baseLeft = coords.left;
    setAdjustedPos({ top: baseTop, left: baseLeft });
    requestAnimationFrame(() => {
      const menu = menuRef.current;
      if (!menu) return;
      const h = menu.offsetHeight;
      const spaceBelow = window.innerHeight - baseTop;
      if (spaceBelow < h && baseTop > h + 8) {
        setAdjustedPos({ top: baseTop - h - 8 - 4, left: baseLeft });
      }
    });
  }, [editor, state.visible, state.rangeTo, state.filter, flatList.length]);

  const select = useCallback(
    (item: SlashMenuItem) => {
      applySlashCommand(editor, state, item.run);
      onClose();
    },
    [editor, state, onClose],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!state.visible || flatList.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setActiveIndex((p) => (p + 1) % flatList.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setActiveIndex((p) => (p - 1 + flatList.length) % flatList.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const item = flatList[activeIndex];
        if (item) select(item);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    },
    [state.visible, flatList, activeIndex, select, onClose],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [handleKeyDown]);

  useEffect(() => {
    if (!state.visible || !menuRef.current) return;
    const el = menuRef.current.querySelector('.slash-menu-item.active');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, state.visible]);

  if (!state.visible || flatList.length === 0) return null;

  let itemIdx = 0;
  return (
    <div
      ref={menuRef}
      className="slash-menu fixed z-40 bg-panel border border-brd2 rounded-lg shadow-[0_8px_32px_rgba(0,0,0,.12)] min-w-[240px] max-h-[320px] overflow-y-auto p-1.5 animate-[fadeIn_.12s]"
      style={{ top: adjustedPos.top, left: adjustedPos.left }}
    >
      {Array.from(grouped.entries()).map(([category, items]) => (
        <div key={category} className="mb-1">
          <div className="text-[9px] font-semibold text-t3 uppercase tracking-[.1em] py-1.5 px-2">
            {t(CATEGORY_KEYS[category])}
          </div>
          {items.map((item) => {
            const idx = itemIdx++;
            const isActive = idx === activeIndex;
            return (
              <div
                key={item.id}
                className={`slash-menu-item flex items-center gap-2 py-1.5 px-2 rounded-[5px] cursor-pointer transition-[background] duration-100 ${isActive ? 'active bg-hov' : ''}`}
                onClick={() => select(item)}
                onMouseEnter={() => setActiveIndex(idx)}
              >
                <item.icon size={15} strokeWidth={1.6} className="text-t2 shrink-0" />
                <span className="text-xs font-medium text-t1">{t(item.labelKey)}</span>
              </div>
            );
          })}
        </div>
      ))}
      {flatList.length === 0 && (
        <div className="text-xs text-t3 py-2 px-2">{t('editor:slashMenu.richText.empty')}</div>
      )}
    </div>
  );
}
