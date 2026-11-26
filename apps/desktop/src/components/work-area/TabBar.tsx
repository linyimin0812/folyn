import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FileTab } from '@/store/editorStore';
import { FileIcon } from '@/components/icons/FileIcon';
import { hideWebviewsForOverlay } from '@/components/file-types/web/WebViewer';
import { useTranslation } from 'react-i18next';
import { X, SquareArrowOutUpRight, Pin, PinOff } from 'lucide-react';
import { isExternalPath } from '@/utils/isExternalPath';

interface TabBarProps {
  tabs: FileTab[];
  /** Most recently used first (spec 6.2 — drives the switch list order). */
  mruOrder: string[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onCloseOthers: (tabId: string) => void;
  onTogglePin: (tabId: string) => void;
}

/** Instance suffix display for duplicate tabs of one document (`path`, `path ~2`): 1 → none. */
function instanceLabel(tabs: FileTab[], tab: FileTab): string | null {
  const siblings = tabs.filter((t) => t.path === tab.path);
  if (siblings.length < 2) return null;
  const i = siblings.findIndex((t) => t.id === tab.id) + 1;
  return i > 1 ? `~${i}` : null;
}

// jsdom lacks CSS.escape (established constraint) — this is the same local
// shim headingNav uses, reduced to attribute-selector quoting: escape the
// characters that would break out of a quoted attr value.
const cssEscape = (id: string): string => id.replace(/["\\\u0000]/g, (ch) => `\\${ch}`);

// Render position for the context menu: under the tab's strip entry.
function menuLeftFor(tabId: string): string {
  const el = document.querySelector(`[data-tab-id="${cssEscape(tabId)}"]`);
  if (!el) return '50%';
  const r = el.getBoundingClientRect();
  return `${Math.min(r.left, window.innerWidth - 190)}px`;
}

export function TabBar({ tabs, mruOrder, activeTabId, onSelectTab, onCloseTab, onCloseOthers, onTogglePin }: TabBarProps) {
  const { t } = useTranslation();
  const [tabListOpen, setTabListOpen] = useState(false);
  const [listQuery, setListQuery] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!tabListOpen) return;
    // Hide native webviews while the panel is open so it can never be covered
    // by a web page; the active webview re-syncs on folyn:overlay-closed.
    hideWebviewsForOverlay();
    const handleClick = (e: MouseEvent) => {
      if (tabListRef.current && !tabListRef.current.contains(e.target as Node)) {
        setTabListOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    if (searchInputRef.current) searchInputRef.current.focus();
    return () => {
      document.removeEventListener('mousedown', handleClick);
      window.dispatchEvent(new CustomEvent('folyn:overlay-closed'));
    };
  }, [tabListOpen]);

  // Shared outside-click dismissal for the per-tab context menu.
  useEffect(() => {
    if (!menuFor) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuFor(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuFor]);

  const closeTabList = useCallback(() => setTabListOpen(false), []);

  /** Open the folder containing an external file in the system file manager
   *  (e.g. Finder). Resolves ~/ and $HOME/ prefixes before taking the dirname,
   *  since the shell opener does not expand them. */
  const openExternalFolder = useCallback(async (path: string) => {
    try {
      const { openPath } = await import('@tauri-apps/plugin-opener');
      let resolved = path;
      if (resolved.startsWith('~/') || resolved.startsWith('$HOME/')) {
        const { homeDir, join } = await import('@tauri-apps/api/path');
        const home = (await homeDir()).replace(/[/\\]+$/, '');
        // ponytail: join() is separator-aware — string concat produced mixed
        // separators on Windows failing the fs scope glob.
        const suffix = resolved.startsWith('~/') ? resolved.slice(1) : resolved.slice('$HOME'.length);
        resolved = await join(home, suffix);
      }
      const { dirname } = await import('@tauri-apps/api/path');
      // ponytail: dirname() is separator-aware; lastIndexOf('/') on a Windows
      // backslash path returns -1 → wrong folder.
      const folder = await dirname(resolved);
      await openPath(folder || resolved);
    } catch (err) {
      console.warn('[TabBar] open containing folder failed:', err);
    }
  }, []);

  const handleCloseAll = useCallback(() => {
    // Close-all protects pinned tabs too (spec 6.2); dirty tabs are flushed
    // by closeTabWithSnapshot's auto-save path first.
    for (const tab of tabs) {
      if (tab.pinned) continue;
      onCloseTab(tab.id);
    }
    closeTabList();
  }, [tabs, onCloseTab, closeTabList]);

  // Switch list: MRU order (spec 6.2), filtered by query over
  // name/path/section — this is how two tabs of one document are told apart.
  const mruTabs = useMemo(() => {
    const byId = new Map(tabs.map((tab) => [tab.id, tab]));
    const ordered = mruOrder.map((id) => byId.get(id)).filter((tab): tab is FileTab => !!tab);
    for (const tab of tabs) if (!ordered.includes(tab)) ordered.push(tab);
    const q = listQuery.trim().toLowerCase();
    if (!q) return ordered;
    return ordered.filter((tab) =>
      tab.name.toLowerCase().includes(q)
      || tab.path.toLowerCase().includes(q)
      || (tab.readingHeading?.text ?? '').toLowerCase().includes(q),
    );
  }, [tabs, mruOrder, listQuery]);

  return (
    <div className="flex items-stretch h-[34px] shrink-0 border-b border-brd bg-panel">
      <div className="flex items-stretch flex-1 min-w-0 overflow-x-auto overflow-y-hidden gap-px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => {
          const inst = instanceLabel(tabs, tab);
          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              className={`group flex items-center gap-[5px] px-[11px] text-[calc(var(--ui-font-size)-3px)] text-t3 cursor-pointer border-b-2 border-b-transparent whitespace-nowrap shrink-0 transition-all duration-[220ms] select-none hover:text-t2 hover:bg-hov ${activeTabId === tab.id ? 'text-t1 !border-b-acc bg-surf' : ''}`}
              onClick={() => onSelectTab(tab.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenuFor(tab.id);
              }}
              title={`${tab.name}${tab.readingHeading ? ` · ${tab.readingHeading.text}` : ''}`}
            >
              {tab.pinned && <Pin size={10} className="shrink-0 text-acc pointer-events-none" />}
              <span className="shrink-0 flex items-center"><FileIcon filename={tab.name} fileType={tab.fileType} /></span>
              <span className="max-w-[110px] overflow-hidden text-ellipsis">{tab.name}</span>
              {inst && <span className="text-t4 text-[10px] shrink-0">{inst}</span>}
              {isExternalPath(tab.path) && (
                <span
                  className="shrink-0 flex items-center cursor-pointer"
                  role="button"
                  aria-label={t('topbar:tabList.openExternalFolder')}
                  onClick={(event) => {
                    event.stopPropagation();
                    void openExternalFolder(tab.path);
                  }}
                >
                  <SquareArrowOutUpRight size={12} className="text-t4 pointer-events-none" />
                </span>
              )}
              {tab.isDirty && <span className="w-[5px] h-[5px] rounded-full bg-amber shrink-0" />}
              {tab.pinned ? (
                // Pinned tabs have no close affordance (spec 6.2 关闭保护) —
                // closing is an explicit context-menu action.
                <span
                  className="opacity-0 shrink-0 w-[14px] h-[14px] flex items-center justify-center text-[10px] transition-opacity duration-100 group-hover:opacity-60 cursor-pointer"
                  role="button"
                  aria-label={t('topbar:tabList.unpin')}
                  title={t('topbar:tabList.unpin')}
                  onClick={(event) => {
                    event.stopPropagation();
                    onTogglePin(tab.id);
                  }}
                >
                  <PinOff size={10} />
                </span>
              ) : (
                <span
                  className="opacity-0 text-[10px] shrink-0 w-[14px] h-[14px] flex items-center justify-center rounded-[3px] transition-[opacity,background] duration-100 group-hover:opacity-50 hover:!opacity-100 hover:bg-hov hover:text-red"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                >
                  ✕
                </span>
              )}
            </div>
          );
        })}
      </div>

      {menuFor && (
        <div
          ref={menuRef}
          data-testid="tab-context-menu"
          role="menu"
          className="fixed z-[120] w-[180px] bg-panel border border-brd2 rounded-[6px] shadow-[0_8px_32px_rgba(0,0,0,.14)] py-1 text-[calc(var(--ui-font-size)-2px)]"
          style={{
            left: menuLeftFor(menuFor),
            top: '40px',
          }}
        >
          {(() => {
            const tab = tabs.find((t) => t.id === menuFor);
            if (!tab) return null;
            return (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="w-full flex items-center gap-2 px-3 py-[6px] text-t2 cursor-pointer hover:bg-hov hover:text-t1 text-left"
                  onClick={() => { onTogglePin(tab.id); setMenuFor(null); }}
                >
                  {tab.pinned ? <PinOff size={12} /> : <Pin size={12} />}
                  {tab.pinned ? t('topbar:tabList.unpin') : t('topbar:tabList.pin')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="w-full flex items-center gap-2 px-3 py-[6px] text-t2 cursor-pointer hover:bg-hov hover:text-t1 text-left"
                  onClick={() => { onCloseTab(tab.id); setMenuFor(null); }}
                >
                  <X size={12} />
                  {t('topbar:tabList.closeTab')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="w-full flex items-center gap-2 px-3 py-[6px] text-t2 cursor-pointer hover:bg-hov hover:text-t1 text-left"
                  disabled={tabs.filter((t) => !t.pinned && t.id !== tab.id).length === 0}
                  title={tab.pinned ? t('topbar:tabList.pinnedNote') : undefined}
                  onClick={() => { onCloseOthers(tab.id); setMenuFor(null); }}
                >
                  <X size={12} />
                  {t('topbar:tabList.closeOthers')}
                </button>
              </>
            );
          })()}
        </div>
      )}

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
            className="absolute top-full right-0 z-[100] w-[340px] max-h-[380px] flex flex-col overflow-hidden bg-panel border border-brd2 rounded-[6px] shadow-[0_8px_32px_rgba(0,0,0,.14)] animate-[fadeIn_.12s]"
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
            {/* Spec 6.2 — searchable switch list: MRU-ordered, matches on
                name / path / reading section (two tabs of one document are
                told apart by their section labels). */}
            <div className="flex items-center gap-2 h-[32px] px-3 border-b border-brd shrink-0">
              <input
                ref={searchInputRef}
                className="flex-1 min-w-0 bg-transparent text-[calc(var(--ui-font-size)-2px)] text-t1 placeholder:text-t4 outline-none"
                placeholder={t('topbar:tabList.searchPlaceholder')}
                value={listQuery}
                spellCheck={false}
                onChange={(e) => setListQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    if (listQuery) setListQuery('');
                    else setTabListOpen(false);
                  } else if (e.key === 'Enter' && mruTabs.length > 0) {
                    onSelectTab(mruTabs[0].id);
                    closeTabList();
                  } else if (e.key === 'ArrowDown' && mruTabs.length > 0) {
                    e.preventDefault();
                    (mruTabs[0] && document.querySelector(`[data-switch-id="${cssEscape(mruTabs[0].id)}"]`) as HTMLElement | null)?.focus?.();
                  }
                }}
              />
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {mruTabs.length === 0 ? (
                <div className="px-3 py-5 text-center text-[11px] text-t3">
                  {tabs.length === 0 ? t('topbar:tabList.noOpenFiles') : t('topbar:tabList.noMatches')}
                </div>
              ) : (
                mruTabs.map((tab, i) => {
                  const inst = instanceLabel(tabs, tab);
                  return (
                    <div
                      key={tab.id}
                      data-switch-id={tab.id}
                      role="menuitem"
                      tabIndex={-1}
                      className={`group flex items-center gap-2 px-3 py-[7px] text-[calc(var(--ui-font-size)-2px)] cursor-pointer whitespace-nowrap transition-[background,color] duration-[120ms] hover:bg-hov focus:bg-hov focus:outline-none ${
                        activeTabId === tab.id ? 'text-acc bg-accdim' : 'text-t2 hover:text-t1'
                      }`}
                      onClick={() => {
                        onSelectTab(tab.id);
                        closeTabList();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          onSelectTab(tab.id);
                          closeTabList();
                        }
                      }}
                      title={tab.path}
                    >
                      <span className="shrink-0 flex items-center w-[10px] justify-center text-t4 text-[10px]">{i + 1}</span>
                      <span className="shrink-0 flex items-center">
                        <FileIcon filename={tab.name} fileType={tab.fileType} />
                      </span>
                      <span className="flex-1 min-w-0 overflow-hidden text-ellipsis">
                        {tab.name}
                        {inst && <span className="text-t4 text-[10px] ml-1">{inst}</span>}
                        {tab.readingHeading && (
                          <span className="text-t3 text-[10px] ml-2 opacity-80">
                            § {tab.readingHeading.text}
                          </span>
                        )}
                      </span>
                      {tab.pinned && <Pin size={10} className="shrink-0 text-acc" />}
                      {isExternalPath(tab.path) && (
                        <span
                          className="shrink-0 flex items-center cursor-pointer"
                          role="button"
                          aria-label={t('topbar:tabList.openExternalFolder')}
                          onClick={(event) => {
                            event.stopPropagation();
                            void openExternalFolder(tab.path);
                          }}
                        >
                          <SquareArrowOutUpRight size={12} className="text-t4 pointer-events-none" />
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
                  );
                })
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
