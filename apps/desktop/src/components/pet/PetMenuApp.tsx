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
// Submenus (size, opacity) expand inline (accordion) below their parent item
// on click — single-column layout, no side-overflow positioning. Only one
// submenu open at a time (opening one closes the other).
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

/** Accordion section state — `null` = all collapsed, otherwise the open
 *  section's key. Only one open at a time. */
type AccordionSection = 'size' | 'opacity' | null;

/** Emit a `pet://menu-action` event with the given payload. Swallows errors
 *  so the click path never throws into React state. Used for size/opacity
 *  picks where the menu stays open so the user can keep exploring. */
async function emitMenuAction(
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
}

/** Emit + hide. Used for top-level actions (show-main, hide-pet,
 *  click-through toggle, exit-app) — the menu closes after the action
 *  fires, matching the native NSMenu auto-close behavior. */
async function emitMenuActionAndHide(
  action: PetMenuAction,
  payload?: { size?: PetSize; opacity?: string; clickThrough?: boolean },
): Promise<void> {
  await emitMenuAction(action, payload);
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('pet_menu_hide');
    } catch (err) {
      console.warn('[pet-menu] hide failed:', err);
    }
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
 * size + position + show the `pet-menu` window in one frame. Called on each
 * `pet://menu-show` event so a locale change (which shifts label widths)
 * re-positions correctly. Swallows errors so a missing window / failed
 * invoke doesn't break the open path — the menu just doesn't appear.
 */
async function openMenu(
  root: HTMLDivElement | null,
  petSize: PetSize,
): Promise<void> {
  if (!isTauri() || !root) return;
  const rect = root.getBoundingClientRect();
  const menuWidth = Math.ceil(rect.width);
  const menuHeight = Math.ceil(rect.height);
  if (menuWidth <= 0 || menuHeight <= 0) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const [petPos, workArea] = await Promise.all([
      invoke<PetPositionResult>('get_pet_position'),
      invoke<PetWorkArea>('pet_get_work_area'),
    ]);
    const sf = workArea.scale_factor || 1;
    // petPos is physical px → logical for the math (matches petPosition.ts
    // unit contract), then × sf back to physical for set_position.
    const petPosLogical = { x: petPos.x / sf, y: petPos.y / sf };
    const posLogical = computePanelPosition(
      petPosLogical,
      workArea,
      { width: menuWidth, height: menuHeight },
      petSize,
    );
    await invoke('pet_menu_set_size', {
      width: Math.round(menuWidth * sf),
      height: Math.round(menuHeight * sf),
    });
    await invoke('pet_menu_set_position', {
      x: Math.round(posLogical.x * sf),
      y: Math.round(posLogical.y * sf),
    });
    await invoke('pet_menu_show');
  } catch (err) {
    console.warn('[pet-menu] open path failed:', err);
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
 * ESC + window-blur (click outside) hide the window. Item clicks emit
 * `pet://menu-action` + hide. The size/opacity accordion items emit the
 * `set-pet-size` / `set-pet-opacity` actions but do NOT close the menu —
 * the user can pick a size and continue interacting (the menu stays open
 * until they click a top-level action or ESC). The native menu auto-closed
 * on every pick; staying open for size/opacity is intentional UX —
 * adjusting size is a multi-step exploration.
 */
export function PetMenuApp(): JSX.Element {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const [petSize, setPetSize] = useState<PetSize>(PET_SIZE_DEFAULT);
  const [petOpacity, setPetOpacity] = useState<string>('100');
  const [petClickThrough, setPetClickThrough] = useState<boolean>(false);
  const [openSection, setOpenSection] = useState<AccordionSection>(null);

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
  // pre-check immediately. Local picks (from this menu) write to petStore
  // here; cross-window picks land via the `pet://settings-updated` listener
  // above, which calls `hydrateAllStores` → the store mutates → this
  // subscribe fires → state mirrors update.
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
        void openMenu(rootRef.current, petSize);
      });
    })();
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [petSize]);

  const toggleSection = (s: 'size' | 'opacity') =>
    setOpenSection((cur) => (cur === s ? null : s));

  return (
    <div className="pet-menu-root" ref={rootRef} role="menu">
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

      {/* Size submenu — inline accordion. */}
      <button
        className="pet-menu-item pet-menu-item--parent"
        role="menuitem"
        aria-expanded={openSection === 'size'}
        onClick={() => toggleSection('size')}
      >
        <span>{t('pet:menu.sizeSubmenu')}</span>
        <span className="pet-menu-chevron">
          {openSection === 'size' ? '▾' : '▸'}
        </span>
      </button>
      {openSection === 'size' && (
        <div className="pet-menu-submenu" role="group">
          {SIZE_LEVELS.map((level) => (
            <button
              key={level}
              className={`pet-menu-item pet-menu-item--radio${
                petSize === level ? ' is-checked' : ''
              }`}
              role="menuitemradio"
              aria-checked={petSize === level}
              onClick={() => {
                setPetSize(level);
                emitMenuAction('set-pet-size', { size: level });
              }}
            >
              <span className="pet-menu-radio" />
              {level}%
            </button>
          ))}
        </div>
      )}

      {/* Opacity submenu — inline accordion. */}
      <button
        className="pet-menu-item pet-menu-item--parent"
        role="menuitem"
        aria-expanded={openSection === 'opacity'}
        onClick={() => toggleSection('opacity')}
      >
        <span>{t('pet:menu.opacitySubmenu')}</span>
        <span className="pet-menu-chevron">
          {openSection === 'opacity' ? '▾' : '▸'}
        </span>
      </button>
      {openSection === 'opacity' && (
        <div className="pet-menu-submenu" role="group">
          {OPACITY_LEVELS.map((level) => (
            <button
              key={level}
              className={`pet-menu-item pet-menu-item--radio${
                petOpacity === level ? ' is-checked' : ''
              }`}
              role="menuitemradio"
              aria-checked={petOpacity === level}
              onClick={() => {
                setPetOpacity(level);
                emitMenuAction('set-pet-opacity', { opacity: level });
              }}
            >
              <span className="pet-menu-radio" />
              {level}%
            </button>
          ))}
        </div>
      )}

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
        <span className="pet-menu-check">{petClickThrough ? '✓' : ''}</span>
        {t('pet:menu.clickThrough')}
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
  );
}
