import { useState, useEffect, useCallback, useRef } from 'react';
import { ContainerRegistry } from '@quill/container-plugins';
import type { ContainerPlugin, ContainerCategory } from '@quill/container-plugins';

const CATEGORY_LABELS: Record<ContainerCategory, string> = {
  layout: '布局',
  media: '媒体',
  ai: 'AI',
  data: '数据',
  custom: '自定义',
};

interface SlashMenuProps {
  visible: boolean;
  filter: string;
  position: { top: number; left: number };
  onSelect: (plugin: ContainerPlugin) => void;
  onClose: () => void;
}

export function SlashMenu({ visible, filter, position, onSelect, onClose }: SlashMenuProps) {
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
    <div className="slash-menu" ref={menuRef} style={{ top: adjustedPosition.top, left: adjustedPosition.left, maxHeight: '300px', overflowY: 'auto' }}>
      {Array.from(grouped.entries()).map(([category, plugins]) => (
        <div key={category} className="slash-menu-group">
          <div className="slash-menu-category">{CATEGORY_LABELS[category]}</div>
          {plugins.map((plugin) => {
            const currentIndex = itemIndex++;
            return (
              <div
                key={plugin.name}
                className={`slash-menu-item ${currentIndex === activeIndex ? 'active' : ''}`}
                onClick={() => onSelect(plugin)}
                onMouseEnter={() => setActiveIndex(currentIndex)}
              >
                <span className="slash-menu-icon">{plugin.icon}</span>
                <div className="slash-menu-info">
                  <span className="slash-menu-label">{plugin.label}</span>
                  {plugin.description && (
                    <span className="slash-menu-desc">{plugin.description}</span>
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
