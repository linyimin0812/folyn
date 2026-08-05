import { useCallback, useEffect } from 'react';
import type { FileTab } from '@/store/editorStore';
import { useEditorStore } from '@/store/editorStore';
import { FileIcon } from '@/components/icons/FileIcon';
import { isTauri } from '@/utils/platform';
import { useTranslation } from 'react-i18next';

interface TabBarProps {
  tabs: FileTab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
}

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab }: TabBarProps) {
  const { t } = useTranslation();

  // The open-files list is a native NSMenu (topbar_tablist_menu) so it floats
  // above the embedded webview without hiding the currently open webpage.
  const openTabList = useCallback((e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const tabItems = tabs.map((tab) => ({ id: tab.id, name: tab.name }));
    void Promise.all([
      import('@tauri-apps/api/core'),
      import('@tauri-apps/api/window'),
    ]).then(([{ invoke }, { getCurrentWindow }]) => {
      return invoke('topbar_tablist_menu', {
        x: rect.left,
        y: rect.bottom,
        tabs: tabItems,
        activeTabId,
        closeAllLabel: t('topbar:tabList.closeAll'),
        noOpenFilesLabel: t('topbar:tabList.noOpenFiles'),
        windowLabel: getCurrentWindow().label,
      });
    }).catch((err) => {
      console.warn('[TabBar] open tab list failed:', err);
    });
  }, [tabs, activeTabId, t]);

  // Menu item clicks arrive as Tauri events (forwarded by on_menu_event in
  // lib.rs); route them straight to the editor store.
  useEffect(() => {
    if (!isTauri()) return;
    let unlistenSelect: (() => void) | null = null;
    let unlistenCloseAll: (() => void) | null = null;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<string>('app://select-tab', (event) => {
        useEditorStore.getState().setActiveTab(event.payload);
      }).then((fn) => { unlistenSelect = fn; });
      listen('app://close-all-tabs', () => {
        const state = useEditorStore.getState();
        const ids = [...state.tabs.map((tab) => tab.id)];
        for (const id of ids) state.closeTab(id);
      }).then((fn) => { unlistenCloseAll = fn; });
    });
    return () => {
      unlistenSelect?.();
      unlistenCloseAll?.();
    };
  }, []);

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
      <div className="relative flex items-center shrink-0 border-l border-brd">
        <button
          className="w-7 h-full flex items-center justify-center text-t3 cursor-pointer transition-[background] duration-150 hover:bg-hov hover:text-t2"
          onClick={openTabList}
          title={t('topbar:tabList.menu')}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>
    </div>
  );
}
