import { describe, it, expect, beforeEach } from 'vitest';

// Pet context menu is now a *native* OS popup built Rust-side (issue #1 fix:
// the 120x120 pet window clipped the HTML menu). The frontend contract is:
//   (1) `PET_MENU_ACTIONS` lists exactly the actions that the Rust side
//       recognizes (kept in sync with `pet_ctx_menu_action` in lib.rs),
//   (2) `openPetContextMenu()` invokes the `pet_show_context_menu` Tauri
//       command with the current locale read from `i18n.language`. The pet
//       window is a separate JS realm with its own i18next instance; the
//       main window's `setLocale` emits `locale://changed`, a listener in
//       `PetApp.tsx` applies the new locale to this realm's i18next, so
//       `i18n.language` stays current. Selections are delivered via the
//       `pet://menu-action` event.
//
// PR1 of the pet-quick-action-panel task extends the contract: the union now
// also includes the 5 launcher-only actions dispatched by the pet-panel
// launcher grid (daily-note, global-search, clip-from-url, command-palette,
// toggle-theme). The native right-click menu surfaces the first six
// (`PET_NATIVE_MENU_ACTIONS`: show-main, new-note, toggle-ai, hide-pet,
// set-pet-size, disable-pet); the launcher dispatches the rest.
// `hide-pet` is the Chinese-labeled sibling of `disable-pet` (same behavior);
// `set-pet-size` carries a `{ size }` payload on the event.
//
// `@tauri-apps/api/core` is mocked globally via vitest.workspace.ts alias
// (test/mocks/@tauri-apps/api/core.ts) and reset in beforeEach.

import { invoke } from '@tauri-apps/api/core';
import i18n from '@/i18n';
import {
  PET_MENU_ACTIONS,
  PET_NATIVE_MENU_ACTIONS,
  PET_LAUNCHER_ACTIONS,
  openPetContextMenu,
  type PetMenuAction,
} from './PetContextMenu';

describe('PetContextMenu (native popup + launcher contract)', () => {
  beforeEach(() => {
    // `openPetContextMenu` reads `i18n.language`; pin it here so the invoke
    // payload is deterministic. i18next is a shared singleton across the
    // test file, so we restore it after each test.
    void i18n.changeLanguage('zh');
  });

  it('PET_NATIVE_MENU_ACTIONS lists the six native right-click actions', () => {
    expect(PET_NATIVE_MENU_ACTIONS).toEqual([
      'show-main',
      'new-note',
      'toggle-ai',
      'hide-pet',
      'set-pet-size',
      'disable-pet',
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
    ]);
  });

  it('PET_MENU_ACTIONS is the union of native + launcher actions', () => {
    expect(PET_MENU_ACTIONS).toEqual([
      'show-main',
      'new-note',
      'toggle-ai',
      'hide-pet',
      'set-pet-size',
      'disable-pet',
      'daily-note',
      'global-search',
      'clip-from-url',
      'command-palette',
      'toggle-theme',
      'open-ai-settings',
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

  it('openPetContextMenu invokes pet_show_context_menu with the current locale', async () => {
    await openPetContextMenu();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('pet_show_context_menu', { locale: 'zh' });
  });

  it('openPetContextMenu tracks locale changes through i18n.language', async () => {
    void i18n.changeLanguage('en');
    await openPetContextMenu();
    expect(invoke).toHaveBeenCalledWith('pet_show_context_menu', { locale: 'en' });
  });
});
