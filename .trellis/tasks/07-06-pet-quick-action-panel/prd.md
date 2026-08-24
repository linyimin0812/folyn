# Pet Quick-Action Panel

## Goal

Replace the pet's left-click behavior (currently a native OS context menu
with 4 items) with a **second Tauri window `pet-panel`** that surfaces
Mochi's core capabilities in mini form: an 8-button launcher grid **plus an
embedded AI chat** with its own persistent, vault-free session. The pet
becomes a one-click gateway to capture / navigate / ask, without first
opening the full main window.

## What I already know (from repo)

* Current left-click → `openPetContextMenu()` → Rust `pet_show_context_menu`
  native popup; items: `show-main | new-note | toggle-ai | disable-pet`
  (`PetContextMenu.tsx:16`, `commands.rs:595-648`).
* Actions dispatched via the `pet://menu-action` Tauri event → `App.tsx`
  listener (`:167-245`) → `focusMain()` (`:172-181` shows+focuses the hidden
  main window). Main window hidden-not-closed while pet mode is on
  (`lib.rs:83-100`).
* Pet window = 120×120 transparent always-on-top skipTaskbar, labelled `pet`
  (`commands.rs:405`); mounts `PetApp` via `#/pet` hash route (`main.tsx:8-11`).
  Too small for an HTML menu (issue #1) — that's why the menu is native today.
* `PetMenuAction` contract designed for extension; tests assert frontend↔Rust
  action set stays in sync.
* **AI send/stream pipeline is NOT coupled to `aiStore`** — it's
  `@mochi/cli-adapter`'s `CliAdapter` (`packages/cli-adapter/src/types.ts:99`,
  `baseAdapter.ts:11-16`): `start({cliPath, workingDir})` →
  `send(prompt, CliSendOptions)` → `onEvent(CliStreamEvent)`. Services like
  `clipService`, `wikiIngestService`, `planMyDayService` each create their own
  adapter via `CliAdapterRegistry.getInstance().create(settings.cliAdapter)`
  and stream independently. `services/aiStreamUtils.ts` exports
  `collectTextFromStream` + `StreamEvent` for reuse. → pet-panel can self-host
  a chat with its own adapter + store, no `aiStore`, no vault.
* Mochi capabilities ranked "quick-action-able": New Note
  (`requestNewItem('file')`), Daily Note (`editorStore.openDailyNote`),
  Global Search (`searchStore.openPanel`), Clip from URL
  (`clipService.saveClipFromUrl`), Command Palette
  (`commandPaletteStore.toggle`), Show Main (`focusMain`), Toggle Theme
  (`settingsStore.toggleTheme`), Disable Pet (`toggle_pet_mode`).
* Positioning/clamp reference: `petPosition.ts` (`clampPetPosition`,
  `computeDefaultPetPosition`); fullscreen guard via `pet_cursor_probe`
  `main_fullscreen`; work area via `pet_get_work_area`.

## Decisions (ADR-lite)

* **Form (Q1):** Launcher grid + embedded AI chat; chat must not perceive
  vault content.
* **Window (Q2):** Second Tauri window `pet-panel` (visible:false, shown on
  pet click, positioned next to pet). Pet window stays 120×120. New
  `#/pet-panel` hash route mounts `PetPanelApp`, mirroring `#/pet`.
* **Chat scope (Q3):** Independent persistent session — own store, persisted
  across restarts, separate from `aiStore`/main AI, no vault grounding.
  Self-created `CliAdapter`, reuses `aiStreamUtils`.
* **Launcher set (Q4):** 8 MVP buttons — New Note, Daily Note, Clip from URL,
  Global Search, Command Palette, Show Main, Toggle Theme, Disable Pet.
  Dropped: Toggle AI (redundant w/ embedded chat), Plan My Day (niche, via
  palette).
* **Expansion (Q5):** MVP includes explicit close + Esc + click-pet-toggle,
  open left/up to stay on-screen, fullscreen guard, clip-URL inline input,
  unconfigured-AI guidance. Out of Scope: plugin-driven buttons, chat→vault,
  Pin/remember-tab, stream-interrupt resume.

**Consequences:** adds a 2nd managed Tauri window (positioning + lifecycle
plumbing in Rust) and a new persisted store; keeps `aiStore`/main AI untouched.
Left-click semantics change (was native menu → now HTML panel); right-click
keeps the native menu for muscle-memory + dev/power-user access.

## Requirements

* **R1 Window:** A `pet-panel` Tauri window (decorated or borderless per
  platform), always-on-top, skipTaskbar, `visible:false` at launch, shown on
  pet left-click, hidden on close/Esc/second pet click.
* **R2 Left-click rebind:** Pet left-click opens `pet-panel` (no longer opens
  the native context menu). Right-click still opens the native context menu.
* **R3 Positioning:** On open, position `pet-panel` next to the pet, expanding
  left and/or up when the pet is near the right/bottom screen edge so the
  panel stays fully on-screen (clamp using `pet_get_work_area`).
* **R4 Fullscreen guard:** Do not show the panel while the main window is
  fullscreen (reuse `pet_cursor_probe.main_fullscreen`).
* **R5 Launcher grid:** 8 buttons (Q4 set). Each button dispatches its action
  via the existing `pet://menu-action` channel (extend `PetMenuAction` for
  new actions: daily-note, global-search, clip-from-url, command-palette,
  toggle-theme) + `focusMain()` where the action opens the main window. New
  Note / Daily Note / Global Search / Command Palette / Show Main / Toggle
  Theme → focus main; Clip from URL → inline URL input in the panel, calls
  `saveClipFromUrl`, shows success/failure inline; Disable Pet →
  `toggle_pet_mode` + hide panel.
* **R6 Chat:** Embedded chat with its own persisted session (Q3). Self-created
  `CliAdapter` (no `aiStore`), streaming via `aiStreamUtils`; messages
  persisted across app restarts in a separate `petChatStore`. No vault
  grounding (no file mentions, no wiki/clip mode).
* **R7 Unconfigured-AI state:** If no AI provider/key is configured, the chat
  area shows a guidance CTA (link to settings) instead of erroring.
* **R8 Dismiss:** Close button (×), `Esc`, and clicking the pet again toggle
  the panel. No blur-auto-close (would misfire on chat input).

## Acceptance Criteria

* [ ] Left-clicking the pet shows `pet-panel`; right-click still shows the
      native context menu.
* [ ] Second left-click on the pet (or × / Esc) hides the panel.
* [ ] Panel opens fully on-screen even when pet is at bottom-right corner.
* [ ] Panel does not open while main window is fullscreen.
* [ ] All 8 launcher buttons trigger their intended capability; Clip-from-URL
      accepts a URL in-panel and produces a clip file with success/failure
      feedback.
* [ ] Chat: send a message → streamed response appears; messages survive
      app restart.
* [ ] With no AI provider configured, chat shows guidance CTA, no crash.
* [ ] `PetMenuAction` union + Rust menu/action mapping stay in sync (existing
      contract test updated and green).
* [ ] Pet panel tests (positioning/clamp, launcher dispatch, chat store
      persistence) added and green.

## Definition of Done

* Tests added/updated (unit + integration where appropriate)
* Lint / typecheck / CI green
* `tauri-window-patterns.md` spec updated for the new `pet-panel` window
  contract (show/hide/position/focus rules)
* Left-click behavior change noted in release/changelog
* Rollout: feature is additive (new window); rollback = revert left-click to
  `openPetContextMenu` (one-line), low risk

## Technical Approach

* **Rust (`src-tauri`):** Add `pet-panel` window to `tauri.conf.json`
  (`visible:false`, always-on-top, skipTaskbar, `url`/#/pet-panel`); add
  commands `pet_panel_show`, `pet_panel_hide`, `pet_panel_set_position`,
  `pet_panel_get_position` mirroring the pet window commands; extend
  `pet_ctx_menu_action` / `PetMenuAction` for the 5 new actions; pet left-click
  handler flips from `openPetContextMenu` to `pet_panel_show` + positioning.
* **Frontend route:** `main.tsx` adds `#/pet-panel` → mount `PetPanelApp`.
* **`PetPanelApp`:** launcher grid (`PetLauncher`) + chat (`PetChat`) +
  clip-URL inline form; close button + Esc listener; reads pet position +
  work area to self-clamp (reuse `clampPetPosition` logic generalized).
* **`PetChat`:** owns a `CliAdapter` from `CliAdapterRegistry`, `start()`,
  `send()` with plain `CliSendOptions` (no vault system prompt), `onEvent` →
  append tokens via `aiStreamUtils`. `workingDir` = a neutral temp dir (no
  vault).
* **`petChatStore`:** zustand store, messages persisted via
  `utils/storageClient` (Tauri store plugin), separate namespace from
  `aiStore`.
* **Reuse seams:** `pet://menu-action` event, `focusMain()`,
  `clampPetPosition`, `pet_get_work_area`, `pet_cursor_probe`,
  `CliAdapterRegistry`, `aiStreamUtils`, `clipService.saveClipFromUrl`.

## Out of Scope

* Plugin/config-driven launcher buttons (hardcoded 8 for now)
* Chat grounding in vault (wiki/clip mode) — stays vault-free
* Pin / "keep open" / remember-last-tab
* Stream-interrupt resume (close mid-stream discards in-flight; persisted
  messages retained)
* Resizing the pet window (pet stays 120×120)
* Mobile/non-desktop platforms

## Implementation Plan (small PRs)

* **PR1 — Window plumbing + left-click rebind:** `tauri.conf.json` `pet-panel`
  window; Rust `pet_panel_show/hide/set_position` commands; `#/pet-panel`
  route in `main.tsx`; pet left-click → show+position+clamp, Esc/×/second-click
  → hide; fullscreen guard. Extend `PetMenuAction` + Rust mapping for 5 new
  actions. Update contract test.
* **PR2 — Launcher grid + clip-URL:** `PetPanelApp` shell + `PetLauncher` (8
  buttons) wired to `pet://menu-action` + `focusMain()`; inline Clip-from-URL
  form calling `saveClipFromUrl` with feedback; positioning/clamp on open.
* **PR3 — Pet chat:** `petChatStore` (persisted) + `PetChat` component using
  `CliAdapter` + `aiStreamUtils`; unconfigured-AI guidance CTA.
* **PR4 — Polish + spec:** AC sweep, `tauri-window-patterns.md` update,
  lint/typecheck/CI green, changelog note.

## Research References

* Inline code inspection confirmed `CliAdapter` is reusable without `aiStore`
  (see "What I already know"). No external research needed for MVP decisions;
  if a streaming/persistence edge case arises during PR3, spawn
  `trellis-research` then.
