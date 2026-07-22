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
 * Quick-action menu/launcher actions. The native pet right-click context
 * menu (built Rust-side in `commands::pet_show_context_menu`) surfaces six
 * items: `show-main`, `hide-pet`, `set-pet-size`, `set-pet-opacity`,
 * `toggle-pet-click-through`, `exit-app`.
 *
 * `hide-pet` is the sole "turn the pet off" entry — the old `disable-pet`
 * sibling was dropped from the right-click menu AND the pet-panel launcher
 * grid. `App.tsx` `handleAction` routes `hide-pet` to the same logic
 * (`setPetModeEnabled(false)` + `toggle_pet_mode`).
 *
 * `set-pet-size` carries `{ size: '50'|'75'|'100'|'125'|'150' }` on the event,
 * `set-pet-opacity` carries `{ opacity: '25'|'50'|'75'|'100' }`, and
 * `toggle-pet-click-through` carries `{ clickThrough: boolean }`. The Rust
 * `pet_ctx_menu_action` mapping emits the action string and the payload is
 * attached separately in `lib.rs::on_menu_event`.
 *
 * The remaining five launcher-only actions (`daily-note`, `global-search`,
 * `clip-from-url`, `command-palette`, `toggle-theme`) are dispatched by the
 * pet-panel launcher grid via the same `pet://menu-action` event channel —
 * they are NOT in the native right-click menu, but the action strings are
 * recognized by `pet_ctx_menu_action` in `lib.rs` so the contract stays
 * uniform and the frontend↔Rust sync test (see PetContextMenu.test.tsx)
 * covers the full set.
 *
 * `open-ai-settings` is dispatched by secondary windows (voice-orb caption
 * link, pet-panel chat CTA / session-header "AI 设置" button) that cannot
 * touch the main window's navStore directly (separate JS realm). The action
 * is routed by `routePetMenuAction` in the MAIN window, which sets
 * `currentPage='settings'` + `settingsTab='ai'` and focuses main.
 */
export type PetMenuAction =
  | 'show-main'
  | 'hide-pet'
  | 'set-pet-size'
  | 'set-pet-opacity'
  | 'toggle-pet-click-through'
  | 'exit-app'
  | 'daily-note'
  | 'global-search'
  | 'clip-from-url'
  | 'command-palette'
  | 'toggle-theme'
  | 'open-ai-settings';

/** Payload for `pet://menu-action` events. `set-pet-size` carries the size
 *  level, `set-pet-opacity` the opacity level, `toggle-pet-click-through`
 *  the next bool; all other actions use only `action`. */
export interface PetMenuActionPayload {
  action: PetMenuAction;
  size?: '50' | '75' | '100' | '125' | '150';
  opacity?: '25' | '50' | '75' | '100';
  clickThrough?: boolean;
}

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
  'hide-pet',
  'set-pet-size',
  'set-pet-opacity',
  'toggle-pet-click-through',
  'exit-app',
] as const;

export const PET_LAUNCHER_ACTIONS: readonly PetMenuAction[] = [
  'daily-note',
  'global-search',
  'clip-from-url',
  'command-palette',
  'toggle-theme',
  'open-ai-settings',
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
 *
 * Reads the current locale from `i18n.language`. The pet window is a
 * separate JS realm with its own i18next instance; the main window's
 * `setLocale` emits `locale://changed` (see `localeStore.ts`), and a
 * listener in `PetApp.tsx` calls `i18n.changeLanguage` on this window's
 * own instance — so `i18n.language` here tracks the user's choice
 * without the caller threading locale through. The Rust side falls back
 * to English for unknown locales.
 */
export async function openPetContextMenu(): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  const i18n = (await import('@/i18n')).default;
  const locale = i18n.language || 'en';
  await invoke('pet_show_context_menu', { locale });
}
