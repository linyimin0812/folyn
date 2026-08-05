// Pet context menu — custom HTML menu window (replaces native NSMenu).
//
// Originally the right-click menu was a native NSMenu built Rust-side
// (`commands::pet_show_context_menu` + muda's `popup_menu_at`), because the
// pet Tauri window is only 96x96px and an HTML `position: fixed` menu would
// be clipped by the window bounds (issue #1). The native path positioned
// the menu at the cursor / pet-view corner, but muda's
// `popUpMenuPositioningItem:atLocation:inView:` anchors the menu's top-left
// at a location INSIDE the pet view — macOS auto-shifts to keep the menu on
// screen, but the shift still left the menu overlapping the pet near screen
// edges, and when the shift left no room macOS showed scroll arrows inside
// the menu (the user reported this with the pet at screen bottom-right).
//
// The replacement: a custom HTML menu rendered in a dedicated borderless
// transparent Tauri window (`pet-menu`). The frontend measures the DOM,
// computes a quadrant-aware position (reusing `computePanelPosition`'s math
// from `petPosition.ts` — picks the menu corner that attaches to the pet's
// diagonally-opposite icon corner, gap away, no overlap), and calls
// `pet_menu_set_size` + `pet_menu_set_position` + `pet_menu_show`. Item
// clicks emit `pet://menu-action` (same channel as before); the main
// window's `usePetHostBridge` listener + `routePetMenuAction` dispatcher
// are unchanged. Closes on item click, ESC, and window blur (click
// outside). Submenus (size, opacity) expand inline (accordion).
//
// This module keeps the `PetMenuAction` contract (the union of actions the
// pet menu / launcher can emit) so `usePetHostBridge` and the contract test
// stay valid. `openPetContextMenu()` now opens the HTML menu window.

import { isTauri } from '@/utils/platform';

/**
 * Quick-action menu/launcher actions. The pet right-click HTML menu
 * (`PetMenuApp.tsx`) surfaces six items: `show-main`, `hide-pet`,
 * `set-pet-size`, `set-pet-opacity`, `toggle-pet-click-through`,
 * `exit-app`. The action strings are emitted on the `pet://menu-action`
 * event channel — the main window's `usePetHostBridge` listener routes
 * them via `routePetMenuAction`.
 *
 * `hide-pet` is the sole "turn the pet off" entry — the old `disable-pet`
 * sibling was dropped from the right-click menu AND the pet-panel launcher
 * grid. `App.tsx` `handleAction` routes `hide-pet` to the same logic
 * (`setPetModeEnabled(false)` + `toggle_pet_mode`).
 *
 * `set-pet-size` carries `{ size: '50'|'75'|'100'|'125'|'150' }` on the event,
 * `set-pet-opacity` carries `{ opacity: '25'|'50'|'75'|'100' }`, and
 * `toggle-pet-click-through` carries `{ clickThrough: boolean }`.
 *
 * The remaining five launcher-only actions (`daily-note`, `global-search`,
 * `clip-from-url`, `command-palette`, `toggle-theme`) are dispatched by the
 * pet-panel launcher grid via the same `pet://menu-action` event channel —
 * they are NOT in the right-click menu, but the action strings stay in this
 * union so the contract test (covers the full set) keeps passing.
 *
 * `open-ai-settings` is dispatched by secondary windows (voice-orb caption
 * link, pet-panel chat CTA / session-header "AI 设置" button) that cannot
 * touch the main window's navStore directly (separate JS realm). The action
 * is routed by `routePetMenuAction` in the MAIN window, which sets
 * `currentPage='settings'` + `settingsTab='ai'` and focuses main.
 *
 * `open-plugin-tool` is dispatched by the pet-panel search when the user
 * picks an installed plugin result — the MAIN window resolves the plugin's
 * registered `plugin.openTool.<pluginId>.<toolId>` command and opens its
 * tool window (popup); plugins without a window tool fall back to the
 * Plugins settings tab.
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
  | 'open-ai-settings'
  | 'run-command'
  | 'open-plugins-settings'
  | 'open-plugin-tool';

/** Payload for `pet://menu-action` events. `set-pet-size` carries the size
 *  level, `set-pet-opacity` the opacity level, `toggle-pet-click-through`
 *  the next bool, `run-command` the command id to run in the main window,
 *  `open-plugin-tool` the plugin id whose tool window should open; all other
 *  actions use only `action`. */
export interface PetMenuActionPayload {
  action: PetMenuAction;
  size?: '50' | '75' | '100' | '125' | '150';
  opacity?: '25' | '50' | '75' | '100';
  clickThrough?: boolean;
  commandId?: string;
  pluginId?: string;
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
  'run-command',
  'open-plugins-settings',
  'open-plugin-tool',
] as const;

export const PET_MENU_ACTIONS: readonly PetMenuAction[] = [
  ...PET_NATIVE_MENU_ACTIONS,
  ...PET_LAUNCHER_ACTIONS,
] as const;

/**
 * Show the pet context menu. Opens the custom HTML `pet-menu` Tauri window
 * (replaces the native NSMenu). The menu window measures its own DOM on
 * mount and computes a quadrant-aware position so it never overlaps the pet
 * and never shows internal scroll arrows — see `PetMenuApp.tsx`. Item
 * selections are delivered via the `pet://menu-action` event (listened to
 * in `usePetHostBridge` in the main window).
 *
 * The `pet-menu` window is `visible:false` + `focus:false` at startup; this
 * call makes it visible + key. The menu closes itself on item click / ESC /
 * window blur (click outside), so this call does NOT await dismissal —
 * unlike the old `pet_show_context_menu` invoke which blocked until the
 * native menu was dismissed.
 *
 * No locale parameter is threaded through: the menu window has its own
 * i18n instance (separate JS realm) hydrated from `localeStore` via the
 * shared storage, so the menu reads `i18n.language` directly when rendering
 * labels. The Rust `pet_menu_label` / `PetMenuLabel` (now deleted) used to
 * be the source of truth; labels now live in the frontend `pet:menu.*`
 * i18n keys (zh/en).
 */
export async function openPetContextMenu(): Promise<void> {
  if (!isTauri()) return;
  // The pet-menu window is a separate JS realm — its React tree mounts
  // fresh on each `pet://` reload, but the WINDOW itself is created once at
  // app launch and reused. After the first open, the React tree is already
  // mounted (just hidden); `useLayoutEffect` runs only on first mount, so
  // subsequent opens need to re-measure (in case locale changed the label
  // widths) and re-position. The menu component listens for `pet://menu-show`
  // and re-runs the measure/position path on each fire. Emit that signal
  // here; the menu window handles the rest.
  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit('pet://menu-show', {});
  } catch (err) {
    console.warn('[pet-context-menu] emit menu-show failed:', err);
  }
}
