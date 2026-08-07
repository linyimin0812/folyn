import { useState, useRef, useEffect } from 'react';
import type { ContainerPlugin, ContainerProps } from '../ContainerPlugin';

/** Single tab panel – renders content with a data attribute for the label */
function TabComponent({ children, attributes }: ContainerProps) {
  const label = attributes?.label || attributes?.title || '';
  return (
    <div data-tab-label={label} data-is-tab="true" style={{ display: 'none' }}>
      {children}
    </div>
  );
}

/**
 * Tabs container – collects :::tab children via DOM after mount,
 * renders tab headers and shows the active tab content.
 */
function TabsComponent({ children }: ContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tabs, setTabs] = useState<Array<{ label: string; element: HTMLElement }>>([]);
  const [activeTab, setActiveTab] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const tabElements = container.querySelectorAll<HTMLElement>('[data-is-tab="true"]');
    const collected: Array<{ label: string; element: HTMLElement }> = [];
    tabElements.forEach((el, index) => {
      const label = el.getAttribute('data-tab-label') || `Tab ${index + 1}`;
      collected.push({ label, element: el });
    });
    if (collected.length > 0) {
      setTabs(collected);
      // Show first tab
      collected.forEach((tab, i) => {
        tab.element.style.display = i === 0 ? 'block' : 'none';
      });
    }
  }, [children]);

  useEffect(() => {
    tabs.forEach((tab, i) => {
      tab.element.style.display = i === activeTab ? 'block' : 'none';
    });
  }, [activeTab, tabs]);

  return (
    <div ref={containerRef} className="docmd-tabs" style={{
      border: '1px solid var(--brd, #e4e4e7)',
      borderRadius: '6px',
      overflow: 'hidden',
      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
      margin: '1.5rem 0',
    }}>
      {tabs.length > 0 && (
        <div style={{
          display: 'flex',
          backgroundColor: 'var(--surf, #fafafa)',
          borderBottom: '1px solid var(--brd, #e4e4e7)',
          flexWrap: 'wrap',
        }}>
          {tabs.map((tab, i) => (
            <button
              key={i}
              data-tab-button={i}
              onClick={() => setActiveTab(i)}
              style={{
                padding: '.75rem 1.25rem',
                cursor: 'pointer',
                border: 'none',
                borderBottom: `3px solid ${activeTab === i ? 'var(--acc, #068ad5)' : 'transparent'}`,
                marginBottom: '-1px',
                fontWeight: 500,
                fontSize: '14px',
                whiteSpace: 'nowrap',
                color: activeTab === i ? 'var(--acc, #068ad5)' : 'var(--t3, #71717a)',
                backgroundColor: activeTab === i ? 'var(--panel, #fff)' : 'transparent',
                transition: 'color .2s, border-color .2s, background-color .2s',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
      <div style={{ padding: '1.5rem' }}>
        {children}
      </div>
    </div>
  );
}

export const tabPlugin: ContainerPlugin = {
  name: 'tab',
  icon: '📄',
  label: '标签项',
  category: 'layout',
  component: TabComponent,
  template: ':::tab{label="标签名"}\n标签内容\n:::',
  description: '单个标签（用在 ::::tabs 内部）',
};

export const tabsPlugin: ContainerPlugin = {
  name: 'tabs',
  icon: '📑',
  label: '标签页',
  category: 'layout',
  component: TabsComponent,
  template: '::::tabs\n:::tab{label="macOS"}\nmacOS 安装说明\n:::\n:::tab{label="Windows"}\nWindows 安装说明\n:::\n:::tab{label="Linux"}\nLinux 安装说明\n:::\n::::',
  description: '可切换的标签面板',
};
