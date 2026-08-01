import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isTauri } from '@/utils/platform';
import { usePetStore } from '@/store/petStore';
import { hydrateAllStores } from '@/store/settingsPersistence';
import {
  clampPanelPosition,
  computePanelPosition,
  resolvePanelSize,
  PET_PANEL_SIZE_VERSION,
  type PetWorkArea,
} from './petPosition';
import { PetLauncher } from './PetLauncher';
import { AiPanel } from '@/components/ai/AiPanel';
import { PetInbox } from './PetInbox';
import { useVaultStore } from '@/store/vaultStore';

type PetPanelTab = 'actions' | 'chat' | 'inbox';

interface PetCursorProbeResult {
  cursor_x: number;
  cursor_y: number;
  window_x: number;
  window_y: number;
  main_fullscreen: boolean;
}

interface PetPanelSizePayload {
  width: number;
  height: number;
}

/** Position-persist poll interval — mirrors the pet window's pattern. */
const PANEL_PERSIST_INTERVAL_MS = 800;

/**
 * PetPanelApp — mounted only in the `pet-panel` Tauri window (see main.tsx
 * `#/pet-panel` route switch). Hosts a tabbed layout: **Actions** (the
 * `PetLauncher` grid) and **Chat** (the `PetChat` component). Only one view
 * is mounted at a time; switching tabs unmounts the inactive view — this
 * releases the chat's `CliAdapter` mid-stream, which is acceptable per the
 * PRD's Out-of-Scope "stream-interrupt resume" rule.
 *
 * Lifecycle:
 *  - Close button (×) → invoke `pet_panel_hide` to hide the window.
 *  - Esc key → same.
 *  - The pet's left-click handler (PetApp.tsx) toggles this window via
 *    `pet_panel_show` / `pet_panel_hide`; this component only owns the
 *    in-panel dismiss paths.
 *  - Header is a drag handle (left-button `onPointerDown` →
 *    `getCurrentWindow().startDragging()`). The close button stops
 *    propagation so it never triggers a drag.
 *  - The window is `resizable: true` (edges are OS-draggable). Position and
 *    size are persisted to `petStore` (`petPanelX/Y/Width/Height`) via
 *    a periodic poll, and restored on mount — so the panel reappears where
 *    the user last left it instead of snapping back to the pet's corner.
 *
 * The window itself is declared in `tauri.conf.json` with `visible:false`,
 * `alwaysOnTop:true`, `skipTaskbar:true`, `decorations:false`,
 * `transparent:false` (panel is opaque), `resizable:true`,
 * `minWidth:280`, `minHeight:360`. Its capability file is
 * `capabilities/pet-panel.json` (grants `allow-start-dragging`,
 * `allow-outer-position`, etc.). The body background override lives in
 * `pet.css` (scoped via `is-pet-panel-window` on `<html>`).
 */
export function PetPanelApp() {
  // Default tab is Chat — the panel opens on the embedded AI chat so a
  // single left-click on the pet drops the user into "ask" mode without an
  // extra tab switch. The launcher grid is one click away on the Actions tab.
  const [tab, setTab] = useState<PetPanelTab>('chat');
  // ponytail: drives the CSS opacity/transform transition on
  // `.pet-panel-root`. The webview persists across shows (no re-mount), so
  // the fade-in has to be class-driven by an explicit event rather than a
  // mount-only @keyframes. `applyPanelFrame` (PetApp.tsx) emits
  // `pet://panel-fade-in` AFTER the post-show frame re-assert; this listener
  // flips `is-visible` on → CSS transitions opacity 0→1 + scale 0.98→1 over
  // 180ms from the stable final frame.
  const [isVisible, setVisible] = useState(false);
  const { t } = useTranslation();
  const setPetPanelPosition = usePetStore((s) => s.setPetPanelPosition);
  const setPetPanelSize = usePetStore((s) => s.setPetPanelSize);

  const hidePanel = useCallback(async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('pet_panel_hide');
    } catch (err) {
      console.warn('[pet-panel] hide failed:', err);
    }
  }, []);

  // Esc key dismisses the panel.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        void hidePanel();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [hidePanel]);

  // ponytail: show-fade is driven by `pet://panel-fade-in` (emitted by
  // `applyPanelFrame` in PetApp.tsx AFTER the post-show frame re-assert) and
  // hide-reset is driven by `pet://panel-fade-out` (emitted by `pet_panel_hide`
  // in Rust on actual hide). Both are explicit events — NOT `tauri://focus`.
  //
  // The previous onFocusChanged + isVisible() check was unreliable during
  // the app activation that `set_focus()` (in pet_panel_show) triggers:
  // `isVisible()` could return false momentarily mid-activation →
  // setVisible(false) interrupted the fade-in transition → 忽隐忽现 (flicker:
  // appear, vanish, reappear). The explicit fade-out event fires ONLY on
  // actual hide, so the fade-in is never interrupted.
  //
  // File-upload (NSOpenPanel steals key window → blur, panel still visible)
  // does NOT emit fade-out → panel stays at opacity:1, no blank. Same for
  // app deactivation (blur without hide).
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen('pet://panel-fade-out', () => {
          setVisible(false);
        });
      } catch (err) {
        console.warn('[pet-panel] panel-fade-out listener failed:', err);
      }
    })();
    return () => {
      void unlisten?.();
    };
  }, []);

  // ── Show-fade trigger (decoupled from focus) ──
  // Listens for `pet://panel-fade-in` emitted by `applyPanelFrame` AFTER the
  // post-show frame re-assert completes. This guarantees the CSS opacity/scale
  // transition starts from the stable final rect, not mid-re-assert. The `pet`
  // window emits via global `emit` (ACL: `core:event:allow-emit` on `pet`);
  // this `listen` is ACL-allowed via `core:event:allow-listen` on `pet-panel`.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen('pet://panel-fade-in', () => {
          setVisible(true);
        });
      } catch (err) {
        console.warn('[pet-panel] panel-fade-in listener failed:', err);
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // ── Cross-window settings sync ──
  // The panel window holds its own petStore instance; without this listener
  // it would never see writes from the main window (e.g. `addInboxItem` on
  // `pet://notify`) because those only update the main window's store and
  // broadcast via `pet://settings-updated`. Mirrors the listener in
  // PetBubbleApp / PetCornerApp — same channel, same `hydrateAllStores` call.
  // Without this, the Inbox tab stays empty even after a curl triggers a
  // notification: the main window recorded the item, but the panel's
  // petStore.inboxItems was never updated.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen<Record<string, unknown>>(
          'pet://settings-updated',
          (event) => {
            if (event.payload) hydrateAllStores(event.payload);
          },
        );
      } catch (err) {
        console.warn('[pet-panel] settings-updated listener failed:', err);
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // ── Topmost level (visible over all always-on-top apps) ──
  // Tauri's `alwaysOnTop: true` config only sets the Floating NSWindow
  // level (5), which other always-on-top apps (VS Code, etc.) can cover.
  // Raise the panel to `kCGScreenSaverWindowLevelKey` (13) so it stays
  // visible everywhere. The level persists for the window's lifetime, so
  // calling once on mount is sufficient. Non-fatal if it fails.
  useEffect(() => {
    (async () => {
      if (!isTauri()) return;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('pet_set_topmost_level', { label: 'pet-panel' });
        // ponytail: make the panel WINDOW transparent (opaque=NO +
        // backgroundColor=clear + WKWebView drawsBackground=NO). The panel
        // webview persists across shows, so this runs once on mount. Without
        // this, `show()` can reset the frame to the last visible position
        // WHILE CSS opacity is still 0 — CSS opacity only masks the root
        // element's content, NOT the WKWebView's opaque white background,
        // so the user sees a white rect jump from old → new position (闪动).
        // With a transparent window + drawsBackground=NO, CSS opacity:0 means
        // "see desktop through the window" — no white flash, the CSS
        // opacity 0→1 + scale(0.98→1) transition takes over cleanly from
        // the stable final frame. Also gives the panel visible rounded
        // corners (CSS border-radius:10px now shows desktop at the corners
        // instead of white webview background). The root element's own
        // `background: var(--panel)` still provides the opaque panel body.
        try {
          await invoke('pet_make_transparent', { label: 'pet-panel' });
        } catch (err) {
          console.warn('[pet-panel] pet_make_transparent failed:', err);
        }
      } catch (err) {
        console.warn('[pet-panel] set_topmost_level failed:', err);
      }
    })();
  }, []);

  // ── fileTree mirror from main window ──
  // ponytail: the pet-panel window lacks vault-path fs ACL, so its own
  // `useVaultStore.refreshFileTree()` would fail and leave fileTree empty.
  // AiPanel's @-mention reads fileTree, so we mirror it from the main
  // window via the `pet://file-tree-updated` broadcast (emitted by
  // `startFileTreeBroadcast` in App.tsx on every fileTree change, debounced
  // ~300ms). Mirrors the `pet://settings-updated` listener pattern above.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen<{ currentVault: unknown; fileTree: unknown }>(
          'pet://file-tree-updated',
          (event) => {
            const payload = event.payload;
            if (!payload) return;
            useVaultStore.setState({
              currentVault: payload.currentVault as never,
              fileTree: payload.fileTree as never,
            });
          },
        );
      } catch (err) {
        console.warn('[pet-panel] file-tree-updated listener failed:', err);
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // ── Initial position/size restore ──
  // On mount, if a saved pos+size exists, restore it (clamped to the current
  // work area so a monitor change since the last session doesn't push the
  // panel off-screen). Otherwise fall back to `computePanelPosition` next to
  // the pet (first-ever open). The pet's left-click handler in PetApp.tsx
  // positions the panel before showing it on the *open* gesture, but the
  // panel frontend also restores on its own mount so a show-without-position
  // (e.g. dev reload) still lands sensibly.
  //
  // Order matters: SIZE is clamped first, then POSITION is clamped against
  // the clamped size. If position were clamped against the default 440×620
  // while the actual panel is larger, the bottom-right corner would slide
  // off-screen after a resize → close → reopen cycle.
  //
  // Version-gate: the saved size is only restored when its persisted
  // `petPanelSizeVersion` matches the current `PET_PANEL_SIZE_VERSION`
  // constant. A mismatch (e.g. the default size was bumped since the user
  // last opened the panel, or first-ever open with version 0) ignores the
  // saved size, applies the new default, and persists the new default +
  // version so subsequent opens are stable. Mirrors the open-gesture logic
  // in PetApp.tsx — kept in sync so a dev-reload mount path also migrates.
  //
  // Unit boundary: `petPanelX/Y` is saved in LOGICAL points (matches the
  // work-area math); `pet_panel_set_position` takes PHYSICAL px, so multiply
  // by `sf`. `probe.window_x/y` (first-open fallback) is physical — divide
  // by `sf` before passing to `computePanelPosition` (logical). Panel SIZE
  // is also stored/restored in LOGICAL points (mirrors the position link);
  // `pet_panel_set_size` takes PHYSICAL px, so multiply by `sf` here.
  //
  // Authority note: this mount-restore runs once when the webview loads, at
  // which point the panel window may still be HIDDEN (Tauri creates it
  // `visible: false`). On macOS, `set_size` / `set_position` on a hidden
  // NSPanel can be deferred by the window manager until the window is
  // ordered in, so this pre-show `set_size` is best-effort. The
  // authoritative size-set is the post-show re-assert in `PetApp.tsx`'s
  // `openOrTogglePetPanel` (it calls `pet_panel_set_size` again AFTER
  // `pet_panel_show`), which fires when the user clicks the pet to open the
  // panel. Don't add a `set_size` re-assert here — there's no `show()` call
  // in this mount path to follow.
  useEffect(() => {
    (async () => {
      if (!isTauri()) return;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const workArea = await invoke<PetWorkArea>('pet_get_work_area');
        const sf = workArea.scale_factor || 1;
        const {
          petPanelX,
          petPanelY,
          petPanelWidth,
          petPanelHeight,
          petPanelSizeVersion,
        } = usePetStore.getState();

        // 1. Resolve the SIZE (logical points). `resolvePanelSize` returns
        //    the clamped saved size when the version matches, or the current
        //    default when it doesn't (version mismatch / first-ever open).
        //    The clamped size is reused by `clampPanelPosition` so the
        //    position clamp respects the actual panel dimensions, not the
        //    default 440×620.
        const savedMatchesVersion = petPanelSizeVersion === PET_PANEL_SIZE_VERSION;
        const clampedSize = resolvePanelSize(
          { width: petPanelWidth, height: petPanelHeight },
          petPanelSizeVersion,
          workArea,
        );
        // Persist corrections: (a) version mismatch → write new default +
        //    new version; (b) version matched but clamp shrunk the saved
        //    size to fit the current work area → write the clamped value.
        if (
          !savedMatchesVersion ||
          petPanelWidth !== clampedSize.width ||
          petPanelHeight !== clampedSize.height
        ) {
          setPetPanelSize(clampedSize.width, clampedSize.height);
        }
        if (!savedMatchesVersion) {
          usePetStore.getState().setPetPanelSizeVersion(PET_PANEL_SIZE_VERSION);
        }
        await invoke('pet_panel_set_size', {
          width: Math.round(clampedSize.width * sf),
          height: Math.round(clampedSize.height * sf),
        });

        // 2. Clamp the saved POSITION against the clamped size (logical points).
        if (petPanelX >= 0 && petPanelY >= 0) {
          const pos = clampPanelPosition(
            { x: petPanelX, y: petPanelY },
            workArea,
            clampedSize,
          );
          if (pos.x !== petPanelX || pos.y !== petPanelY) {
            setPetPanelPosition(pos.x, pos.y);
          }
          await invoke('pet_panel_set_position', {
            x: Math.round(pos.x * sf),
            y: Math.round(pos.y * sf),
          });
        } else {
          // First-ever open: position next to the pet (probe gives pet pos
          // in PHYSICAL px — divide by `sf` to get logical for the math).
          // Pass the clamped size (which equals the defaults here, since
          // first-ever open has no saved size) so `computePanelPosition`
          // attaches the panel's actual corner to the pet icon.
          const probe = await invoke<PetCursorProbeResult>('pet_cursor_probe');
          // Read the current pet size so the panel anchor tracks the actual
          // mascot bounds (a small/ large pet shifts where the panel's corner
          // attaches). The pet window keeps its own store instance in sync
          // via the `pet://size-changed` listener in PetApp.
          const petSize = usePetStore.getState().petSize;
          const pos = computePanelPosition(
            { x: probe.window_x / sf, y: probe.window_y / sf },
            workArea,
            clampedSize,
            petSize,
          );
          await invoke('pet_panel_set_position', {
            x: Math.round(pos.x * sf),
            y: Math.round(pos.y * sf),
          });
          setPetPanelPosition(pos.x, pos.y);
        }
      } catch (err) {
        console.warn('[pet-panel] restore pos/size failed:', err);
      }
    })();
  }, [setPetPanelPosition, setPetPanelSize]);

  // ── Position + size persistence poll ──
  // Native drag and OS edge-resize don't deliver reliable JS pointerup, so
  // poll the window's outer position + size every ~800ms (mirrors the pet
  // window's persist pattern) and persist when either changes. Uses the
  // custom Rust `pet_panel_get_*` commands so no extra ACL permission is
  // needed (custom invoke commands bypass the ACL).
  //
  // Unit boundary: `pet_panel_get_position` returns PHYSICAL px; the saved
  // `petPanelX/Y` is stored in LOGICAL points (matches the work-area math at
  // restore), so divide by `sf` before persisting. `sf` is cached once from
  // `pet_get_work_area` (a single-monitor panel window never changes DPI).
  // Panel SIZE is also persisted in LOGICAL points (mirrors position): divide
  // by `sf` before `setPetPanelSize` so the saved value matches the logical
  // work-area math at restore.
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let lastX = -1;
    let lastY = -1;
    let lastW = -1;
    let lastH = -1;
    let sf = 1;

    const persist = async () => {
      if (cancelled) return;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        if (sf === 1) {
          const wa = await invoke<PetWorkArea>('pet_get_work_area');
          sf = wa.scale_factor || 1;
        }
        const pos = await invoke<{ x: number; y: number }>('pet_panel_get_position');
        const size = await invoke<PetPanelSizePayload>('pet_panel_get_size');
        const x = Math.round(pos.x / sf);
        const y = Math.round(pos.y / sf);
        const w = Math.round(size.width / sf);
        const h = Math.round(size.height / sf);
        if (x !== lastX || y !== lastY) {
          lastX = x;
          lastY = y;
          usePetStore.getState().setPetPanelPosition(x, y);
        }
        if (w !== lastW || h !== lastH) {
          lastW = w;
          lastH = h;
          usePetStore.getState().setPetPanelSize(w, h);
          // Keep the persisted version in sync with the persisted size so
          // the open gesture / mount-restore respect the user-resized size
          // on next open. Without this, a user resize after a default-bump
          // migration would still be ignored next open (version mismatch).
          usePetStore.getState().setPetPanelSizeVersion(PET_PANEL_SIZE_VERSION);
        }
      } catch {
        // Non-fatal; try again next tick.
      }
    };

    const id = window.setInterval(persist, PANEL_PERSIST_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // ── Drag handle ──
  // Left-button pointerdown on the header starts a native window drag via
  // `getCurrentWindow().startDragging()`. The close button stops propagation
  // so clicking it never triggers a drag. `core:window:allow-start-dragging`
  // is granted in `capabilities/pet-panel.json`. The `e.button == null`
  // short-circuit lets environments that don't surface a `button` property
  // (e.g. jsdom tests) still exercise the handler; real pointer events always
  // carry `button` so production semantics (left-button only) are unchanged.
  const headerPointerDown = useCallback(async (e: React.PointerEvent) => {
    if (e.button != null && e.button !== 0) return;
    if (!isTauri()) return;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().startDragging();
    } catch (err) {
      console.warn('[pet-panel] startDragging failed:', err);
    }
  }, []);

  const suppressDrag = useCallback((e: React.PointerEvent) => {
    // Prevent the header drag handler from firing on interactive children
    // (close button, tabs). Same stopPropagation for both.
    e.stopPropagation();
  }, []);

  return (
    <div className={`pet-panel-root${isVisible ? ' is-visible' : ''}`}>
      <header
        className="pet-panel-header"
        onPointerDown={headerPointerDown}
        role="banner"
      >
        <nav
          className="pet-panel-tabs"
          role="tablist"
          aria-label="Pet panel sections"
          onPointerDown={suppressDrag}
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'chat'}
            className={`pet-panel-tab${tab === 'chat' ? ' is-active' : ''}`}
            onClick={() => setTab('chat')}
          >
            {t('pet:tabs.chat')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'actions'}
            className={`pet-panel-tab${tab === 'actions' ? ' is-active' : ''}`}
            onClick={() => setTab('actions')}
          >
            {t('pet:tabs.actions')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'inbox'}
            className={`pet-panel-tab${tab === 'inbox' ? ' is-active' : ''}`}
            onClick={() => setTab('inbox')}
          >
            {t('pet:tabs.inbox')}
          </button>
        </nav>
        <button
          type="button"
          className="pet-panel-close"
          aria-label="Close pet panel"
          onClick={() => void hidePanel()}
          onPointerDown={suppressDrag}
        >
          ×
        </button>
      </header>
      <main className="pet-panel-body">
        {tab === 'chat' ? <AiPanel embedded /> : tab === 'actions' ? <PetLauncher /> : <PetInbox />}
      </main>
    </div>
  );
}
