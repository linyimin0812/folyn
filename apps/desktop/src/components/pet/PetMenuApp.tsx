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
// item → after a short delay the submenu card appears to the right of the
// main card, vertically aligned with the parent item's top edge. This mirrors
// native macOS NSMenu submenus (no click-to-expand-inline accordion). Only one
// submenu visible at a time; hovering the other parent swaps. Picking a radio
// closes the whole menu (native submenu behavior).
//
// Mouse-only + ESC. No arrow-key / role=menuitem keyboard nav in MVP.

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isTauri } from '@/utils/platform';
import {
  computePanelPosition,
  PET_SIZE_DEFAULT,
  type PetSize,
  type PetWorkArea,
} from './petPosition';
import type { PetMenuAction } from './PetContextMenu';
import { usePetStore } from '@/store/petStore';
import { hydrateAllStores } from '@/store/settingsPersistence';

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

/** Which submenu is currently visible (hover-triggered), plus the parent
 *  item's vertical offset so the floating card can align with it. */
type HoveredSection = { section: 'size' | 'opacity'; offsetTop: number } | null;

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
 * `computePanelPosition`'s corner-attach math from `petPosition.ts`), then
 * size + position the `pet-menu` window. Used both on the open path (followed
 * by `pet_menu_show`) and on submenu show/hide (the window is already visible
 * — caller must NOT re-show, that would flicker / steal focus). Swallows
 * errors so a missing window / failed invoke doesn't break the open path.
 *
 * The root passed here is `.pet-menu-window-root`, whose `getBoundingClientRect`
 * returns the union of the main card + the floating submenu when the submenu
 * is rendered — so the OS window grows to fit both cards.
 *
 * `reposition` defaults to `true` (the open path needs quadrant-aware
 * positioning before show). The submenu show/hide path passes `false` — when
 * the floating submenu appears/disappears, only the window SIZE changes (the
 * union rect grows/shrinks); the window's top-left must STAY FIXED so the
 * main card doesn't move out from under the mouse. If the submenu path
 * re-positions, the recomputed top-left (based on the new larger size) shifts
 * the window → the parent item moves → `onMouseLeave` fires → submenu hides
 * after 200ms → window shrinks → position recomputed back → `onMouseEnter`
 * fires → submenu shows after 150ms → … enter/leave feedback loop = "shake".
 * Holding the position breaks the loop. (The open path's `computePanelPosition`
 * clamps the LARGER union to the work area — that clamp is correct there
 * because the user just right-clicked and the menu is fresh; on submenu
 * toggle the user is mid-interaction and any movement is hostile.)
 *
 * The adaptive submenu side (`computeSubmenuSide`, called by `openMenu`
 * AFTER this) mitigates the "wider union overflows on the submenu side"
 * concern from the previous paragraph — the submenu flips to whichever side
 * has more room at open time, so the visible content stays clear of the
 * screen edge even without re-positioning on submenu toggle.
 */
async function resizeAndReposition(
  root: HTMLDivElement | null,
  petSize: PetSize,
  reposition = true,
): Promise<void> {
  if (!isTauri() || !root) return;
  const rect = root.getBoundingClientRect();
  const menuWidth = Math.ceil(rect.width);
  const menuHeight = Math.ceil(rect.height);
  if (menuWidth <= 0 || menuHeight <= 0) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    // Always fetch workArea — it carries `scale_factor` (needed for the
    // logical→physical `set_size` multiply even when we skip positioning)
    // AND is needed for `computePanelPosition` when repositioning. One IPC
    // call covers both; cheaper than a separate `get_scale_factor` command.
    const workArea = await invoke<PetWorkArea>('pet_get_work_area');
    const sf = workArea.scale_factor || 1;
    await invoke('pet_menu_set_size', {
      width: Math.round(menuWidth * sf),
      height: Math.round(menuHeight * sf),
    });
    if (reposition) {
      const petPos = await invoke<PetPositionResult>('get_pet_position');
      // petPos is physical px → logical for the math (matches petPosition.ts
      // unit contract), then × sf back to physical for set_position.
      const petPosLogical = { x: petPos.x / sf, y: petPos.y / sf };
      const posLogical = computePanelPosition(
        petPosLogical,
        workArea,
        { width: menuWidth, height: menuHeight },
        petSize,
      );
      await invoke('pet_menu_set_position', {
        x: Math.round(posLogical.x * sf),
        y: Math.round(posLogical.y * sf),
      });
    }
  } catch (err) {
    console.warn('[pet-menu] resize/reposition failed:', err);
  }
}

/** Submenu opens toward the side with more screen room — mirrors native
 *  macOS NSMenu behavior. `'right'` is the default (matches the pre-fix
 *  always-right layout); `'left'` flips the submenu to render before the main
 *  card via `order: -1` so it extends leftward away from the screen's right
 *  edge. See `openMenu` for the room-on-the-right check that picks the side. */
type SubmenuSide = 'left' | 'right';

/** Submenu min-width (120) + gap (6) + ~10px buffer, in logical px. If the
 *  room to the right of the main card is less than this, flip the submenu
 *  to the left side. */
const SUBMENU_FLIP_THRESHOLD_LOGICAL = 136;

/**
 * Open path: measure rendered DOM + compute quadrant-aware position +
 * size/position/show the window. Re-runs on every `pet://menu-show` event
 * so a locale change (which shifts label widths) re-positions correctly.
 * Delegates the measure+size+position work to `resizeAndReposition` so the
 * submenu-toggle path can reuse it without re-showing the window.
 *
 * After positioning, picks which side the submenu should open toward based
 * on which side of the main card has more screen room. The side is returned
 * to the caller (which sets React state) so the submenu's `--left` modifier
 * applies before the submenu is first rendered.
 */
async function openMenu(
  root: HTMLDivElement | null,
  petSize: PetSize,
): Promise<SubmenuSide> {
  if (!isTauri() || !root) return 'right';
  await resizeAndReposition(root, petSize);
  const side = await computeSubmenuSide(root);
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('pet_menu_show');
  } catch (err) {
    console.warn('[pet-menu] open path failed:', err);
  }
  return side;
}

/**
 * Pick the submenu side based on room to the right of the main card. The
 * window has just been positioned by `resizeAndReposition`, so its
 * `outerPosition()` is the physical top-left of the main card. The wrapper
 * rect's `right` is the logical width of the main card (no submenu rendered
 * yet at open time). Convert both to physical px and compare against the
 * work area's right edge. If the right side has less than
 * `SUBMENU_FLIP_THRESHOLD_LOGICAL * sf` room, the submenu flips left.
 */
async function computeSubmenuSide(root: HTMLDivElement): Promise<SubmenuSide> {
  if (!isTauri()) return 'right';
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const { invoke } = await import('@tauri-apps/api/core');
    const win = getCurrentWindow();
    const winPos = await win.outerPosition();
    const rect = root.getBoundingClientRect();
    const workArea = await invoke<PetWorkArea>('pet_get_work_area');
    const sf = workArea.scale_factor || 1;
    const mainCardRightPhysical = winPos.x + rect.right * sf;
    const workAreaRightPhysical = (workArea.x + workArea.width) * sf;
    const roomRight = workAreaRightPhysical - mainCardRightPhysical;
    return roomRight < SUBMENU_FLIP_THRESHOLD_LOGICAL * sf ? 'left' : 'right';
  } catch (err) {
    console.warn('[pet-menu] computeSubmenuSide failed:', err);
    return 'right';
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
        void openMenu(rootRef.current, petSize).then((side) => {
          setSubmenuSide(side);
        });
      });
    })();
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [petSize]);

  // Submenu show/hide → re-measure + re-size the menu window (NOT re-show,
  // NOT re-position). When the floating submenu appears, the wrapper's union
  // bounding box grows (main card + submenu card to the right); the OS window
  // was sized for the main card alone at open time, so without a re-size the
  // submenu would be clipped (transparent borderless NSPanel has no scroll).
  //
  // `reposition: false` here is the critical fix: re-positioning recomputes
  // the window's top-left from the new (larger) union rect, which shifts the
  // main card on screen → parent item moves out from under the mouse →
  // onMouseLeave → hideSubmenu (200ms) → submenu disappears → window shrinks
  // → position recomputed back → onMouseEnter → showSubmenu (150ms) → …
  // enter/leave feedback loop visible as "shaking". Holding the position
  // keeps the main card under the cursor so the loop never starts. The open
  // path's `computePanelPosition` already clamped the (smaller) main card to
  // the work area; the wider union may overflow on the submenu side, but the
  // submenu floats over transparent space so the visible content stays clear
  // of the screen edge in practice.
  useEffect(() => {
    if (!isTauri()) return;
    void resizeAndReposition(rootRef.current, petSize, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoveredSection, petSize]);

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
          {t('pet:menu.showMain')}
        </button>
        <button
          className="pet-menu-item"
          role="menuitem"
          onClick={() => emitMenuActionAndHide('hide-pet')}
        >
          {t('pet:menu.hidePet')}
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
          {t('pet:menu.exitApp')}
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
