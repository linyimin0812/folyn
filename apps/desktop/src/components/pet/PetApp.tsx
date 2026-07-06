import { useCallback, useEffect, useRef, useState } from 'react';
import { PetMascot } from './PetMascot';
import { openPetContextMenu } from './PetContextMenu';
import { clampPetPosition, computeDefaultPetPosition, computePanelPosition } from './petPosition';

/**
 * PetApp — mounted only in the `pet` Tauri window (see main.tsx `#/pet` route
 * switch). Renders the ink-drop + quill mascot and wires up:
 *
 *  - State machine (idle/hover/drag/click) — D4, R2.
 *  - Single click → open the pet-panel quick-action window
 *    (`openOrTogglePetPanel`): a second Tauri window (`pet-panel`) with a
 *    launcher grid + embedded AI chat. Position is clamped next to the pet
 *    via `computePanelPosition` / `pet_get_work_area`. A second click (or
 *    × / Esc) hides the panel. Skipped while the main window is fullscreen.
 *  - Right-click → native context menu (D8, R3, AC5), kept for muscle
 *    memory + power-user access. Built Rust-side (`pet_show_context_menu`)
 *    because the 120x120 pet window would clip an HTML menu (issue #1);
 *    selections emit `pet://menu-action`.
 *  - Drag → `startDragging` on the pet window; position persisted to
 *    `settingsStore` (R5, AC3/AC7).
 *  - Fullscreen handling (R7, AC9) — hide when the main window is fullscreen.
 *
 * Click-through on transparent regions was REMOVED. The prior 60ms probe +
 * 80×80 sprite hit-test raced with native drag end: after a drag the cursor
 * often rested in the 20px transparent border, the next probe tick flipped
 * `setIgnoreCursorEvents(true)`, and the next click passed through the
 * window without firing `handlePointerDown` — so the pet could be dragged
 * once and then stuck. The trade-off: the transparent border no longer
 * passes clicks to apps behind the pet (small UX cost); in exchange, drag
 * and click are 100% reliable. The probe still runs, only for fullscreen
 * detection. See `tauri-window-patterns.md` for the contract.
 */

type PetState = 'idle' | 'hover' | 'drag' | 'click';

/** Sprite fills the full 120x120 pet window — no transparent margin around
 * the quill icon. The breathing glow sits behind it as a separate layer. */
const SPRITE_OFFSET = 0;
const SPRITE_SIZE = 120;
const PROBE_INTERVAL_MS = 250;
const POSITION_PERSIST_INTERVAL_MS = 800;

interface PetCursorProbeResult {
  cursor_x: number;
  cursor_y: number;
  window_x: number;
  window_y: number;
  main_fullscreen: boolean;
}

interface PetWorkAreaResult {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Open the pet-panel quick-action window next to the pet, or hide it if it is
 * already visible (R8 toggle). Skipped while the main window is fullscreen
 * (R4) — the probe's `main_fullscreen` field is checked first.
 *
 * Positioning: if a saved `petPanelX/Y` exists (user has dragged the panel
 * before), restore that position (clamped to the work area) so the panel
 * reappears where the user left it instead of snapping back to the pet's
 * corner. On the first-ever open (no saved pos), fall back to
 * `computePanelPosition` next to the pet. Likewise restore a saved size if
 * present so a user-resized panel keeps its size across opens. All window
 * mutation goes through Rust `invoke` commands so the ACL contract is
 * satisfied (custom commands bypass the ACL; the panel window still has
 * `capabilities/pet-panel.json` for its own `@tauri-apps/api/window` calls
 * — `startDragging`, `outerPosition`).
 */
async function openOrTogglePetPanel(): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');

    // Fullscreen guard (R4): skip while the main editor is fullscreen.
    const probe = await invoke<PetCursorProbeResult>('pet_cursor_probe');
    if (probe.main_fullscreen) return;

    // Toggle: if the panel is already visible, hide it (R8 second-click).
    const visible = await invoke<boolean>('pet_panel_is_visible');
    if (visible) {
      await invoke('pet_panel_hide');
      return;
    }

    const workArea = await invoke<PetWorkAreaResult>('pet_get_work_area');

    // Restore a saved size first so the position clamp uses the right
    // footprint. (clampPanelPosition uses the default PET_PANEL_WIDTH/HEIGHT
    // — that's fine for a clamp: a smaller saved size only means more slack.)
    const { useSettingsStore } = await import('@/store/settingsStore');
    const { petPanelX, petPanelY, petPanelWidth, petPanelHeight } =
      useSettingsStore.getState();

    if (petPanelWidth > 0 && petPanelHeight > 0) {
      const { clampPanelSize } = await import('./petPosition');
      const size = clampPanelSize(
        { width: petPanelWidth, height: petPanelHeight },
        { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height },
      );
      await invoke('pet_panel_set_size', { width: size.width, height: size.height });
    }

    // Position: restore saved (clamped) or fall back to next-to-pet.
    let panelPos: { x: number; y: number };
    if (petPanelX >= 0 && petPanelY >= 0) {
      const { clampPanelPosition } = await import('./petPosition');
      panelPos = clampPanelPosition(
        { x: petPanelX, y: petPanelY },
        { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height },
      );
      if (panelPos.x !== petPanelX || panelPos.y !== petPanelY) {
        useSettingsStore.getState().setPetPanelPosition(panelPos.x, panelPos.y);
      }
    } else {
      const petPos = { x: probe.window_x, y: probe.window_y };
      panelPos = computePanelPosition(petPos, workArea);
      useSettingsStore.getState().setPetPanelPosition(panelPos.x, panelPos.y);
    }

    // Position the panel before showing so it appears at the right spot in
    // one frame (avoids a flash at the default position).
    await invoke('pet_panel_set_position', { x: panelPos.x, y: panelPos.y });
    await invoke('pet_panel_show');
  } catch (err) {
    console.warn('[pet] openOrTogglePetPanel failed:', err);
  }
}

export function PetApp() {
  const [state, setState] = useState<PetState>('idle');
  // Removed: `draggingRef` is still tracked so the state-machine callbacks
  // (hover/leave) know not to clobber 'drag' while native drag is in flight.
  const draggingRef = useRef(false);

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
    // gesture was a click (not a drag) — we then open the quick-action
    // menu. Native drag consumes mouseup/click, so we cannot rely on a
    // separate onClick handler.
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
      // Single-click mascot = open the pet-panel quick-action window (PR1).
      // Right-click still opens the native context menu (handleContextMenu
      // below) for muscle-memory + power-user access. The panel is shown via
      // `pet_panel_show` + `pet_panel_set_position`; if it is already visible
      // the click toggles it closed (R8). The panel is skipped while the main
      // window is fullscreen (R4) — re-use `pet_cursor_probe.main_fullscreen`.
      setState('click');
      window.setTimeout(() => setState('idle'), 320);
      await openOrTogglePetPanel();
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
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    void openPetContextMenu();
  }, []);

  // ── Fullscreen probe (periodic) ──
  // The probe no longer toggles `setIgnoreCursorEvents` — the whole 120x120
  // window receives pointer events at all times. The probe's only remaining
  // job is fullscreen detection: hide the pet while the main editor window is
  // fullscreen, re-show it when not.
  useEffect(() => {
    let cancelled = false;

    const probe = async () => {
      if (cancelled) return;
      let result: PetCursorProbeResult;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        result = await invoke<PetCursorProbeResult>('pet_cursor_probe');
      } catch {
        // Probe failure is non-fatal — leave visibility as-is.
        return;
      }
      if (cancelled) return;

      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const win = getCurrentWindow();
        if (result.main_fullscreen) {
          const visible = await win.isVisible();
          if (visible) await win.hide();
        } else {
          const visible = await win.isVisible();
          if (!visible) await win.show();
        }
      } catch {
        // Non-fatal; try again next tick.
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

  // ── Initial position restore (R5, AC7, R1/R2) ──
  // On mount, resolve the pet's initial position:
  //  - If a saved position exists, clamp it to the current work area. If the
  //    saved value was off-screen (e.g. from a previous monitor setup or a
  //    pre-fix default), the clamped value is persisted back so subsequent
  //    launches don't re-clamp.
  //  - Otherwise, compute the default bottom-right position from the work
  //    area (NSScreen.visibleFrame on macOS, excludes Dock + menu bar) and
  //    persist it.
  useEffect(() => {
    (async () => {
      try {
        const { useSettingsStore } = await import('@/store/settingsStore');
        const { invoke } = await import('@tauri-apps/api/core');
        const workArea = await invoke<PetWorkAreaResult>('pet_get_work_area');
        const { petPositionX, petPositionY } = useSettingsStore.getState();

        let resolved: { x: number; y: number };
        if (petPositionX >= 0 && petPositionY >= 0) {
          const clamped = clampPetPosition(
            { x: petPositionX, y: petPositionY },
            { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height },
          );
          // If clamping changed the value, persist the corrected position
          // so the next launch doesn't need to re-clamp.
          if (clamped.x !== petPositionX || clamped.y !== petPositionY) {
            useSettingsStore.getState().setPetPosition(clamped.x, clamped.y);
          }
          resolved = clamped;
        } else {
          // Default: bottom-right of the work area, plus the work area's
          // origin offset (work area is in physical px top-left origin,
          // same coordinate space as `set_pet_position`).
          const rel = computeDefaultPetPosition({
            width: workArea.width,
            height: workArea.height,
          });
          resolved = { x: workArea.x + rel.x, y: workArea.y + rel.y };
          useSettingsStore.getState().setPetPosition(resolved.x, resolved.y);
        }
        await invoke('set_pet_position', { x: resolved.x, y: resolved.y });
      } catch {
        // Non-fatal; the window just stays at its creation position.
      }
    })();
  }, []);

  return (
    <div className="pet-root">
      {/* The mascot sprite is wrapped in an interaction layer that owns all
          mouse handlers. CSS keyframes on `.pet-mascot` drive the animations,
          including the breathing `drop-shadow` halo around the dark tile
          (see pet.css). The glow is the mascot's own filter — no separate
          layer needed. */}
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
