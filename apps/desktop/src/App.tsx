import { useEffect, useRef, useState, useCallback } from 'react';
import { Topbar } from './components/shell/Topbar';
import { ActivityBar } from './components/shell/ActivityBar';
import { Sidebar } from './components/sidebar/Sidebar';
import { WorkArea } from './components/work-area/WorkArea';
import { StatusBar } from './components/shell/StatusBar';
import { AiPanel } from './components/ai/AiPanel';
import { GlobalSearchPanel } from './components/search/GlobalSearchPanel';
import { CommandPalette } from './components/shell/CommandPalette';
import { useWikiStore } from '@/store/wikiStore';

import { SettingsPage } from './components/pages/SettingsPage';
import { VaultPage } from './components/pages/VaultPage';
import { ScheduleWorkbenchPage } from './components/schedule/ScheduleWorkbenchPage';
import { StudyWorkbenchPage } from './components/study/StudyWorkbenchPage';
import { useTheme } from './hooks/useTheme';
import { useSettingsStore } from './store/settingsStore';
import { useVaultStore } from './store/vaultStore';
import { useEditorStore } from './store/editorStore';
import { useSearchStore } from './store/searchStore';
import { useCommandPaletteStore } from './store/commandPaletteStore';
import { loadAiSessionsForVault } from './store/aiStore';
import { registerBuiltinPlugins } from '@quill/container-plugins';
import { registerBuiltinCommands } from './services/commandRegistry';
import { requestNewItem } from './services/newItemBridge';
import { isTauri } from './utils/platform';
import { pluginHost } from '@quill/plugin-host';
import { sandboxLoader } from './services/plugin-host/sandboxLoader';
import { trustedLoader } from './services/plugin-host/trustedLoader';
import type { PetMenuAction } from './components/pet/PetContextMenu';

registerBuiltinPlugins();
// Seed the command palette's static commands (actions + panels/modes) once at
// startup. File commands are sourced dynamically from the live vault tree.
registerBuiltinCommands();

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

/**
 * 强制关闭所有文本输入元素的首字母自动大写 / 自动纠正 / 拼写检查。
 * Tauri (WKWebView) 对 <html autocapitalize="off"> 的继承不可靠，
 * 因此逐元素强制设置，并对后续动态插入的节点保持同步。
 */
function useDisableAutoCapitalize() {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const TARGET = 'input, textarea, [contenteditable=""], [contenteditable="true"]';
    const apply = (root: ParentNode) => {
      root.querySelectorAll<HTMLElement>(TARGET).forEach((el) => {
        el.setAttribute('autocapitalize', 'off');
        el.setAttribute('autocorrect', 'off');
        el.setAttribute('spellcheck', 'false');
      });
    };
    apply(document);
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (node.nodeType !== Node.ELEMENT_NODE) return;
          const el = node as HTMLElement;
          if (el.matches?.(TARGET)) {
            el.setAttribute('autocapitalize', 'off');
            el.setAttribute('autocorrect', 'off');
            el.setAttribute('spellcheck', 'false');
          }
          apply(el);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
}

export default function App() {
  useTheme();
  useDisableAutoCapitalize();

  const isMobile = useIsMobile();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const activePanel = useEditorStore((s) => s.activePanel);
  const setActivePanel = useEditorStore((s) => s.setActivePanel);
  const setCurrentPage = useSettingsStore((s) => s.setCurrentPage);

  // 切换 activity 面板时同时回到 editor 页（从 schedule 页点面板按钮可返回）。
  const handlePanelChange = useCallback(
    (panel: typeof activePanel) => {
      setActivePanel(panel);
      setCurrentPage('editor');
    },
    [setActivePanel, setCurrentPage],
  );

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

  // ── Pet icon orphan sweep + fallback (PRD: settings-pet-tab-and-custom-icon) ──
  // On startup, reconcile the persisted `petIconSource` / `petIconPath` with
  // the actual files under appDataDir:
  //  (a) If `petIconSource === 'custom'` but the saved file is missing
  //      (externally deleted / moved), clear the flag to `'builtin'` so the
  //      pet window renders the inline SVG instead of a broken-image icon.
  //      Belt-and-suspenders with the `<img>` onError handler in PetMascot
  //      (which clears the flag at render time); this sweep covers the case
  //      where the pet window hasn't mounted yet (pet mode off) so the
  //      missing file would otherwise persist in storage unchecked.
  //  (b) If `petIconSource !== 'custom'` but a leftover `pet-icon.<ext>`
  //      file exists in appDataDir (e.g. the user previously uploaded an
  //      icon then reset to builtin, but the reset's file-delete failed),
  //      delete it so the appData dir stays clean.
  //
  // Lives in the MAIN window (not PetApp) because the fs plugin calls
  // (`exists`, `remove`, `readDir`) require fs ACL permissions that the
  // main window already has (`capabilities/default.json`) but the pet
  // window does not (`capabilities/pet.json` only grants core:window + core:event).
  // Running the sweep here on every main-window startup is more reliable
  // than running it in PetApp (which only mounts when pet mode is on).
  // Wrapped in isTauri + try/catch so non-Tauri/test envs skip it.
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    (async () => {
      try {
        const { exists, remove, readDir } = await import('@tauri-apps/plugin-fs');
        const { appDataDir, join } = await import('@tauri-apps/api/path');
        const appData = await appDataDir();
        const { petIconSource, petIconPath } = useSettingsStore.getState();

        if (petIconSource === 'custom' && petIconPath) {
          // Fallback: custom flag set but file missing → clear flag.
          let fileExists = false;
          try {
            fileExists = await exists(petIconPath);
          } catch {
            // exists() can throw on permission errors; treat as "missing"
            // so the flag clears and the pet doesn't render a broken icon.
            fileExists = false;
          }
          if (!fileExists && !cancelled) {
            console.warn('[App] pet custom icon file missing, clearing flag:', petIconPath);
            useSettingsStore.getState().setPetIcon('builtin');
          }
        } else {
          // Orphan sweep: delete any leftover pet-icon.<ext> files in
          // appDataDir so they don't accumulate across reset cycles.
          try {
            const entries = await readDir(appData);
            for (const e of entries) {
              if (cancelled) break;
              if (!e.name.startsWith('pet-icon.')) continue;
              try {
                await remove(await join(appData, e.name));
              } catch {
                // Non-fatal; best-effort cleanup.
              }
            }
          } catch {
            // readDir on appDataDir can fail on permission / platform
            // edge cases — non-fatal, the sweep is best-effort.
          }
        }
      } catch (err) {
        console.warn('[App] pet icon sweep failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Hide all native webviews when leaving the editor page ──
  useEffect(() => {
    if (currentPage !== 'editor' && isTauri()) {
      import('@tauri-apps/api/core').then(({ invoke }) => {
        invoke('hide_all_webviews', { labels: [] }).catch(() => {});
      });
    }
  }, [currentPage]);

  // ── Desktop Pet Mode bridge (macOS MVP) ──
  // (1) On launch, if the user had pet mode enabled, re-show the pet window.
  //     The pet window starts `visible:false` in tauri.conf.json; calling
  //     `toggle_pet_mode` flips it to visible and syncs the menu checkmark.
  //     PetApp (mounted in the pet window) restores its own saved position.
  // (2) Listen for `pet://menu-action` events from the pet window and
  //     dispatch to existing store actions / window-focus helpers. Each
  //     action also focuses the main window so the editor comes forward.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;

    const focusMain = async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const win = getCurrentWindow();
        await win.show();
        await win.setFocus();
      } catch {
        // Non-fatal.
      }
    };

    const handleAction = async (action: PetMenuAction) => {
      switch (action) {
        case 'show-main':
          await focusMain();
          break;
        case 'new-note':
          requestNewItem('file');
          await focusMain();
          break;
        case 'toggle-ai':
          useEditorStore.getState().toggleAiPanel();
          await focusMain();
          break;
        case 'disable-pet':
          useSettingsStore.getState().setPetModeEnabled(false);
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('toggle_pet_mode');
          } catch {
            // Non-fatal; the menu bar item can still toggle it off.
          }
          break;
        // ── Pet-panel launcher actions (PR1). These are dispatched by the
        // pet-panel launcher grid via the same `pet://menu-action` channel.
        // Each action that targets the main editor focuses it so the editor
        // comes forward. `clip-from-url` is handled in-panel (PR2) — the
        // listener just focuses main as a no-op-ish fallback. ──
        case 'daily-note':
          void useEditorStore.getState().openDailyNote();
          await focusMain();
          break;
        case 'global-search':
          useSearchStore.getState().openPanel();
          await focusMain();
          break;
        case 'clip-from-url':
          // Handled inside the pet-panel (inline URL form, PR2). Focus main
          // as a safe fallback so the user sees the editor if the panel
          // flow is interrupted.
          await focusMain();
          break;
        case 'command-palette':
          useCommandPaletteStore.getState().toggle();
          await focusMain();
          break;
        case 'toggle-theme':
          useSettingsStore.getState().toggleTheme();
          await focusMain();
          break;
      }
    };

    (async () => {
      // Launch restore: only re-show if the user left pet mode on.
      const { petModeEnabled } = useSettingsStore.getState();
      if (petModeEnabled) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          // The pet window starts hidden; toggle → show.
          await invoke('toggle_pet_mode');
        } catch {
          // Non-fatal.
        }
      }
      // Event listener for pet → main window actions.
      const { listen } = await import('@tauri-apps/api/event');
      const unAction = await listen<{ action: PetMenuAction }>('pet://menu-action', (event) => {
        if (event.payload?.action) void handleAction(event.payload.action);
      });
      // Visibility sync: when the pet is toggled via the menu bar / keyboard
      // shortcut, Rust emits this so the frontend preference stays in sync.
      const unVis = await listen<boolean>('pet://visibility-changed', (event) => {
        useSettingsStore.getState().setPetModeEnabled(!!event.payload);
      });
      if (cancelled) {
        unAction();
        unVis();
      } else {
        unlisten = () => {
          unAction();
          unVis();
        };
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // ── Plugin host: register loaders + sync on install/approve/uninstall ──
  // The sandbox loader is the untrusted-tier PluginLoader (sandboxed iframe +
  // host RPC). The trusted loader is the in-process PluginLoader (blob-URL
  // `import()` + TOFU gate). Sandbox plugins auto-activate on install (their
  // commands appear immediately). Trusted plugins do NOT auto-activate on
  // install — they require `approve_plugin` (the explicit TOFU-pin consent,
  // surfaced as the `plugin://approved` event) before activation. This is the
  // PR3 acceptance: "trusted-tier plugins require explicit approval before
  // loading". Failures are logged and never crash the main app.
  useEffect(() => {
    if (!isTauri()) return;
    let uninstalled: (() => void) | null = null;
    let cancelled = false;

    /** Read a plugin manifest from ~/.quill/plugins/<id>/manifest.json */
    async function readPluginManifest(id: string): Promise<Record<string, unknown>> {
      const { homeDir, join } = await import('@tauri-apps/api/path');
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const home = await homeDir();
      const manifestPath = await join(home, '.quill', 'plugins', id, 'manifest.json');
      return JSON.parse(await readTextFile(manifestPath)) as Record<string, unknown>;
    }

    (async () => {
      // Register both loaders (disposable; cleaned up on unmount).
      const sandboxDisposable = pluginHost.registerLoader(sandboxLoader);
      const trustedDisposable = pluginHost.registerLoader(trustedLoader);

      // Hydrate from disk: query the Rust side for installed plugins and
      // install + activate each one in the in-memory host.
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const entries = await invoke<
          Array<{ id: string; name: string; version: string; tier: string; trusted: boolean }>
        >('list_plugins');
        for (const entry of entries) {
          if (cancelled) break;
          try {
            const manifest = await readPluginManifest(entry.id);
            await pluginHost.install(manifest as never);
            // Activate sandbox plugins so their commands appear immediately.
            // Trusted plugins activate only after approval (plugin://approved).
            if (manifest.tier === 'sandbox') {
              await pluginHost.activate(manifest.id as string).catch((err: unknown) => {
                console.warn(`[App] failed to activate plugin ${entry.id}:`, err);
              });
            } else if (manifest.tier === 'trusted' && entry.trusted) {
              // Already-approved trusted plugin (hydrated from a prior
              // session) — activate it now.
              await pluginHost.activate(manifest.id as string).catch((err: unknown) => {
                console.warn(`[App] failed to activate trusted plugin ${entry.id}:`, err);
              });
            }
          } catch (err: unknown) {
            console.warn(`[App] failed to hydrate plugin ${entry.id}:`, err);
          }
        }
      } catch (err: unknown) {
        console.warn('[App] plugin hydration failed:', err);
      }

      // Listen for live install/approve/uninstall events.
      const { listen } = await import('@tauri-apps/api/event');
      const unInstall = await listen<{ id: string }>('plugin://installed', async (event) => {
        try {
          const manifest = await readPluginManifest(event.payload.id);
          await pluginHost.install(manifest as never);
          // Sandbox: activate immediately. Trusted: wait for approval.
          if (manifest.tier === 'sandbox') {
            await pluginHost.activate(manifest.id as string).catch(() => {});
          }
        } catch (err: unknown) {
          console.warn(`[App] failed to install plugin on event:`, err);
        }
      });
      const unApprove = await listen<{ id: string }>('plugin://approved', async (event) => {
        try {
          // The plugin was already installed on the `plugin://installed`
          // event; just activate it now that the user has approved.
          await pluginHost.activate(event.payload.id).catch((err: unknown) => {
            console.warn(`[App] failed to activate approved plugin ${event.payload.id}:`, err);
          });
        } catch (err: unknown) {
          console.warn(`[App] failed to approve plugin on event:`, err);
        }
      });
      const unUninstall = await listen<{ id: string }>('plugin://uninstalled', async (event) => {
        try {
          await pluginHost.uninstall(event.payload.id);
        } catch (err: unknown) {
          console.warn(`[App] failed to uninstall plugin on event:`, err);
        }
      });

      if (cancelled) {
        unInstall();
        unApprove();
        unUninstall();
        sandboxDisposable.dispose();
        trustedDisposable.dispose();
      } else {
        uninstalled = () => {
          unInstall();
          unApprove();
          unUninstall();
          sandboxDisposable.dispose();
          trustedDisposable.dispose();
        };
      }
    })();

    return () => {
      cancelled = true;
      uninstalled?.();
    };
  }, []);

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
          useSettingsStore.getState().setCurrentPage('schedule');
        }
      }
      // Cmd/Ctrl+P (no Shift) toggles the command palette. Shift is reserved
      // (e.g. Cmd+Shift+P / Cmd+Shift+F), so this branch only fires without it.
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === 'p'
      ) {
        e.preventDefault();
        useCommandPaletteStore.getState().toggle();
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
          {!isMobile && <ActivityBar activePanel={activePanel} onPanelChange={handlePanelChange} />}
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

      {currentPage === 'schedule' && (
        <div className="body-row flex-1 flex overflow-hidden">
          {!isMobile && <ActivityBar activePanel={activePanel} onPanelChange={handlePanelChange} />}
          <ScheduleWorkbenchPage />
        </div>
      )}

      {currentPage === 'study' && (
        <div className="body-row flex-1 flex overflow-hidden">
          {!isMobile && <ActivityBar activePanel={activePanel} onPanelChange={handlePanelChange} />}
          <StudyWorkbenchPage />
          {showAiPanel && <AiPanel />}
        </div>
      )}

      {showStatusBar && <StatusBar />}
      <GlobalSearchPanel />
      <CommandPalette />
    </div>
  );
}
