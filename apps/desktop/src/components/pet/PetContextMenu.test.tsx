import { describe, it, expect } from 'vitest';

// Pet context menu is now a *native* OS popup built Rust-side (issue #1 fix:
// the 120x120 pet window clipped the HTML menu). The frontend contract is:
//   (1) `PET_MENU_ACTIONS` lists exactly the actions that the Rust side
//       recognizes (kept in sync with `pet_ctx_menu_action` in lib.rs),
//   (2) `openPetContextMenu()` invokes the `pet_show_context_menu` Tauri
//       command, which shows the native menu; selections are delivered via
//       the `pet://menu-action` event (listened to in App.tsx).
//
// PR1 of the pet-quick-action-panel task extends the contract: the union now
// also includes the 5 launcher-only actions dispatched by the pet-panel
// launcher grid (daily-note, global-search, clip-from-url, command-palette,
// toggle-theme). The native right-click menu still surfaces only the first
// four (`PET_NATIVE_MENU_ACTIONS`); the launcher dispatches the rest.
//
// `@tauri-apps/api/core` is mocked globally via vitest.workspace.ts alias
// (test/mocks/@tauri-apps/api/core.ts) and reset in beforeEach.

import { invoke } from '@tauri-apps/api/core';
import {
  PET_MENU_ACTIONS,
  PET_NATIVE_MENU_ACTIONS,
  PET_LAUNCHER_ACTIONS,
  openPetContextMenu,
  type PetMenuAction,
} from './PetContextMenu';

describe('PetContextMenu (native popup + launcher contract)', () => {
  it('PET_NATIVE_MENU_ACTIONS lists the four native right-click actions', () => {
    expect(PET_NATIVE_MENU_ACTIONS).toEqual([
      'show-main',
      'new-note',
      'toggle-ai',
      'disable-pet',
    ]);
  });

  it('PET_LAUNCHER_ACTIONS lists the five pet-panel launcher actions', () => {
    expect(PET_LAUNCHER_ACTIONS).toEqual([
      'daily-note',
      'global-search',
      'clip-from-url',
      'command-palette',
      'toggle-theme',
    ]);
  });

  it('PET_MENU_ACTIONS is the union of native + launcher actions', () => {
    expect(PET_MENU_ACTIONS).toEqual([
      'show-main',
      'new-note',
      'toggle-ai',
      'disable-pet',
      'daily-note',
      'global-search',
      'clip-from-url',
      'command-palette',
      'toggle-theme',
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

  it('openPetContextMenu invokes the pet_show_context_menu Tauri command', async () => {
    await openPetContextMenu();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('pet_show_context_menu');
  });
});
