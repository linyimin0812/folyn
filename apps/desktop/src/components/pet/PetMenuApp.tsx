// Pet right-click HTML menu window (`pet-menu`).
//
// Replaces the native NSMenu path (`pet_show_context_menu` + muda's
// `popUpMenuPositioningItem:atLocation:inView:`) so the menu can be positioned
// adaptively outside the pet view — no overlap with the pet, no internal
// scroll arrows. The menu renders as HTML in a transparent borderless NSPanel
// window; the frontend measures the DOM, computes a quadrant-aware position
// (reusing `computePanelPosition`'s math from `petPosition.ts`), and calls
// `pet_menu_set_size` + `pet_menu_set_position` + `pet_menu_show` in that
// order before reveal.
//
// Item clicks emit `pet://menu-action` (same channel as the native menu + the
// pet-panel launcher grid) so `usePetHostBridge` / `routePetMenuAction` in the
// main window need no change. Closes on item click, ESC, and window blur
// (click outside).
//
// Submenus (size, opacity) are floating secondary cards — hover the parent
// item → after a short delay the submenu card appears beside the main card,
// vertically aligned with the parent item's top edge. The side is adaptive:
// the submenu opens AWAY from the pet icon (pet on the right half → left,
// pet on the left half → right) so it never covers the mascot and never gets
// covered by it — `computePanelPosition` always places the main card entirely
// on one horizontal side of the pet, so the opposite side is the safe one.
// Only one submenu visible at a time; hovering the other parent swaps.
// Picking a radio closes the whole menu (native submenu behavior).
//
// Mouse-only + ESC. No arrow-key / role=menuitem keyboard nav in MVP.
//
// The submenu side is chosen at open time (see `resizeAndReposition` /
// `SubmenuSide`). For a rightward submenu the window only resizes on toggle
// (top-left fixed). For a leftward submenu the window also shifts by the
// submenu's left-extent so the MAIN CARD stays at the identical screen
// position — the parent item never moves out from under the mouse, so no
// enter/leave "shake" loop.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isTauri } from '@/utils/platform';
import {
  computePanelPosition,
  mascotSizeForPetSize,
  PET_PANEL_GAP,
  PET_SIZE_DEFAULT,
  petSizeToPx,
  type PetSize,
  type PetWorkArea,
} from './petPosition';
import type { PetMenuAction } from './PetContextMenu';
import { usePetStore } from '@/store/petStore';
import { hydrateAllStores } from '@/store/settingsPersistence';
import { currentWindowScaleFactor } from '@/utils/windowScale';

/** Physical-position result from `get_pet_position` (physical px). */
interface PetPositionResult {
  x: number;
  y: number;
}

/** Pet size levels surfaced in the size submenu. Synced with Rust
 *  `PET_CTX_MENU_SIZE_*` ids (now deleted from Rust, but the level set +
 *  payload shape stay — the `set-pet-size` action carries these strings). */
const SIZE_LEVELS: PetSize[] = ['50', '75', '100', '125', '150'];

/** Pet opacity levels surfaced in the opacity submenu. Synced with the
 *  `set-pet-opacity` action payload. */
const OPACITY_LEVELS = ['25', '50', '75', '100'] as const;

/** Room reserved for the submenu on its chosen side at open time (logical
 *  px). Submenu min-width 128 + 6px gap + 6px buffer. The open path keeps
 *  the main card far enough from the work-area edge on the submenu side so
 *  the submenu never gets clipped — without moving the main card later
 *  (which would jump the first-level menu). */
const SUBMENU_RESERVATION_LOGICAL = 140;

/** Bottom-side room reserved for the submenu at open time (logical px).
 *  The floating submenu card renders below its parent item; the part that
 *  extends past the main card's bottom edge is ~18px (submenu bottom 201 −
 *  main card 183, both measured at line-height 1.2). Add a small buffer
 *  for font-metric variation so the submenu never spills past the work
 *  area's bottom edge when the pet is near the screen bottom. */
const SUBMENU_GROWTH_LOGICAL = 22;

/** Which submenu is currently visible (hover-triggered), plus the parent
 *  item's vertical offset so the floating card can align with it. */
type HoveredSection = { section: 'size' | 'opacity'; offsetTop: number } | null;

/** Which side of the main card the submenu opens toward. Chosen at open time
 *  from the pet's horizontal half: `'left'` when the pet is on the right
 *  half (main card sits left of the icon → submenu extends left, away from
 *  it), `'right'` when the pet is on the left half. Mirrors the quadrant
 *  branch in `computePanelPosition` so the two can never disagree about
 *  which side of the icon the main card is on. */
type SubmenuSide = 'left' | 'right';

/** Emit a `pet://menu-action` event with the given payload, then hide the
 *  menu window. Used for every item click — top-level actions AND size/opacity
 *  radio picks — matching the native NSMenu auto-close behavior (picking any
 *  leaf closes the whole menu). Swallows errors so the click path never
 *  throws into React state. */
async function emitMenuActionAndHide(
  action: PetMenuAction,
  payload?: { size?: PetSize; opacity?: string; clickThrough?: boolean },
): Promise<void> {
  if (!isTauri()) return;
  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit('pet://menu-action', { action, ...payload });
  } catch (err) {
    console.warn('[pet-menu] emit menu-action failed:', err);
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('pet_menu_hide');
  } catch (err) {
    console.warn('[pet-menu] hide failed:', err);
  }
}

/** Hide the menu window. Swallows errors so ESC / blur handlers never throw. */
async function hideMenu(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('pet_menu_hide');
  } catch {
    // Non-fatal.
  }
}

/**
 * Measure the rendered menu DOM, compute a quadrant-aware position (reusing
 * `computePanelPosition`'s corner-attach math from `petPosition.ts`), pick
 * the submenu side, then size + position the `pet-menu` window. Open path
 * only (followed by `pet_menu_show`); the submenu show/hide path is handled
 * by `syncSubmenuWindow`, which keeps the main card fixed. Swallows errors
 * so a missing window / failed invoke doesn't break the open path.
 *
 * The root passed here is `.pet-menu-window-root`; the MEASURE is taken from
 * its `.pet-menu-root` child (the main card), NOT the wrapper union. The
 * wrapper's rect includes a rendered submenu (size/opacity card), and if the
 * previous open left one in the DOM when a new `pet://menu-show` arrives,
 * measuring the union would size/position the window as if the submenu were
 * part of the main card — the main card drifts away from the pet. Measuring
 * the main card directly makes the open path immune to submenu render state.
 *
 * Submenu side: recomputed on EVERY open from the pet's horizontal half —
 * `'left'` (pet on the right half, main card left of the icon) or `'right'`
 * (pet on the left half). The submenu later opens on that side, AWAY from
 * the pet icon, so it can never cover or be covered by the mascot. The side
 * is returned to the caller, which stores it for the submenu-toggle path.
 *
 * Side reservation (open path only): after `computePanelPosition` returns
 * `posLogical`, keep `SUBMENU_RESERVATION_LOGICAL` of free room on the
 * submenu's chosen side so the submenu never gets clipped at the work-area
 * edge. For `'right'` that means shifting the main card left when the right
 * side would overflow; for `'left'` it means shifting the main card right
 * when the left side would be too tight — the latter capped at the pet icon
 * edge (`PET_PANEL_GAP` away) so the reservation can never push the card
 * onto the mascot. In practice the away side points into the larger quadrant
 * (the same one `computePanelPosition` placed the card into), so these
 * shifts are pure safety nets.
 *
 * Bottom-side reservation (open path only): the floating submenu card
 * extends ~SUBMENU_GROWTH_LOGICAL below the main card's bottom edge. If
 * that bottom edge would overflow the work area's bottom (pet near the
 * screen bottom, or a larger pet size pushing iconTop down), shift
 * `posLogical.y` upward. Clamped to `>= workArea.y`. Same no-jump
 * rationale: the position is fixed at open time, only the window SIZE
 * changes on submenu toggle.
 *
 * Left/top edge clamp: `computePanelPosition` doesn't clamp to the work
 * area, so on narrow/short screens the computed corner-attach position can
 * fall off-screen. Clamp both axes to `>= workArea.{x,y}` so the main card
 * is always fully visible.
 */
async function resizeAndReposition(
  root: HTMLDivElement | null,
  petSize: PetSize,
): Promise<{ pos: { x: number; y: number }; side: SubmenuSide } | null> {
  if (!isTauri() || !root) return null;
  const card = root.querySelector<HTMLElement>('.pet-menu-root');
  const rect = card?.getBoundingClientRect() ?? root.getBoundingClientRect();
  const menuWidth = Math.ceil(rect.width);
  const menuHeight = Math.ceil(rect.height);
  if (menuWidth <= 0 || menuHeight <= 0) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const workArea = await invoke<PetWorkArea>('pet_get_work_area');
    // Pet screen's scale (petPos → logical) vs the MENU window's own scale
    // (frame → physical) — see currentWindowScaleFactor. The first open
    // after the pet moves to a different-DPI screen must not mix them.
    const screenSf = workArea.scale_factor || 1;
    const winSf = await currentWindowScaleFactor(screenSf);
    await invoke('pet_menu_set_size', {
      width: Math.round(menuWidth * winSf),
      height: Math.round(menuHeight * winSf),
    });
    const petPos = await invoke<PetPositionResult>('get_pet_position');
    // petPos is physical px → logical for the math (matches petPosition.ts
    // unit contract), then × winSf back to physical for set_position.
    const petPosLogical = { x: petPos.x / screenSf, y: petPos.y / screenSf };
    const posLogical = computePanelPosition(
      petPosLogical,
      workArea,
      { width: menuWidth, height: menuHeight },
      petSize,
    );

    // Submenu side: mirror computePanelPosition's X branch — pet on the right
    // half → main card extends left of the icon → submenu opens LEFT (away
    // from the icon); pet on the left half → submenu opens RIGHT.
    const petWindowSize = petSizeToPx(petSize);
    const petCenterX = petPosLogical.x + petWindowSize / 2;
    const side: SubmenuSide =
      petCenterX >= workArea.x + workArea.width / 2 ? 'left' : 'right';

    if (side === 'right') {
      // Ensure the rightward submenu has room: shift the main card leftward
      // when the right side would overflow; clamp to the work area's left
      // edge so the reservation never pushes the main card off-screen.
      const rightEdge = posLogical.x + menuWidth + SUBMENU_RESERVATION_LOGICAL;
      const workAreaRight = workArea.x + workArea.width;
      if (rightEdge > workAreaRight) {
        posLogical.x = Math.max(workArea.x, workAreaRight - menuWidth - SUBMENU_RESERVATION_LOGICAL);
      }
    } else {
      // Leftward submenu: keep its left edge on-screen by shifting the main
      // card right when the pet-adjacent placement would be too tight. Cap
      // at the pet icon edge (PET_PANEL_GAP away) so the reservation can
      // never push the main card onto the mascot — the pet takes precedence.
      const minX = workArea.x + SUBMENU_RESERVATION_LOGICAL;
      if (posLogical.x < minX) {
        const mascotSize = mascotSizeForPetSize(petSize);
        const inset = (petWindowSize - mascotSize) / 2;
        const iconLeft = petPosLogical.x + inset;
        const maxX = iconLeft - PET_PANEL_GAP - menuWidth;
        posLogical.x = Math.min(maxX, minX);
      }
    }

    // Bottom-side reservation: the submenu extends ~SUBMENU_GROWTH_LOGICAL
    // below the main card's bottom. Shift the window upward when the bottom
    // edge would overflow the work area's bottom (pet near screen bottom, or
    // larger pet sizes that push iconTop down). Clamped to workArea.y so the
    // reservation never pushes the window off the top.
    const bottomEdge = posLogical.y + menuHeight + SUBMENU_GROWTH_LOGICAL;
    const workAreaBottom = workArea.y + workArea.height;
    if (bottomEdge > workAreaBottom) {
      posLogical.y = Math.max(workArea.y, workAreaBottom - menuHeight - SUBMENU_GROWTH_LOGICAL);
    }
    // Left/top edge clamp: computePanelPosition doesn't clamp, so on
    // narrow/short screens the computed corner-attach position can fall
    // off-screen.
    posLogical.x = Math.max(posLogical.x, workArea.x);
    posLogical.y = Math.max(posLogical.y, workArea.y);

    await invoke('pet_menu_set_position', {
      x: Math.round(posLogical.x * winSf),
      y: Math.round(posLogical.y * winSf),
    });
    return { pos: posLogical, side };
  } catch (err) {
    console.warn('[pet-menu] resize/reposition failed:', err);
    return null;
  }
}

/**
 * Open path: measure rendered DOM + compute quadrant-aware position + pick
 * the submenu side + size/position/show the window. Re-runs on every
 * `pet://menu-show` event so a locale change (which shifts label widths) or
 * a pet drag (which shifts the pet) re-positions correctly. Returns the
 * final main-card position + chosen submenu side so the caller can store
 * them for the submenu-toggle path (`syncSubmenuWindow`).
 */
async function openMenu(
  root: HTMLDivElement | null,
  petSize: PetSize,
): Promise<{ pos: { x: number; y: number }; side: SubmenuSide } | null> {
  if (!isTauri() || !root) return null;
  const placed = await resizeAndReposition(root, petSize);
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('pet_menu_show');
  } catch (err) {
    console.warn('[pet-menu] open path failed:', err);
  }
  return placed;
}

/**
 * Submenu show/hide → re-measure the wrapper union + re-size the menu window
 * (+ shift it when the submenu opens on the LEFT). Called from the
 * `hoveredSection` / `submenuSide` / `petSize` effect. Never re-shows the
 * window (that would flicker / steal focus) and never moves the MAIN card:
 *
 * - Rightward submenu: the union grows/shrinks right of the main card, so
 *   only the window SIZE changes; the top-left stays put.
 * - Leftward submenu: the union extends LEFT of the main card. The window
 *   top-left must shift left by the submenu's left-extent (and back on
 *   hide) so the main card — and the parent item under the mouse — stays at
 *   the identical screen position. This is a precise shift, NOT a recompute:
 *   recomputing from the union rect (as `computePanelPosition` would) moves
 *   the main card → parent item leaves the cursor → `onMouseLeave` → hide →
 *   shrink → position recomputed back → `onMouseEnter` → … enter/leave
 *   feedback loop = "shake". Holding the main card fixed breaks the loop.
 */
async function syncSubmenuWindow(
  root: HTMLDivElement | null,
  side: SubmenuSide,
  openPos: { x: number; y: number } | null,
): Promise<void> {
  if (!isTauri() || !root) return;
  const union = root.getBoundingClientRect();
  const unionWidth = Math.ceil(union.width);
  const unionHeight = Math.ceil(union.height);
  if (unionWidth <= 0 || unionHeight <= 0) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const workArea = await invoke<PetWorkArea>('pet_get_work_area');
    // The MENU window's own scale for the frame conversions — see
    // currentWindowScaleFactor.
    const winSf = await currentWindowScaleFactor(workArea.scale_factor || 1);
    await invoke('pet_menu_set_size', {
      width: Math.round(unionWidth * winSf),
      height: Math.round(unionHeight * winSf),
    });
    // Leftward submenu only: keep the main card pinned to its open position.
    // The shift is the submenu card's left-extent (its left edge minus the
    // union's left edge) — measured live so a size/opacity swap (4 vs 5
    // radio rows are the same width, but locale/font drift is covered) stays
    // exact. Hidden → restore the open position (union == main card).
    if (side === 'left' && openPos) {
      const main = root.querySelector<HTMLElement>('.pet-menu-root');
      const mainRect = main?.getBoundingClientRect();
      const shiftLogical = mainRect ? mainRect.left - union.left : 0;
      await invoke('pet_menu_set_position', {
        x: Math.round((openPos.x - shiftLogical) * winSf),
        y: Math.round(openPos.y * winSf),
      });
    }
  } catch (err) {
    console.warn('[pet-menu] sync submenu window failed:', err);
  }
}

/**
 * The pet right-click menu window root. Mounts only in the `pet-menu` Tauri
 * window (see `main.tsx` `#/pet-menu` route). On mount: hydrates petStore
 * (reads petSize / petOpacity / petClickThrough for the radio + toggle
 * pre-checks), renders the menu, measures its DOM, computes a quadrant-aware
 * position, sizes + positions + shows the window in one frame (no flash at
 * the default origin — mirrors the `pet-bubble` open path).
 *
 * ESC + window-blur (click outside) hides the window. Item clicks emit
 * `pet://menu-action` + hide. The size/opacity submenus are floating
 * secondary cards (hover-triggered); picking a radio closes the whole menu
 * (native submenu behavior).
 */
export function PetMenuApp(): JSX.Element {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const [petSize, setPetSize] = useState<PetSize>(PET_SIZE_DEFAULT);
  const [petOpacity, setPetOpacity] = useState<string>('100');
  const [petClickThrough, setPetClickThrough] = useState<boolean>(false);
  const [hoveredSection, setHoveredSection] = useState<HoveredSection>(null);
  const [submenuSide, setSubmenuSide] = useState<SubmenuSide>('right');
  const showTimeoutRef = useRef<number | null>(null);
  const hideTimeoutRef = useRef<number | null>(null);
  // The main card's screen position (logical px) from the last open. The
  // leftward-submenu path pins the main card to this exact spot while the
  // window shifts around it (see `syncSubmenuWindow`).
  const openPosRef = useRef<{ x: number; y: number } | null>(null);

  // Native transparency: Tauri's `transparent: true` config does not
  // reliably disable the macOS WKWebView's opaque background on all builds,
  // leaving a white rect behind the menu card (the webview paints its own
  // background before the page, so CSS `background: transparent !important`
  // cannot remove it). `pet_make_transparent` flips NSWindow opaque=NO +
  // backgroundColor=clear + WKWebView drawsBackground=NO on the main thread
  // — the same mount-time call PetApp makes for the pet window.
  useEffect(() => {
    if (!isTauri()) return;
    void import('@tauri-apps/api/core').then(({ invoke }) =>
      invoke('pet_make_transparent', { label: 'pet-menu' }).catch((err) => {
        console.warn('[pet-menu] pet_make_transparent failed:', err);
      }),
    );
  }, []);

  // petStore is hydrated eagerly by `settingsPersistence.settingsLoadDone`
  // (runs once per realm at module load — same as the main window). The
  // menu window is a separate JS realm with its own petStore instance;
  // mirror PetBubbleApp's cross-window sync: listen for
  // `pet://settings-updated` (emitted by the main window after each setter
  // persist) and re-hydrate so size/opacity/click-through stay fresh
  // across windows without a manual reload.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen<Record<string, unknown>>(
        'pet://settings-updated',
        (event) => {
          if (event.payload) hydrateAllStores(event.payload);
        },
      );
    })();
    return () => unlisten?.();
  }, []);

  // Subscribe to store changes so a size/opacity pick updates the radio
  // pre-check immediately. Cross-window picks land via the
  // `pet://settings-updated` listener above, which calls `hydrateAllStores`
  // → the store mutates → this subscribe fires → state mirrors update.
  useEffect(() => {
    const unsub = usePetStore.subscribe((s) => {
      setPetSize(s.petSize);
      setPetOpacity(s.petOpacity);
      setPetClickThrough(s.petClickThrough);
    });
    return unsub;
  }, []);

  // ESC + window-blur → hide. Mounted once on the menu window. Keydown is
  // on `document` (the WKWebView is made first responder by
  // `pet_menu_show`'s `makeFirstResponder` so document receives it). Blur
  // is the current Tauri window's `tauri://blur` event (fires when the user
  // clicks outside the menu).
  useEffect(() => {
    if (!isTauri()) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        hideMenu();
      }
    };
    document.addEventListener('keydown', onKey);
    let unlistenBlur: (() => void) | undefined;
    (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      const unlisten = await win.onFocusChanged(({ payload: focused }) => {
        // ponytail: `onFocusChanged` fires both focus-gained and focus-lost.
        // The menu grabs focus on show (`pet_menu_show`'s `set_focus`); when
        // the user clicks elsewhere the window loses focus → hide. We do NOT
        // hide on the initial focus-gain (the show path sets focus and this
        // listener fires `focused=true` immediately — guard with `if (!focused)`.
        if (!focused) hideMenu();
      });
      unlistenBlur = unlisten;
    })();
    return () => {
      document.removeEventListener('keydown', onKey);
      unlistenBlur?.();
    };
  }, []);

  // Open path: measure rendered DOM + compute quadrant-aware position +
  // size/position/show the window. Runs in response to a `pet://menu-show`
  // event (emitted by `openPetContextMenu` in `PetContextMenu.tsx`). The
  // window is `visible:false` at app launch, so the React tree mounts but
  // the menu does NOT show itself until the user right-clicks the pet.
  // The measure path re-runs every fire so locale-changed label widths
  // still position correctly.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen('pet://menu-show', () => {
        // Reset submenu state on every open so a size/opacity pick from the
        // previous open doesn't leave the submenu visible on the next open.
        // The pet-menu window is created once and shown/hidden repeatedly —
        // React `hoveredSection` state persists across opens; without this
        // reset, picking a radio (which only calls `pet_menu_hide`, not
        // `setHoveredSection(null)`) leaves the submenu rendered, and the
        // next `pet://menu-show` measures a wrapper that already includes
        // the submenu card. `setTimeout(0)` defers `openMenu` past the state
        // update so the measure sees the wrapper WITHOUT the submenu.
        clearShow();
        clearHide();
        setHoveredSection(null);
        // ponytail: `setTimeout(0)` — NOT `requestAnimationFrame`. The
        // pet-menu window is `visible:false` at app launch and stays hidden
        // until the user right-clicks the pet; WKWebView SUSPENDS rAF
        // callbacks for non-visible windows (the callback never fires, so
        // openMenu never ran and the right-click menu never appeared —
        // reproduced in dev with the pet-menu window hidden). setTimeout
        // is a macrotask and fires even while the window is hidden. The
        // deferral purpose is unchanged: run after React commits the
        // `setHoveredSection(null)` reset so the measured DOM excludes a
        // stale submenu card.
        window.setTimeout(() => {
          void (async () => {
            const placed = await openMenu(rootRef.current, petSize);
            if (placed) {
              openPosRef.current = placed.pos;
              setSubmenuSide(placed.side);
            }
          })();
        }, 0);
      });
    })();
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [petSize]);

  // Submenu show/hide (and petSize changes) → sync the window frame to the
  // wrapper's union: re-size, and for a leftward submenu also shift so the
  // main card stays pinned to its open position (see `syncSubmenuWindow`).
  // No re-show, no computePanelPosition recompute — the parent item under
  // the cursor never moves, so no enter/leave "shake" loop can start.
  useEffect(() => {
    if (!isTauri()) return;
    void syncSubmenuWindow(
      rootRef.current,
      submenuSide,
      openPosRef.current,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoveredSection, submenuSide, petSize]);

  // Clear pending submenu show/hide timeouts on unmount so a pending show
  // doesn't fire after the window is torn down.
  useEffect(() => {
    return () => {
      if (showTimeoutRef.current) clearTimeout(showTimeoutRef.current);
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, []);

  const clearShow = () => {
    if (showTimeoutRef.current) {
      clearTimeout(showTimeoutRef.current);
      showTimeoutRef.current = null;
    }
  };
  const clearHide = () => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  };

  const showSubmenu = (section: 'size' | 'opacity', offsetTop: number) => {
    clearHide();
    if (hoveredSection?.section === section) return; // already showing this section
    clearShow();
    // 150ms show delay so rapid hovering across parent items doesn't flicker
    // the submenu. Tracked in showTimeoutRef so a subsequent hide can cancel
    // it (race: hover → schedule show → leave before 150ms → schedule hide →
    // show would fire anyway without this clear).
    showTimeoutRef.current = window.setTimeout(() => {
      setHoveredSection({ section, offsetTop });
    }, 150);
  };

  const hideSubmenu = () => {
    clearShow();
    clearHide();
    // 200ms hide delay gives the user room to cross the diagonal gap between
    // the parent item and the floating submenu card without the submenu
    // snapping closed mid-transit.
    hideTimeoutRef.current = window.setTimeout(() => {
      setHoveredSection(null);
    }, 200);
  };

  return (
    <div className="pet-menu-window-root" ref={rootRef}>
      <div className="pet-menu-root" role="menu">
        <button
          className="pet-menu-item"
          role="menuitem"
          onClick={() => emitMenuActionAndHide('show-main')}
        >
          <span>{t('pet:menu.showMain')}</span>
        </button>
        <button
          className="pet-menu-item"
          role="menuitem"
          onClick={() => emitMenuActionAndHide('hide-pet')}
        >
          <span>{t('pet:menu.hidePet')}</span>
        </button>

        {/* Size submenu — hover- or click-triggered floating card. Clicking
         * the parent opens the submenu immediately (clears pending show/hide
         * first so click doesn't race with a pending hover). */}
        <button
          className="pet-menu-item pet-menu-item--parent"
          role="menuitem"
          aria-expanded={hoveredSection?.section === 'size'}
          onMouseEnter={(e) => showSubmenu('size', e.currentTarget.offsetTop)}
          onMouseLeave={hideSubmenu}
          onClick={(e) => {
            clearShow();
            clearHide();
            setHoveredSection({ section: 'size', offsetTop: e.currentTarget.offsetTop });
          }}
        >
          <span>{t('pet:menu.sizeSubmenu')}</span>
          <span className="pet-menu-chevron">▸</span>
        </button>

        {/* Opacity submenu — hover- or click-triggered floating card. */}
        <button
          className="pet-menu-item pet-menu-item--parent"
          role="menuitem"
          aria-expanded={hoveredSection?.section === 'opacity'}
          onMouseEnter={(e) => showSubmenu('opacity', e.currentTarget.offsetTop)}
          onMouseLeave={hideSubmenu}
          onClick={(e) => {
            clearShow();
            clearHide();
            setHoveredSection({ section: 'opacity', offsetTop: e.currentTarget.offsetTop });
          }}
        >
          <span>{t('pet:menu.opacitySubmenu')}</span>
          <span className="pet-menu-chevron">▸</span>
        </button>

        <button
          className={`pet-menu-item pet-menu-item--toggle${
            petClickThrough ? ' is-checked' : ''
          }`}
          role="menuitemcheckbox"
          aria-checked={petClickThrough}
          onClick={() => {
            const next = !petClickThrough;
            setPetClickThrough(next);
            emitMenuActionAndHide('toggle-pet-click-through', {
              clickThrough: next,
            });
          }}
        >
          <span>{t('pet:menu.clickThrough')}</span>
          <span className="pet-menu-check" aria-hidden="true">{petClickThrough ? '✓' : ''}</span>
        </button>

        <div className="pet-menu-sep" />

        <button
          className="pet-menu-item"
          role="menuitem"
          onClick={() => emitMenuActionAndHide('exit-app')}
        >
          <span>{t('pet:menu.exitApp')}</span>
        </button>
      </div>

      {hoveredSection && (
        <div
          className={`pet-menu-submenu${
            submenuSide === 'left' ? ' pet-menu-submenu--left' : ''
          }`}
          role="group"
          style={{ marginTop: hoveredSection.offsetTop }}
          onMouseEnter={() => {
            // Crossing from parent item onto the submenu card — cancel the
            // pending hide so the submenu stays open while the user is on it.
            clearHide();
          }}
          onMouseLeave={hideSubmenu}
        >
          {hoveredSection.section === 'size'
            ? SIZE_LEVELS.map((level) => (
                <button
                  key={level}
                  className={`pet-menu-item pet-menu-item--radio${
                    petSize === level ? ' is-checked' : ''
                  }`}
                  role="menuitemradio"
                  aria-checked={petSize === level}
                  onClick={() => {
                    // No local setPetSize — the menu is closing anyway; the
                    // store updates via the emit path + `pet://settings-updated`
                    // re-hydrate on next open.
                    emitMenuActionAndHide('set-pet-size', { size: level });
                  }}
                >
                  <span className="pet-menu-radio" />
                  {level}%
                </button>
              ))
            : OPACITY_LEVELS.map((level) => (
                <button
                  key={level}
                  className={`pet-menu-item pet-menu-item--radio${
                    petOpacity === level ? ' is-checked' : ''
                  }`}
                  role="menuitemradio"
                  aria-checked={petOpacity === level}
                  onClick={() => {
                    emitMenuActionAndHide('set-pet-opacity', { opacity: level });
                  }}
                >
                  <span className="pet-menu-radio" />
                  {level}%
                </button>
              ))}
        </div>
      )}
    </div>
  );
}
