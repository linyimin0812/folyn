import { describe, it, expect, beforeEach } from 'vitest';

// Pet right-click menu is a custom HTML window (`pet-menu` Tauri window —
// see `PetMenuApp.tsx`), replacing the native NSMenu path so the menu can
// be positioned adaptively outside the pet view (no overlap, no internal
// scroll arrows). The frontend contract is:
//   (1) `PET_MENU_ACTIONS` lists exactly the actions that the Rust side
//       recognizes (kept in sync with `pet_ctx_menu_action` in lib.rs),
//   (2) `openPetContextMenu()` emits the `pet://menu-show` event so the
//       `pet-menu` window measures its DOM, computes a quadrant-aware
//       position, and shows itself. No `invoke` is required on this path.
//       Selections are delivered via the `pet://menu-action` event.
//
// The native NSMenu path remains for the tray menu only (`tray_set_enabled`
// → `build_pet_context_menu`); the `PET_CTX_MENU_*` ids + `on_menu_event`
// handler stay, so the contract test below (the union) still covers the
// tray's action set.
//
// PR1 of the pet-quick-action-panel task extends the contract: the union
// now also includes the 5 launcher-only actions dispatched by the pet-panel
// launcher grid (daily-note, global-search, clip-from-url,
// command-palette, toggle-theme). The right-click HTML menu surfaces the
// first six (`PET_NATIVE_MENU_ACTIONS`: show-main, hide-pet, set-pet-size,
// set-pet-opacity, toggle-pet-click-through, exit-app); the launcher
// dispatches the rest. `hide-pet` is the sole "turn the pet off" entry —
// the old `new-note` / `toggle-ai` / `disable-pet` were dropped from the
// right-click menu (and `new-note` + `disable-pet` also from the launcher
// grid).
//
// `@tauri-apps/api/event` is mocked globally via vitest.workspace.ts alias
// (test/mocks/@tauri-apps/api/event.ts) and reset in beforeEach.

import { emit } from '@tauri-apps/api/event';
import i18n from '@/i18n';
import {
  PET_MENU_ACTIONS,
  PET_NATIVE_MENU_ACTIONS,
  PET_LAUNCHER_ACTIONS,
  openPetContextMenu,
  type PetMenuAction,
} from './PetContextMenu';

describe('PetContextMenu (HTML menu window + launcher contract)', () => {
  beforeEach(() => {
    // The HTML menu window has its own i18n instance hydrated from
    // `localeStore`; `openPetContextMenu` no longer threads a locale
    // parameter. Pin the test realm's locale anyway so any future
    // locale-aware code path on this emit remains deterministic.
    void i18n.changeLanguage('zh');
  });

  it('PET_NATIVE_MENU_ACTIONS lists the six native right-click actions', () => {
    expect(PET_NATIVE_MENU_ACTIONS).toEqual([
      'show-main',
      'hide-pet',
      'set-pet-size',
      'set-pet-opacity',
      'toggle-pet-click-through',
      'exit-app',
    ]);
  });

  it('PET_LAUNCHER_ACTIONS lists the pet-panel launcher actions', () => {
    expect(PET_LAUNCHER_ACTIONS).toEqual([
      'daily-note',
      'global-search',
      'clip-from-url',
      'command-palette',
      'toggle-theme',
      'open-ai-settings',
      'run-command',
      'open-plugins-settings',
      'open-plugin-tool',
    ]);
  });

  it('PET_MENU_ACTIONS is the union of native + launcher actions', () => {
    expect(PET_MENU_ACTIONS).toEqual([
      'show-main',
      'hide-pet',
      'set-pet-size',
      'set-pet-opacity',
      'toggle-pet-click-through',
      'exit-app',
      'daily-note',
      'global-search',
      'clip-from-url',
      'command-palette',
      'toggle-theme',
      'open-ai-settings',
      'run-command',
      'open-plugins-settings',
      'open-plugin-tool',
    ]);
  });

  it('every action is a valid PetMenuAction', () => {
    for (const action of PET_MENU_ACTIONS) {
      // TS narrows `action` to PetMenuAction here; if the const ever drifts
      // to a value outside the union, this assignment would fail to type-check.
      const _typed: PetMenuAction = action;
      expect(_typed).toBe(action);
    }
  });

  it('native and launcher action sets are disjoint', () => {
    const native = new Set<string>(PET_NATIVE_MENU_ACTIONS);
    for (const action of PET_LAUNCHER_ACTIONS) {
      expect(native.has(action)).toBe(false);
    }
  });

  it('openPetContextMenu emits pet://menu-show so the menu window opens', async () => {
    await openPetContextMenu();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('pet://menu-show', {});
  });
});
