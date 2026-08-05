import { useEffect, useRef, useState } from 'react';
import { useEditorStore, type ViewMode } from '@/store/editorStore';
import { useEditorViewStateStore } from '@/store/editorViewState';
import { useNavStore } from '@/store/navStore';
import { useVaultStore } from '@/store/vaultStore';
import { useTerminalStore } from '@/store/terminalStore';
import { isExternalPath } from '@/utils/isExternalPath';
import * as editorIoService from '@/services/editorIoService';
import { openBrowserTab } from '@/services/editorIoService';
import { requestRevealPath } from '@/services/revealPathBridge';
import { useTheme } from '@/hooks/useTheme';
import { ExportMenu } from '@/components/editor/ExportMenu';
import { MoveDialog } from '@/components/sidebar/SidebarActions';
import { LanguageSwitcher } from '@/components/shell/LanguageSwitcher';
import { requestPlanMyDay } from '@/services/planMyDayBridge';
import { useTranslation } from 'react-i18next';
import { Sun, Moon, FolderInput, Plus } from 'lucide-react';
import terminalIcon from '@/assets/terminal.svg';
import chromeIcon from '@/assets/chrome.svg';

/** File types that support meaningful multi-mode switching — show the view-mode segment. */
const SHOW_VIEW_MODE_FILE_TYPES = new Set(['markdown', 'json', 'csv', 'mmap', 'dbml', 'html', 'svg']);

const VIEW_MODE_ICONS: Record<ViewMode, React.ReactNode> = {
  split: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <line x1="8" y1="2.5" x2="8" y2="13.5" />
    </svg>
  ),
  edit: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M11.5 1.5l3 3-9 9H2.5v-3l9-9z" />
      <line x1="9" y1="4" x2="12" y2="7" />
    </svg>
  ),
  preview: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  ),
  visual: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M11.5 1.5l3 3-9 9H2.5v-3l9-9z" />
      <line x1="9" y1="4" x2="12" y2="7" />
    </svg>
  ),
  source: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M5 3L1 8l4 5M11 3l4 5-4 5" />
    </svg>
  ),
};

const VIEW_MODES: ViewMode[] = ['split', 'edit', 'preview'];

const HTML_MODES: ViewMode[] = ['preview', 'source', 'visual'];

interface TopbarProps {
  isMobile?: boolean;
  onToggleSidebar?: () => void;
}

export function Topbar({ isMobile, onToggleSidebar }: TopbarProps) {
  const { t } = useTranslation();
  const viewMode = useEditorStore((state) => state.viewMode);
  const setViewMode = useEditorStore((state) => state.setViewMode);
  const toggleAiPanel = useEditorViewStateStore((state) => state.toggleAiPanel);
  const openTerminalDock = useEditorViewStateStore((state) => state.openTerminalDock);
  const closeTerminalPanel = useEditorViewStateStore((state) => state.closeTerminalPanel);
  const terminalPanelVisible = useEditorViewStateStore((state) => state.terminalPanelVisible);
  const terminalSessions = useTerminalStore((state) => state.sessions);
  const activeTab = useEditorStore((state) => {
    const tabs = state.tabs;
    return tabs.find((t) => t.id === state.activeTabId);
  });
  const fileTree = useVaultStore((state) => state.fileTree);
  const copyExternalFileToVault = useVaultStore((state) => state.copyExternalFileToVault);
  const [copyToVaultSource, setCopyToVaultSource] = useState<{ path: string; name: string } | null>(null);
  const { theme, toggleTheme } = useTheme();
  // The "copy external file into the vault" entry point: only an external
  // file tab (absolute / `~` path, not a web tab) has no vault home, so it is
  // the only context where this action is meaningful.
  const isExternalFileActive = !!activeTab
    && activeTab.fileType !== 'web'
    && isExternalPath(activeTab.path);
  const showViewMode = activeTab ? SHOW_VIEW_MODE_FILE_TYPES.has(activeTab.fileType) : false;
  const modes = activeTab?.fileType === 'html' ? HTML_MODES : VIEW_MODES;
  const setCurrentPage = useNavStore((state) => state.setCurrentPage);
  const currentPage = useNavStore((state) => state.currentPage);
  const [plusOpen, setPlusOpen] = useState(false);
  const plusRef = useRef<HTMLDivElement>(null);
  const showPlusMenu = currentPage === 'editor' || currentPage === 'study';

  useEffect(() => {
    if (!plusOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (plusRef.current && !plusRef.current.contains(e.target as Node)) {
        setPlusOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [plusOpen]);

  return (
    <header data-tauri-drag-region className="topbar h-[36px] shrink-0 bg-panel border-b border-brd flex items-center justify-between pl-0 pr-2.5 gap-[3px] z-50">
      {/* Left: Logo + mobile menu */}
      <div className="tb-left flex items-center h-full flex-1 overflow-hidden">
        {isMobile && (
          <button className="tb-btn mobile-menu-btn w-[30px] h-[30px] flex items-center justify-center rounded-[5px] text-sm text-t3 transition-all duration-150 hover:bg-hov hover:text-t1" onClick={onToggleSidebar} title={t('topbar:menu')}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <line x1="2" y1="4" x2="14" y2="4" />
              <line x1="2" y1="8" x2="14" y2="8" />
              <line x1="2" y1="12" x2="14" y2="12" />
            </svg>
          </button>
        )}
        <div data-tauri-drag-region={false} className="logo flex items-center gap-[7px] py-1 pl-0 pr-2 rounded-[5px] cursor-pointer shrink-0 transition-[background] duration-150 hover:bg-hov" onClick={() => setCurrentPage('editor')}>
          <div className="w-[36px] h-full flex items-center justify-center">
            <img src={`${import.meta.env.BASE_URL}quill.svg`} alt="Quill" width="24" height="24" style={{ borderRadius: 5 }} />
          </div>
          <span className="logo-name font-bold text-[length:var(--ui-font-size)]">
            Qu<em className="text-acc not-italic">ill</em>
          </span>
        </div>
      </div>

      {/* Right: View mode + Action buttons */}
      <div className="tb-right flex items-center gap-0.5 shrink-0">
        {/* View mode segment -- shown only for multi-mode file types */}
        {showViewMode && (
        <div className="view-seg flex items-center gap-px shrink-0">
          {modes.map((mode) => {
            return (
              <button
                key={mode}
                className={`vseg py-[3px] px-[9px] rounded text-[length:calc(var(--ui-font-size)-3px)] cursor-pointer transition-all duration-150 font-medium ${viewMode === mode ? 'text-acc bg-accdim' : 'text-t3 hover:text-t2 hover:bg-hov'}`}
                onClick={() => setViewMode(mode)}
                title={t(`topbar:viewMode.${mode}`)}
              >
                {VIEW_MODE_ICONS[mode]}
              </button>
            );
          })}
        </div>
        )}

        <div className="top-div w-px h-[18px] bg-brd2 mx-[3px] shrink-0" />

        {showPlusMenu && (
        <div className="relative" ref={plusRef}>
          <button
            className="tb-btn w-[30px] h-[30px] flex items-center justify-center rounded-[5px] text-sm text-t3 transition-all duration-150 hover:bg-hov hover:text-t1"
            onClick={() => setPlusOpen((v) => !v)}
            title={t('topbar:plus.menu')}
          >
            <Plus size={15} />
          </button>
          {plusOpen && (
            <div className="absolute top-full right-0 mt-1 z-[200] min-w-[190px] bg-surf border border-brd rounded-[8px] shadow-[0_8px_28px_rgba(0,0,0,0.16)] py-1">
              <button
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] text-t2 cursor-pointer border-none bg-transparent transition-colors duration-150 hover:bg-hov hover:text-t1"
                onClick={() => {
                  setPlusOpen(false);
                  useTerminalStore.getState().addSession();
                  openTerminalDock();
                }}
              >
                <img src={terminalIcon} alt="" width="14" height="14" className="shrink-0 opacity-80" />
                {t('topbar:plus.newTerminal')}
              </button>
              <button
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] text-t2 cursor-pointer border-none bg-transparent transition-colors duration-150 hover:bg-hov hover:text-t1"
                onClick={() => {
                  setPlusOpen(false);
                  openBrowserTab();
                }}
              >
                <img src={chromeIcon} alt="" width="14" height="14" className="shrink-0" />
                {t('topbar:plus.newBrowser')}
              </button>
            </div>
          )}
        </div>
        )}

        {/* Terminal collapse/expand toggle — appears once a terminal exists,
            next to the + icon and before the AI button, mirroring the AI
            button's behavior. */}
        {terminalSessions.length > 0 && (
          <button
            className={`tb-btn tb-term-btn w-[30px] h-[30px] flex items-center justify-center rounded-[5px] text-sm transition-all duration-150 hover:bg-hov ${
              terminalPanelVisible ? 'text-acc bg-accdim' : 'text-t3 hover:text-t1'
            }`}
            onClick={() => {
              if (terminalPanelVisible) {
                closeTerminalPanel();
              } else {
                openTerminalDock();
              }
            }}
            title={terminalPanelVisible ? t('topbar:terminal.collapse') : t('topbar:terminal.expand')}
          >
            <img src={terminalIcon} alt="" width="14" height="14" className="shrink-0" />
          </button>
        )}

        <button className="tb-btn tb-ai-btn w-[30px] h-[30px] flex items-center justify-center rounded-[5px] text-xs text-t3 transition-all duration-150 hover:bg-hov hover:text-t1 font-bold tracking-[-0.5px]" onClick={() => {
          if (currentPage === 'schedule') {
            requestPlanMyDay();
          } else {
            toggleAiPanel();
          }
        }} title={currentPage === 'schedule' ? t('topbar:ai.planToday') : t('topbar:ai.panel')}>
          AI
        </button>
        <ExportMenu />
        {isExternalFileActive && activeTab && (
          <button
            className="tb-btn w-[30px] h-[30px] flex items-center justify-center rounded-[5px] text-sm text-t3 transition-all duration-150 hover:bg-hov hover:text-t1"
            onClick={() => setCopyToVaultSource({ path: activeTab.path, name: activeTab.name })}
            title={t('topbar:copyToVault')}
          >
            <FolderInput size={14} />
          </button>
        )}
        {copyToVaultSource && (
          <MoveDialog
            mode="copy"
            sources={[{ path: copyToVaultSource.path, type: 'file', name: copyToVaultSource.name }]}
            fileTree={fileTree}
            onCancel={() => setCopyToVaultSource(null)}
            onConfirm={async (targetDir) => {
              const newPath = await copyExternalFileToVault(copyToVaultSource.path, targetDir);
              setCopyToVaultSource(null);
              const name = newPath.includes('/') ? newPath.substring(newPath.lastIndexOf('/') + 1) : newPath;
              await editorIoService.openFile(newPath, name);
              // Reveal + select the new vault file in the sidebar tree. The
              // bridge queues the request if the Sidebar isn't mounted yet.
              requestRevealPath(newPath);
            }}
          />
        )}
        <LanguageSwitcher />
        <button className="tb-btn w-[30px] h-[30px] flex items-center justify-center rounded-[5px] text-sm text-t3 transition-all duration-150 hover:bg-hov hover:text-t1" onClick={toggleTheme} title={t('topbar:theme.toggle')}>
          {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
        </button>

      </div>
    </header>
  );
}
