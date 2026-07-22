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
import { usePetHostBridge } from './hooks/usePetHostBridge';
import { useNavStore } from './store/navStore';
import { useAppearanceStore } from './store/appearanceStore';
import { useVaultStore } from './store/vaultStore';
import { useEditorStore } from './store/editorStore';
import * as editorIoService from './services/editorIoService';
import { registerEditorFileChangeApplier } from './services/fileChangeApplier';
import { useSearchStore } from './store/searchStore';
import { useCommandPaletteStore } from './store/commandPaletteStore';
import { loadAiSessionsForVault } from './store/aiStore';
import { registerBuiltinPlugins } from '@quill/container-plugins';
import { registerBuiltinCommands } from './services/commandRegistry';
import { registerBuiltinPanels } from './services/registerBuiltinPanels';
import { isTauri } from './utils/platform';
import { useLocaleStore } from '@/store/localeStore';
import { pluginHost } from '@quill/plugin-host';
import { sandboxLoader } from './services/plugin-host/sandboxLoader';
import { trustedLoader } from './services/plugin-host/trustedLoader';
import { attachToolWindowRpcListener } from './services/plugin-host/toolWindowRpcListener';

registerBuiltinPlugins();
// Seed the command palette's static commands (actions + panels/modes) once at
// startup. File commands are sourced dynamically from the live vault tree.
registerBuiltinCommands();
// Register the 5 built-in sidebar panels (files/wiki/clips/analyze/calendar)
// into featurePanelStore + wire visibility/active-panel sync. ActivityBar and
// Sidebar are data-driven off the store; this must run before they mount.
// (Plugin panels arrive later via featureAdapter — PR3.)
registerBuiltinPanels();

// ponytail: register plugin loaders ONCE at module top-level, NOT inside the
// plugin-host useEffect. React StrictMode (dev) mounts effects twice; both
// mounts share the SAME `sandboxLoader`/`trustedLoader` module singletons, so
// mount #1's cleanup disposing its `registerLoader` handle wipes the entry
// mount #2 registered (dispose checks `loaders.get(tier) === loader` — true
// for the shared singleton). The result: after StrictMode settles, the
// loaders map is empty and `pluginHost.activate(id)` throws
// "No loader registered for tier: sandbox". App-lifetime singletons don't
// need disposal — they live for the whole session.
pluginHost.registerLoader(sandboxLoader);
pluginHost.registerLoader(trustedLoader);

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
  usePetHostBridge();

  const isMobile = useIsMobile();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const activePanel = useEditorStore((s) => s.activePanel);
  const setActivePanel = useEditorStore((s) => s.setActivePanel);
  const setCurrentPage = useNavStore((s) => s.setCurrentPage);

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

  const currentPage = useNavStore((state) => state.currentPage);
  const showAiPanel = useAppearanceStore((state) => state.showAiPanel);
  const showStatusBar = useAppearanceStore((state) => state.showStatusBar);
  const fontSize = useAppearanceStore((state) => state.fontSize);
  // enable*Panel flags are no longer read here post-PR2 — the visibility +
  // active-panel fallback logic moved into registerBuiltinPanels (one general
  // rule: if the active panel becomes invisible, re-route to 'files').

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

      await useVaultStore.getState().initVault();

      await loadAiSessionsForVault();
      await editorIoService.restoreOpenTabs();

      useWikiStore.getState().initWiki().catch((err) => {
        console.warn('[App] Wiki init failed:', err);
      });

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
    if (currentPage !== 'editor' && isTauri()) {
      import('@tauri-apps/api/core').then(({ invoke }) => {
        invoke('hide_all_webviews', { labels: [] }).catch(() => {});
      });
    }
  }, [currentPage]);

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
      // Loaders are registered at module top-level (see file header) — they
      // are app-lifetime singletons, not per-effect disposables.

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

      // Fetch-RPC listener: routes `quill-plugin://.../rpc` POSTs from tool
      // windows back through the shared `dispatchPluginRpc` so the same
      // permission checks / path resolution apply as the iframe bridge.
      const unRpc = await attachToolWindowRpcListener();

      if (cancelled) {
        unInstall();
        unApprove();
        unUninstall();
        unRpc();
      } else {
        uninstalled = () => {
          unInstall();
          unApprove();
          unUninstall();
          unRpc();
        };
      }
    })();

    return () => {
      cancelled = true;
      uninstalled?.();
    };
  }, []);

  // ── Voice input: global toggle hotkey ──
  // Registers the persisted voice hotkey on mount and listens for
  // `voice://hotkey-toggle` events from the `tauri-plugin-global-shortcut`
  // handler in `lib.rs`. Toggle semantics (mirrors openless `qa_hotkey.rs`):
  // each press flips the state — idle → start, recording → stop → transcribe
  // → polish → insert. Other phases are ignored by the guards already in
  // `useVoiceInput.start`/`.stop`. Reuses the SAME flow as the mic button.
  //
  // Root cause for the subscribe pattern: `loadSettings()` is fire-and-forget
  // async (`settingsPersistence.ts`), so `useVoiceStore.getState().globalHotkey`
  // at mount time reads the default `''` before hydration lands — the mount-time
  // register silently no-ops. Subscribing to globalHotkey changes lets the
  // hydration `''` → 'Cmd+Shift+V' transition re-register without re-running
  // the whole effect (no listener churn). Non-Tauri/test envs skip.
  useEffect(() => {
    if (!isTauri()) return;
    let unlistenToggle: (() => void) | undefined;
    let unsubHotkey: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const { listen } = await import('@tauri-apps/api/event');
        const { useVoiceStore } = await import('@/store/voiceStore');
        const { useVoiceInput } = await import('@/hooks/useVoiceInput');

        const register = async (accel: string) => {
          if (!accel || cancelled) return;
          try {
            await invoke('voice_set_global_hotkey', { accelerator: accel });
          } catch (err) {
            console.warn('[voice] hotkey register failed:', err);
          }
        };

        // Initial register (covers the cache-hit case where hydration finished
        // before this effect ran). StrictMode teardown-races-await: the first
        // mount's cleanup may run while this `await` is in flight; `cancelled`
        // gates the stale register so only the remount's register lands.
        await register(useVoiceStore.getState().globalHotkey);

        // Re-register whenever the persisted hotkey hydrates/changes. Without
        // this, first launch picks up an empty hotkey and never re-registers
        // once hydration lands the real value → user must open VoiceSettings
        // and re-set the hotkey to trigger the invoke.
        unsubHotkey = useVoiceStore.subscribe((state, prev) => {
          if (state.globalHotkey !== prev.globalHotkey) {
            void register(state.globalHotkey);
          }
        });

        // One event = one toggle. Read phase and flip; the hook's own guards
        // make a stray toggle during transcribe/polish/insert a no-op.
        // 'inserting' is also allowed through to start() so the user can
        // break out of the post-no-API-key linger (idleNoticeTimer running)
        // — start() itself rejects the call if no linger is active.
        unlistenToggle = await listen('voice://hotkey-toggle', () => {
          const { phase, start, stop } = useVoiceInput.getState();
          if (phase === 'idle' || phase === 'inserting') void start('hotkey');
          else if (phase === 'recording') void stop();
        });
      } catch (err) {
        console.warn('[voice] hotkey listener setup failed:', err);
      }
      // ponytail: StrictMode teardown-races-await canonical guard (mirrors
      // VoiceOrbOverlay.tsx:76-98): if cleanup already ran while we were
      // awaiting `listen` / `subscribe`, drop the listeners right now so they
      // don't leak.
      if (cancelled) {
        unlistenToggle?.();
        unsubHotkey?.();
      }
    })();
    return () => {
      cancelled = true;
      unlistenToggle?.();
      unsubHotkey?.();
    };
  }, []);

  // ── Global Ctrl+S / Cmd+S and Cmd+Shift+F ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const activeTabId = useEditorStore.getState().activeTabId;
        if (activeTabId) {
          editorIoService.saveFile(activeTabId);
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
        if (useAppearanceStore.getState().enableDailyPanel) {
          e.preventDefault();
          useNavStore.getState().setCurrentPage('schedule');
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
            <Sidebar onFileSelect={isMobile ? closeMobileSidebar : undefined} />
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
