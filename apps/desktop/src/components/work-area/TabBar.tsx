import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileTab } from '@/store/editorStore';
import { FileIcon } from '@/components/icons/FileIcon';
import { hideWebviewsForOverlay } from '@/components/file-types/web/WebViewer';
import { useTranslation } from 'react-i18next';
import { X, SquareArrowOutUpRight } from 'lucide-react';
import { isExternalPath } from '@/utils/isExternalPath';

interface TabBarProps {
  tabs: FileTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
}

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab }: TabBarProps) {
  const { t } = useTranslation();
  const [tabListOpen, setTabListOpen] = useState(false);
  const tabListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tabListOpen) return;
    // Hide native webviews while the panel is open so it can never be covered
    // by a web page; the active webview re-syncs on quill:overlay-closed.
    hideWebviewsForOverlay();
    const handleClick = (e: MouseEvent) => {
      if (tabListRef.current && !tabListRef.current.contains(e.target as Node)) {
        setTabListOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      window.dispatchEvent(new CustomEvent('quill:overlay-closed'));
    };
  }, [tabListOpen]);

  const closeTabList = useCallback(() => setTabListOpen(false), []);

  const handleCloseAll = useCallback(() => {
    for (const tab of tabs) onCloseTab(tab.id);
    closeTabList();
  }, [tabs, onCloseTab, closeTabList]);

  return (
    <div className="flex items-stretch h-[34px] shrink-0 border-b border-brd bg-panel">
      <div className="flex items-stretch flex-1 min-w-0 overflow-x-auto overflow-y-hidden gap-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => {
          return (
            <div
              key={tab.id}
              className={`group flex items-center gap-[5px] px-[11px] font-mono text-[calc(var(--ui-font-size)-3px)] text-t3 cursor-pointer border-b-2 border-b-transparent whitespace-nowrap shrink-0 transition-all duration-[220ms] select-none hover:text-t2 hover:bg-hov ${activeTabId === tab.id ? 'text-t1 !border-b-acc bg-surf' : ''}`}
              onClick={() => onSelectTab(tab.id)}
            >
              <span className="shrink-0 flex items-center"><FileIcon filename={tab.name} fileType={tab.fileType} /></span>
              <span className="max-w-[110px] overflow-hidden text-ellipsis">{tab.name}</span>
              {isExternalPath(tab.path) && (
                <span data-tip={t('topbar:tabList.externalFile')} className="flex items-center shrink-0">
                  <SquareArrowOutUpRight
                    size={11}
                    className="text-t4 group-hover:text-t3"
                    aria-label={t('topbar:tabList.externalFile')}
                  />
                </span>
              )}
              {tab.isDirty && <span className="w-[5px] h-[5px] rounded-full bg-amber shrink-0" />}
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
          onClick={() => setTabListOpen((open) => !open)}
          title={t('topbar:tabList.menu')}
          aria-label={t('topbar:tabList.menu')}
          aria-haspopup="menu"
          aria-expanded={tabListOpen}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {tabListOpen && (
          <div
            data-testid="tab-list-panel"
            role="menu"
            className="absolute top-full right-0 z-[100] w-[300px] max-h-[340px] flex flex-col overflow-hidden bg-panel border border-brd2 rounded-[6px] shadow-[0_8px_32px_rgba(0,0,0,.14)] animate-[fadeIn_.12s]"
          >
            <div className="flex items-center gap-2 h-[34px] px-3 border-b border-brd shrink-0">
              <span className="text-[11px] font-semibold text-t2 uppercase tracking-[0.06em]">
                {t('topbar:tabList.menu')}
              </span>
              <span className="text-[10px] text-t3 bg-hov rounded-[8px] px-1.5 py-px">
                {tabs.length}
              </span>
              <button
                type="button"
                className="ml-auto w-[22px] h-[22px] flex items-center justify-center rounded-[4px] text-t3 cursor-pointer transition-[background,color] duration-100 hover:bg-hov hover:text-t1"
                onClick={closeTabList}
                title={t('topbar:tabList.closePanel')}
                aria-label={t('topbar:tabList.closePanel')}
              >
                <X size={12} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {tabs.length === 0 ? (
                <div className="px-3 py-5 text-center text-[11px] text-t3">
                  {t('topbar:tabList.noOpenFiles')}
                </div>
              ) : (
                tabs.map((tab) => (
                  <div
                    key={tab.id}
                    role="menuitem"
                    className={`group flex items-center gap-2 px-3 py-[7px] text-[calc(var(--ui-font-size)-2px)] cursor-pointer whitespace-nowrap transition-[background,color] duration-[120ms] hover:bg-hov ${
                      activeTabId === tab.id ? 'text-acc bg-accdim' : 'text-t2 hover:text-t1'
                    }`}
                    onClick={() => {
                      onSelectTab(tab.id);
                      closeTabList();
                    }}
                    title={tab.name}
                  >
                    <span className="shrink-0 flex items-center">
                      <FileIcon filename={tab.name} fileType={tab.fileType} />
                    </span>
                    <span className="flex-1 min-w-0 overflow-hidden text-ellipsis">{tab.name}</span>
                    {isExternalPath(tab.path) && (
                      <span data-tip={t('topbar:tabList.externalFile')} className="flex items-center shrink-0">
                        <SquareArrowOutUpRight
                          size={12}
                          className="text-t4 group-hover:text-t3"
                          aria-label={t('topbar:tabList.externalFile')}
                        />
                      </span>
                    )}
                    {tab.isDirty && <span className="w-[5px] h-[5px] rounded-full bg-amber shrink-0" />}
                    <span
                      role="button"
                      aria-label={t('topbar:tabList.closeTab')}
                      className="opacity-40 text-[10px] shrink-0 w-[18px] h-[18px] flex items-center justify-center rounded-[3px] transition-[opacity,background,color] duration-100 group-hover:opacity-100 hover:!opacity-100 hover:bg-hov hover:text-red"
                      onClick={(event) => {
                        event.stopPropagation();
                        onCloseTab(tab.id);
                      }}
                    >
                      <X size={12} />
                    </span>
                  </div>
                ))
              )}
            </div>
            {tabs.length > 0 && (
              <button
                type="button"
                className="h-[32px] shrink-0 border-t border-brd text-[11px] text-t3 cursor-pointer transition-[background,color] duration-100 hover:bg-hov hover:text-t1"
                onClick={handleCloseAll}
              >
                {t('topbar:tabList.closeAll')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
