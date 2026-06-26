import { useEffect, useRef, useState, useCallback } from 'react';
import { Topbar } from './components/shell/Topbar';
import { ActivityBar } from './components/shell/ActivityBar';
import { Sidebar } from './components/sidebar/Sidebar';
import { WorkArea } from './components/work-area/WorkArea';
import { StatusBar } from './components/shell/StatusBar';
import { AiPanel } from './components/ai/AiPanel';
import { GlobalSearchPanel } from './components/search/GlobalSearchPanel';
import { useWikiStore } from '@/store/wikiStore';

import { SettingsPage } from './components/pages/SettingsPage';
import { VaultPage } from './components/pages/VaultPage';
import { useTheme } from './hooks/useTheme';
import { useSettingsStore } from './store/settingsStore';
import { useVaultStore } from './store/vaultStore';
import { useEditorStore } from './store/editorStore';
import { useSearchStore } from './store/searchStore';
import { loadAiSessionsForVault } from './store/aiStore';
import { registerBuiltinPlugins } from '@quill/container-plugins';
import { isTauri } from './utils/platform';

registerBuiltinPlugins();

/** Hook to detect mobile viewport */
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= breakpoint : false,
  );
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const handler = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    mql.addEventListener('change', handler);
    setIsMobile(mql.matches);
    return () => mql.removeEventListener('change', handler);
  }, [breakpoint]);
  return isMobile;
}

export default function App() {
  useTheme();

  const isMobile = useIsMobile();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const activePanel = useEditorStore((s) => s.activePanel);
  const setActivePanel = useEditorStore((s) => s.setActivePanel);

  const toggleMobileSidebar = useCallback(() => {
    setMobileSidebarOpen((prev) => !prev);
  }, []);

  const closeMobileSidebar = useCallback(() => {
    setMobileSidebarOpen(false);
  }, []);

  const currentPage = useSettingsStore((state) => state.currentPage);
  const showAiPanel = useSettingsStore((state) => state.showAiPanel);
  const showStatusBar = useSettingsStore((state) => state.showStatusBar);
  const fontSize = useSettingsStore((state) => state.fontSize);
  const enableWikiPanel = useSettingsStore((state) => state.enableWikiPanel);
  const enableClipsPanel = useSettingsStore((state) => state.enableClipsPanel);
  const enableAnalyzePanel = useSettingsStore((state) => state.enableAnalyzePanel);
  const enableDailyPanel = useSettingsStore((state) => state.enableDailyPanel);

  // ── Vault initialization ──
  const vaultInitialized = useRef(false);

  useEffect(() => {
    if (vaultInitialized.current) return;
    vaultInitialized.current = true;

    const initializeVault = async () => {
      await useVaultStore.getState().initVault();

      await loadAiSessionsForVault();
      await useEditorStore.getState().restoreOpenTabs();

      useWikiStore.getState().initWiki().catch((err) => {
        console.warn('[App] Wiki init failed:', err);
      });

      const { fileTree } = useVaultStore.getState();
      const { tabs } = useEditorStore.getState();
      if (tabs.length === 0 && fileTree.length > 0) {
        const firstFile = fileTree.find((entry) => entry.type === 'file');
        if (firstFile) {
          await useEditorStore.getState().openFile(firstFile.path, firstFile.name);
        }
      }
    };
    initializeVault();
  }, []);

  // ── Hide all native webviews when leaving the editor page ──
  useEffect(() => {
    if (currentPage !== 'editor' && isTauri()) {
      import('@tauri-apps/api/core').then(({ invoke }) => {
        invoke('hide_all_webviews', { labels: [] }).catch(() => {});
      });
    }
  }, [currentPage]);

  // ── Fall back to 'files' panel when the active feature is disabled ──
  // If the user turns off a feature (in Settings) while its panel is active,
  // we must not leave the UI on a now-hidden panel. Re-route to 'files'.
  useEffect(() => {
    if (activePanel === 'wiki' && !enableWikiPanel) setActivePanel('files');
    else if (activePanel === 'clips' && !enableClipsPanel) setActivePanel('files');
    else if (activePanel === 'analyze' && !enableAnalyzePanel) setActivePanel('files');
    else if (activePanel === 'calendar' && !enableDailyPanel) setActivePanel('files');
  }, [activePanel, enableWikiPanel, enableClipsPanel, enableAnalyzePanel, enableDailyPanel, setActivePanel]);

  // ── Global Ctrl+S / Cmd+S and Cmd+Shift+F ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const { activeTabId, saveFile } = useEditorStore.getState();
        if (activeTabId) {
          saveFile(activeTabId);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        const { isOpen, openPanel, closePanel } = useSearchStore.getState();
        if (isOpen) {
          closePanel();
        } else {
          openPanel();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        // Only trigger daily note when the feature is enabled; otherwise let the
        // event pass through untouched so users (and the OS) keep default behavior.
        if (useSettingsStore.getState().enableDailyPanel) {
          e.preventDefault();
          useEditorStore.getState().openDailyNote();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="shell flex flex-col h-dvh" style={{ '--ui-font-size': `${fontSize}px` } as any}>
      <Topbar isMobile={isMobile} onToggleSidebar={toggleMobileSidebar} />

      {currentPage === 'editor' && (
        <div className="body-row flex-1 flex overflow-hidden">
          {!isMobile && <ActivityBar activePanel={activePanel} onPanelChange={setActivePanel} />}
          {isMobile && mobileSidebarOpen && (
            <div className="mobile-sidebar-overlay" onClick={closeMobileSidebar} />
          )}
          <div className={`sidebar-wrapper ${isMobile ? 'mobile' : ''} ${mobileSidebarOpen ? 'open' : ''}`}>
            <Sidebar activePanel={activePanel} onFileSelect={isMobile ? closeMobileSidebar : undefined} />
          </div>
          <WorkArea />
          {showAiPanel && <AiPanel />}
        </div>
      )}

      {currentPage === 'vault' && (
        <div className="body-row flex-1 flex overflow-hidden">
          <VaultPage />
        </div>
      )}

      {currentPage === 'settings' && (
        <div className="body-row flex-1 flex overflow-hidden">
          <SettingsPage />
        </div>
      )}

      {showStatusBar && <StatusBar />}
      <GlobalSearchPanel />
    </div>
  );
}
