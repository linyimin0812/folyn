import { useEffect, useRef, useState, useCallback } from 'react';
import { Topbar } from './components/shell/Topbar';
import { ActivityBar } from './components/shell/ActivityBar';
import { Sidebar } from './components/sidebar/Sidebar';
import { WorkArea } from './components/work-area/WorkArea';
import { StatusBar } from './components/shell/StatusBar';
import { RightDock } from './components/ai/RightDock';
import { GlobalSearchPanel } from './components/search/GlobalSearchPanel';
import { CommandPalette } from './components/shell/CommandPalette';
import { useWikiStore } from '@/store/wikiStore';

import { SettingsPage } from './components/pages/SettingsPage';
import { VaultPage } from './components/pages/VaultPage';
import { ScheduleWorkbenchPage } from './components/schedule/ScheduleWorkbenchPage';
import { StudyWorkbenchPage } from './components/study/StudyWorkbenchPage';
import { useTheme } from './hooks/useTheme';
import { useDisableAutoCapitalize } from './hooks/useDisableAutoCapitalize';
import { usePetHostBridge } from './hooks/usePetHostBridge';
import { useNavStore } from './store/navStore';
import { useAppearanceStore } from './store/appearanceStore';
import { useEditorViewStateStore } from './store/editorViewState';
import { useVaultStore, startFileTreeBroadcast } from './store/vaultStore';
import { startProvidersBroadcast } from './store/aiConfigStore';
import { settingsLoadDone, persistNow, loadSettings, resolveSettingsLoadDone } from './store/settingsPersistence';
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

export default function App() {
  useTheme();
  useDisableAutoCapitalize();
  usePetHostBridge();

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

  // 切换 activity 面板时同时回到 editor 页（从 schedule 页点面板按钮可返回），
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
  // Mirrors the canonical teardown-races-await pattern at App.tsx:381-423
  // (voice hotkey). The redundant setState on the second mount is idempotent.
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
    settingsLoadDone.then(() => {
      stop = startFileTreeBroadcast();
      stopProviders = startProvidersBroadcast();
    });
    return () => { stop?.(); stopProviders?.(); };
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
      // Cmd/Ctrl+A selects all in native <input>/<textarea>. CodeMirror has
      // its own Mod-a keymap that preventDefaults, so it never reaches here.
      // Tauri's Edit menu lacks a Select All item on purpose — adding
      // `.select_all()` regresses CodeMirror (menu accelerator intercepts
      // Cmd+A before the webview gets the keydown).
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a') {
        const el = e.target as HTMLElement | null;
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          e.preventDefault();
          el.select();
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

  // ── Tray icon: sync Rust-side with the persisted `showTrayIcon` flag ──
  // Mirrors the voice-hotkey subscribe pattern: `loadSettings()` is
  // fire-and-forget async, so reading `showTrayIcon` at mount time returns
  // the default `false` before hydration lands. Initial invoke + subscribe
  // covers both the cache-hit case and the post-hydrate `false` → `true`
  // transition. The SettingsPage Toggle also invokes on change, but this
  // effect is the source of truth for startup + external hydrate paths.
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unsub: (() => void) | undefined;
    const sync = async (enabled: boolean) => {
      if (cancelled) return;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const i18n = (await import('@/i18n')).default;
        await invoke('tray_set_enabled', { enabled, locale: i18n.language || 'en' });
      } catch (err) {
        console.warn('[tray] sync failed:', err);
      }
    };
    void sync(useAppearanceStore.getState().showTrayIcon);
    unsub = useAppearanceStore.subscribe((state, prev) => {
      if (state.showTrayIcon !== prev.showTrayIcon) {
        void sync(state.showTrayIcon);
      }
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  // ── OS file drag-and-drop onto the window (best-effort, macOS) ──
  // When the user drags a file from Finder onto the window, the webview
  // receives an HTML5 `drop` event. WebKit (WKWebView) exposes the real path
  // on the dropped `File` object (`.path`); if present, we open it as an
  // external (vault-independent) tab. We deliberately do NOT flip the Tauri
  // `dragDropEnabled` window flag (which would give us reliable `tauri://drag`
  // events with paths) because doing so also disables HTML5 drag-and-drop on
  // Windows — which the schedule board DnD relies on. So this is best-effort:
  // works on macOS where `.path` is populated, silently no-ops elsewhere.
  useEffect(() => {
    if (!isTauri()) return;
    const onDrop = (e: DragEvent) => {
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;
      let opened = false;
      for (let i = 0; i < files.length; i++) {
        const f = files[i] as unknown as { path?: string };
        const p = f.path;
        if (!p) continue;
        const name = p.includes('/') ? p.substring(p.lastIndexOf('/') + 1) : p;
        void editorIoService.openFile(p, name);
        opened = true;
      }
      if (opened) {
        e.preventDefault();
        useNavStore.getState().setCurrentPage('editor');
      }
    };
    const onDragOver = (e: DragEvent) => {
    // Allow a drop (default is to deny). Only signal allow when there are
      // files so we don't interfere with in-app HTML5 DnD (board cards).
      if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
    };
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragover', onDragOver);
    return () => {
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragover', onDragOver);
    };
  }, []);

  // ── OS "Open With" / file-association launch ──
  // When the OS launches Quill to open a file (right-click → Open With →
  // Quill, or double-click an associated file), the Rust `RunEvent::Opened`
  // handler converts the `file://` URL to a path and emits it here. We open
  // it as a vault-independent external tab. Safe to fire before
  // `restoreOpenTabs` completes — `openFile` is idempotent on the tab id.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen<string[]>('app://open-external-file', (e) => {
          const paths = e.payload ?? [];
          for (const p of paths) {
            const name = p.includes('/') ? p.substring(p.lastIndexOf('/') + 1) : p;
            void editorIoService.openFile(p, name);
          }
          if (paths.length > 0) {
            useNavStore.getState().setCurrentPage('editor');
          }
        });
      } catch (err) {
        console.warn('[App] open-external-file listener setup failed:', err);
      }
      if (cancelled) unlisten?.();
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // ponytail: flush persisted settings before the window closes. The 300ms
  // debounce in storageClient would otherwise drop the last setter's write
  // if the user changes a setting and Cmd+Q / closes the window within
  // that window. pet menu "退出应用" goes through routePetMenuAction which
  // also awaits persistNow; this listener covers Cmd+Q and window-close.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        unlisten = await getCurrentWindow().onCloseRequested(async (e) => {
          e.preventDefault();
          try {
            await persistNow();
          } catch (err) {
            console.warn('[App] persistNow on close failed:', err);
          }
          await getCurrentWindow().destroy();
        });
      } catch (err) {
        console.warn('[App] close-requested listener setup failed:', err);
      }
      if (cancelled) unlisten?.();
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
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
            <Sidebar
              collapsed={sidebarCollapsed}
              onCollapsedChange={setSidebarCollapsed}
              onFileSelect={isMobile ? closeMobileSidebar : undefined}
            />
          </div>
          <WorkArea />
          <RightDock />
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
          <RightDock />
        </div>
      )}

      {showStatusBar && <StatusBar />}
      <GlobalSearchPanel />
      <CommandPalette />
    </div>
  );
}
