import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Topbar } from './components/shell/Topbar';
import { ActivityBar } from './components/shell/ActivityBar';
import { Sidebar } from './components/sidebar/Sidebar';
import { WorkArea } from './components/work-area/WorkArea';
import { StatusBar } from './components/shell/StatusBar';
import { ToastHost } from './components/shell/ToastHost';
import { RightDock } from './components/ai/RightDock';
import { TerminalPanel } from './components/terminal/TerminalPanel';
import { useTerminalStore } from './store/terminalStore';
import { GlobalSearchPanel } from './components/search/GlobalSearchPanel';
import { CommandPalette } from './components/shell/CommandPalette';
import { useWikiStore } from '@/store/wikiStore';

import { SettingsPage } from './components/pages/SettingsPage';
import { VaultPage } from './components/pages/VaultPage';
import { ScheduleWorkbenchPage } from './components/schedule/ScheduleWorkbenchPage';
import { TranslationPanel } from './components/translation/TranslationPanel';
import { useTheme } from './hooks/useTheme';
import { useDisableAutoCapitalize } from './hooks/useDisableAutoCapitalize';
import { usePetHostBridge } from './hooks/usePetHostBridge';
import { installExternalLinkInterceptor } from './services/externalLinks';
import { useNavStore } from './store/navStore';
import { useAppearanceStore } from './store/appearanceStore';
import { useEditorViewStateStore } from './store/editorViewState';
import { useVaultStore, startFileTreeBroadcast } from './store/vaultStore';
import { startProvidersBroadcast } from './store/aiConfigStore';
import { usePetStore } from './store/petStore';
import { settingsLoadDone, persistNow, loadSettings, resolveSettingsLoadDone } from './store/settingsPersistence';
import { useEditorStore } from './store/editorStore';
import * as editorIoService from './services/editorIoService';
import { registerEditorFileChangeApplier } from './services/fileChangeApplier';
import { readClipboardFiles } from '@/services/clipboardFiles';
import { useToastStore } from '@/store/toastStore';
import { PasteConflictDialog, type ConflictChoice, type ConflictResolution } from '@/components/editor/PasteConflictDialog';
import { MoveDialog } from '@/components/sidebar/SidebarActions';
import type { VaultEntry } from '@folyn/vault-provider';
import { useSearchStore } from './store/searchStore';
import { useCommandPaletteStore } from './store/commandPaletteStore';
import { loadAiSessionsForVault } from './store/aiStore';
import { startPetChatSessionsHost } from './store/petChatSessions';
import { registerBuiltinPlugins } from '@folyn/container-plugins';
import { registerBuiltinCommands } from './services/commandRegistry';
import { registerBuiltinPanels } from './services/registerBuiltinPanels';
import { registerBuiltinCodeContributions } from './services/registerBuiltinCodeContributions';
import { registerErrorDemoPlugin } from './services/registerErrorDemoPlugin';
import { isTauri } from './utils/platform';
import { useLocaleStore } from '@/store/localeStore';
import { pluginHost } from '@folyn/plugin-host';
import { sandboxLoader } from './services/plugin-host/sandboxLoader';
import { trustedLoader } from './services/plugin-host/trustedLoader';
import { attachToolWindowRpcListener } from './services/plugin-host/toolWindowRpcListener';

registerBuiltinPlugins();
registerBuiltinCodeContributions();
registerErrorDemoPlugin();
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
  const { t } = useTranslation();

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
    let stopPetChat: (() => void) | undefined;
    settingsLoadDone.then(() => {
      stop = startFileTreeBroadcast();
      stopProviders = startProvidersBroadcast();
      stopPetChat = startPetChatSessionsHost();
    });
    return () => { stop?.(); stopProviders?.(); stopPetChat?.(); };
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
      // ponytail: load the active vault's saved wiki query session (mirror aiStore boot pattern)
      const { useWikiQueryStore } = await import('./store/wikiQueryStore');
      await useWikiQueryStore.getState().loadForCurrentVault();
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

    /** Read a plugin manifest from ~/.folyn/plugins/<id>/manifest.json */
    async function readPluginManifest(id: string): Promise<Record<string, unknown>> {
      const { homeDir, join } = await import('@tauri-apps/api/path');
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const home = await homeDir();
      const manifestPath = await join(home, '.folyn', 'plugins', id, 'manifest.json');
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

      // Fetch-RPC listener: routes `folyn-plugin://.../rpc` POSTs from tool
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

  // ── OS file drag-and-drop onto the window ──
  // When the user drags a file from the OS file manager (Finder / Explorer)
  // onto the window, the webview receives an HTML5 `drop` event. We open each
  // dropped file as a vault-independent external tab via `openDroppedFiles`,
  // which routes by platform: macOS gets the real path from WebKit's private
  // `File.path`; Windows (no path on the File object) stages the content into
  // `~/.folyn/drops/` and opens that staged copy (see editorIoService for why
  // `dragDropEnabled` can't be flipped on). A full-window overlay signals that
  // a file drop is pending so the user knows the window accepts files.
  const [fileDragActive, setFileDragActive] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    const isFileDrag = (e: DragEvent) => !!e.dataTransfer?.types?.includes('Files');
    // dragenter/dragleave fire per child element AND their order + relatedTarget
    // are not reliable across WKWebView/WebView2 — a depth counter desyncs
    // (leave fires before the matching enter when crossing children), so the
    // overlay flickers off mid-drag or stays stuck on after a cancelled drop.
    // Instead we drive the overlay off the reliable, continuously-firing
    // dragover: each dragover refreshes a short lease; when it expires (drop,
    // drag leaves the window, or the user drags back out) the overlay clears.
    let lease: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      if (!lease) setFileDragActive(true);
      else clearTimeout(lease);
      // 120ms > the dragover cadence on every platform, so the lease only lapses
      // once dragover actually stops (i.e. the drag has left the window or ended).
      lease = setTimeout(() => {
        lease = null;
        setFileDragActive(false);
      }, 120);
    };
    const disarm = () => {
      if (lease) { clearTimeout(lease); lease = null; }
      setFileDragActive(false);
    };
    const onDragOver = (e: DragEvent) => {
      // Allow a drop (default is to deny). Only signal allow when there are
      // files so we don't interfere with in-app HTML5 DnD (board cards).
      if (!isFileDrag(e)) return;
      e.preventDefault();
      arm();
    };
    // ponytail: single capture-phase drop listener. Capture runs BEFORE any
    // child React handler (CodeMirror/ProseMirror/rich-text onDrop), so a
    // child stopPropagation in bubble can't prevent us from preventDefault
    // AND reading dataTransfer. Per HTML5 spec dataTransfer is available
    // throughout the drop dispatch including capture phase — earlier worry
    // about capture-phase empty files was a misdiagnosis; the real culprit
    // for "only one file opens" was bubble onDrop being stopPropagation'd by
    // a mounted child after the first file's editor mounted.
    const onDrop = (e: DragEvent) => {
      if (isFileDrag(e)) e.preventDefault();
      disarm();
      if (!isFileDrag(e)) return;
      // Read from both .files and .items — WKWebView populates .files, but
      // fall back to .items (with getAsFile) when .files is empty so a real
      // file drop is never silently dropped.
      const dt = e.dataTransfer;
      const fromFiles = dt?.files ? Array.from(dt.files) : [];
      const fromItems = !dt?.items ? [] : Array.from(dt.items)
        .filter((it) => it.kind === 'file')
        .map((it) => it.getAsFile())
        .filter((f): f is File => !!f);
      const arr = fromFiles.length > 0 ? fromFiles : fromItems;
      if (arr.length === 0) return;
      void editorIoService.openDroppedFiles(arr).then((n) => {
        if (n > 0) useNavStore.getState().setCurrentPage('editor');
      });
    };
    // ponytail: capture phase so our preventDefault runs BEFORE any child
    // React handler (CodeMirror/ProseMirror/preview drop handlers) that
    // might stopPropagation — otherwise the window bubble listener never
    // fires and WKWebView navigates to the dropped file.
    // ponytail: the markdown/html preview is a sandboxed <iframe> — a
    // separate document whose dragover/drop don't reach the parent window.
    // The iframe forwards 'folyn:file-drag-active' (arm the overlay) and
    // 'folyn:open-dropped-files' (open the files) via postMessage; handle
    // them here, reusing the same arm/disarm + openDroppedFiles path as
    // window drops. Files (not paths) are forwarded because a cross-origin
    // sandbox iframe can't read WebKit's private File.path.
    const onMsg = (e: MessageEvent) => {
      if (e.source === window) return;
      const data = e.data as { type?: string; files?: File[] } | null;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'folyn:file-drag-active') {
        arm();
      } else if (data.type === 'folyn:open-dropped-files' && Array.isArray(data.files)) {
        // iframe (markdown/html preview) forwarded a drop as File objects —
        // the iframe is a separate document whose dragover/drop don't reach
        // the parent window, and a cross-origin (allow-scripts only) iframe
        // can't read WebKit's private File.path, so it ships the File objects
        // themselves. Route through the same openDroppedFiles path as a
        // window-level drop (macOS .path if present, else staging).
        disarm();
        void editorIoService.openDroppedFiles(data.files).then((n) => {
          if (n > 0) useNavStore.getState().setCurrentPage('editor');
        });
      }
    };
    window.addEventListener('dragover', onDragOver, true);
    window.addEventListener('drop', onDrop, true);
    window.addEventListener('message', onMsg);
    return () => {
      if (lease) clearTimeout(lease);
      window.removeEventListener('dragover', onDragOver, true);
      window.removeEventListener('drop', onDrop, true);
      window.removeEventListener('message', onMsg);
    };
  }, []);

  // ── OS file paste (Finder Cmd+C → Folyn Cmd+V) ──
  // When the user copies a file in Finder/Explorer and pastes in Folyn, open a
  // folder picker restricted to the current vault, then import each clipboard
  // file into the picked folder via `copyExternalFileToVault` (binary-safe —
  // reuses the path proven by the drag-drop flow).
  //
  // File refs on the clipboard can't be read synchronously via
  // `navigator.clipboard` (WKWebView/WebView2 only expose text/plain +
  // image/png), so the Rust `read_clipboard_files` command (arboard) does the
  // read. To avoid racing that async read against the paste event's narrow
  // synchronous preventDefault window, we refresh a cached file list on
  // window focus — the user must focus Folyn before pasting, which updates
  // the cache just-in-time.
  //
  // ponytail: "File wins" — when the cache is non-empty we preventDefault +
  // stopPropagation in capture so CodeMirror/ProseMirror bubble-phase paste
  // handlers never fire (they'd insert the filename as text). When the cache
  // is empty we no-op and the default text paste runs unchanged.
  // Split-screen edge case: copy a file in Finder while Folyn stays focused
  // (no focus event fires) → cache is stale → text paste runs instead of the
  // picker. Acceptable for MVP; a polling fallback can cover it if it bites.
  // Folder picker = in-app MoveDialog (same UI as right-click "Move to…"),
  // NOT the native OS folder picker. Reuses MoveDialog with mode 'copy' +
  // empty sources (the clipboard files are external, not vault entries, so
  // there's no move-into-self to guard). MoveDialog returns a vault-relative
  // dir path ('' = root), so no absolute-path normalization or vault-boundary
  // validation is needed here.
  const [pickerFileTree, setPickerFileTree] = useState<VaultEntry[]>([]);
  const [pickerVisible, setPickerVisible] = useState(false);
  const pickerResolverRef = useRef<((dir: string | null) => void) | null>(null);
  const showFolderPicker = useCallback(() => {
    setPickerFileTree(useVaultStore.getState().fileTree);
    setPickerVisible(true);
    return new Promise<string | null>((resolve) => {
      pickerResolverRef.current = resolve;
    });
  }, []);
  const onPickerConfirm = useCallback(async (dir: string) => {
    setPickerVisible(false);
    const r = pickerResolverRef.current;
    pickerResolverRef.current = null;
    r?.(dir);
  }, []);
  const onPickerCancel = useCallback(() => {
    setPickerVisible(false);
    const r = pickerResolverRef.current;
    pickerResolverRef.current = null;
    r?.(null);
  }, []);

  const [conflictFile, setConflictFile] = useState<string | null>(null);
  const [conflictRemaining, setConflictRemaining] = useState(0);
  const conflictResolverRef = useRef<((res: ConflictResolution) => void) | null>(null);
  const showConflictModal = useCallback(
    (fileName: string, remaining: number) =>
      new Promise<ConflictResolution>((resolve) => {
        conflictResolverRef.current = resolve;
        setConflictFile(fileName);
        setConflictRemaining(remaining);
      }),
    [],
  );
  const onConflictResolve = useCallback((res: ConflictResolution) => {
    setConflictFile(null);
    const r = conflictResolverRef.current;
    conflictResolverRef.current = null;
    r?.(res);
  }, []);

  const runFilePasteImport = useCallback(async (srcPaths: string[]) => {
    if (!useVaultStore.getState().currentVault?.basePath) {
      useToastStore.getState().push(t('editor:filePaste.openVaultFirst'));
      return;
    }
    const relDir = await showFolderPicker();
    if (relDir === null) return; // user cancelled the folder picker
    const vault = useVaultStore.getState();
    let imported = 0;
    let skipped = 0;
    let batchChoice: ConflictChoice | null = null;
    let applyToAll = false;
    for (let i = 0; i < srcPaths.length; i++) {
      const src = srcPaths[i];
      // ponytail: split on both separators — arboard returns backslash paths
      // on Windows (`C:\Users\…`), the old `/`-only split made baseName the
      // whole path → invalid vault filename → silent writeFileBytes failure.
      const baseName = src.split(/[\\/]/).pop()!;
      const remaining = srcPaths.length - i - 1;
      let choice: ConflictChoice | 'write';
      const exists = await vault.externalFileExistsAt(relDir, baseName);
      if (!exists) {
        choice = 'write';
      } else if (applyToAll && batchChoice) {
        choice = batchChoice;
      } else {
        const res = await showConflictModal(baseName, remaining);
        applyToAll = res.applyToAll;
        if (applyToAll) batchChoice = res.choice;
        choice = res.choice;
      }
      try {
        if (choice === 'skip') {
          skipped++;
          continue;
        }
        if (choice === 'overwrite') {
          await vault.overwriteExternalFileToVault(src, relDir);
        } else {
          // 'write' (no conflict) or 'rename' — copyExternalFileToVault
          // uses the original name when free, ` 副本` suffix on collision,
          // so it covers both cases (the caller has already resolved the
          // choice; for 'rename' we rely on the auto-suffix).
          await vault.copyExternalFileToVault(src, relDir);
        }
        imported++;
      } catch (err) {
        console.error('[paste] import failed', src, err);
      }
    }
    if (imported > 0) {
      useToastStore.getState().push(
        t('editor:filePaste.imported', { count: imported, where: relDir || t('editor:filePaste.vaultRoot') }),
      );
    } else if (skipped > 0) {
      useToastStore.getState().push(t('editor:filePaste.allSkipped', { count: skipped }));
    }
  }, [t, showFolderPicker, showConflictModal]);

  const clipboardFilesCache = useRef<string[]>([]);
  useEffect(() => {
    if (!isTauri()) return;
    const refresh = () => {
      void readClipboardFiles().then((p) => {
        clipboardFilesCache.current = p;
      });
    };
    refresh();
    window.addEventListener('focus', refresh);
    const onPaste = (e: ClipboardEvent) => {
      const paths = clipboardFilesCache.current;
      if (paths.length === 0) return; // no file ref → default text paste
      e.preventDefault();
      e.stopImmediatePropagation();
      void runFilePasteImport(paths).finally(() => {
        // ponytail: refresh async after this paste so a 2nd paste-without-
        // refocus (different file copied in place) sees the new clipboard.
        setTimeout(refresh, 0);
      });
    };
    window.addEventListener('paste', onPaste, true);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('paste', onPaste, true);
    };
  }, []);

  // ── OS "Open With" / file-association launch ──
  // When the OS launches Folyn to open a file (right-click → Open With →
  // Folyn, or double-click an associated file), the Rust side buffers the
  // paths in `PendingOpenFiles` AND emits `app://open-external-file` (from
  // `RunEvent::Opened` on macOS and the single-instance callback on both
  // platforms). We listen FIRST so warm-launch emits are never missed, then
  // drain the buffer so cold-launch paths (arrived before React mounted)
  // are recovered. Each path opens as a vault-independent external tab.
  // Safe to fire before `restoreOpenTabs` completes — `openFile` is
  // idempotent on the tab id.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    const openPaths = (paths: string[]) => {
      for (const p of paths) {
        const name = p.split(/[\\/]/).pop()!;
        void editorIoService.openFile(p, name);
      }
      if (paths.length > 0) {
        useNavStore.getState().setCurrentPage('editor');
      }
    };
    // Register the listener FIRST so warm-launch emits are never missed,
    // then drain the backend buffer (cold-launch paths that arrived before
    // React mounted). A path can be delivered twice (once via the event,
    // once via the drain) — `openFile` is idempotent on the tab id, so the
    // second delivery just re-activates the tab. The two steps are
    // independent: a failure in one must not disable the other (e.g. a
    // missing `drain_pending_open_files` on an older backend must not kill
    // the warm-launch listener).
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen<string[]>('app://open-external-file', (e) => {
          openPaths(e.payload ?? []);
        });
      } catch (err) {
        console.warn('[App] open-external-file listener setup failed:', err);
      }
      if (cancelled) unlisten?.();
    })();
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const pending = await invoke<string[]>('drain_pending_open_files');
        openPaths(pending ?? []);
      } catch (err) {
        console.warn('[App] drain pending open files failed:', err);
      }
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
            // Flush open tabs first (sync, marks storage dirty), then
            // persistNow() flushes everything to disk. Without this, closing
            // a tab and quitting within the persist debounce window would
            // restore the closed tab on the next launch.
            editorIoService.saveOpenTabs();
            await persistNow();
          } catch (err) {
            console.warn('[App] persistNow on close failed:', err);
          }
          // ponytail: pet mode on → Rust's on_window_event owns the hide
          // (prevent_close + hide, and fullscreen-aware on macOS: hiding a
          // fullscreen window under macOSPrivateApi leaves a black fullscreen
          // Space behind, so Rust exits fullscreen + waits for the transition
          // before hiding). The webview stays alive after the window is
          // hidden, so the persistNow() flush above is not cut short. Pet off
          // → real close (app exits, pet window cleanup is automatic).
          const petOn = usePetStore.getState().petModeEnabled;
          if (!petOn) {
            await getCurrentWindow().destroy();
          }
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
            {!isMobile && <ActivityBar activePanel={activePanel} onPanelChange={handlePanelChange} />}
            {isMobile && mobileSidebarOpen && (
              <div className="mobile-sidebar-overlay" onClick={closeMobileSidebar} />
            )}
            {/* The file bar is a full-height sibling of the editor column so
                it keeps showing the file tree while the terminal occupies
                only the space below the editor content. */}
            <div className={`sidebar-wrapper ${isMobile ? 'mobile' : ''} ${mobileSidebarOpen ? 'open' : ''}`}>
              <Sidebar
                collapsed={sidebarCollapsed}
                onCollapsedChange={setSidebarCollapsed}
                onFileSelect={isMobile ? closeMobileSidebar : undefined}
              />
            </div>
            <EditorContent />
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

      {currentPage === 'schedule' && (
        <div className="body-row flex-1 flex overflow-hidden">
          {!isMobile && <ActivityBar activePanel={activePanel} onPanelChange={handlePanelChange} />}
          <ScheduleWorkbenchPage />
        </div>
      )}

      {currentPage === 'translation' && (
        <div className="body-row flex-1 flex overflow-hidden">
          {!isMobile && <ActivityBar activePanel={activePanel} onPanelChange={handlePanelChange} />}
          <TranslationPanel />
        </div>
      )}

      {showStatusBar && <StatusBar />}
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
    </div>
  );
}

/** Editor + AI dock with a single mounted terminal that moves between bottom
 *  and right via absolute positioning, so xterm and scrollback survive the
 *  dock-location switch. */
function EditorContent() {
  return (
    <TerminalHost>
      <WorkArea />
      <RightDock />
    </TerminalHost>
  );
}

/** Shared terminal host used by editor and schedule layouts. */
function TerminalHost({ children }: { children: ReactNode }) {
  const sessions = useTerminalStore((s) => s.sessions);
  const terminalPanelVisible = useEditorViewStateStore((s) => s.terminalPanelVisible);
  const terminalInRightDock = useEditorViewStateStore((s) => s.terminalInRightDock);
  const terminalRightWidth = useEditorViewStateStore((s) => s.terminalRightWidth);
  const [bottomHeight, setBottomHeight] = useState(240);

  const hasSessions = sessions.length > 0;
  const bottomOpen = hasSessions && terminalPanelVisible && !terminalInRightDock;
  const rightOpen = hasSessions && terminalInRightDock;

  return (
    <div className="relative flex-1 min-w-0 flex flex-col overflow-hidden">
      <div
        className="flex-1 min-h-0 flex"
        style={{
          paddingBottom: bottomOpen ? bottomHeight + 8 : 0,
          paddingRight: rightOpen ? terminalRightWidth : 0,
        }}
      >
        {children}
      </div>
      <TerminalDock
        bottomHeight={bottomHeight}
        onBottomHeightChange={setBottomHeight}
      />
    </div>
  );
}

/** Single persistent terminal dock rendered at the bottom or right edge. */
function TerminalDock({
  bottomHeight,
  onBottomHeightChange,
}: {
  bottomHeight: number;
  onBottomHeightChange: (height: number) => void;
}) {
  const sessions = useTerminalStore((s) => s.sessions);
  const terminalPanelVisible = useEditorViewStateStore((s) => s.terminalPanelVisible);
  const terminalInRightDock = useEditorViewStateStore((s) => s.terminalInRightDock);
  const terminalRightWidth = useEditorViewStateStore((s) => s.terminalRightWidth);

  if (sessions.length === 0) return null;

  const right = terminalInRightDock;
  const bottom = terminalPanelVisible && !right;
  const visible = right || bottom;

  return (
    <div
      className="absolute z-10 bg-bg"
      style={
        !visible
          ? { display: 'none' }
          : right
            ? {
                top: 0,
                right: 0,
                bottom: 0,
                width: terminalRightWidth,
                borderLeft: '1px solid var(--brd)',
              }
            : {
                left: 0,
                right: 0,
                bottom: 0,
                height: bottomHeight + 8,
                borderTop: '1px solid var(--brd)',
              }
      }
    >
      {visible && (right ? (
        <TerminalRightResizeHandle key="right-resize" />
      ) : (
        <TerminalResizeHandle
          key="bottom-resize"
          height={bottomHeight}
          onHeightChange={onBottomHeightChange}
        />
      ))}
      <TerminalPanel key="terminal-panel" height={right ? '100%' : bottomHeight} />
    </div>
  );
}

const MIN_TERMINAL_RIGHT_WIDTH = 240;
const MAX_TERMINAL_RIGHT_WIDTH = 640;

function TerminalRightResizeHandle() {
  const terminalRightWidth = useEditorViewStateStore((s) => s.terminalRightWidth);
  const setTerminalRightWidth = useEditorViewStateStore((s) => s.setTerminalRightWidth);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const startResize = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startWidth: terminalRightWidth };
      document.body.style.cursor = 'col-resize';
      document.documentElement.classList.add('is-resizing');
    },
    [terminalRightWidth],
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const next = drag.startWidth + drag.startX - e.clientX;
      setTerminalRightWidth(Math.max(MIN_TERMINAL_RIGHT_WIDTH, Math.min(MAX_TERMINAL_RIGHT_WIDTH, next)));
    };
    const stopResize = () => {
      dragRef.current = null;
      document.body.style.cursor = '';
      document.documentElement.classList.remove('is-resizing');
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', stopResize);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', stopResize);
    };
  }, [setTerminalRightWidth]);

  return (
    <div
      className="absolute left-0 top-0 bottom-0 w-0.5 cursor-col-resize z-10 bg-transparent transition-[background] duration-[140ms] hover:bg-acc hover:opacity-30"
      onMouseDown={startResize}
    />
  );
}

/**
 * 2px visible separator with an 8px hit target. The line sits at the TOP
 * edge of the handle so clicking ON the line (and a comfortable strip below
 * it, over the terminal header) starts the drag — not just a few pixels
 * above the line. The strip below the line matches the header color, so
 * only the line separates the editor from the terminal.
 */
function TerminalResizeHandle({
  height,
  onHeightChange,
}: {
  height: number;
  onHeightChange: (height: number) => void;
}) {
  const [dragging, setDragging] = useState<{ startY: number; startHeight: number } | null>(null);

  useEffect(() => {
    if (!dragging) return;
    const onMouseMove = (e: MouseEvent) => {
      const delta = dragging.startY - e.clientY;
      const next = Math.max(100, Math.min(600, dragging.startHeight + delta));
      onHeightChange(next);
    };
    const stop = () => {
      setDragging(null);
      document.body.style.cursor = '';
      document.documentElement.classList.remove('is-resizing');
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', stop);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', stop);
    };
  }, [dragging]);

  return (
    <div
      className="shrink-0 h-[8px] relative cursor-row-resize bg-panel"
      onMouseDown={(e) => {
        e.preventDefault();
        setDragging({ startY: e.clientY, startHeight: height });
        document.body.style.cursor = 'row-resize';
        document.documentElement.classList.add('is-resizing');
      }}
    >
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-brd transition-colors duration-150 hover:bg-acc hover:opacity-60" />
    </div>
  );
}
