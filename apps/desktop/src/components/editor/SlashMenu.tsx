import { useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Heading1, Heading2, Heading3, Quote, Code2, Table, Minus } from 'lucide-react';
import type { ContainerCategory } from '@folyn/container-extensions';
import { getActiveContainers } from '@/services/containerRegistryService';
import { IconFromSvg } from '@/components/icons/IconFromSvg';

const CATEGORY_KEYS: Record<ContainerCategory | 'basic', string> = {
  basic: 'editor:slashMenu.categories.basic',
  layout: 'editor:slashMenu.categories.layout',
  media: 'editor:slashMenu.categories.media',
  ai: 'editor:slashMenu.categories.ai',
  data: 'editor:slashMenu.categories.data',
  custom: 'editor:slashMenu.categories.custom',
};

/** One selectable slash-menu entry. Structural subset of ContainerExtension
 *  (which stays assignable as-is) plus `cursorOffset` for basic blocks. */
export interface SlashMenuItem {
  name: string;
  icon: string | ReactNode;
  label: string;
  category: ContainerCategory | 'basic';
  /** Markdown inserted when selected from the slash menu */
  template: string;
  description?: string;
  /** Offset into `template` where the cursor lands after insert
 *   (default: end of the template). */
  cursorOffset?: number;
}

/** Basic markdown block entries — plain templates, no `:::directive`, so they
 *  never touch ContainerRegistry (its contract requires a React component).
 *  Lean core set; code block and table carry `cursorOffset` to land the
 *  cursor inside the block. */
const BASIC_BLOCKS: {
  name: string;
  icon: ReactNode;
  labelKey: string;
  template: string;
  cursorOffset?: number;
}[] = [
  { name: 'heading1', icon: <Heading1 size={16} />, labelKey: 'editor:slashMenu.basic.heading1', template: '# ' },
  { name: 'heading2', icon: <Heading2 size={16} />, labelKey: 'editor:slashMenu.basic.heading2', template: '## ' },
  { name: 'heading3', icon: <Heading3 size={16} />, labelKey: 'editor:slashMenu.basic.heading3', template: '### ' },
  { name: 'blockquote', icon: <Quote size={16} />, labelKey: 'editor:slashMenu.basic.blockquote', template: '> ' },
  { name: 'code-block', icon: <Code2 size={16} />, labelKey: 'editor:slashMenu.basic.codeBlock', template: '```\n\n```', cursorOffset: 4 },
  { name: 'table', icon: <Table size={16} />, labelKey: 'editor:slashMenu.basic.table', template: '|  |  |\n| --- | --- |\n|  |  |', cursorOffset: 2 },
  { name: 'horizontal-rule', icon: <Minus size={16} />, labelKey: 'editor:slashMenu.basic.horizontalRule', template: '---' },
];

interface SlashMenuProps {
  visible: boolean;
  filter: string;
  position: { top: number; left: number };
  onSelect: (item: SlashMenuItem) => void;
  onClose: () => void;
}

/** Tokenize the "/" query into character-class runs — non-ASCII
 *  (CJK/kana/accented) / latin / digits — so "标题1" searches as
 *  标题 AND 1: "标题" hits the localized label (一级标题), "1" hits the
 *  ASCII name (heading1). Whole-substring matching alone can never match
 *  that query — the label ends with 标题 and has no digit, the name has no
 *  CJK — so typing a level makes the menu vanish with no way to select it. */
function tokenizeQuery(filter: string): string[] {
  return filter.toLowerCase().match(/[^\x00-\x7f]+|[a-z]+|[0-9]+/g) ?? [];
}

/** Search: the text typed after "/" is the query. Every token must hit the
 *  item's name + label + description (case-insensitive, tokens ANDed, fields
 *  concatenated — a token can hit in the name while another hits in the
 *  label, which is exactly what makes "标题1" match). */
function matchesQuery(item: SlashMenuItem, tokens: string[]): boolean {
  const haystack = `${item.name} ${item.label} ${item.description ?? ''}`.toLowerCase();
  return tokens.every((tk) => haystack.includes(tk));
}

/**
 * Render a container's resolved `icon`. Inline `<svg>...</svg>` strings
 * (set directly from the manifest, OR pre-resolved from a `.svg` file path by
 * `registerExtensionContainers`) go through `IconFromSvg`; plain strings are
 * the emoji/text fallback (preserves the builtin convention); ReactNode icons
 * (basic-block lucide components) render as-is.
 *
 * ponytail: inline three-branch dispatcher; not worth a shared file — the
 * `featureAdapter` version has a ThemeIcon fallback that doesn't apply here.
 */
function renderIcon(icon: string | ReactNode): ReactNode {
  if (typeof icon === 'string') {
    if (icon.trim().startsWith('<svg')) {
      return <IconFromSvg svg={icon} size={16} />;
    }
    return <span>{icon}</span>;
  }
  return icon;
}

export function SlashMenu({ visible, filter, position, onSelect, onClose }: SlashMenuProps) {
  const { t } = useTranslation();
  const [activeIndex, setActiveIndex] = useState(0);
  const [adjustedPosition, setAdjustedPosition] = useState(position);
  const menuRef = useRef<HTMLDivElement>(null);
  // IME composition tracking: WKWebView reports some keydowns during a
  // composition with isComposing=false, so the event flag alone is not
  // reliable. Track the session on document and ignore keys while it's
  // active — the filter itself is mirrored from the document in
  // EditorView.handleUpdate, so the menu still works during composition.
  const composingRef = useRef(false);
  // Remember whether the menu is flipped above the cursor so the
  // below/above decision doesn't oscillate as the filtered list height
  // changes on every keystroke.
  const flippedRef = useRef(false);

  // Basic markdown blocks (labels localized here) always come first so the
  // highest-frequency entries are at the top; containers follow in their
  // registry categories. `step`/`tab` are sub-directives, not insertable.
  const basicItems: SlashMenuItem[] = BASIC_BLOCKS.map((b) => ({
    name: b.name,
    icon: b.icon,
    label: t(b.labelKey),
    category: 'basic',
    template: b.template,
    cursorOffset: b.cursorOffset,
  }));
  const allItems: SlashMenuItem[] = [
    ...basicItems,
    ...getActiveContainers().filter((p) => p.name !== 'step' && p.name !== 'tab'),
  ];

  const tokens = tokenizeQuery(filter);
  const filtered = tokens.length ? allItems.filter((p) => matchesQuery(p, tokens)) : allItems;

  // Group by category
  const grouped = new Map<ContainerCategory | 'basic', SlashMenuItem[]>();
  for (const item of filtered) {
    const list = grouped.get(item.category) || [];
    list.push(item);
    grouped.set(item.category, list);
  }

  // Build flat list in the same order as the grouped rendering
  const flatList: SlashMenuItem[] = [];
  for (const items of grouped.values()) {
    flatList.push(...items);
  }

  // Always start on the first item: reset when the menu reopens AND when the
  // filter changes, so a previous selection never carries across triggers.
  useEffect(() => {
    setActiveIndex(0);
  }, [visible, filter]);

  // Adjust position to avoid being clipped at the bottom of the viewport.
  // The side (below/above) is sticky once chosen: it only flips back when
  // the other side clearly fits, so filtering (which changes the list
  // height every keystroke) can't make the menu oscillate up/down.
  useEffect(() => {
    if (!visible || !menuRef.current) {
      flippedRef.current = false;
      setAdjustedPosition(position);
      return;
    }
    requestAnimationFrame(() => {
      const menu = menuRef.current;
      if (!menu) return;
      const menuHeight = menu.offsetHeight;
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - position.top;
      const spaceAbove = position.top;
      const fitsBelow = spaceBelow >= menuHeight;
      const fitsAbove = spaceAbove >= menuHeight;

      if (flippedRef.current) {
        // Keep it above while it fits there; flip back only when it no
        // longer fits above AND clearly fits below (hysteresis).
        if (fitsAbove || !fitsBelow) {
          setAdjustedPosition({ top: Math.max(0, position.top - menuHeight - 8), left: position.left });
        } else {
          flippedRef.current = false;
          setAdjustedPosition(position);
        }
      } else if (!fitsBelow && fitsAbove) {
        flippedRef.current = true;
        setAdjustedPosition({ top: Math.max(0, position.top - menuHeight - 8), left: position.left });
      } else {
        setAdjustedPosition(position);
      }
    });
  }, [visible, position, flatList.length]);

  // Track composition at the document level (fires regardless of which
  // element owns the editor) so the keydown guard below works in WKWebView.
  useEffect(() => {
    const onStart = () => {
      composingRef.current = true;
    };
    const onEnd = () => {
      composingRef.current = false;
    };
    document.addEventListener('compositionstart', onStart);
    document.addEventListener('compositionend', onEnd);
    return () => {
      document.removeEventListener('compositionstart', onStart);
      document.removeEventListener('compositionend', onEnd);
    };
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Let the IME own the keyboard during composition (pinyin/Chinese
      // input): Enter confirms the composed text and arrows move the
      // candidate list — neither should drive menu navigation or selection.
      // The filter is mirrored live (EditorView.handleUpdate), so by the
      // time composition ends the menu already shows the right item and the
      // confirming Enter may select it.
      if (e.isComposing || e.keyCode === 229) return;
      if (composingRef.current) return;
      if (!visible || flatList.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setActiveIndex((prev) => Math.min(prev + 1, flatList.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (flatList[activeIndex]) onSelect(flatList[activeIndex]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    },
    [visible, flatList, activeIndex, onSelect, onClose],
  );

  // Use capture phase to intercept arrow keys before the editor processes them
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [handleKeyDown]);

  // Scroll the active item into view within the menu's own scroll container
  // only. scrollIntoView also scrolls ancestor containers (the fixed menu's
  // DOM ancestors include the editor pane), which shifts the surrounding
  // content and makes the menu appear to jump relative to the cursor.
  useEffect(() => {
    if (!visible || !menuRef.current) return;
    const menu = menuRef.current;
    const activeElement = menu.querySelector('.slash-menu-item.active');
    if (!activeElement) return;
    const menuRect = menu.getBoundingClientRect();
    const itemRect = activeElement.getBoundingClientRect();
    if (itemRect.top < menuRect.top) {
      menu.scrollTop -= menuRect.top - itemRect.top;
    } else if (itemRect.bottom > menuRect.bottom) {
      menu.scrollTop += itemRect.bottom - menuRect.bottom;
    }
  }, [activeIndex, visible]);

  if (!visible || flatList.length === 0) return null;

  let itemIndex = 0;

  return (
    <div
      className="slash-menu fixed z-40 bg-panel border border-brd2 rounded-xl shadow-[0_12px_40px_rgba(0,0,0,.16)] min-w-[248px] max-w-[320px] max-h-[320px] overflow-y-auto p-1.5 animate-[slideUp_.14s_ease]"
      ref={menuRef}
      style={{ top: adjustedPosition.top, left: adjustedPosition.left }}
    >
      {Array.from(grouped.entries()).map(([category, items]) => (
        <div key={category} className="mb-0.5">
          <div className="text-[9px] font-semibold text-t3 uppercase tracking-[.1em] pt-1.5 pb-1 px-2">{t(CATEGORY_KEYS[category])}</div>
          {items.map((item) => {
            const currentIndex = itemIndex++;
            return (
              <div
                key={item.name}
                className={`slash-menu-item group flex items-center gap-2.5 py-2 px-2 rounded-lg cursor-pointer transition-[background-color,box-shadow] duration-100 ${
                  currentIndex === activeIndex
                    ? 'active bg-accglow shadow-[inset_0_0_0_1px_var(--accdim)]'
                    : 'hover:bg-hov'
                }`}
                onClick={() => onSelect(item)}
                onMouseEnter={() => setActiveIndex(currentIndex)}
              >
                <span
                  className={`w-7 h-7 flex items-center justify-center rounded-md bg-surf2 text-[15px] shrink-0 transition-colors duration-100 ${
                    currentIndex === activeIndex ? 'bg-accdim' : ''
                  }`}
                >
                  {renderIcon(item.icon)}
                </span>
                <div className="flex flex-col gap-px min-w-0">
                  <span className="text-xs font-medium text-t1 truncate">{item.label}</span>
                  {item.description && (
                    <span className="text-[10px] text-t3 truncate">{item.description}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
