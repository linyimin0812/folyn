// Pet context menu — native OS popup (issue #1 fix).
//
// The pet Tauri window is only 120x120px, so an HTML `position: fixed`
// context menu (`min-width: 168px`) is clipped by the window bounds and part
// of it is invisible/unclickable. Instead, the right-click menu is shown as
// a *native* OS popup built Rust-side (`commands::pet_show_context_menu`),
// which is rendered by the OS and ignores the tiny window. Item selections
// fire `on_menu_event` in `lib.rs`, which emits `pet://menu-action` — the
// main window's existing listener in `App.tsx` dispatches the action.
//
// This module keeps the `PetMenuAction` contract (the union of actions the
// Rust side can emit) and exposes `openPetContextMenu()` for the pet
// frontend to call on right-click. App.tsx's listener needs no change.

/**
 * Quick-action menu/launcher actions. The first four (`show-main`,
 * `new-note`, `toggle-ai`, `disable-pet`) are surfaced by the native pet
 * right-click context menu (built Rust-side in `commands::pet_show_context_menu`).
 *
 * The remaining five (`daily-note`, `global-search`, `clip-from-url`,
 * `command-palette`, `toggle-theme`) are dispatched by the pet-panel launcher
 * grid (PR2) via the same `pet://menu-action` event channel — they are NOT in
 * the native right-click menu, but the action strings are recognized by
 * `pet_ctx_menu_action` in `lib.rs` so the contract stays uniform and the
 * frontend↔Rust sync test (see PetContextMenu.test.tsx) covers the full set.
 */
export type PetMenuAction =
  | 'show-main'
  | 'new-note'
  | 'toggle-ai'
  | 'disable-pet'
  | 'daily-note'
  | 'global-search'
  | 'clip-from-url'
  | 'command-palette'
  | 'toggle-theme';

/**
 * The complete set of actions the pet context-menu / pet-panel launcher can
 * emit via `pet://menu-action`. Kept in sync with the Rust menu item id →
 * action mapping in `lib.rs` (`pet_ctx_menu_action`). Tests assert this
 * matches the contract so a future Rust-side change that drops or renames an
 * action is caught here.
 *
 * `PET_NATIVE_MENU_ACTIONS` is the subset surfaced by the native right-click
 * menu; `PET_LAUNCHER_ACTIONS` is the subset dispatched by the pet-panel
 * launcher grid. `PET_MENU_ACTIONS` is the union (used by the contract test).
 */
export const PET_NATIVE_MENU_ACTIONS: readonly PetMenuAction[] = [
  'show-main',
  'new-note',
  'toggle-ai',
  'disable-pet',
] as const;

export const PET_LAUNCHER_ACTIONS: readonly PetMenuAction[] = [
  'daily-note',
  'global-search',
  'clip-from-url',
  'command-palette',
  'toggle-theme',
] as const;

export const PET_MENU_ACTIONS: readonly PetMenuAction[] = [
  ...PET_NATIVE_MENU_ACTIONS,
  ...PET_LAUNCHER_ACTIONS,
] as const;

/**
 * Show the native pet context menu at the cursor. Implemented Rust-side
 * (`pet_show_context_menu` Tauri command) because the pet window is too
 * small to host an HTML menu. Resolves after the user picks an item or
 * dismisses the menu; the chosen action is delivered separately via the
 * `pet://menu-action` event (listened to in `App.tsx`).
 */
export async function openPetContextMenu(): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('pet_show_context_menu');
}
