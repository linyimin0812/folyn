import { useCallback, useEffect, useRef, useState } from 'react';
import { PetMascot } from './PetMascot';
import { openPetContextMenu } from './PetContextMenu';
import { clampPetPosition, computeDefaultPetPosition, computePanelPosition, computeCenteredPanelPosition, resolvePanelSize, PET_PANEL_SIZE_VERSION, petSizeToPx } from './petPosition';
import { keysToAccelerator } from '@/utils/shortcutAccelerator';
import { isTauri } from '@/utils/platform';
import { useSettingsStore } from '@/store/settingsStore';

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
 *  - Always visible: the pet stays on-screen at all times, including over
 *    fullscreen apps / VS Code. The previous fullscreen-auto-hide probe was
 *    removed — the user wants the pet always visible. `pet_set_topmost_level`
 *    (kCGScreenSaverWindowLevelKey = 13) is re-applied on the ~800ms
 *    position-persist poll because the OS can reset the level after a `show()`.
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

/** Pet window size is now user-selectable (small/medium/large). The sprite
 *  layer reads `petSize` from settingsStore and scales to match the Tauri
 *  window size (kept in sync by the Rust `set_pet_size` command). The
 *  mascot SVG inside is 75% of this value (see `mascotSizeForPetSize`).
 *  MUST stay in sync with `PET_SIZE_TO_PX` in `petPosition.ts` and the
 *  `pet` window size in `tauri.conf.json` (which is the medium default,
 *  overridden at mount via `set_pet_size`). */
const SPRITE_OFFSET = 0;
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
  scale_factor: number;
}

/**
 * Resolve the panel size for an open, applying the version-gate migration
 * (saved size whose persisted `petPanelSizeVersion` mismatches the current
 * `PET_PANEL_SIZE_VERSION` is replaced with the new default, and the new
 * default + version are persisted so subsequent opens don't re-migrate).
 * Returns the resolved logical size. Shared by the click-open and
 * shortcut-open paths so they cannot drift on size-resolution behavior.
 *
 * Pure w.r.t. settingsStore + invoke('pet_panel_set_size'): no position
 * computation, no show, no post-show re-assert. Callers feed the returned
 * size into their own position computation + `applyPanelFrame`.
 */
async function resolveAndPersistPanelSize(workArea: PetWorkAreaResult): Promise<{ width: number; height: number }> {
  const { invoke } = await import('@tauri-apps/api/core');
  const { useSettingsStore } = await import('@/store/settingsStore');
  const { petPanelWidth, petPanelHeight, petPanelSizeVersion } = useSettingsStore.getState();

  const savedMatchesVersion = petPanelSizeVersion === PET_PANEL_SIZE_VERSION;
  const size = resolvePanelSize(
    { width: petPanelWidth, height: petPanelHeight },
    petPanelSizeVersion,
    { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height },
  );
  await invoke('pet_panel_set_size', { width: size.width, height: size.height });

  if (!savedMatchesVersion || petPanelWidth !== size.width || petPanelHeight !== size.height) {
    const { setPetPanelSize, setPetPanelSizeVersion } = useSettingsStore.getState();
    setPetPanelSize(size.width, size.height);
    setPetPanelSizeVersion(PET_PANEL_SIZE_VERSION);
  }
  return size;
}

/**
 * Apply the panel's outer frame (position + size), show it, then re-assert
 * position+size AFTER show. The post-show re-assert is required on macOS:
 * `set_position` / `set_size` on a HIDDEN NSPanel/NSWindow may not take
 * effect reliably (the window manager can defer the frame update until the
 * window is ordered in), and `show()` can reset the frame to the last
 * visible position/size. Calling them again on the now-visible window
 * guarantees the panel lands at the computed spot — same values, so no
 * visible jump. Shared by both open paths so neither can regress on the
 * NSPanel frame-deferral workaround.
 *
 * `panelPosPhysical` and `panelSizePhysical` are PHYSICAL px (the caller
 * multiplies logical by `scale_factor` before calling).
 */
async function applyPanelFrame(
  panelPosPhysical: { x: number; y: number },
  panelSizePhysical: { width: number; height: number },
): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  const { emit } = await import('@tauri-apps/api/event');
  await invoke('pet_panel_set_position', panelPosPhysical);
  await invoke('pet_panel_set_size', panelSizePhysical);
  await invoke('pet_panel_show');
  await invoke('pet_panel_set_position', panelPosPhysical);
  await invoke('pet_panel_set_size', panelSizePhysical);
  // ponytail: emit the fade-in trigger AFTER the post-show frame re-assert so
  // the panel is already in its final rect when the CSS opacity/scale
  // transition starts. Previously the fade was keyed off `tauri://focus`
  // (fired by `set_focus()` inside `pet_panel_show`), which fires BEFORE the
  // re-assert — the panel moved/resized while half-faded-in → 闪动. Now the
  // pet-panel window listens for `pet://panel-fade-in` and calls
  // `setVisible(true)` only then. The `pet` window has `core:event:allow-emit`
  // in capabilities/pet.json; `pet-panel` has `core:event:allow-listen`.
  await emit('pet://panel-fade-in');
}

/**
 * If the panel is currently visible, hide it and return `true` (toggle-off).
 * Otherwise return `false` (caller proceeds with open). Shared by both open
 * paths so the toggle-on-second-trigger semantics stay unified.
 */
async function hideIfVisible(): Promise<boolean> {
  const { invoke } = await import('@tauri-apps/api/core');
  const visible = await invoke<boolean>('pet_panel_is_visible');
  if (visible) {
    await invoke('pet_panel_hide');
    return true;
  }
  return false;
}

/**
 * Open the pet-panel quick-action window next to the pet, or hide it if it is
 * already visible (R8 toggle). The panel is an NSPanel at Dock level with
 * `can_join_all_spaces | full_screen_auxiliary`, so it shows over fullscreen
 * apps too — no fullscreen guard needed (the R4 guard that used to abort here
 * was from when the pet/panel could not rise over fullscreen; the NSPanel
 * backend makes it possible, so the guard is removed).
 *
 * Positioning: ALWAYS recompute the panel position from the pet's CURRENT
 * outer position at open time via `computePanelPosition` (the panel's corner
 * attaches to the pet icon's diagonally-opposite corner with `PET_PANEL_GAP`
 * clearance on BOTH axes; the corner is chosen by work-area quadrant so the
 * panel extends into the open quadrant and never covers the pet icon). The
 * saved `petPanelX/Y` is NOT restored — even if the user dragged the panel
 * to a new spot while it was open, the next open snaps back to the
 * pet-relative position. (The panel can still be dragged while open; that
 * drag is just not persisted.) A saved SIZE is still restored so a
 * user-resized panel keeps its size across opens. All window mutation goes
 * through Rust `invoke` commands so the ACL contract is satisfied (custom
 * commands bypass the ACL; the panel window still has
 * `capabilities/pet-panel.json` for its own `@tauri-apps/api/window` calls
 * — `startDragging`, `outerPosition`).
 */
async function openOrTogglePetPanel(): Promise<void> {
  try {
    if (await hideIfVisible()) return;

    const { invoke } = await import('@tauri-apps/api/core');
    const probe = await invoke<PetCursorProbeResult>('pet_cursor_probe');
    const workArea = await invoke<PetWorkAreaResult>('pet_get_work_area');
    const sf = workArea.scale_factor || 1;
    const size = await resolveAndPersistPanelSize(workArea);

    // Read the current pet size level from settingsStore so the panel anchor
    // tracks the actual mascot bounds (a large/ small pet shifts where the
    // panel's corner attaches). The pet window's own store instance is kept
    // in sync via the `pet://size-changed` listener below.
    const { useSettingsStore } = await import('@/store/settingsStore');
    const petSize = useSettingsStore.getState().petSize;

    // ALWAYS recompute the panel position from the pet's current outer
    // position so the panel opens next to the pet (corner-attachment). See
    // `computePanelPosition` for the quadrant + corner math. The computed
    // position is NOT persisted.
    //
    // Unit boundary: `probe.window_x/y` is PHYSICAL px; `computePanelPosition`
    // runs in LOGICAL points. Divide by `sf` to get logical, compute, then
    // multiply by `sf` for `pet_panel_set_position` (physical px).
    const petPosLogical = { x: probe.window_x / sf, y: probe.window_y / sf };
    const panelPosLogical = computePanelPosition(petPosLogical, {
      x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height, scale_factor: sf,
    }, size, petSize);
    await applyPanelFrame(
      { x: Math.round(panelPosLogical.x * sf), y: Math.round(panelPosLogical.y * sf) },
      { width: Math.round(size.width * sf), height: Math.round(size.height * sf) },
    );
  } catch (err) {
    console.warn('[pet] openOrTogglePetPanel failed:', err);
  }
}

/**
 * Open the pet-panel window **centered in the work area**, or hide it if it
 * is already visible (toggle semantics, matching the click path). Invoked
 * exclusively by the global-shortcut handler (Rust emits `pet://shortcut-toggle`
 * → this function). Distinct from `openOrTogglePetPanel` (which positions
 * the panel next to the pet icon) because the shortcut is meant to summon
 * the panel from any app — the pet icon may be obscured or off-screen, so
 * anchoring to it is unreliable; work-area center is the predictable spot.
 *
 * Reuses `resolveAndPersistPanelSize` + `applyPanelFrame` so size-resolution,
 * the version-gate migration, and the post-show NSPanel frame re-assert stay
 * unified with the click path. Only the position computation differs
 * (`computeCenteredPanelPosition` instead of `computePanelPosition`).
 */
async function openPetPanelCentered(): Promise<void> {
  try {
    if (await hideIfVisible()) return;

    const { invoke } = await import('@tauri-apps/api/core');
    const workArea = await invoke<PetWorkAreaResult>('pet_get_work_area');
    const sf = workArea.scale_factor || 1;
    const size = await resolveAndPersistPanelSize(workArea);

    const panelPosLogical = computeCenteredPanelPosition(
      { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height },
      size,
    );
    await applyPanelFrame(
      { x: Math.round(panelPosLogical.x * sf), y: Math.round(panelPosLogical.y * sf) },
      { width: Math.round(size.width * sf), height: Math.round(size.height * sf) },
    );
  } catch (err) {
    console.warn('[pet] openPetPanelCentered failed:', err);
  }
}

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
  const petSize = useSettingsStore((s) => s.petSize);
  const spriteSize = petSizeToPx(petSize);

  // ── State machine: mouse event handlers ──
  // ponytail: the hand cursor on hover is now set by the Rust-side
  // NSTrackingArea (ActiveAlways + cursorUpdate) on the QuillPetPanel — see
  // pet_panel_macos.rs. The previous `invoke('pet_set_cursor')` calls didn't
  // stick when another app owned the cursor (the nonactivating panel isn't
  // key until clicked). The tracking area delivers cursorUpdate even when
  // Quill isn't frontmost. The `pet_set_cursor` Rust command is kept as a
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
      const { useSettingsStore } = await import('@/store/settingsStore');
      useSettingsStore.getState().setPetPosition(
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

  // ── Position persistence + topmost re-apply (R5, AC7) ──
  // Periodically read the window's outer position and persist it to
  // settingsStore when it changes. Native drag doesn't deliver JS pointerup
  // reliably, so polling is the robust path.
  //
  // Unit boundary: `outerPosition()` returns PHYSICAL px; the saved position
  // is stored in LOGICAL points (display-resolution-independent, matches the
  // work-area math used at launch). `scaleFactor()` is cached once per poller
  // lifetime — it only changes when the window moves to a monitor with a
  // different DPI, which for the pet is effectively never (single primary-
  // monitor macOS MVP); if it ever does, the launch effect re-resolves from
  // `pet_get_work_area.scale_factor` on the next startup and the saved logical
  // value is still correct.
  //
  // Topmost re-apply: Tauri's `alwaysOnTop: true` config only sets the
  // Floating NSWindow level (5), which other always-on-top apps (VS Code,
  // etc.) can cover. `pet_set_topmost_level` raises the pet to
  // `kCGScreenSaverWindowLevelKey` (13) so it stays visible everywhere. The
  // OS can reset the level after a `show()` (e.g. when `toggle_pet_mode`
  // re-shows the pet), so re-invoke it on this ~800ms poll — it is idempotent
  // and cheap. Wrapped in isTauri + try/catch so non-Tauri/test envs skip it.
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let lastX = -1;
    let lastY = -1;
    let sf = 1;

    const persist = async () => {
      if (cancelled) return;
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        // Cache the scale factor once; it doesn't change for a single-
        // monitor pet window. (If it ever does, the launch effect re-
        // resolves from pet_get_work_area on next startup.)
        if (sf === 1) {
          sf = await getCurrentWindow().scaleFactor() || 1;
        }
        const pos = await getCurrentWindow().outerPosition();
        const x = Math.round(pos.x / sf);
        const y = Math.round(pos.y / sf);
        if (x !== lastX || y !== lastY) {
          lastX = x;
          lastY = y;
          const { useSettingsStore } = await import('@/store/settingsStore');
          useSettingsStore.getState().setPetPosition(x, y);
        }
      } catch {
        // Non-fatal; try again next tick.
      }

      // Re-apply the ScreenSaver-level topmost so the OS never demotes the
      // pet below other always-on-top apps after a show().
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('pet_set_topmost_level', { label: 'pet' });
      } catch (err) {
        console.warn('[pet] pet_set_topmost_level poll failed:', err);
      }
    };

    const id = window.setInterval(persist, POSITION_PERSIST_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // ── Show the pet window on launch (position-first) ──
  // The pet window is created `visible: false` (tauri.conf.json) and relies on
  // the frontend to show it when it mounts. The previous fullscreen-auto-hide
  // probe's `else` branch used to call `win.show()` — that probe was removed
  // for "always visible", so this mount effect now owns the launch-time show.
  // Idempotent: `show()` on an already-visible window is a no-op. The pet
  // window's capability file (`capabilities/pet.json`) grants
  // `core:window:allow-show`, so this call is ACL-allowed. Do NOT re-add
  // fullscreen hide logic — the pet must stay visible at all times.
  //
  // ORDERING: resolve and `set_pet_position` BEFORE `show()`. tauri.conf.json
  // uses `center: true` (no hardcoded `x`/`y`) so the window is CREATED
  // off-screen-center as a transient — the runtime position-set corrects to
  // the exact saved-or-default position before the first visible frame. The
  // previous layout had a separate position-restore useEffect running in
  // PARALLEL with this show effect, which raced: `show()` could land before
  // `set_pet_position`, briefly flashing the window at the conf default
  // (centered) position. Merging them into one async chain guarantees the
  // position is applied first. Both calls are non-fatal if they fail — the
  // window still shows at the conf default (centered, never off-screen).
  //
  // Unit boundary: the work area from `pet_get_work_area` is in LOGICAL points
  // (plus `scale_factor`); the saved position is also logical. The math here
  // (`computeDefaultPetPosition` / `clampPetPosition`) runs in logical space.
  // `set_pet_position` / `outerPosition()` / `setPosition` operate in PHYSICAL
  // px, so multiply by `sf` before calling them and divide by `sf` after
  // reading `outerPosition()`.
  //
  // `show()` resets the NSWindow level to Floating (Tauri's alwaysOnTop
  // default), which lets other always-on-top apps (VS Code, etc.) cover the
  // pet. Re-apply `pet_set_topmost_level` immediately after `show()` so the
  // ScreenSaver level is restored in the same frame — the ~800ms poll would
  // otherwise leave a window where the pet sits at Floating for up to 800ms.
  useEffect(() => {
    if (!isTauri()) return;
    (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const { invoke } = await import('@tauri-apps/api/core');

      // 1. Resolve and apply the initial position BEFORE show() so the first
      //    visible frame is already at the right spot (no centered flash).
      try {
        const { useSettingsStore } = await import('@/store/settingsStore');
        const workArea = await invoke<PetWorkAreaResult>('pet_get_work_area');
        const sf = workArea.scale_factor || 1;
        const { petPositionX, petPositionY, petSize } = useSettingsStore.getState();
        const petWindowSize = petSizeToPx(petSize);

        // Restore the persisted pet window size BEFORE positioning so a large
        // / small pet's bounds are correct when the position is clamped. The
        // `pet` Tauri window starts at the medium (96) default from
        // tauri.conf.json; `set_pet_size` resizes it to the saved level. If
        // this fails the medium default still applies, which is never
        // off-screen.
        try {
          await invoke('set_pet_size', { level: petSize });
        } catch (err) {
          console.warn('[pet] set_pet_size on mount failed:', err);
        }

        // Work-area guard: if the OS returns a zero-sized work area (e.g.
        // NSScreen.mainScreen is nil during early launch), the default-branch
        // math would compute x=0, y=PET_MIN_TOP (top-left) — visibly wrong.
        // Skip the position-set entirely and let Tauri's `center: true` conf
        // default apply (centered, never off-screen). The ~800ms poller below
        // will persist the actual (centered) position; on the next launch the
        // saved-position branch will restore it. The user can drag the pet to
        // overwrite. This is an edge case; on most launches workArea is valid.
        if (workArea.width <= 0 || workArea.height <= 0) {
          console.warn('[pet] work area is zero, skipping position-set:', workArea);
        } else {
          let resolved: { x: number; y: number };
          let source: 'saved' | 'default' = 'default';
          if (petPositionX >= 0 && petPositionY >= 0) {
            // Saved position (logical): clamp to the current work area, using
            // the actual pet window size so a size change between launches
            // still keeps the whole window on-screen. If the saved value is
            // off-screen, the clamped value is persisted back so subsequent
            // launches skip the re-clamp.
            source = 'saved';
            const clamped = clampPetPosition(
              { x: petPositionX, y: petPositionY },
              { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height, scale_factor: sf },
              petWindowSize,
            );
            if (clamped.x !== petPositionX || clamped.y !== petPositionY) {
              useSettingsStore.getState().setPetPosition(clamped.x, clamped.y);
            }
            resolved = clamped;
          } else {
            // First-launch default: bottom-right of the work area, lifted by
            // PET_BOTTOM_MARGIN. Persist so the next launch restores it.
            const rel = computeDefaultPetPosition({
              width: workArea.width,
              height: workArea.height,
            });
            resolved = { x: workArea.x + rel.x, y: workArea.y + rel.y };
            useSettingsStore.getState().setPetPosition(resolved.x, resolved.y);
          }

          // Diagnostic: log the saved + work-area + resolved values so a
          // "still centered" report can be traced to a saved localStorage
          // position vs. a work-area fallback vs. a set_pet_position failure.
          console.info('[pet] launch position:', {
            source,
            saved: { x: petPositionX, y: petPositionY },
            workArea,
            sf,
            resolved,
          });

          // Apply via the custom Rust command first (ACL-safe custom invoke).
          // `set_pet_position` takes PHYSICAL px, so multiply the logical
          // resolved value by `sf`. Then verify with `outerPosition()` (also
          // physical — divide by `sf` to compare with the logical resolved);
          // if the OS didn't honor the custom command (some builds race the
          // WebviewWindow creation), fall back to the standard `setPosition()`
          // API — both are valid paths, belt-and-suspenders so a silent invoke
          // failure cannot leave the window centered.
          const physicalX = Math.round(resolved.x * sf);
          const physicalY = Math.round(resolved.y * sf);
          try {
            await invoke('set_pet_position', { x: physicalX, y: physicalY });
          } catch (err) {
            console.warn('[pet] set_pet_position invoke failed, falling back to setPosition:', err);
          }
          try {
            const actual = await getCurrentWindow().outerPosition();
            const actualLogicalX = Math.round(actual.x / sf);
            const actualLogicalY = Math.round(actual.y / sf);
            if (actualLogicalX !== resolved.x || actualLogicalY !== resolved.y) {
              console.warn('[pet] position mismatch after invoke, retrying via setPosition:', {
                actual: { x: actualLogicalX, y: actualLogicalY },
                expected: resolved,
              });
              const { PhysicalPosition } = await import('@tauri-apps/api/dpi');
              await getCurrentWindow().setPosition(new PhysicalPosition(physicalX, physicalY));
            }
          } catch (err) {
            console.warn('[pet] position verify/retry failed:', err);
          }
        }
      } catch (err) {
        // Non-fatal; the window falls back to the Tauri `center: true` conf
        // default (centered), which is never off-screen.
        console.warn('[pet] launch position resolve failed:', err);
      }

      // 2. Show the window at the now-correct position.
      try {
        await getCurrentWindow().show();
        // Re-assert the pet size AFTER show(). macOS can defer `set_size` on
        // a HIDDEN NSWindow and `show()` may reset the frame to the conf
        // default (96×96 medium). If the user saved small/large, the
        // pre-show `set_pet_size` (step 1) may have been clobbered by show()
        // — re-assert here so a non-medium size reliably takes effect on
        // first launch. Mirrors the pet-panel post-show re-assert pattern
        // (see tauri-window-patterns.md "Secondary Opaque Panel Window").
        const { petSize: savedSize } = (await import('@/store/settingsStore')).useSettingsStore.getState();
        if (savedSize !== 'medium') {
          try {
            await invoke('set_pet_size', { level: savedSize });
          } catch (err) {
            console.warn('[pet] set_pet_size post-show re-assert failed:', err);
          }
        }
        await invoke('pet_set_topmost_level', { label: 'pet' });
        // Native transparency: Tauri's `transparent: true` config doesn't
        // reliably disable the macOS WKWebView's opaque background on all
        // builds, leaving a white rect around the circular mascot. The
        // `pet_make_transparent` command flips NSWindow opaque=NO +
        // backgroundColor=clear + WKWebView drawsBackground=NO on the main
        // thread so transparent CSS regions finally show the desktop. Called
        // once on mount, after show(). Pet-panel is opaque by design and is
        // NOT made transparent.
        try {
          await invoke('pet_make_transparent', { label: 'pet' });
        } catch (err) {
          console.warn('[pet] pet_make_transparent failed:', err);
        }
      } catch (err) {
        console.warn('[pet] initial show / set_topmost_level failed:', err);
      }
    })();
  }, []);

  // ── Topmost level (visible over all always-on-top apps) ──
  // Tauri's `alwaysOnTop: true` config only sets the Floating NSWindow
  // level (5), which other always-on-top apps (VS Code, etc.) can cover.
  // Raise the pet to `kCGScreenSaverWindowLevelKey` (13) so it stays
  // visible everywhere. The level persists for the window's lifetime, so
  // calling once on mount is sufficient. Non-fatal if it fails.
  useEffect(() => {
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('pet_set_topmost_level', { label: 'pet' });
      } catch (err) {
        console.warn('[pet] set_topmost_level failed:', err);
      }
    })();
  }, []);

  // ── Re-assert topmost level on window blur (Issue 2 diagnostic + fix) ──
  // Tauri/macOS may reset the always-on-top level when the pet window loses
  // focus (app deactivation — user switched to another app). Re-invoke
  // `pet_set_topmost_level('pet')` on the `tauri://blur` event so the
  // ScreenSaver level is re-asserted immediately when the user switches away.
  // Without this, switching to another app can hide the pet behind it.
  // Wrapped in isTauri + try/catch so non-Tauri/test envs skip it. The
  // unlisten callback is returned from `listen` for cleanup.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const { invoke } = await import('@tauri-apps/api/core');
        unlisten = await getCurrentWindow().listen('tauri://blur', () => {
          invoke('pet_set_topmost_level', { label: 'pet' }).catch((err) =>
            console.warn('[pet] topmost re-apply on blur failed:', err),
          );
        });
      } catch (err) {
        console.warn('[pet] blur listener setup failed:', err);
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // ── Global shortcut: toggle pet-panel from any app ──
  // Rust's `tauri_plugin_global_shortcut` handler emits `pet://shortcut-toggle`
  // on every Pressed event (see lib.rs plugin build). This effect:
  //   1. registers the persisted accelerator on mount (so the shortcut works
  //      before the user visits Settings), and
  //   2. listens for `pet://shortcut-toggle` and calls `openPetPanelCentered`.
  //
  // Mounted in the `pet` window (always alive while pet mode is on) so the
  // listener + registration survive across main-window hide/show. Wrapped in
  // isTauri + try/catch so non-Tauri/test envs skip it. The unlisten callback
  // is returned from `listen` for cleanup; the accelerator stays registered
  // at the OS level after unmount (Tauri process exit unregisters it).
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const { listen } = await import('@tauri-apps/api/event');
        const { useSettingsStore } = await import('@/store/settingsStore');
        const { shortcuts } = useSettingsStore.getState();
        const toggle = shortcuts.find((s) => s.id === 'togglePetPanel');
        if (toggle) {
          const accelerator = keysToAccelerator(toggle.keys);
          await invoke('pet_panel_set_shortcut', { accelerator });
          console.info('[pet] global shortcut registered:', accelerator);
        } else {
          console.warn('[pet] togglePetPanel shortcut not found in settingsStore; global shortcut not registered');
        }
        unlisten = await listen('pet://shortcut-toggle', () => {
          console.info('[pet] pet://shortcut-toggle event received');
          void openPetPanelCentered();
        });
      } catch (err) {
        console.warn('[pet] global shortcut setup failed:', err);
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // ── Cross-window icon-change sync ──
  // The `pet` Tauri window has its own JS context + its own Zustand store
  // instance; `storageClient`'s in-memory cache is per-window with no cross-
  // window invalidation. When the main window's PetSettings calls
  // `setPetIcon(...)`, only the main window's store updates — this pet window
  // would keep rendering the stale icon until next launch. The main window
  // emits `pet://icon-changed` after every `setPetIcon` call; this listener
  // applies the payload to the pet window's own store instance so the mascot
  // re-renders live. Pattern mirrors the `pet://visibility-changed` listener
  // in App.tsx. Wrapped in isTauri + try/catch so non-Tauri/test envs skip it.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const { useSettingsStore } = await import('@/store/settingsStore');
        unlisten = await listen<{ source: 'builtin' | 'custom'; path: string }>(
          'pet://icon-changed',
          (event) => {
            const { source, path } = event.payload ?? {};
            if (source !== 'builtin' && source !== 'custom') return;
            useSettingsStore.setState({
              petIconSource: source,
              petIconPath: typeof path === 'string' ? path : '',
            });
          },
        );
      } catch (err) {
        console.warn('[pet] icon-changed listener setup failed:', err);
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // ── Cross-window size change sync ──
  // The main window's `handleAction('set-pet-size')` (App.tsx) calls Rust
  // `set_pet_size` (which resizes the pet window) AND emits `pet://size-changed`
  // here. This listener applies the new level to this pet window's own store
  // instance (so `petSize` re-renders the sprite layer + mascot SVG) and
  // re-clamps the position so a larger pet doesn't sit off-screen. Pattern
  // mirrors `pet://icon-changed` above. Wrapped in isTauri + try/catch so
  // non-Tauri/test envs skip it.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const { invoke } = await import('@tauri-apps/api/core');
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        unlisten = await listen<{ size: 'small' | 'medium' | 'large' }>(
          'pet://size-changed',
          async (event) => {
            const size = event.payload?.size;
            if (size !== 'small' && size !== 'medium' && size !== 'large') return;
            const { useSettingsStore } = await import('@/store/settingsStore');
            useSettingsStore.setState({ petSize: size });
            // Re-clamp the current position with the new size so a larger
            // pet stays fully on-screen. Non-fatal if the work-area probe
            // fails — the saved position is unchanged and the user can
            // drag the pet back on-screen.
            try {
              const workArea = await invoke<PetWorkAreaResult>('pet_get_work_area');
              if (workArea.width > 0 && workArea.height > 0) {
                const sf = workArea.scale_factor || 1;
                const pos = await getCurrentWindow().outerPosition();
                const x = Math.round(pos.x / sf);
                const y = Math.round(pos.y / sf);
                const clamped = clampPetPosition(
                  { x, y },
                  { x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height, scale_factor: sf },
                  petSizeToPx(size),
                );
                if (clamped.x !== x || clamped.y !== y) {
                  await invoke('set_pet_position', { x: Math.round(clamped.x * sf), y: Math.round(clamped.y * sf) });
                  useSettingsStore.getState().setPetPosition(clamped.x, clamped.y);
                }
              }
            } catch (err) {
              console.warn('[pet] size-changed re-clamp failed:', err);
            }
          },
        );
      } catch (err) {
        console.warn('[pet] size-changed listener setup failed:', err);
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
        aria-label="Quill desktop pet"
        role="button"
      >
        <PetMascot state={state} size={petSize} />
      </div>
    </div>
  );
}
