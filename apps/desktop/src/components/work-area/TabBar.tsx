import { useRef, useState, useEffect } from 'react';
import type { FileTab } from '@/store/editorStore';
import { getHandlerById } from '../file-types/registry';
import { FileIcon } from '@/components/icons/FileIcon';

interface TabBarProps {
  tabs: FileTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
}

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab }: TabBarProps) {
  const [tabListOpen, setTabListOpen] = useState(false);
  const tabListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tabListOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (tabListRef.current && !tabListRef.current.contains(e.target as Node)) {
        setTabListOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [tabListOpen]);

  return (
    <div className="flex items-stretch h-[34px] shrink-0 border-b border-brd bg-panel">
      <div className="flex items-stretch flex-1 min-w-0 overflow-x-auto overflow-y-hidden gap-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => {
          const tabHandler = getHandlerById(tab.fileType);
          return (
            <div
              key={tab.id}
              className={`group flex items-center gap-[5px] px-[11px] font-mono text-[calc(var(--ui-font-size)-3px)] text-t3 cursor-pointer border-b-2 border-b-transparent whitespace-nowrap shrink-0 transition-all duration-[220ms] select-none hover:text-t2 hover:bg-hov ${activeTabId === tab.id ? 'text-t1 !border-b-acc bg-surf' : ''}`}
              onClick={() => onSelectTab(tab.id)}
            >
              {tab.isDirty && <span className="w-[5px] h-[5px] rounded-full bg-amber shrink-0" />}
              <span className="shrink-0 flex items-center">{tabHandler?.icon ?? <FileIcon filename={tab.name} />}</span>
              <span className="max-w-[110px] overflow-hidden text-ellipsis">{tab.name}</span>
              <span
                className="opacity-0 text-[10px] shrink-0 w-[14px] h-[14px] flex items-center justify-center rounded-[3px] transition-[opacity,background] duration-100 group-hover:opacity-50 hover:!opacity-100 hover:bg-hov hover:text-red"
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTab(tab.id);
                }}
              >
                ✕
              </span>
            </div>
          );
        })}
      </div>
      <div className="relative flex items-center shrink-0 border-l border-brd" ref={tabListRef}>
        <button
          className="w-7 h-full flex items-center justify-center text-t3 cursor-pointer transition-[background] duration-150 hover:bg-hov hover:text-t2"
          onClick={() => setTabListOpen(!tabListOpen)}
          title="所有打开的文件"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {tabListOpen && (
          <div className="absolute top-full right-0 z-[100] max-h-[300px] overflow-y-auto bg-surf border border-brd rounded-[6px] shadow-[0_4px_16px_rgba(0,0,0,0.12)] py-1">
            {tabs.map((tab) => {
              const tabHandler = getHandlerById(tab.fileType);
              return (
                <div
                  key={tab.id}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-[calc(var(--ui-font-size)-2px)] text-t2 cursor-pointer whitespace-nowrap transition-[background] duration-[120ms] hover:bg-hov ${activeTabId === tab.id ? '!text-acc bg-hov' : ''}`}
                  onClick={() => { onSelectTab(tab.id); setTabListOpen(false); }}
                >
                  <span className="shrink-0 flex items-center">{tabHandler?.icon ?? <FileIcon filename={tab.name} />}</span>
                  <span className="flex-1">{tab.name}</span>
                  {tab.isDirty && <span className="w-[5px] h-[5px] rounded-full bg-amber shrink-0" />}
                  <span
                    className="opacity-40 text-[10px] w-[18px] h-[18px] shrink-0 flex items-center justify-center rounded-[3px] transition-[opacity,background] duration-100 hover:opacity-100 hover:bg-hov hover:text-red"
                    onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
                  >
                    ✕
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
