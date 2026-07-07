# Pet Panel Toggle via Global Shortcut

## Goal

Let the user summon/dismiss the desktop pet panel (the launcher panel that currently opens on pet-icon click) via a **global** keyboard shortcut (default `Cmd+Shift+Q`, user-configurable), so they don't have to find and click the floating pet icon — especially when the pet is obscured or the user is mid-flow in another app. The panel opens **centered in the screen work area** (not pet-adjacent).

## Requirements

- Register a global keyboard shortcut (default `Cmd+Shift+Q`) that toggles the pet-panel window's visibility, system-wide (works even when Quill is not focused).
- On open via shortcut, the panel appears **centered in the screen's work area** (the monitor space excluding macOS Dock/menubar — i.e. `pet_get_work_area`'s returned rect), NOT at the pet-icon-adjacent corner. The click-open path is unchanged (still pet-adjacent) — only the shortcut path centers.
- On second trigger while visible, hide the panel (toggle semantics, matching click behavior).
- Default shortcut is `Cmd+Shift+Q`. The user can re-bind it in Settings → 快捷键 (reuse the existing `ShortcutEditor`).
- macOS-only initially (matches current pet-mode scope).

## Acceptance Criteria

- [ ] Pressing `Cmd+Shift+Q` (default) toggles pet-panel visibility when Quill is **not** the focused app.
- [ ] Pressing the shortcut while the panel is visible hides it.
- [ ] Open-via-shortcut centers the panel in the screen's work area (logical center of `pet_get_work_area`'s rect, minus the panel's own size).
- [ ] Click-to-toggle still works (no regression).
- [ ] User can re-bind the shortcut in Settings → 快捷键; the new combo takes effect globally after save.
- [ ] On macOS, the app handles the accessibility-permission absence gracefully (shortcut silently no-ops + a one-time console warning; spec'd so we don't crash on permission denial).
- [ ] Tests: settings store round-trip for the new shortcut key; existing pet-panel tests still pass.

## Definition of Done

- Tests added/updated (settings store for the new shortcut field; Rust command test if a new `pet_panel_toggle` command is introduced).
- Lint / typecheck / CI green.
- Spec updated: extend `.trellis/spec/desktop/frontend/tauri-window-patterns.md` with a "Global Shortcuts" scenario documenting the plugin + ACL contract + accessibility caveat.
- Rollout: default shortcut documented in changelog/journal. Rollback = remove the plugin registration; the shortcut simply stops firing.

## Technical Approach

**Plugin**: add `tauri-plugin-global-shortcut = "2"` to `apps/desktop/src-tauri/Cargo.toml`. Register the plugin in `lib.rs` `tauri::Builder::default().plugin(tauri_plugin_global_shortcut::init())`.

**Shortcut storage**: add a new entry to `DEFAULT_SHORTCUTS` with `id: 'togglePetPanel'`, `name: '唤起桌宠面板'`, `keys: ['⌘', 'Shift', 'Q']`. The existing `ShortcutEditor` in `SettingsPage` already records and persists new combos — no new UI needed. Conversion: `["⌘", "Shift", "Q"]` → Tauri accelerator string `"Cmd+Shift+Q"` (small helper, since Tauri uses `Cmd/Alt/Shift/Control/Super` and `+`-joined).

**Position when shortcut-triggered**: center the panel in `pet_get_work_area`'s rect (work-area center, not screen center — excludes Dock/menubar). Computed as `x = workArea.x + (workArea.width - panelWidth) / 2`, same for `y`. The click-open path stays pet-adjacent (`openOrTogglePetPanel` unchanged) — the shortcut path is a separate function `openPetPanelCentered` that reuses the size-resolution + post-show re-assert logic but swaps the position computation. Both paths share the size-resolution + `set_size` + `show` + re-assert helpers.

**Registration lifecycle**:
- On app startup (after `apply_pet_backend_init`), read the persisted shortcut from settings and register it via the plugin's Rust API (`GlobalShortcutExt::register`).
- When the user re-binds in Settings, unregister the old accelerator and register the new one. The frontend `ShortcutEditor` already calls `updateShortcut`; extend that path to also emit an IPC event (`pet://shortcut-changed`) or call a new Rust command `pet_panel_set_shortcut(accelerator)` that swaps the registration.
- Handler: the registered callback calls the same code path as `openOrTogglePetPanel`. Since that function currently lives in `PetApp.tsx` (frontend), and the global shortcut fires from Rust, we need a Rust-side entry point. Two options:
  - **Option A (recommended)**: emit a `pet://shortcut-toggle` event from Rust to all webview windows; `PetApp.tsx` (always-mounted in the pet window) listens and calls a new `openPetPanelCentered` function (centered position, not pet-adjacent). Keeps the position-computation logic in TS where it already lives, no Rust port.
  - Option B: implement a Rust `pet_panel_toggle` command that does position computation in Rust. More work, diverges from the TS path, risks drift.

**Permission / ACL**: global shortcuts in Tauri 2 are gated by the `global-shortcut:allow-register` etc. permission. Add a capability entry. (Custom `invoke` commands like `pet_panel_set_shortcut` bypass the ACL — only the plugin's built-in commands need ACL entries.)

**macOS accessibility caveat**: `tauri-plugin-global-shortcut` uses Carbon `RegisterEventHotKey` on macOS, which does NOT require Accessibility permission (unlike CGEventTap). Verify this during implementation; if a permission prompt appears, document the UX.

## Decision (ADR-lite)

**Context**: Need to trigger the pet-panel from any app without clicking the floating pet icon.

**Decision**:
- Global shortcut via `tauri-plugin-global-shortcut` (not in-app keydown) — pet floats over other apps, so the shortcut must work when Quill isn't focused.
- Default `Cmd+Shift+Q` (Q for Quill; `Cmd+Shift+P` collides with VSCode/Slack command palettes).
- Reuse existing `ShortcutItem`/`ShortcutEditor` for user-configurability — no new settings UI.
- Toggle handler routes through Rust → `pet://shortcut-toggle` event → `PetApp.tsx` `openPetPanelCentered` (work-area centered position, distinct from click-open's pet-adjacent path) — keeps position logic unified in TS, with shared size-resolution + post-show re-assert helpers.

**Consequences**:
- Adds a Tauri plugin dependency + ACL capability entry.
- Requires extending the spec for the global-shortcut contract.
- If the user rebinds to a combo that conflicts with another app's global shortcut, the OS resolves it unpredictably — document this as a known limitation.
- Future: extending other pet actions (new-note, search) to global shortcuts follows the same pattern.

## Out of Scope

- Cross-platform (Windows/Linux) — pet mode is macOS-only for now.
- Multiple global shortcuts (e.g. separate shortcuts for new-note / search from the panel) — follow-up.
- Conflict-detection UI (warning when the chosen combo is already OS-reserved).
- Persisting the panel's drag position across opens (existing behavior intentionally doesn't; not changed here).

## Technical Notes

- Files to touch:
  - `apps/desktop/src-tauri/Cargo.toml` — add plugin dep.
  - `apps/desktop/src-tauri/src/lib.rs` — register plugin + startup registration.
  - `apps/desktop/src-tauri/src/commands.rs` — new `pet_panel_set_shortcut` command (unregister old + register new).
  - `apps/desktop/src-tauri/capabilities/*.json` — add global-shortcut permissions.
  - `apps/desktop/src/store/settingsStore.ts` — add `togglePetPanel` to `DEFAULT_SHORTCUTS`; ensure it's persisted (already covered by `shortcuts` round-trip).
  - `apps/desktop/src/components/pet/PetApp.tsx` — extract shared panel-open helpers (size resolution + `set_size` + `show` + post-show re-assert) from `openOrTogglePetPanel`; add new `openPetPanelCentered` (work-area-centered position) used by the shortcut path; add `pet://shortcut-toggle` listener. Click-open path unchanged.
  - `apps/desktop/src/components/pages/SettingsPage.tsx` — `ShortcutEditor`'s `updateShortcut` path needs to also call `pet_panel_set_shortcut` when the changed shortcut is the toggle-pet-panel one (or always emit and let Rust no-op non-global ones).
- Spec to update: `.trellis/spec/desktop/frontend/tauri-window-patterns.md` — add "Global Shortcuts" scenario.
