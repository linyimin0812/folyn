import { useState, useRef, useEffect } from 'react';
import type { ContainerExtension, ContainerProps } from '../ContainerExtension';

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
 * Underline strip, no outer card: tab content flows below the strip as
 * regular markdown (de-carded reading), styled by .docmd-tabs* CSS.
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
    <div ref={containerRef} className="docmd-tabs">
      {tabs.length > 0 && (
        <div className="docmd-tabs-strip">
          {tabs.map((tab, i) => (
            <button
              key={i}
              data-tab-button={i}
              className={`docmd-tab-btn${activeTab === i ? ' is-active' : ''}`}
              onClick={() => setActiveTab(i)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
      <div className="docmd-tabs-body">
        {children}
      </div>
    </div>
  );
}

export const tabExtension: ContainerExtension = {
  name: 'tab',
  icon: '📄',
  label: '标签项',
  category: 'layout',
  component: TabComponent,
  template: ':::tab{label="标签名"}\n标签内容\n:::',
  description: '单个标签（用在 ::::tabs 内部）',
};

export const tabsExtension: ContainerExtension = {
  name: 'tabs',
  icon: '📑',
  label: '标签页',
  category: 'layout',
  component: TabsComponent,
  template: '::::tabs\n:::tab{label="macOS"}\nmacOS 安装说明\n:::\n:::tab{label="Windows"}\nWindows 安装说明\n:::\n:::tab{label="Linux"}\nLinux 安装说明\n:::\n::::',
  description: '可切换的标签面板',
  hidesInactiveChildren: true,
};
