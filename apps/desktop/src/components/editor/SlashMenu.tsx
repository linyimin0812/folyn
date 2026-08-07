import { useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ContainerRegistry } from '@quill/container-plugins';
import type { ContainerPlugin, ContainerCategory } from '@quill/container-plugins';
import { IconFromSvg } from '@/components/icons/IconFromSvg';

const CATEGORY_KEYS: Record<ContainerCategory, string> = {
  layout: 'editor:slashMenu.categories.layout',
  media: 'editor:slashMenu.categories.media',
  ai: 'editor:slashMenu.categories.ai',
  data: 'editor:slashMenu.categories.data',
  custom: 'editor:slashMenu.categories.custom',
};

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
  const registry = ContainerRegistry.getInstance();

  const allPlugins = registry.getAll().filter((p) => p.name !== 'step' && p.name !== 'tab');
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

  useEffect(() => {
    setActiveIndex(0);
  }, [filter]);

  // Adjust position to avoid being clipped at the bottom of the viewport
  useEffect(() => {
    if (!visible || !menuRef.current) {
      setAdjustedPosition(position);
      return;
    }
    requestAnimationFrame(() => {
      const menu = menuRef.current;
      if (!menu) return;
      const menuHeight = menu.offsetHeight;
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - position.top;
      if (spaceBelow < menuHeight && position.top > menuHeight) {
        // Not enough space below, flip above
        setAdjustedPosition({ top: position.top - menuHeight - 8, left: position.left });
      } else {
        setAdjustedPosition(position);
      }
    });
  }, [visible, position, flatList.length]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
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

  // Scroll active item into view
  useEffect(() => {
    if (!visible || !menuRef.current) return;
    const activeElement = menuRef.current.querySelector('.slash-menu-item.active');
    if (activeElement) {
      activeElement.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, visible]);

  if (!visible || flatList.length === 0) return null;

  let itemIndex = 0;

  return (
    <div
      className="slash-menu fixed z-40 bg-panel border border-brd2 rounded-lg shadow-[0_8px_32px_rgba(0,0,0,.12)] min-w-[240px] max-h-[320px] overflow-y-auto p-1.5 animate-[fadeIn_.12s]"
      ref={menuRef}
      style={{ top: adjustedPosition.top, left: adjustedPosition.left }}
    >
      {Array.from(grouped.entries()).map(([category, plugins]) => (
        <div key={category} className="mb-1">
          <div className="text-[9px] font-semibold text-t3 uppercase tracking-[.1em] py-1.5 px-2">{t(CATEGORY_KEYS[category])}</div>
          {plugins.map((plugin) => {
            const currentIndex = itemIndex++;
            return (
              <div
                key={plugin.name}
                className={`slash-menu-item flex items-center gap-2 py-1.5 px-2 rounded-[5px] cursor-pointer transition-[background] duration-100 ${currentIndex === activeIndex ? 'active bg-hov' : ''}`}
                onClick={() => onSelect(plugin)}
                onMouseEnter={() => setActiveIndex(currentIndex)}
              >
                <span className="text-base w-6 text-center shrink-0">{renderContainerIcon(plugin.icon)}</span>
                <div className="flex flex-col gap-px">
                  <span className="text-xs font-medium text-t1">{plugin.label}</span>
                  {plugin.description && (
                    <span className="text-[10px] text-t3">{plugin.description}</span>
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
