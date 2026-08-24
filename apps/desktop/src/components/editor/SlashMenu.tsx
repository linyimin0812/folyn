import { useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ContainerRegistry } from '@folyn/container-plugins';
import type { ContainerPlugin, ContainerCategory } from '@folyn/container-plugins';
import { IconFromSvg } from '@/components/icons/IconFromSvg';

const CATEGORY_KEYS: Record<ContainerCategory, string> = {
  layout: 'editor:slashMenu.categories.layout',
  media: 'editor:slashMenu.categories.media',
  ai: 'editor:slashMenu.categories.ai',
  data: 'editor:slashMenu.categories.data',
  custom: 'editor:slashMenu.categories.custom',
};

/** Plugins that still render in the preview pane but should not be offered as
 *  `/`-commands. `ai-result` is inserted through the AI panel's own flow;
 *  `plugin-error-demo` is a dev-only error-boundary self-check. */
const SLASH_MENU_HIDDEN_PLUGINS = new Set(['ai-result', 'plugin-error-demo']);

interface SlashMenuProps {
  visible: boolean;
  filter: string;
  position: { top: number; left: number };
  onSelect: (plugin: ContainerPlugin) => void;
  onClose: () => void;
}

/**
 * Render a container's resolved `icon` string. Inline `<svg>...</svg>` strings
 * (set directly from the manifest, OR pre-resolved from a `.svg` file path by
 * `registerPluginContainers`) go through `IconFromSvg`; anything else is the
 * emoji/text fallback (preserves the builtin convention).
 *
 * ponytail: inline two-branch dispatcher; not worth a shared file — the
 * `featureAdapter` version has a ThemeIcon fallback that doesn't apply here.
 */
function renderContainerIcon(icon: string): ReactNode {
  if (icon.trim().startsWith('<svg')) {
    return <IconFromSvg svg={icon} size={16} />;
  }
  return <span>{icon}</span>;
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
  const registry = ContainerRegistry.getInstance();

  const allPlugins = registry
    .getAll()
    .filter((p) => !SLASH_MENU_HIDDEN_PLUGINS.has(p.name) && p.name !== 'step' && p.name !== 'tab');
  const filtered = filter
    ? allPlugins.filter(
        (p) =>
          p.name.toLowerCase().includes(filter.toLowerCase()) ||
          p.label.includes(filter),
      )
    : allPlugins;

  // Group by category
  const grouped = new Map<ContainerCategory, ContainerPlugin[]>();
  for (const plugin of filtered) {
    const list = grouped.get(plugin.category) || [];
    list.push(plugin);
    grouped.set(plugin.category, list);
  }

  // Build flat list in the same order as the grouped rendering
  const flatList: ContainerPlugin[] = [];
  for (const plugins of grouped.values()) {
    flatList.push(...plugins);
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
      {Array.from(grouped.entries()).map(([category, plugins]) => (
        <div key={category} className="mb-0.5">
          <div className="text-[9px] font-semibold text-t3 uppercase tracking-[.1em] pt-1.5 pb-1 px-2">{t(CATEGORY_KEYS[category])}</div>
          {plugins.map((plugin) => {
            const currentIndex = itemIndex++;
            return (
              <div
                key={plugin.name}
                className={`slash-menu-item group flex items-center gap-2.5 py-2 px-2 rounded-lg cursor-pointer transition-[background-color,box-shadow] duration-100 ${
                  currentIndex === activeIndex
                    ? 'active bg-accglow shadow-[inset_0_0_0_1px_var(--accdim)]'
                    : 'hover:bg-hov'
                }`}
                onClick={() => onSelect(plugin)}
                onMouseEnter={() => setActiveIndex(currentIndex)}
              >
                <span
                  className={`w-7 h-7 flex items-center justify-center rounded-md bg-surf2 text-[15px] shrink-0 transition-colors duration-100 ${
                    currentIndex === activeIndex ? 'bg-accdim' : ''
                  }`}
                >
                  {renderContainerIcon(plugin.icon)}
                </span>
                <div className="flex flex-col gap-px min-w-0">
                  <span className="text-xs font-medium text-t1 truncate">{plugin.label}</span>
                  {plugin.description && (
                    <span className="text-[10px] text-t3 truncate">{plugin.description}</span>
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
