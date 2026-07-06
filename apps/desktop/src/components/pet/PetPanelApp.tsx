import { useCallback, useEffect, useState } from 'react';
import { isTauri } from '@/utils/platform';
import { useSettingsStore } from '@/store/settingsStore';
import {
  clampPanelPosition,
  clampPanelSize,
  computePanelPosition,
  PET_PANEL_WIDTH,
  PET_PANEL_HEIGHT,
  type PetWorkArea,
} from './petPosition';
import { PetLauncher } from './PetLauncher';
import { PetChat } from './PetChat';

type PetPanelTab = 'actions' | 'chat';

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
 *    size are persisted to `settingsStore` (`petPanelX/Y/Width/Height`) via
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
  const [tab, setTab] = useState<PetPanelTab>('actions');
  const setPetPanelPosition = useSettingsStore((s) => s.setPetPanelPosition);
  const setPetPanelSize = useSettingsStore((s) => s.setPetPanelSize);

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

  // ── Initial position/size restore ──
  // On mount, if a saved pos+size exists, restore it (clamped to the current
  // work area so a monitor change since the last session doesn't push the
  // panel off-screen). Otherwise fall back to `computePanelPosition` next to
  // the pet (first-ever open). The pet's left-click handler in PetApp.tsx
  // positions the panel before showing it on the *open* gesture, but the
  // panel frontend also restores on its own mount so a show-without-position
  // (e.g. dev reload) still lands sensibly.
  useEffect(() => {
    (async () => {
      if (!isTauri()) return;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const workArea = await invoke<PetWorkArea>('pet_get_work_area');
        const {
          petPanelX,
          petPanelY,
          petPanelWidth,
          petPanelHeight,
        } = useSettingsStore.getState();

        if (petPanelX >= 0 && petPanelY >= 0) {
          const pos = clampPanelPosition({ x: petPanelX, y: petPanelY }, workArea);
          if (pos.x !== petPanelX || pos.y !== petPanelY) {
            setPetPanelPosition(pos.x, pos.y);
          }
          await invoke('pet_panel_set_position', { x: pos.x, y: pos.y });
        } else {
          // First-ever open: position next to the pet (probe gives pet pos).
          const probe = await invoke<PetCursorProbeResult>('pet_cursor_probe');
          const pos = computePanelPosition(
            { x: probe.window_x, y: probe.window_y },
            workArea,
          );
          await invoke('pet_panel_set_position', { x: pos.x, y: pos.y });
          setPetPanelPosition(pos.x, pos.y);
        }

        if (petPanelWidth > 0 && petPanelHeight > 0) {
          const size = clampPanelSize(
            { width: petPanelWidth, height: petPanelHeight },
            workArea,
          );
          if (size.width !== petPanelWidth || size.height !== petPanelHeight) {
            setPetPanelSize(size.width, size.height);
          }
          await invoke('pet_panel_set_size', {
            width: size.width,
            height: size.height,
          });
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
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let lastX = -1;
    let lastY = -1;
    let lastW = -1;
    let lastH = -1;

    const persist = async () => {
      if (cancelled) return;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const pos = await invoke<{ x: number; y: number }>('pet_panel_get_position');
        const size = await invoke<PetPanelSizePayload>('pet_panel_get_size');
        const x = Math.round(pos.x);
        const y = Math.round(pos.y);
        const w = Math.round(size.width);
        const h = Math.round(size.height);
        if (x !== lastX || y !== lastY) {
          lastX = x;
          lastY = y;
          useSettingsStore.getState().setPetPanelPosition(x, y);
        }
        if (w !== lastW || h !== lastH) {
          lastW = w;
          lastH = h;
          useSettingsStore.getState().setPetPanelSize(w, h);
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

  const handleClosePointerDown = useCallback((e: React.PointerEvent) => {
    // Prevent the header drag handler from firing on the close button.
    e.stopPropagation();
  }, []);

  return (
    <div className="pet-panel-root">
      <header
        className="pet-panel-header"
        onPointerDown={headerPointerDown}
        role="banner"
      >
        <span className="pet-panel-title">Quick Actions</span>
        <button
          type="button"
          className="pet-panel-close"
          aria-label="Close pet panel"
          onClick={() => void hidePanel()}
          onPointerDown={handleClosePointerDown}
        >
          ×
        </button>
      </header>
      <nav className="pet-panel-tabs" role="tablist" aria-label="Pet panel sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'actions'}
          className={`pet-panel-tab${tab === 'actions' ? ' is-active' : ''}`}
          onClick={() => setTab('actions')}
        >
          Actions
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'chat'}
          className={`pet-panel-tab${tab === 'chat' ? ' is-active' : ''}`}
          onClick={() => setTab('chat')}
        >
          Chat
        </button>
      </nav>
      <main className="pet-panel-body">
        {tab === 'actions' ? <PetLauncher /> : <PetChat />}
      </main>
    </div>
  );
}

// Re-export so callers can reference the canonical default panel size
// (declared in `petPosition.ts`) without an extra import hop.
export { PET_PANEL_WIDTH, PET_PANEL_HEIGHT };
