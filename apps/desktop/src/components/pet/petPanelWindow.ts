import { LogicalPosition, LogicalSize, PhysicalPosition, PhysicalSize, Position, Size } from '@tauri-apps/api/dpi';
import { getPetCursorContext } from './petCursor';
import { isMacPlatform } from '@/utils/shellSidecar';
import { computePanelPosition, computeCursorPanelPosition, resolvePanelSize, PET_PANEL_SIZE_VERSION } from './petPosition';

/**
 * Pet-panel window control — open/toggle/frame logic for the `pet-panel`
 * quick-action window. Extracted from PetApp.tsx so the panel-open paths
 * (mascot click + global shortcut) live next to each other and cannot drift.
 */

interface PetCursorProbeResult {
  cursor_x: number;
  cursor_y: number;
  window_x: number;
  window_y: number;
  main_fullscreen: boolean;
}

/** Raw `pet_get_work_area` invoke result (logical on macOS, physical
 *  elsewhere — see the unit-boundary notes at each call site). */
export interface PetWorkAreaResult {
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
 * Persists logical dimensions without mutating the native window. Callers
 * feed the returned size into position computation + `applyPanelFrame`.
 */
async function resolveAndPersistPanelSize(): Promise<{ width: number; height: number }> {
  const { usePetStore } = await import('@/store/petStore');
  const { petPanelWidth, petPanelHeight, petPanelSizeVersion } = usePetStore.getState();

  const savedMatchesVersion = petPanelSizeVersion === PET_PANEL_SIZE_VERSION;
  const size = resolvePanelSize(
    { width: petPanelWidth, height: petPanelHeight },
    petPanelSizeVersion,
  );

  if (!savedMatchesVersion || petPanelWidth !== size.width || petPanelHeight !== size.height) {
    const { setPetPanelSize, setPetPanelSizeVersion } = usePetStore.getState();
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
 * Frame values carry their units through IPC. macOS cursor opens use
 * logical points so both reassertions survive a change of display scale.
 */
async function applyPanelFrame(
  position: LogicalPosition | PhysicalPosition,
  size: LogicalSize | PhysicalSize,
): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  const { emit } = await import('@tauri-apps/api/event');
  await invoke('pet_panel_set_position', { position: new Position(position) });
  await invoke('pet_panel_set_size', { size: new Size(size) });
  await invoke('pet_panel_show');
  await invoke('pet_panel_set_position', { position: new Position(position) });
  await invoke('pet_panel_set_size', { size: new Size(size) });
  // Re-focus as the LAST step of the open gesture. On Windows, opening via
  // a `pet` (focus:false) click leaves Folyn non-foreground, so the
  // `set_focus()` inside `pet_panel_show` can hit Windows' SetForegroundWindow
  // block → panel shows but never gains focus → clicking elsewhere doesn't
  // deactivate it → the unpinned blur auto-hide never fires. Re-issuing
  // focus here (after the visible, user-initiated pet click has satisfied
  // SetForegroundWindow's input-queue recency) gives Windows another chance
  // to promote the panel. Idempotent on macOS / when focus already landed.
  await invoke('pet_panel_set_focus');
  // ponytail: CSS opacity:0 + transition handles the fade-in. The earlier
  // window-level alphaValue mask (NSAnimationContext) crashed with ObjC
  // exceptions ("Rust cannot catch foreign exceptions"). The 忽隐忽现
  // root cause was the racy onFocusChanged → setVisible(false) mid-
  // transition, already fixed by the `pet://panel-fade-out` event listener
  // in PetPanelApp. The transparent window (pet_make_transparent) means
  // CSS opacity:0 shows desktop, not a white flash — silky enough.
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
 * panel extends into the open quadrant, then shifts inward at screen edges). The
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
export async function openOrTogglePetPanel(): Promise<void> {
  try {
    if (await hideIfVisible()) return;

    const { invoke } = await import('@tauri-apps/api/core');
    const probe = await invoke<PetCursorProbeResult>('pet_cursor_probe');
    const rawWorkArea = await invoke<PetWorkAreaResult>('pet_get_work_area');
    const screenSf = rawWorkArea.scale_factor || 1;
    // Native work areas are logical on macOS and physical elsewhere.
    const workArea = isMacPlatform() ? rawWorkArea : {
      ...rawWorkArea,
      x: rawWorkArea.x / screenSf,
      y: rawWorkArea.y / screenSf,
      width: rawWorkArea.width / screenSf,
      height: rawWorkArea.height / screenSf,
    };
    const size = await resolveAndPersistPanelSize();

    // Read the current pet size level from petStore so the panel anchor
    // tracks the actual mascot bounds (a large/ small pet shifts where the
    // panel's corner attaches). The pet window's own store instance is kept
    // in sync via the `pet://size-changed` listener in PetApp.
    const { usePetStore } = await import('@/store/petStore');
    const petSize = usePetStore.getState().petSize;

    // ALWAYS recompute the panel position from the pet's current outer
    // position so the panel opens next to the pet (corner-attachment). See
    // `computePanelPosition` for the quadrant + corner math. The computed
    // position is NOT persisted.
    //
    // Unit boundary: `probe.window_x/y` is PHYSICAL px; `computePanelPosition`
    // runs in LOGICAL points. Divide by `screenSf` to get logical, compute,
    // then retain logical units on macOS; other platforms use screen pixels.
    const petPosLogical = { x: probe.window_x / screenSf, y: probe.window_y / screenSf };
    const panelPosLogical = computePanelPosition(petPosLogical, {
      x: workArea.x, y: workArea.y, width: workArea.width, height: workArea.height, scale_factor: screenSf,
    }, size, petSize);
    await applyPanelFrame(
      isMacPlatform()
        ? new LogicalPosition(panelPosLogical)
        : new PhysicalPosition(Math.round(panelPosLogical.x * screenSf), Math.round(panelPosLogical.y * screenSf)),
      isMacPlatform()
        ? new LogicalSize(size)
        : new PhysicalSize(Math.round(size.width * screenSf), Math.round(size.height * screenSf)),
    );
  } catch (err) {
    console.warn('[pet] openOrTogglePetPanel failed:', err);
  }
}

/**
 * Toggle the panel near the cursor on its current monitor. Share sizing,
 * focus and post-show frame reassertion with the mascot-click path.
 */
export async function openPetPanelAtCursor(): Promise<void> {
  try {
    if (await hideIfVisible()) return;

    const { cursor, workArea } = await getPetCursorContext();
    const size = await resolveAndPersistPanelSize();
    const position = computeCursorPanelPosition(cursor, workArea, size);
    const sf = workArea.scale_factor;
    await applyPanelFrame(
      isMacPlatform()
        ? new LogicalPosition(position)
        : new PhysicalPosition(Math.round(position.x * sf), Math.round(position.y * sf)),
      isMacPlatform()
        ? new LogicalSize(size)
        : new PhysicalSize(Math.round(size.width * sf), Math.round(size.height * sf)),
    );
    // Summoned via the global shortcut → focus the search box so the user
    // can type immediately (Spotlight/Raycast behavior). Emitted AFTER
    // `applyPanelFrame`'s `pet://panel-fade-in`; by then `pet_panel_show`
    // has run `set_focus()` + `makeFirstResponder(wkwebview)`, so the panel
    // is the key window and the webview is first responder → `.focus()` on
    // the input receives keystrokes. The click path does NOT emit this —
    // it leaves the default chat tab's focus alone ("ask mode").
    const { emit } = await import('@tauri-apps/api/event');
    await emit('pet://panel-focus-search');
  } catch (err) {
    console.warn('[pet] openPetPanelAtCursor failed:', err);
  }
}
