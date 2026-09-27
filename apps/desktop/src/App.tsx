import { useEffect, useRef, useState, useCallback } from 'react';
import { Topbar } from './components/shell/Topbar';
import { ActivityBar } from './components/shell/ActivityBar';
import { Sidebar } from './components/sidebar/Sidebar';
import { EditorContent } from './components/work-area/EditorContent';
import { StatusBar } from './components/shell/StatusBar';
import { ToastHost } from './components/shell/ToastHost';
import { GlobalSearchPanel } from './components/search/GlobalSearchPanel';
import { CommandPalette } from './components/shell/CommandPalette';
import { ConsentModal } from '@/components/settings/ConsentModal';

import { SettingsPage } from './components/pages/SettingsPage';
import { VaultPage } from './components/pages/VaultPage';
import { TranslationPanel } from './components/translation/TranslationPanel';
import { ActivityPage } from './components/activity/ActivityPage';
import { ExtensionPageView } from './components/shell/ExtensionPageView';
import { useTheme } from './hooks/useTheme';
import { useDisableAutoCapitalize } from './hooks/useDisableAutoCapitalize';
import { usePetHostBridge } from './hooks/usePetHostBridge';
import { useScreenWakeRelayout } from './hooks/useScreenWakeRelayout';
import { useIsMobile } from './hooks/useIsMobile';
import { useExtensionHostSync } from './hooks/useExtensionHostSync';
import { useVoiceGlobalHotkey } from './hooks/useVoiceGlobalHotkey';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';
import { useTrayIconSync } from './hooks/useTrayIconSync';
import { useOsFileDragDrop } from './hooks/useOsFileDragDrop';
import { useOsFilePasteImport } from './hooks/useOsFilePasteImport';
import { useOpenExternalFiles } from './hooks/useOpenExternalFiles';
import { usePersistOnClose } from './hooks/usePersistOnClose';
import { installExternalLinkInterceptor } from './services/externalLinks';
import { registerBuiltinExtensionHost } from './services/extension-host/registerBuiltinExtensionHost';
import { useNavStore } from './store/navStore';
import { useAppearanceStore } from './store/appearanceStore';
import { useEditorViewStateStore } from './store/editorViewState';
import { useVaultStore, startFileTreeBroadcast } from './store/vaultStore';
import { initExternalFileWatcher } from './utils/fileWatcher';
import { startProvidersBroadcast } from './store/aiConfigStore';
import { settingsLoadDone, loadSettings, resolveSettingsLoadDone, hydrateAllStores } from './store/settingsPersistence';
import { useEditorStore } from './store/editorStore';
import { getWebviewLabels } from './components/file-types/web/WebViewer';
import * as editorIoService from './services/editorIoService';
import { registerEditorFileChangeApplier } from './services/fileChangeApplier';
import { PasteConflictDialog } from '@/components/editor/PasteConflictDialog';
import { MoveDialog } from '@/components/sidebar/SidebarActions';
import { loadAiSessionsForVault } from './store/aiStore';
import { startPetChatSessionsHost } from './store/petChatSessions';
import { registerBuiltinExtensions } from '@folyn/container-extensions';
import { registerBuiltinCommands } from './services/commandRegistry';
import { registerBuiltinPanels } from './services/registerBuiltinPanels';
import { registerBuiltinCodeContributions } from './services/registerBuiltinCodeContributions';
import { registerBuiltinExporters } from './services/export/exporterRegistry';
import { isTauri } from "@/utils/platform";
import { useLocaleStore } from '@/store/localeStore';

registerBuiltinExtensions();
registerBuiltinCodeContributions();
registerBuiltinExporters();
// Seed the command palette's static commands (actions + panels/modes) once at
// startup. File commands are sourced dynamically from the live vault tree.
registerBuiltinCommands();
// Register the 3 built-in sidebar panels (files/wiki/calendar)
// into featurePanelStore + wire visibility/active-panel sync. ActivityBar and
// Sidebar are data-driven off the store; this must run before they mount.
// (Extension panels arrive later via featureAdapter — PR3.)
registerBuiltinPanels();
// Wire the extension-host API/context hooks + sandbox/trusted loaders once at
// module-eval time (app-lifetime singletons).
registerBuiltinExtensionHost();

export default function App() {
  useTheme();
  useDisableAutoCapitalize();
  usePetHostBridge();
  useScreenWakeRelayout();

  useEffect(() => installExternalLinkInterceptor(), []);

  // ── Hydrate persisted settings on mount ──
  // loadSettings() reads every registered store's slice from disk and
  // hydrates the Zustand stores. Must run AFTER the component mounts so
  // that all module-level code (including registerPersistSlice calls) has
  // finished evaluating — otherwise SLICES is still [] and no store gets
  // hydrated. The promise returned by resolveSettingsLoadDone() unblocks
  // every effect that awaits settingsLoadDone, including the pet-icon
  // library reconcile in usePetHostBridge and the vault initializer below.
  useEffect(() => {
    loadSettings().then(() => resolveSettingsLoadDone());
  }, []);

  const isMobile = useIsMobile();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const activePanel = useEditorStore((s) => s.activePanel);
  const setActivePanel = useEditorStore((s) => s.setActivePanel);
  const setCurrentPage = useNavStore((s) => s.setCurrentPage);

  // 切换 activity 面板时同时回到 editor 页（从其他页点面板按钮可返回），
  // 并展开侧边栏（若之前被隐藏）。
  const handlePanelChange = useCallback(
    (panel: typeof activePanel) => {
      setActivePanel(panel);
      setCurrentPage('editor');
      setSidebarCollapsed(false);
    },
    [setActivePanel, setCurrentPage],
  );

  const toggleMobileSidebar = useCallback(() => {
    setMobileSidebarOpen((prev) => !prev);
  }, []);

  const closeMobileSidebar = useCallback(() => {
    setMobileSidebarOpen(false);
  }, []);

  const currentPage = useNavStore((state) => state.currentPage);
  const showStatusBar = useAppearanceStore((state) => state.showStatusBar);
  const fontSize = useAppearanceStore((state) => state.fontSize);
  const focusMode = useEditorViewStateStore((state) => state.focusMode);
  // enable*Panel flags are no longer read here post-PR2 — the visibility +
  // active-panel fallback logic moved into registerBuiltinPanels (one general
  // rule: if the active panel becomes invisible, re-route to 'files').

  // ponytail: showAiPanel is a launch-time auto-expand preference, NOT a
  // mount gate. Seed aiPanelVisible once from showAiPanel so "默认显示 AI
  // 面板" works on launch without preventing the user from opening the panel
  // manually when the setting is off.
  //
  // MUST await settingsLoadDone: appearanceStore.showAiPanel is the DEFAULT
  // (true) until the persisted blob hydrates. Reading it before hydration
  // resolves always yields true, so a user with showAiPanel=false would
  // still see the panel auto-open.
  //
  // NO ref guard: React 18 StrictMode (main.tsx:91) double-mounts effects.
  // A ref guard would short-circuit the second mount while the first mount's
  // `.then` is still in flight, and the first mount's `cancelled` flag
  // (flipped by its cleanup) would skip the setState — neither mount seeds.
  // Mirrors the canonical teardown-races-await pattern (see
  // useVoiceGlobalHotkey — voice hotkey). The redundant setState on the
  // second mount is idempotent.
  useEffect(() => {
    let cancelled = false;
    settingsLoadDone.then(() => {
      if (cancelled) return;
      useEditorViewStateStore.setState({
        aiPanelVisible: useAppearanceStore.getState().showAiPanel,
      });
    });
    return () => { cancelled = true; };
  }, []);

  // ponytail: push fileTree + currentVault to secondary Tauri windows
  // (pet-panel) that mount AiPanel in `embedded` mode. Secondary windows
  // lack vault-path fs ACL, so they can't refreshFileTree themselves — the
  // main window owns the authoritative tree and broadcasts it on change.
  // Mirrors the pet://settings-updated broadcast pattern.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let stopProviders: (() => void) | undefined;
    let stopPetChat: (() => void) | undefined;
    settingsLoadDone.then(() => {
      stop = startFileTreeBroadcast();
      stopProviders = startProvidersBroadcast();
      stopPetChat = startPetChatSessionsHost();
    });
    return () => { stop?.(); stopProviders?.(); stopPetChat?.(); };
  }, []);

  // ── Mirror secondary-window state changes into the main window's stores ──
  // Secondary Tauri windows (pet-panel's pin toggle, pet-menu, etc.) hold
  // their own store instances; their setters call `persist()` → broadcast
  // `pet://settings-updated`. But the main window NEVER hydrated from that
  // broadcast — it only ANSWERED `pet://settings-request` with its own
  // (stale) state. So a pin toggle in pet-panel updated pet-panel's store +
  // broadcast, but the main window's store stayed on the pre-toggle value;
  // `collectPersistedBlob()` (used by the settings-request reply AND the
  // on-quit `persistNow()` flush) returned the stale value, and on restart
  // the pin was lost. Listening here keeps the main window's stores in sync
  // so its on-quit flush writes the latest secondary-window state to disk.
  // Other secondary windows already listen on the same channel (PetApp,
  // PetBubbleApp, etc.); the main window was the missing listener.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    settingsLoadDone.then(() => {
      if (cancelled) return;
      void (async () => {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen<Record<string, unknown>>(
          'pet://settings-updated',
          (event) => {
            if (event.payload) hydrateAllStores(event.payload);
          },
        );
      })();
    });
    return () => { cancelled = true; unlisten?.(); };
  }, []);

  // ── Vault initialization ──
  const vaultInitialized = useRef(false);

  useEffect(() => {
    if (vaultInitialized.current) return;
    vaultInitialized.current = true;

    const initializeVault = async () => {
      // ponytail: register the editor-layer FileChangeApplier BEFORE any AI
      // flow could fire addFileChange. aiStore.addFileChange no-ops if the
      // applier slot is null, so ordering just needs this before the first
      // user/AI action — here at init is the safe earliest point.
      registerEditorFileChangeApplier();

      // Gate vault init on settings hydration — refreshFileTree reads
      // appearanceStore.excludePatterns to filter the tree, and without this
      // await it races against loadSettings(): the per-slice refactor reads
      // 10 files sequentially (~10-50ms on SSD), wide enough for refresh to
      // land before hydration restores user-hidden folders. Same pattern as
      // usePetHostBridge (which awaits this before reading petStore).
      await settingsLoadDone;

      await useVaultStore.getState().initVault();

      // External (non-vault) tabs need per-file watches — the vault-root
      // watcher never sees them. Must run before restoreOpenTabs so restored
      // external tabs get watched; later opens are handled by the subscription.
      await initExternalFileWatcher();

      await loadAiSessionsForVault();
      await editorIoService.restoreOpenTabs();

      const { fileTree } = useVaultStore.getState();
      const { tabs } = useEditorStore.getState();
      if (tabs.length === 0 && fileTree.length > 0) {
        const firstFile = fileTree.find((entry) => entry.type === 'file');
        if (firstFile) {
          await editorIoService.openFile(firstFile.path, firstFile.name);
        }
      }
    };
    initializeVault();
  }, []);

  // ── Hide all native webviews when leaving the editor page ──
  useEffect(() => {
    if (currentPage !== 'editor') {
      // Focus mode only makes sense on the editor page; leaving the page
      // exits it so the destination page's chrome is visible.
      if (useEditorViewStateStore.getState().focusMode) {
        useEditorViewStateStore.getState().setFocusMode(false);
      }
      if (isTauri()) {
        const labels = getWebviewLabels();
        import('@tauri-apps/api/core').then(({ invoke }) => {
          invoke('hide_all_webviews', { labels }).catch(() => {});
        });
      }
    }
  }, [currentPage]);

  // ── Focus mode: hide the desktop-pet window, restore on exit ──
  // The pet is a separate native window (label "pet"). Focus mode hides it
  // (along with every other chrome) so only the editor/preview remains. We
  // capture the pet's visibility at enter-time so exiting restores the prior
  // state rather than forcing it on/off. Uses WebviewWindow.getByLabel so
  // the user's petModeEnabled preference is never touched (toggle_pet_mode
  // would flip the persisted setting).
  const petVisibleBeforeFocusRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    if (currentPage !== 'editor') return;
    (async () => {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const pet = await WebviewWindow.getByLabel('pet');
      if (!pet) return;
      if (focusMode) {
        try {
          const visible = await pet.isVisible();
          petVisibleBeforeFocusRef.current = visible;
          if (visible) await pet.hide();
        } catch {
          petVisibleBeforeFocusRef.current = null;
        }
      } else {
        if (petVisibleBeforeFocusRef.current === true) {
          try { await pet.show(); } catch { /* non-fatal */ }
        }
        petVisibleBeforeFocusRef.current = null;
      }
    })();
  }, [focusMode, currentPage]);

  // ── Extension host hydration + live install/approve/uninstall sync ──
  useExtensionHostSync();
  // ── Voice input: global toggle hotkey ──
  useVoiceGlobalHotkey();
  // ── Global shortcuts (Cmd+S, search, focus mode, palette, …) ──
  useGlobalShortcuts();

  // ponytail: on Tauri startup, push the persisted locale to Rust so the
  // macOS app menu bar (built with locale="en" at app boot before JS
  // started) rebuilds with the user's actual language. Fire-and-forget;
  // a rebuild failure leaves the English menu visible, not a crash. The
  // localeStore's `hydrate` already calls `syncAppMenuLocale` — invoking
  // it here also re-applies i18n if module-load order left a stale state.
  useEffect(() => {
    if (!isTauri()) return;
    useLocaleStore.getState().hydrate();
  }, []);

  // ── Tray icon: sync Rust-side with the persisted `showTrayIcon` flag ──
  useTrayIconSync();

  // ── OS file drag-and-drop onto the window ──
  const { fileDragActive } = useOsFileDragDrop();

  // ── OS file paste (Finder Cmd+C → Folyn Cmd+V) ──
  const {
    pickerVisible,
    pickerFileTree,
    onPickerConfirm,
    onPickerCancel,
    conflictFile,
    conflictRemaining,
    onConflictResolve,
  } = useOsFilePasteImport();

  // ── OS "Open With" / file-association launch ──
  useOpenExternalFiles();

  // ── Flush persisted settings before the window closes ──
  usePersistOnClose();

  return (
    <div className="shell flex flex-col h-dvh" style={{ '--ui-font-size': `${fontSize}px` } as any}>
      {!(focusMode && currentPage === 'editor') && (
        <Topbar isMobile={isMobile} onToggleSidebar={toggleMobileSidebar} />
      )}

      {fileDragActive && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-none bg-black/40 backdrop-blur-sm"
        >
          <div className="px-6 py-4 rounded-xl border-2 border-dashed border-[var(--acc,#3b82f6)] bg-[var(--bg,#fff)] text-[var(--fg,#111)] text-base font-medium shadow-lg">
            松开以打开文件 / Drop to open
          </div>
        </div>
      )}

      {currentPage === 'editor' && (
        <>
          <div className="body-row flex-1 flex overflow-hidden">
            {!isMobile && !focusMode && <ActivityBar activePanel={activePanel} onPanelChange={handlePanelChange} />}
            {isMobile && mobileSidebarOpen && (
              <div className="mobile-sidebar-overlay" onClick={closeMobileSidebar} />
            )}
            {/* The file bar is a full-height sibling of the editor column so
                it keeps showing the file tree while the terminal occupies
                only the space below the editor content. In focus mode the
                sidebar is hidden so only the editor/preview remains. */}
            {!focusMode && (
              <div className={`sidebar-wrapper ${isMobile ? 'mobile' : ''} ${mobileSidebarOpen ? 'open' : ''}`}>
                <Sidebar
                  collapsed={sidebarCollapsed}
                  onCollapsedChange={setSidebarCollapsed}
                  onFileSelect={isMobile ? closeMobileSidebar : undefined}
                />
              </div>
            )}
            <EditorContent hideRightDock={focusMode} />
          </div>
        </>
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

      {currentPage === 'activity' && (
        <div className="body-row flex-1 flex overflow-hidden">
          {!isMobile && <ActivityBar activePanel={activePanel} onPanelChange={handlePanelChange} />}
          <ActivityPage />
        </div>
      )}

      {currentPage === 'translation' && (
        <div className="body-row flex-1 flex overflow-hidden">
          {!isMobile && <ActivityBar activePanel={activePanel} onPanelChange={handlePanelChange} />}
          <TranslationPanel />
        </div>
      )}

      {currentPage.startsWith('ext:') && (
        <div className="body-row flex-1 flex overflow-hidden">
          {!isMobile && <ActivityBar activePanel={activePanel} onPanelChange={handlePanelChange} />}
          <ExtensionPageView />
        </div>
      )}

      {showStatusBar && !(focusMode && currentPage === 'editor') && <StatusBar />}
      <ToastHost />
      {pickerVisible && (
        <MoveDialog
          sources={[]}
          fileTree={pickerFileTree}
          mode="copy"
          onCancel={onPickerCancel}
          onConfirm={onPickerConfirm}
        />
      )}
      <PasteConflictDialog
        visible={conflictFile !== null}
        fileName={conflictFile ?? ''}
        remaining={conflictRemaining}
        onResolve={onConflictResolve}
      />
      <GlobalSearchPanel />
      <CommandPalette />
      <ConsentModal />
    </div>
  );
}
