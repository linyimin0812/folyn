# Desktop Pet Right-Click Menu — Feature Expansion

## Goal

Expand the desktop pet's existing native right-click context menu with two pet-specific controls: **Always-on-Top toggle** and **Pet Size** selector. The current menu already has "Disable Pet Mode" (which serves as "close pet"); this task does not change that.

## What I already know (from repo inspection)

Right-click menu **already exists** as a native NSMenu built Rust-side:

- `PetApp.tsx:340-343` → `openPetContextMenu()` (`PetContextMenu.tsx:76-79`) → Rust `pet_show_context_menu` (`commands.rs:597-650`).
- Native (not HTML) because the 96×96 transparent pet window would clip an HTML menu.
- Current 4 items: `Show Main Window` / `New Note` / `Toggle AI Panel` / `(separator)` / `Disable Pet Mode`.
- Selection flow: `on_menu_event` → `pet_ctx_menu_action` (`lib.rs:32-47`) → emit `pet://menu-action` → `App.tsx:324` listener → `handleAction` switch (`App.tsx:258-308`).
- `disable-pet` already hides the pet (sets `petModeEnabled=false` + `toggle_pet_mode` Rust command). No "quit app" added in this task.
- Pet window is raised to `kCGScreenSaverWindowLevelKey` (13) + `collectionBehavior` (`moveToActiveSpace | fullScreenAuxiliary | fullScreenAllowsTiling`) via a Rust thread re-apply loop (`lib.rs:60-108`) — this is what makes the pet overlay fullscreen apps (task `07-06-pet-overlay-on-fullscreen-apps`).
- Pet size is fixed at 96×96 in `tauri.conf.json` (`pet` window). Mascot SVG scales to fill.
- Settings: `petPositionX/Y`, `petModeEnabled`, `petIconSource/Path` already in `settingsStore`. No `petAlwaysOnTop` / `petSize` yet.

## Requirements

### R1 — Always-on-Top toggle (checkmark menu item)

- Add a checkable menu item "Always on Top" to the native right-click menu, placed above the existing separator (so the menu reads: `Show Main Window`, `New Note`, `Toggle AI Panel`, `Always on Top ☑`, `---`, `Disable Pet Mode`).
- Default state: **checked** (preserves current ScreenSaver-level behavior — no surprise for existing users).
- When **checked**: pet runs at `kCGScreenSaverWindowLevelKey` (13) + existing collectionBehavior — overlays fullscreen apps (current behavior).
- When **unchecked**: pet drops to `NSFloatingWindowLevel` (3) — still above normal windows, but does **not** overlay fullscreen apps. The Rust re-apply loop (`lib.rs:60-108`) must respect the toggle (skip ScreenSaver-level re-apply when unchecked, but still re-apply Floating level so macOS deactivation doesn't drop it below normal windows).
- Persisted in `settingsStore` as `petAlwaysOnTop: boolean` (default `true`).
- Cross-window sync: when toggled, emit `pet://always-on-top-changed` so the pet frontend re-applies and the main window settings UI stays in sync.

### R2 — Pet Size submenu (radio items)

- Add a submenu "Pet Size" to the native right-click menu, with three radio items: `Small`, `Medium`, `Large` — current selection marked.
- Default: **Medium** (96px — preserves current size).
- Pixel values: Small = 64×64, Medium = 96×96, Large = 128×128.
- Changing size resizes the Tauri `pet` window (`win.setSize`) and re-scales the mascot SVG (already fills window).
- After resize, **re-clamp position** so the window does not go off-screen (reuse the clamp logic from `PetApp.tsx:446-567`).
- Persisted in `settingsStore` as `petSize: 'small' | 'medium' | 'large'` (default `'medium'`).
- Placement: submenu item after "Always on Top", before the separator.
- The quick-action panel positioning (`openOrTogglePetPanel` `PetApp.tsx:171-200`) must account for the new pet size when computing the panel anchor.

### R3 — Contract / test sync

- `PetContextMenu.tsx`: extend `PetMenuAction` with `'toggle-always-on-top'` and `'set-pet-size'` (payload carries size). Update `PET_NATIVE_MENU_ACTIONS`.
- `lib.rs:32-47` `pet_ctx_menu_action`: recognize the new ids.
- `App.tsx:258-308` `handleAction`: handle the two new actions (toggle setting + apply level; set size + resize + re-clamp).
- Update `PetContextMenu.test.tsx` contract test to assert the new action set.
- Native menu radio/checkmark items use Tauri `CheckMenuItem` / `Menu.submenu`.

## Acceptance Criteria

- [ ] Right-clicking the pet shows the native menu with new items in the specified order.
- [ ] Toggling "Always on Top" off moves the pet below fullscreen apps (open a fullscreen video / app and verify pet is hidden). Toggling back on restores overlay.
- [ ] Switching pet size visibly resizes the pet; pet stays fully on-screen (re-clamped).
- [ ] Reload app: both settings persist.
- [ ] Quick-action panel still anchors correctly next to the pet at all 3 sizes.
- [ ] Existing 4 menu items still work.
- [ ] Contract test (`PetContextMenu.test.tsx`) updated and green.

## Definition of Done

- Rust + frontend lint / typecheck / build green.
- Manual smoke test on macOS: both toggles work, fullscreen overlay behavior correct, sizes correct, persistence correct.
- Contract test updated.

## Technical Approach

### Native menu items (Rust side, `commands.rs:597-650`)

- Use `tauri::menu::CheckMenuItem` for "Always on Top" — pre-check state from `settingsStore.petAlwaysOnTop` (read via a frontend bridge or a Rust state cell).
- Use `tauri::menu::Submenu` containing three `CheckMenuItem` (Small/Medium/Large) with the current size checked, and only one checked at a time.
- New menu ids: `PET_CTX_MENU_TOGGLE_TOPMOST`, `PET_CTX_MENU_SIZE_SMALL/MEDIUM/LARGE`.
- Selections still flow `on_menu_event` → `pet_ctx_menu_action` → `pet://menu-action`.

### Always-on-Top apply (Rust side, `lib.rs`)

- New command `pet_set_topmost_level(enabled: bool)`:
  - `true`: current behavior (`kCGScreenSaverWindowLevelKey` + collectionBehavior).
  - `false`: `NSFloatingWindowLevel` (3) + same collectionBehavior minus fullscreen flags.
- The re-apply loop reads the current flag (from Rust app state, synced from `settingsStore` via an event listener) and applies the corresponding level.

### Size apply (frontend + Rust)

- `set_pet_size` Rust command: `win.setSize(Size::Logical(96, 96))` etc. Returns new size.
- Frontend re-clamps position with the existing clamp helper, persists to `settingsStore`.

## Decision (ADR-lite)

**Context**: Right-click menu already exists; user wants pet-specific controls. Of four candidate sub-features (icon change / reset position / always-on-top / size), user picked **always-on-top + size**.

**Decision**:
- Always-on-Top is a **binary** toggle (not three-state) — OFF means Floating level, not Normal, so the pet still shows on the desktop behind fullscreen apps.
- Pet Size is a **3-way radio** (Small/Medium/Large = 64/96/128) — not a slider, to match native menu conventions.
- Default values preserve current behavior (on + medium).

**Consequences**:
- Toggling always-on-top off disables fullscreen overlay too (acceptable — user explicitly chose this).
- Size change requires re-clamp to stay on-screen; added to acceptance criteria.
- Icon change / reset position deferred to future tasks.

## Out of Scope

- B1 (Change Pet Icon) — deferred.
- B2 (Reset Pet Position) — deferred.
- Group A (promoting launcher actions to right-click) — deferred.
- Group C (Settings / Start at Login / Quit App) — deferred.
- Group D (Quick Note / Screenshot / DND) — deferred.
- Sliders, custom size input.
- "Quit App" menu item (Disable Pet Mode remains the close mechanism).

## Technical Notes

- Native menu built in `commands.rs:597-650` (`pet_show_context_menu`).
- Action mapping `lib.rs:32-47` (`pet_ctx_menu_action`).
- Re-apply loop `lib.rs:60-108`.
- Topmost level apply `commands.rs` `pet_set_topmost_level` (existing — will be extended).
- Frontend contract: `PetContextMenu.tsx`, `App.tsx:258-308` `handleAction`.
- Position clamp logic: `PetApp.tsx:446-567`.
- Settings store: `settingsStore` (`petModeEnabled`, `petPositionX/Y`, `petIconSource/Path` — add `petAlwaysOnTop`, `petSize`).
- Tauri v2 menu API: `tauri::menu::{CheckMenuItem, Submenu, MenuItem, PredefinedMenuItem}`.
