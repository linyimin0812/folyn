import { useCallback, useEffect, useRef, useState } from 'react';
import { PetMascot } from './PetMascot';
import { openPetContextMenu, type PetMenuAction } from './PetContextMenu';
import { computeDefaultPetPosition } from './petPosition';

/**
 * PetApp — mounted only in the `pet` Tauri window (see main.tsx `#/pet` route
 * switch). Renders the ink-drop + quill mascot and wires up:
 *
 *  - State machine (idle/hover/drag/click) — D4, R2.
 *  - Single click → focus the main editor window (D5, R3, AC4) via the
 *    `pet://menu-action` Tauri event consumed by the main window.
 *  - Right-click → native context menu (D8, R3, AC5). The menu is built
 *    Rust-side (`pet_show_context_menu`) because the 120x120 pet window
 *    would clip an HTML menu (issue #1); selections emit `pet://menu-action`.
 *  - Drag → `startDragging` on the pet window; position persisted to
 *    `settingsStore` (R5, AC3/AC7).
 *  - Click-through on transparent regions (R6, AC8) — periodic
 *    `pet_cursor_probe` toggles `setIgnoreCursorEvents`.
 *  - Fullscreen handling (R7, AC9) — hide when the main window is fullscreen.
 */

type PetState = 'idle' | 'hover' | 'drag' | 'click';

/** Sprite occupies the center 80x80 of the 120x120 pet window. */
const SPRITE_OFFSET = 20;
const SPRITE_SIZE = 80;
const PROBE_INTERVAL_MS = 250;
const POSITION_PERSIST_INTERVAL_MS = 800;

interface PetCursorProbeResult {
  cursor_x: number;
  cursor_y: number;
  window_x: number;
  window_y: number;
  main_fullscreen: boolean;
}

export function PetApp() {
  const [state, setState] = useState<PetState>('idle');
  // While dragging, click-through must stay off so the window keeps receiving
  // the events it needs. The native right-click menu is rendered by the OS,
  // so it doesn't need click-through gating on the pet window.
  const draggingRef = useRef(false);
  const ignoreRef = useRef(false);

  // ── Emit a menu action to the main window ──
  const emitAction = useCallback(async (action: PetMenuAction) => {
    const { emit } = await import('@tauri-apps/api/event');
    await emit('pet://menu-action', { action });
  }, []);

  // ── State machine: mouse event handlers ──
  const handleMouseEnter = useCallback(() => {
    if (draggingRef.current) return;
    setState((s) => (s === 'idle' || s === 'hover' ? 'hover' : s));
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (draggingRef.current) return;
    setState((s) => (s === 'hover' ? 'idle' : s));
  }, []);

  const handlePointerDown = useCallback(async (e: React.PointerEvent) => {
    // Right-click (button 2) opens the context menu; let the contextmenu
    // handler do the work to avoid duplicate menu opens.
    if (e.button === 2) return;
    if (e.button !== 0) return;

    // Record the window position before the native drag starts. After
    // startDragging() resolves we compare: if the window barely moved, the
    // gesture was a click (not a drag) — we then fire the single-click
    // action (focus main window). Native drag consumes mouseup/click, so we
    // cannot rely on a separate onClick handler.
    let beforeX = 0;
    let beforeY = 0;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const before = await getCurrentWindow().outerPosition();
      beforeX = Math.round(before.x);
      beforeY = Math.round(before.y);
    } catch {
      // If we can't read the position, fall back to treating as a click.
    }

    draggingRef.current = true;
    setState('drag');
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().startDragging();
    } catch (err) {
      // startDragging can fail if the platform doesn't support it; fall back
      // to a no-op drag so the click-through + state machine still work.
      console.warn('[pet] startDragging failed:', err);
    }
    // Native drag returns when the user releases the mouse.
    draggingRef.current = false;

    let afterX = beforeX;
    let afterY = beforeY;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const after = await getCurrentWindow().outerPosition();
      afterX = Math.round(after.x);
      afterY = Math.round(after.y);
    } catch {
      // ignore — treat as no-move
    }

    const dx = Math.abs(afterX - beforeX);
    const dy = Math.abs(afterY - beforeY);
    const wasClick = dx < 5 && dy < 5;

    if (wasClick) {
      // Single-click mascot = focus/show the main window (D5, R3, AC4).
      setState('click');
      window.setTimeout(() => setState('idle'), 320);
      void emitAction('show-main');
    } else {
      // Drag ended — persist the new position immediately so AC7 holds even
      // if the periodic poller hasn't fired yet.
      try {
        const { useSettingsStore } = await import('@/store/settingsStore');
        useSettingsStore.getState().setPetPosition(afterX, afterY);
      } catch {
        // Non-fatal; the periodic poller will catch up.
      }
      setState('idle');
    }
  }, [emitAction]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    // Native OS popup menu (issue #1): the pet window is 120x120, so an HTML
    // menu would be clipped. The menu is built Rust-side; selections emit
    // `pet://menu-action`, which App.tsx already listens for. The native
    // menu handles its own dismiss (Escape / outside-click) so we don't need
    // a `menuOpen` flag here.
    void openPetContextMenu();
  }, []);

  // ── Click-through + fullscreen probe (periodic) ──
  useEffect(() => {
    let cancelled = false;

    const probe = async () => {
      if (cancelled) return;
      let result: PetCursorProbeResult;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        result = await invoke<PetCursorProbeResult>('pet_cursor_probe');
      } catch (err) {
        // Probe failure is non-fatal — keep the window interactive (ignore off).
        if (!cancelled && ignoreRef.current) {
          ignoreRef.current = false;
        }
        return;
      }
      if (cancelled) return;

      // Fullscreen handling (R7/AC9): hide the pet while the main window is
      // fullscreen. We do NOT close the window — just hide() so the saved
      // position + visibility preference are preserved.
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const win = getCurrentWindow();
        if (result.main_fullscreen) {
          const visible = await win.isVisible();
          if (visible) await win.hide();
          return; // stay hidden while fullscreen; don't toggle click-through.
        } else {
          const visible = await win.isVisible();
          if (!visible) await win.show();
        }
      } catch {
        // Non-fatal; continue to click-through logic.
      }

      // Click-through (R6/AC8): when the cursor is outside the sprite's
      // rect, set ignore=true so transparent regions pass clicks through.
      // The sprite is at (SPRITE_OFFSET, SPRITE_OFFSET) within the window.
      const relX = result.cursor_x - result.window_x;
      const relY = result.cursor_y - result.window_y;
      const overSprite =
        relX >= SPRITE_OFFSET &&
        relX <= SPRITE_OFFSET + SPRITE_SIZE &&
        relY >= SPRITE_OFFSET &&
        relY <= SPRITE_OFFSET + SPRITE_SIZE;

      const wantIgnore = !overSprite && !draggingRef.current;
      if (wantIgnore !== ignoreRef.current) {
        ignoreRef.current = wantIgnore;
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          await getCurrentWindow().setIgnoreCursorEvents(wantIgnore);
        } catch {
          // Best-effort: if the platform refuses, leave the window as-is.
        }
      }
    };

    const id = window.setInterval(probe, PROBE_INTERVAL_MS);
    probe();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // ── Position persistence (R5, AC7) ──
  // Periodically read the window's outer position and persist it to
  // settingsStore when it changes. Native drag doesn't deliver JS pointerup
  // reliably, so polling is the robust path.
  useEffect(() => {
    let cancelled = false;
    let lastX = -1;
    let lastY = -1;

    const persist = async () => {
      if (cancelled) return;
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const pos = await getCurrentWindow().outerPosition();
        // outerPosition returns a PhysicalPosition; values may be floats on
        // some platforms — round for stable comparison.
        const x = Math.round(pos.x);
        const y = Math.round(pos.y);
        if (x !== lastX || y !== lastY) {
          lastX = x;
          lastY = y;
          const { useSettingsStore } = await import('@/store/settingsStore');
          useSettingsStore.getState().setPetPosition(x, y);
        }
      } catch {
        // Non-fatal; try again next tick.
      }
    };

    const id = window.setInterval(persist, POSITION_PERSIST_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // ── Initial position restore (R5, AC7) ──
  // On mount, move the pet window to its saved position (or a sensible
  // bottom-right default on first launch).
  useEffect(() => {
    (async () => {
      try {
        const { useSettingsStore } = await import('@/store/settingsStore');
        const { petPositionX, petPositionY } = useSettingsStore.getState();
        const { invoke } = await import('@tauri-apps/api/core');
        if (petPositionX >= 0 && petPositionY >= 0) {
          await invoke('set_pet_position', { x: petPositionX, y: petPositionY });
        } else {
          // Default: bottom-right corner of the primary monitor.
          // `monitor.size` is physical px and `set_pet_position` expects
          // physical px (Rust `PhysicalPosition`) — do NOT divide by
          // scaleFactor (that produced logical px and misplaced the window
          // on retina displays). See `tauri-window-patterns.md`.
          const { currentMonitor } = await import('@tauri-apps/api/window');
          const monitor = await currentMonitor();
          if (monitor) {
            const { x, y } = computeDefaultPetPosition({
              width: monitor.size.width,
              height: monitor.size.height,
            });
            await invoke('set_pet_position', { x, y });
            useSettingsStore.getState().setPetPosition(x, y);
          }
        }
      } catch {
        // Non-fatal; the window just stays at its creation position.
      }
    })();
  }, []);

  return (
    <div className="pet-root">
      {/* The mascot sprite is wrapped in an interaction layer that owns all
          mouse handlers. CSS keyframes on `.pet-mascot` drive the animations. */}
      <div
        className="pet-sprite-layer"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onPointerDown={handlePointerDown}
        onContextMenu={handleContextMenu}
        style={{
          position: 'absolute',
          left: SPRITE_OFFSET,
          top: SPRITE_OFFSET,
          width: SPRITE_SIZE,
          height: SPRITE_SIZE,
          cursor: 'grab',
        }}
        aria-label="Quill desktop pet"
        role="button"
      >
        <PetMascot state={state} />
      </div>
    </div>
  );
}
