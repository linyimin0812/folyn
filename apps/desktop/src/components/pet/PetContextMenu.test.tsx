import { describe, it, expect } from 'vitest';

// Pet context menu is now a *native* OS popup built Rust-side (issue #1 fix:
// the 120x120 pet window clipped the HTML menu). The frontend contract is:
//   (1) `PET_MENU_ACTIONS` lists exactly the D8 quick-actions that the Rust
//       menu can emit (kept in sync with `pet_ctx_menu_action` in lib.rs),
//   (2) `openPetContextMenu()` invokes the `pet_show_context_menu` Tauri
//       command, which shows the native menu; selections are delivered via
//       the `pet://menu-action` event (listened to in App.tsx).
//
// `@tauri-apps/api/core` is mocked globally via vitest.workspace.ts alias
// (test/mocks/@tauri-apps/api/core.ts) and reset in beforeEach.

import { invoke } from '@tauri-apps/api/core';
import {
  PET_MENU_ACTIONS,
  openPetContextMenu,
  type PetMenuAction,
} from './PetContextMenu';

describe('PetContextMenu (native popup contract)', () => {
  it('PET_MENU_ACTIONS lists the four D8 quick-actions', () => {
    expect(PET_MENU_ACTIONS).toEqual([
      'show-main',
      'new-note',
      'toggle-ai',
      'disable-pet',
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

  it('openPetContextMenu invokes the pet_show_context_menu Tauri command', async () => {
    await openPetContextMenu();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('pet_show_context_menu');
  });
});
