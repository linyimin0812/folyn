import { useCallback, useEffect, useRef, useState } from 'react';
import { PetMascot } from './PetMascot';
import { openPetContextMenu } from './PetContextMenu';
import { petSizeToPx } from './petPosition';
import { openOrTogglePetPanel, openPetPanelAtCursor } from './petPanelWindow';
import { usePetPositionPersist } from './usePetPositionPersist';
import { usePetWindowLaunch } from './usePetWindowLaunch';
import { usePetWindowSync } from './usePetWindowSync';
import { keysToAccelerator } from '@/utils/shortcutAccelerator';
import { isTauri } from '@/utils/platform';
import { usePetStore } from '@/store/petStore';
import { usePrefsStore } from '@/store/prefsStore';

/**
 * PetApp — mounted only in the `pet` Tauri window (see main.tsx `#/pet` route
 * switch). Renders the ink-drop + folyn mascot and wires up:
 *
 *  - State machine (idle/hover/drag/click) — D4, R2.
 *  - Single click → open the pet-panel quick-action window
 *    (`openOrTogglePetPanel`, see `petPanelWindow.ts`): a second Tauri
 *    window (`pet-panel`) with a launcher grid + embedded AI chat.
 *    Position is clamped next to the pet via `computePanelPosition` /
 *    `pet_get_work_area`. A second click (or × / Esc) hides the panel.
 *    Skipped while the main window is fullscreen.
 *  - Right-click → native context menu (D8, R3, AC5), kept for muscle
 *    memory + power-user access. Built Rust-side (`pet_show_context_menu`)
 *    because the 120x120 pet window would clip an HTML menu (issue #1);
 *    selections emit `pet://menu-action`.
 *  - Drag → `startDragging` on the pet window; position persisted to
 *    `petStore` (R5, AC3/AC7) — see `usePetPositionPersist`.
 *  - Always visible: the pet stays on-screen at all times, including over
 *    fullscreen apps / VS Code. The previous fullscreen-auto-hide probe was
 *    removed — the user wants the pet always visible. `pet_set_topmost_level`
 *    (kCGScreenSaverWindowLevelKey = 13) is re-applied on the ~800ms
 *    position-persist poll because the OS can reset the level after a `show()`.
 *  - Launch-time position-restore + show: `usePetWindowLaunch`.
 *  - Cross-window settings/icon/locale/size sync: `usePetWindowSync`.
 *
 * Click-through on transparent regions was REMOVED. The prior 60ms probe +
 * 80×80 sprite hit-test raced with native drag end: after a drag the cursor
 * often rested in the 20px transparent border, the next probe tick flipped
 * `setIgnoreCursorEvents(true)`, and the next click passed through the
 * window without firing `handlePointerDown` — so the pet could be dragged
 * once and then stuck. The trade-off: the transparent border no longer
 * passes clicks to apps behind the pet (small UX cost); in exchange, drag
 * and click are 100% reliable. See `tauri-window-patterns.md` for the
 * contract.
 *
 * Click-vs-drag detection is now movement-threshold based (pointermove ≥4px
 * → drag; clean pointerup with <4px movement → click), not the old
 * pointerdown+window-position-delta approach — the latter misclassified
 * drags as clicks after the NSPanel swap because `startDragging()` +
 * `outerPosition()` no longer reliably reflect the drag delta.
 */

type PetState = 'idle' | 'hover' | 'drag' | 'click';

/** Pet window size is user-selectable (50/75/100/125/150 %). The sprite
 *  layer reads `petSize` from petStore and scales to match the Tauri
 *  window size (kept in sync by the Rust `set_pet_size` command). The
 *  mascot SVG inside is 75% of this value (see `mascotSizeForPetSize`).
 *  MUST stay in sync with `PET_SIZE_TO_PX` in `petPosition.ts` and the
 *  `pet` window size in `tauri.conf.json` (which is the 100 default,
 *  overridden at mount via `set_pet_size`). */
const SPRITE_OFFSET = 0;

export function PetApp() {
  const [state, setState] = useState<PetState>('idle');
  // Removed: `draggingRef` is still tracked so the state-machine callbacks
  // (hover/leave) know not to clobber 'drag' while native drag is in flight.
  const draggingRef = useRef(false);

  // Pet size level — drives the sprite layer size (inline style below) and
  // is synced to the Tauri window via `set_pet_size` (invoked on mount to
  // restore the persisted level, and re-applied when the main window emits
  // `pet://size-changed`). The mascot SVG inside reads the same value via
  // `PetMascot`'s `size` prop.
  const petSize = usePetStore((s) => s.petSize);
  const spriteSize = petSizeToPx(petSize);

  // Persisted keys for the global pet-panel toggle shortcut. Subscribed (not
  // getState) so this updates when the pet window's own store instance
  // hydrates from the `pet://settings-updated` broadcast — which arrives
  // AFTER mount (the main window answers `pet://settings-request` once its
  // own loadSettings finishes) — and on every user rebind. The register
  // effect below re-registers the OS accelerator on each change.
  const toggleKeys = usePrefsStore((s) => s.shortcuts.find((x) => x.id === 'togglePetPanel')?.keys);

  // ── Window lifecycle: position persist + topmost, launch show, sync ──
  usePetPositionPersist();
  usePetWindowLaunch();
  usePetWindowSync();

  // ── State machine: mouse event handlers ──
  // ponytail: the hand cursor on hover is now set by the Rust-side
  // NSTrackingArea (ActiveAlways + cursorUpdate) on the FolynPetPanel — see
  // pet_panel_macos.rs. The previous `invoke('pet_set_cursor')` calls didn't
  // stick when another app owned the cursor (the nonactivating panel isn't
  // key until clicked). The tracking area delivers cursorUpdate even when
  // Folyn isn't frontmost. The `pet_set_cursor` Rust command is kept as a
  // fallback.
  const handleMouseEnter = useCallback(() => {
    if (draggingRef.current) return;
    setState((s) => (s === 'idle' || s === 'hover' ? 'hover' : s));
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (draggingRef.current) return;
    setState((s) => (s === 'hover' ? 'idle' : s));
  }, []);

  // Track an in-progress pointer gesture to distinguish a click from a drag.
  // `becameDrag` flips true once the pointer moves past the threshold, which
  // gates BOTH the native drag start AND the panel-open on pointerup — drag
  // and click are mutually exclusive (a drag never opens the panel).
  const pointerStartRef = useRef<{ x: number; y: number; id: number; becameDrag: boolean } | null>(null);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Right-click (button 2) opens the context menu; let the contextmenu
    // handler do the work to avoid duplicate menu opens.
    if (e.button === 2) return;
    if (e.button !== 0) return;

    pointerStartRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId, becameDrag: false };
    // Capture so move/up fire on this element even if the cursor leaves it.
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback(async (e: React.PointerEvent) => {
    const st = pointerStartRef.current;
    if (!st || st.becameDrag || st.id !== e.pointerId) return;

    const dx = Math.abs(e.clientX - st.x);
    const dy = Math.abs(e.clientY - st.y);
    // Below the threshold the gesture is still a candidate click — do nothing.
    if (dx < 4 && dy < 4) return;

    // Movement past the threshold → this is a drag, not a click. Start the
    // native drag; the panel will NOT open (drag and click are mutually
    // exclusive, satisfying "移动时不要显示页面，只有点击时才显示").
    st.becameDrag = true;
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

    // Persist the new position immediately so AC7 holds even if the periodic
    // poller hasn't fired yet. `outerPosition()` returns PHYSICAL px; divide
    // by `scaleFactor` to store LOGICAL points (display-resolution-independent,
    // matches the work-area math). The poller below caches `sf` once and does
    // the same conversion.
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const after = await getCurrentWindow().outerPosition();
      const sf = (await getCurrentWindow().scaleFactor()) || 1;
      const { usePetStore } = await import('@/store/petStore');
      usePetStore.getState().setPetPosition(
        Math.round(after.x / sf),
        Math.round(after.y / sf),
      );
    } catch {
      // Non-fatal; the periodic poller will catch up.
    }
    setState('idle');
  }, []);

  const handlePointerUp = useCallback(async (e: React.PointerEvent) => {
    const st = pointerStartRef.current;
    if (!st || st.id !== e.pointerId) return;
    pointerStartRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // pointer capture may already be released — ignore.
    }

    // If a drag started, the native drag handled the gesture — do NOT open
    // the panel. Only a clean click (pointerdown→up with <4px movement) opens
    // the pet-panel quick-action window.
    if (st.becameDrag) return;

    // Single-click mascot = open the pet-panel quick-action window.
    // Right-click still opens the native context menu (handleContextMenu
    // below) for muscle-memory + power-user access. The NSPanel panel shows
    // over fullscreen apps too, so no fullscreen guard here.
    setState('click');
    window.setTimeout(() => setState('idle'), 320);
    await openOrTogglePetPanel();
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    void openPetContextMenu();
  }, []);

  // ── Global shortcut: toggle pet-panel from any app ──
  // Rust's `tauri_plugin_global_shortcut` handler emits `pet://shortcut-toggle`
  // on every Pressed event (see lib.rs extension build). Two effects:
  //
  //   1. REGISTER the toggle accelerator with the OS, re-running whenever the
  //      persisted `toggleKeys` change. This is crucial because the `pet`
  //      window holds its own store instance that hydrates from the
  //      cross-window `pet://settings-updated` broadcast AFTER mount. The
  //      first run reads pre-hydration DEFAULTS; once the broadcast arrives
  //      (and on every user rebind) the effect re-registers the persisted
  //      combo. Without this, a Windows user whose persisted toggle is
  //      `Win+Shift+Q` would have the DEFAULT `Ctrl+Shift+Q` registered at
  //      startup → the shortcut silently fails until they re-record it.
  //      macOS hides the bug: the default `⌘+Shift+Q` usually matches what
  //      the user persisted, so the stale registration happens to bind the
  //      right combo.
  //
  //   2. LISTEN for `pet://shortcut-toggle` and call `openPetPanelAtCursor`.
  //      Runs once on mount — the listener is key-combo-agnostic, so it
  //      needs no re-registration when keys change.
  //
  // Mounted in the `pet` window (always alive while pet mode is on) so both
  // survive across main-window hide/show. Wrapped in isTauri + try/catch so
  // non-Tauri/test envs skip them. The accelerator stays registered at the OS
  // level after unmount (Tauri process exit unregisters it).
  useEffect(() => {
    if (!isTauri() || !toggleKeys) return;
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const accelerator = keysToAccelerator(toggleKeys);
        await invoke('pet_panel_set_shortcut', { accelerator });
        console.info('[pet] global shortcut registered:', accelerator);
      } catch (err) {
        console.warn('[pet] global shortcut register failed:', err);
      }
    })();
  }, [toggleKeys]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen('pet://shortcut-toggle', () => {
          console.info('[pet] pet://shortcut-toggle event received');
          void openPetPanelAtCursor();
        });
      } catch (err) {
        console.warn('[pet] shortcut-toggle listen failed:', err);
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  return (
    <div className="pet-root">
      {/* The mascot sprite is wrapped in an interaction layer that owns all
          mouse handlers. CSS keyframes on `.pet-mascot` drive the animations,
          including the breathing `scale` self-pulse on the icon (see
          pet.css). No surrounding glow layer. */}
      <div
        className="pet-sprite-layer"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onContextMenu={handleContextMenu}
        style={{
          position: 'absolute',
          left: SPRITE_OFFSET,
          top: SPRITE_OFFSET,
          width: spriteSize,
          height: spriteSize,
          cursor: 'pointer',
        }}
        aria-label="Folyn desktop pet"
        role="button"
      >
        <PetMascot state={state} size={petSize} />
      </div>
    </div>
  );
}
