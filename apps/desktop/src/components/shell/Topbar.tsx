import { useState } from 'react';
import { useEditorStore, type ViewMode } from '@/store/editorStore';
import { getHandlerById, getSupportedModes } from "@/components/file-types/registry";
import { toolbarResolver, resolvedFileType } from '@/services/toolbarResolver';
import type { ToolbarContext } from 'folyn-extension-sdk';
import { useEditorViewStateStore } from '@/store/editorViewState';
import { useNavStore } from '@/store/navStore';
import { useVaultStore } from '@/store/vaultStore';
import { useTerminalStore } from '@/store/terminalStore';
import { isExternalPath } from '@/utils/isExternalPath';
import * as editorIoService from '@/services/editorIoService';
import { requestRevealPath } from '@/services/revealPathBridge';
import { useTheme } from '@/hooks/useTheme';
import { ExportMenu } from '@/components/editor/ExportMenu';
import { MoveDialog } from '@/components/sidebar/SidebarActions';
import { LanguageSwitcher } from '@/components/shell/LanguageSwitcher';
import { useTranslation } from 'react-i18next';
import { Sun, Moon, FolderInput, History, ArrowLeft, ArrowRight } from 'lucide-react';
import { TerminalIcon } from '@/components/icons/TerminalIcon';
import { WindowControls } from '@/components/shell/WindowControls';
import { isVersionableTab } from '@/components/work-area/VersionHistoryPanel';
import { VIEW_MODE_ICONS } from '@/components/shell/viewModeIcons';
import { useExtensionFileViewStore } from '@/store/extensionFileViewStore';
import { useDocLinkHistory } from '@/store/docLinkHistory';

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
  const terminalInRightDock = useEditorViewStateStore((state) => state.terminalInRightDock);
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
  // ponytail: version-history button visibility reuses the panel's
  // `isVersionableTab` (single source of truth — mirrors PR2's
  // `editorIoService.maybeSnapshotVersion` predicate). Same gate so the
  // button can never surface for a file type whose save/close hooks skip
  // snapshots.
  const isVersionableActive = isVersionableTab(activeTab);
  const toggleVersionHistory = useEditorViewStateStore((state) => state.toggleVersionHistory);
  const versionHistoryVisible = useEditorViewStateStore((state) => state.versionHistoryVisible);
  const setCurrentPage = useNavStore((state) => state.setCurrentPage);
  const currentPage = useNavStore((state) => state.currentPage);
  const terminalOpen = terminalPanelVisible || terminalInRightDock;
  // A trail left in another vault doesn't count (the store clears it on next use).
  const linkVaultId = useDocLinkHistory((s) => s.vaultId);
  const linkBack = useDocLinkHistory((s) => s.back.length > 0);
  const linkForward = useDocLinkHistory((s) => s.forward.length > 0);
  const activeVaultId = useVaultStore((state) => state.activeVaultId);
  const canBack = linkBack && linkVaultId === activeVaultId;
  const canForward = linkForward && linkVaultId === activeVaultId;

  // ── Context-driven toolbar (doc §16–§17) ────────────────────────────────
  // Resolve the whole toolbar state from a ToolbarContext — no per-file-type
  // if/else. Modes come straight from the active provider's `modes`.
  const provider = activeTab ? getHandlerById(activeTab.fileType) : undefined;
  const providerModes = getSupportedModes(provider);
  // An extension page that mounts api.fileView publishes its modes, so the one
  // mode segment in the app drives it instead of the page growing its own icons.
  const extensionModes = useExtensionFileViewStore((s) => s.modes);
  const extensionMode = useExtensionFileViewStore((s) => s.mode);
  const setExtensionMode = useExtensionFileViewStore((s) => s.setMode);
  const onExtensionPage = currentPage.startsWith('ext:');
  const showExtensionModes = onExtensionPage && extensionModes.length > 1;
  const activeModes = showExtensionModes ? extensionModes : providerModes;
  const activeMode = showExtensionModes ? extensionMode : viewMode;
  const setActiveMode = showExtensionModes ? setExtensionMode : setViewMode;
  const toolbarCtx: ToolbarContext = {
    activeFile: activeTab ? { path: activeTab.path, fileType: activeTab.fileType } : null,
    fileType: resolvedFileType(provider?.id, providerModes),
    activeMode,
    activeWorkspace: null,
    selection: null,
    currentPage,
  };
  const toolbarState = toolbarResolver.resolve(toolbarCtx);
  const modes = (showExtensionModes ? activeModes : toolbarState.modes) as ViewMode[];
  const showViewMode = modes.length > 1;
  const showTerminalAction = toolbarState.showTerminal;

  return (
    <header
      data-tauri-drag-region="deep"
      className="topbar h-[36px] shrink-0 bg-panel border-b border-brd flex items-center justify-between pl-0 pr-2.5 gap-[3px] z-50"
    >
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
            <img src={`${import.meta.env.BASE_URL}folyn.svg`} alt="Folyn" width="24" height="24" style={{ borderRadius: 5 }} />
          </div>
          <span className="logo-name font-bold text-[length:var(--ui-font-size)]">
            Fo<em className="text-acc not-italic">lyn</em>
          </span>
        </div>
      </div>

      {/* Right: View mode + Action buttons — hidden on settings page */}
      <div className="tb-right flex items-center gap-0.5 shrink-0">
        {currentPage !== 'settings' && (
        <>
        {/* Back/forward along followed document links (Cmd/Ctrl+[ / ]).
            Always shown on the editor page — greyed when there is nowhere to
            go — so the affordance is discoverable before the first link. */}
        {currentPage === 'editor' && (
          <>
            <button
              className="tb-btn w-[30px] h-[30px] flex items-center justify-center rounded-[5px] text-sm text-t3 transition-all duration-150 enabled:hover:bg-hov enabled:hover:text-t1 disabled:opacity-30 disabled:cursor-default"
              disabled={!canBack}
              onClick={() => useDocLinkHistory.getState().goBack()}
              title={t('topbar:docLink.back')}
              aria-label={t('topbar:docLink.back')}
            >
              <ArrowLeft size={14} />
            </button>
            <button
              className="tb-btn w-[30px] h-[30px] flex items-center justify-center rounded-[5px] text-sm text-t3 transition-all duration-150 enabled:hover:bg-hov enabled:hover:text-t1 disabled:opacity-30 disabled:cursor-default"
              disabled={!canForward}
              onClick={() => useDocLinkHistory.getState().goForward()}
              title={t('topbar:docLink.forward')}
              aria-label={t('topbar:docLink.forward')}
            >
              <ArrowRight size={14} />
            </button>
            <div className="top-div w-px h-[18px] bg-brd2 mx-[3px] shrink-0" />
          </>
        )}
        {/* View mode segment -- shown only for multi-mode file types */}
        {showViewMode && (
        <div className="view-seg flex items-center gap-px shrink-0">
          {modes.map((mode) => {
            return (
              <button
                key={mode}
                className={`vseg py-[3px] px-[9px] rounded text-[length:calc(var(--ui-font-size)-3px)] cursor-pointer transition-all duration-150 font-medium ${activeMode === mode ? 'text-acc bg-accdim' : 'text-t3 hover:text-t2 hover:bg-hov'}`}
                onClick={() => setActiveMode(mode)}
                title={t(`topbar:viewMode.${mode}`)}
              >
                {VIEW_MODE_ICONS[mode]}
              </button>
            );
          })}
        </div>
        )}

        <div className="top-div w-px h-[18px] bg-brd2 mx-[3px] shrink-0" />

        {showTerminalAction && (
          <button
            data-tauri-drag-region={false}
            className={`tb-btn tb-term-btn w-[30px] h-[30px] flex items-center justify-center rounded-[5px] text-sm transition-all duration-150 hover:bg-hov ${
              terminalOpen ? 'text-acc bg-accdim' : 'text-t3 hover:text-t1'
            }`}
            onClick={() => {
              if (terminalSessions.length === 0) {
                useTerminalStore.getState().addSession();
                useEditorViewStateStore.getState().openTerminalDock();
                return;
              }
              if (terminalOpen) {
                closeTerminalPanel();
              } else {
                openTerminalDock();
              }
            }}
            title={
              terminalSessions.length === 0
                ? t('topbar:terminal.open')
                : terminalOpen
                  ? t('topbar:terminal.collapse')
                  : t('topbar:terminal.expand')
            }
          >
            <TerminalIcon size={14} className="shrink-0" />
          </button>
        )}

        <button className="tb-btn tb-ai-btn w-[30px] h-[30px] flex items-center justify-center rounded-[5px] text-xs text-t3 transition-all duration-150 hover:bg-hov hover:text-t1 font-bold tracking-[-0.5px]" onClick={toggleAiPanel} title={t('topbar:ai.panel')}>
          AI
        </button>
        {toolbarState.showExport && <ExportMenu />}
        {isVersionableActive && (
          <button
            className={`tb-btn w-[30px] h-[30px] flex items-center justify-center rounded-[5px] text-sm transition-all duration-150 hover:bg-hov hover:text-t1 ${
              versionHistoryVisible ? 'text-acc bg-accdim' : 'text-t3'
            }`}
            onClick={toggleVersionHistory}
            title={t('topbar:versionHistory.toggle')}
          >
            <History size={14} className="shrink-0" />
          </button>
        )}
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
        {toolbarState.showLanguage && <LanguageSwitcher />}
        <button className="tb-btn w-[30px] h-[30px] flex items-center justify-center rounded-[5px] text-sm text-t3 transition-all duration-150 hover:bg-hov hover:text-t1" onClick={toggleTheme} title={t('topbar:theme.toggle')}>
          {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
        </button>

        {/* Windows-only window controls (minimize / maximize / close) — the
            main window drops its native titlebar on Windows, so these buttons
            replace the OS window controls. Renders nothing elsewhere. */}
        </>

        )}
        <WindowControls showSeparator={currentPage !== 'settings'} />

      </div>
    </header>
  );
}
