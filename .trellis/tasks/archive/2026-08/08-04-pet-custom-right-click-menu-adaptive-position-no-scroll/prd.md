# Pet Custom Right-Click Menu — Adaptive Position, No Scroll

## Goal

Replace the native NSMenu pet right-click popup with a self-implemented HTML menu in a dedicated borderless transparent Tauri window, so the menu can be positioned adaptively based on the pet's screen position (no overlap with pet, no internal scrolling). Native NSMenu can't achieve this cleanly — muda's `popUpMenuPositioningItem:atLocation:inView:` anchors the menu's top-left at a location inside the pet view, and macOS's auto-shift still leaves the menu covering the pet when the pet is near a screen edge.

## What I already know

### Current native menu flow
- Frontend `PetContextMenu.tsx::openPetContextMenu()` invokes Rust `pet_show_context_menu` with locale.
- Rust `build_pet_context_menu` (in `pet_menu.rs`) builds an NSMenu with 7 top-level items: `show-main`, `hide-pet`, size submenu (5 radios), opacity submenu (4 radios), `toggle-pet-click-through`, separator, `exit-app`. (`test-bubble` was removed in the prior turn.)
- `pet_show_context_menu` calls `pet.popup_menu_at(&menu, pet_adaptive_menu_pos(&pet))` — muda forwards to NSMenu `popUpMenuPositioningItem:atLocation:inView:` with `inView = pet's ns_view` (so the menu opens on the pet panel's Space — visible even when frontmost app is fullscreen).
- Item selection fires `on_menu_event` in `lib.rs`, which emits `pet://menu-action` with `{action, size? | opacity? | clickThrough?}`.
- Main window's `usePetHostBridge` listener routes via `routePetMenuAction` (`services/petHostRouter.ts`).

### Established borderless-window pattern (precedent)
- `pet`, `pet-panel`, `pet-bubble`, `pet-corner`, `voice-orb` are all transparent + `decorations:false` + `skipTaskbar:true` + `shadow:false` (or `true` for `pet-panel`).
- `pet_panel_macos::convert_windows` converts these to NSPanel with `stationary | move_to_active_space | full_screen_auxiliary` collection behavior → stays on active Space across app-switches/fullscreen.
- `pet-bubble` shows the precedent for adaptive positioning: Rust exposes `pet_bubble_set_position(x,y)` + `pet_bubble_set_size(w,h)` + `pet_bubble_show()` + `pet_bubble_hide()`; the **frontend** computes the clamped position using `get_pet_position` + `pet_get_work_area` and calls these before `show`.
- `pet-bubble` is `focus:false` + `nonactivating_panel` — does not steal focus from the foreground app.

### Menu items / actions
- 6 native menu actions (right-click): `show-main`, `hide-pet`, `set-pet-size`, `set-pet-opacity`, `toggle-pet-click-through`, `exit-app`.
- 6 launcher-only actions (NOT in right-click menu, but in the contract): `daily-note`, `global-search`, `clip-from-url`, `command-palette`, `toggle-theme`, `open-ai-settings`. Stay launcher-only.
- Submenus: size (50/75/100/125/150% single-select), opacity (25/50/75/100% single-select).
- Localization: `pet_menu_label(locale, PetMenuLabel)` covers `zh`/`en`. Pet window has its own i18n instance.

### Position constraints
- Pet window is ~96x96 (logical), small.
- User's concrete complaint: pet at screen bottom-right → menu should appear at pet's top-left (above + left of pet), no overlap, no scroll.
- Need adaptive direction per quadrant (top-left/top-right/bottom-left/bottom-right of monitor).

## Assumptions (temporary)

- New `pet-menu` Tauri window follows the `pet-bubble` pattern (transparent, borderless, skip taskbar, `focus:false`, NSPanel-converted for multi-Space).
- Menu size is known to the frontend after first render (can measure the DOM). Adaptive position is computed in the frontend using `pet_get_work_area` + `get_pet_position` + measured menu size — same approach `pet-bubble` uses (frontend-driven positioning).
- Item selection emits `pet://menu-action` with the same payload shape — `usePetHostBridge` / `routePetMenuAction` need no change.
- Tray menu (`tray_set_enabled`) stays native NSMenu — out of scope for this task.

## Open Questions

(none — all resolved, see Decision below)

## Requirements (evolving)

- [ ] Right-click on pet opens a custom HTML menu (new `pet-menu` window), not a native NSMenu.
- [ ] Menu appears on the side of the pet with the most screen space; when pet is at screen bottom-right, menu appears at pet's top-left with no overlap.
- [ ] Menu never shows internal scroll arrows (sized to fit content; if it would exceed screen, it flips to the other side or clamps).
- [ ] All 6 current menu items present, including size & opacity submenus with their radio states (current size/opacity pre-checked).
- [ ] Submenus expand **inline** (accordion) below their parent item on click — pushes following items down, single-column layout, no side-overflow positioning.
- [ ] Item selection routes through existing `pet://menu-action` channel — no changes to `usePetHostBridge` / `routePetMenuAction`.
- [ ] Locale-aware labels (zh/en), follows existing i18n pattern (frontend i18n, not Rust).
- [ ] Menu closes on: item click, ESC, click outside the menu window.
- [ ] Mouse-only navigation + ESC to close. No arrow-key/Enter/role=menuitem keyboard nav in MVP.
- [ ] Menu stays on the pet's active Space (NSPanel conversion via `pet_panel_macos::convert_windows`).
- [ ] Rust-side native NSMenu code deleted (`pet_show_context_menu`, `build_pet_context_menu`, `pet_menu_label`/`PetMenuLabel`, the `on_menu_event` handler). Tray menu (`tray_set_enabled`) is untouched — it stays native.

## Acceptance Criteria (evolving)

- [ ] Pet at screen bottom-right → right-click → menu appears at pet's top-left, no overlap, no internal scroll.
- [ ] Pet at screen top-left → right-click → menu appears at pet's bottom-right, no overlap.
- [ ] Pet at screen top-right → menu appears at pet's bottom-left.
- [ ] Pet at screen bottom-left → menu appears at pet's top-right.
- [ ] Multi-monitor: pet on a non-primary monitor → menu appears on the same monitor, positioned correctly relative to that monitor's edges.
- [ ] Frontmost app fullscreen → right-click pet → menu visible on pet's Space.
- [ ] Size/opacity submenu radio items reflect current state; selecting one updates state and re-renders menu if reopened.
- [ ] ESC closes menu; clicking outside closes menu; clicking an item fires `pet://menu-action` and closes.
- [ ] `cargo check` + lint + typecheck + existing `PetContextMenu.test.tsx` (or its replacement) pass.

## Definition of Done

- Tests added/updated (positioning logic unit-tested; submenu routing covered).
- Lint / typecheck / `cargo check` green.
- Docs/notes updated if behavior changes (the `PetContextMenu.tsx` top comment currently describes the native flow — rewrite it).
- Rollout/rollback: feature is local to the pet right-click; no migration. Rollback = revert this PR.

## Out of Scope (explicit)

- Tray menu (`tray_set_enabled`) — stays native NSMenu.
- Launcher-only actions (`daily-note` etc.) — not added to right-click menu.
- Keyboard arrow-key navigation (pending Open Question — likely deferred).
- Cross-platform (Linux/Windows) — this is macOS-specific via NSPanel; other platforms can stay as-is or follow later.

## Technical Approach

- New Tauri window `pet-menu` (transparent, `decorations:false`, `skipTaskbar:true`, `shadow:true`, `focus:false`, `visible:false` at start), URL `/#/pet-menu`.
- Register in `pet_panel_macos::convert_windows` so it gets the NSPanel treatment (multi-Space, `nonactivating_panel`).
- Rust commands (mirror `pet_bubble_*`): `pet_menu_show`, `pet_menu_hide`, `pet_menu_set_position(x,y)`, `pet_menu_set_size(w,h)`.
- Frontend route `/#/pet-menu`: renders the menu HTML (React). On mount: measure DOM size, call `set_size` + compute adaptive position (using `get_pet_position` + `pet_get_work_area`) + call `set_position` + `show`. Listen for `keydown:Escape` + window-blur (click outside) → `hide`.
- Submenu: inline accordion (CSS `max-height` transition optional). Click parent toggles; only one open at a time (clicking the other closes the first).
- Item click: `emit('pet://menu-action', payload)` + invoke `pet_menu_hide`.
- Position adaptive logic (frontend, in the `pet-menu` realm): measure menu size; pick the pet quadrant that gives the most room; clamp so menu stays within monitor work area; pass to `set_position`.
- Labels: frontend i18n (zh/en) — adds keys for the 6 menu items + 5 size + 4 opacity labels. Rust `pet_menu_label`/`PetMenuLabel` deleted.
- Routing unchanged: `usePetHostBridge` listener + `routePetMenuAction` dispatcher in main window.

## Decision (ADR-lite)

**Context**: Native NSMenu via muda can't be positioned cleanly outside the pet view (menu's top-left anchors inside the view, macOS auto-shift still overlaps the pet near screen edges → user sees overlap + internal scroll).

**Decision**: Replace native NSMenu for the pet right-click with a self-implemented HTML menu in a dedicated borderless transparent Tauri window, following the existing `pet-bubble` pattern. Submenus expand inline (accordion). Mouse-only + ESC. Delete Rust NSMenu code. Tray menu stays native.

**Consequences**:
- Pro: Full control over positioning (no overlap, no scroll), single code path for the pet right-click, no muda/NSMenu constraint.
- Pro: Reuses the established `pet-bubble` window pattern — no new infrastructure.
- Con: Loses native keyboard arrow-key nav (acceptable for MVP, mouse-only).
- Con: Loses native OS styling (fonts/colors) — menu styled in CSS to match the app.
- Con: Two new realms of code (new Tauri window + React route) — moderate surface area.
- Rollback: revert this PR; the prior native flow is restored.

## Implementation Plan (small PRs)

- **PR1 — Scaffolding**: Add `pet-menu` window to `tauri.conf.json`; register in `pet_panel_macos::convert_windows`; add Rust commands `pet_menu_show`/`hide`/`set_position`/`set_size` (mirror `pet_bubble.rs`); add empty `/#/pet-menu` React route that just calls `show` on mount (no menu items yet). Verify: window opens transparently on pet's Space.
- **PR2 — Menu UI + positioning**: Build the menu component (6 items + inline-accordion submenus, zh/en labels via i18n). Implement adaptive position computation + `set_size`/`set_position`/`show` flow. Item click → `emit('pet://menu-action', payload)` + `hide`. ESC + click-outside → `hide`. Update `PetContextMenu.tsx::openPetContextMenu` to open the new window instead of `pet_show_context_menu`. Verify: AC for all four quadrants pass.
- **PR3 — Cleanup + tests**: Delete Rust `pet_show_context_menu`, `build_pet_context_menu`, `pet_menu_label`/`PetMenuLabel`, the `on_menu_event` handler. Update `PetContextMenu.test.tsx` to reflect the new flow. Add a unit test for the adaptive-position computation. Update the top comment in `PetContextMenu.tsx`. Verify: `cargo check` + lint + typecheck + tests green.

