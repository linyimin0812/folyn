# Desktop Pet Mode

## Goal

Add a "desktop pet" mode to Folyn: a small icon (the pet) that lives persistently on the user's
desktop. Clicking the pet icon lets the user operate Folyn (e.g. summon the main window, trigger
quick actions) without keeping the full editor window open.

## What I already know

* Folyn is a **Tauri v2** desktop app (local-first Markdown editor), single main window defined in
  `apps/desktop/src-tauri/tauri.conf.json` (label `main`, 1440x900, resizable).
* Rust entry: `apps/desktop/src-tauri/src/lib.rs` — `tauri::Builder` setup, menu built in `setup`.
  No system tray / tray icon exists today.
* Existing window/webview management commands in `commands.rs`: `create_webview`,
  `navigate_webview`, `show_webview`, `hide_webview`, `set_webview_position`, etc. — these manage
  embedded webview children, not separate top-level OS windows.
* Frontend is React + Vite (`apps/desktop/src`), feature folders: schedule, study, clips, wiki,
  analyze. AI panel exists (`components/ai`).
* No tray/pet implementation exists yet.

## Assumptions (temporary)

* (resolved — see Resolved Decisions D1–D10)

## Implementation Plan (small PRs)

* **PR1 — Pet window scaffolding (Rust + Tauri config)**
  * Add second window in `tauri.conf.json` (transparent, always-on-top, skipTaskbar, hidden by
    default, label `pet`, route `/#/pet`).
  * `toggle_pet_mode` command in `commands.rs` + menu item in `lib.rs` View submenu with
    checkmark sync. Default off.
  * Smoke test: toggle shows/hides an empty transparent window.
* **PR2 — Mascot component + states (frontend)**
  * `PetApp` React component (SVG ink-drop + folyn, CSS keyframes for idle/hover/drag/click).
  * Drag-to-move via `startDragging` on the window; context menu component.
  * Unit tests for state machine + menu actions dispatch.
* **PR3 — Interaction wiring + position persistence**
  * Single-click → focus/show main window; context-menu items → existing store actions
    (New Note / Toggle AI Panel / Disable Pet Mode).
  * Persist enabled + position in `settingsStore`; restore on launch.
* **PR4 — macOS niceties: click-through + fullscreen handling**
  * Click-through on transparent regions.
  * Fullscreen Space detection → auto hide/show.
  * Tests, lint, spec capture.

* **D1 (interaction model)**: double interaction — single click = focus/show main window;
  right-click (or long-press) = quick-action context menu. (chosen 2026-07-05)
* **D2 (visual)**: full multi-state animated pet — idle / drag / hover / click-feedback states
  (and possibly walk/edge-snap). NOT a static icon. (chosen 2026-07-05)
* **D3 (animation asset)**: CSS/SVG self-drawn Folyn mascot — no external art assets, vector,
  themeable, fits editor aesthetic; states switched via CSS. (chosen 2026-07-05)
* **D4 (mascot + MVP states)**: mascot = ink-drop sprite with a folyn-pen tip (echoes product
  name "Folyn"). MVP animation states: `idle` (breathing/floating), `hover` (looks up/reacts),
  `drag` (wobbles while dragged), `click` (squish/pop feedback). Walking/sleep/summon deferred
  to later iteration. (chosen 2026-07-05)
* **D5 (main window coexistence)**: coexist — pet is a persistent entry point; main window
  behaves normally. Single-click pet = focus/show main window (re-show if closed/minimized).
  No minimize-to-pet in MVP. (chosen 2026-07-05)
* **D6 (platform scope)**: macOS only for MVP. Transparent + always-on-top + skipTaskbar is most
  stable on macOS; Windows/Linux deferred. (chosen 2026-07-05)
* **D7 (toggle entry)**: app menu bar item — add a checkable "Desktop Pet Mode" entry to the
  existing macOS menu (View or Folyn submenu), with optional keyboard shortcut. Tray icon is
  NOT used (semantics differ from a desktop pet). (chosen 2026-07-05)
* **D8 (right-click menu, MVP)**: items = [Show Main Window] [New Note] [Toggle AI Panel]
  [sep] [Disable Pet Mode]. All map to existing features. (chosen 2026-07-05)
* **D9 (position behavior, MVP)**: freely draggable; remember last position across launches
  (persist in `settingsStore`); clean up pet window on app exit; menu checkbox synced with pet
  visibility; click-through on transparent regions (only the mascot sprite is clickable so the
  pet does not block the desktop). (chosen 2026-07-05)
* **D10 (fullscreen handling, MVP)**: when the foreground app is in macOS fullscreen (a
  fullscreen Space), the pet auto-hides and reappears when leaving fullscreen, to avoid
  occluding/interfering with the fullscreen app. Detection mechanism to be confirmed during
  implementation (likely NSWorkspace / Space-change notification via Tauri event or a
  platform plugin). Position clamp on monitor disconnect is DEFERRED (Out of Scope).
  (chosen 2026-07-05)

## Open Questions

* (none — ready for final confirmation)
* Q4 (Platform): MVP target — macOS only, or macOS+Windows+Linux?
* Q5 (Scope): pet position — draggable freely, edge-snapping, remember last position?
* Q6 (Preference): where does the user toggle pet mode on/off (menu bar item / settings / tray)?

## Requirements

### R1. Pet window (macOS)
* A second Tauri window (label `pet`) with: `decorations:false`, `transparent:true`,
  `alwaysOnTop:true`, `skipTaskbar:true`, `resizable:false`, small size (~120x120), no shadow.
* Does NOT appear in Dock as a normal window; does not steal focus on creation.
* Renders a CSS/SVG ink-drop + folyn-tip mascot.

### R2. Mascot + animation states (CSS/SVG)
* Mascot = ink-drop body with a folyn-pen tip, echoing the "Folyn" name.
* MVP states: `idle` (breathing/floating), `hover` (looks up/reacts on mouse enter),
  `drag` (wobbles while being dragged), `click` (squish/pop feedback on click).
* State transitions driven by frontend mouse events; CSS keyframes for motion.

### R3. Interaction
* Single click on the mascot = focus / show the main editor window (re-show if minimized or
  closed). Coexist model (D5): main window behavior is otherwise unchanged.
* Right-click on the mascot = context menu with items: Show Main Window / New Note / Toggle AI
  Panel / --- / Disable Pet Mode. Each item triggers an existing in-app action.

### R4. Toggle (menu bar)
* A checkable "Desktop Pet Mode" item in the macOS app menu (View submenu), with optional
  keyboard shortcut. Checkbox reflects current pet visibility. Toggling shows/hides the pet
  window and persists the preference.

### R5. Position persistence
* Pet is freely draggable (drag the mascot sprite). Last position persisted to `settingsStore`
  and restored on next launch. On first launch, default to a sensible corner (e.g. bottom-right).

### R6. Click-through
* Transparent regions of the pet window pass mouse events through to the desktop/apps beneath;
  only the mascot sprite area is interactive. (macOS: per-region mouse-event ignoring.)

### R7. Fullscreen handling (macOS)
* When the foreground app enters macOS fullscreen (a fullscreen Space), the pet auto-hides.
* When the foreground leaves fullscreen, the pet reappears at its last position.

### R8. Lifecycle
* App exit cleans up the pet window. Pet window does not keep the app alive on its own
  (closing the main window does not quit the app while pet mode is on — consistent with a
  persistent pet; quitting via menu quits both).

## Acceptance Criteria

* [ ] AC1: Enabling "Desktop Pet Mode" from the menu shows a small transparent always-on-top
  mascot window on the desktop; the menu item shows a checkmark.
* [ ] AC2: The mascot renders the ink-drop+folyn sprite and plays the `idle` animation.
* [ ] AC3: Hovering the mascot switches to `hover`; dragging it switches to `drag` and moves
  the window; clicking switches to `click` feedback.
* [ ] AC4: Single-clicking the mascot focuses (or re-shows) the main Folyn editor window.
* [ ] AC5: Right-clicking the mascot opens the context menu; each item performs its action
  (Show Main Window / New Note / Toggle AI Panel / Disable Pet Mode).
* [ ] AC6: Disabling "Desktop Pet Mode" hides the pet window; menu checkmark clears; re-enabling
  restores it at the last position.
* [ ] AC7: Relaunching the app restores the pet at its last saved position (when pet mode on).
* [ ] AC8: Clicking on transparent parts of the pet window passes through to the desktop.
* [ ] AC9: With an app in macOS fullscreen, the pet is hidden; it returns after leaving
  fullscreen.
* [ ] AC10: Quitting Folyn closes the pet window cleanly (no orphan process / stray window).
  * **R8 manual verification (close-doesn't-quit-while-pet-on)**: a Rust unit test for the
    `CloseRequested` handler is impractical (it would require mocking the Tauri window runtime).
    The behavior is implemented in `lib.rs` `on_window_event` for the `main` window: when the pet
    window `is_visible()`, `api.prevent_close()` + `window.hide()`; otherwise default close. Manual
    verification: (1) enable pet mode, (2) close the main editor window with the red traffic-light
    button — the app must NOT quit and the pet remains on screen; (3) single-click the pet — the
    main window re-shows; (4) disable pet mode, then close the main window — the app quits and no
    orphan pet window/process remains. The `pet` window's visibility is the source of truth for
    "pet mode active right now", so no separate cached Rust flag is needed.
* [ ] AC11: Lint / typecheck / existing tests pass; new tests cover window-state toggle and
  position persistence.

## Definition of Done (team quality bar)

* Tests added/updated (window visibility toggle state, position persistence, menu sync).
* Lint / typecheck / CI green.
* Notes/specs updated if new Tauri patterns emerge (e.g. transparent window, fullscreen
  detection) — capture via `trellis-update-spec` if reusable.
* Default-off, additive feature; rollback = disable the menu item.

## Out of Scope (explicit)

* Windows / Linux support (macOS-only MVP).
* Walking / sleep / summon animations, multi-pet, skins.
* File drag-drop onto the pet to open files.
* Schedule/study reminder push notifications via the pet.
* Position clamp on monitor disconnect / resolution change.
* "Minimize main window to pet" mode (coexist only).
* System tray icon.

## Technical Approach

### Window creation
* Create the pet window from Rust via `tauri::WebviewWindowBuilder` on first enable, or declare
  it in `tauri.conf.json` `app.windows` as a second window with the transparent/always-on-top
  flags and load a dedicated frontend route (e.g. `/#/pet`) so only the mascot component mounts.
* Use `tauri.conf.json` window flags: `decorations:false`, `transparent:true`,
  `alwaysOnTop:true`, `skipTaskbar:true`, `resizable:false`, `shadow:false`, `visible:false`
  (shown on enable).

### Frontend
* Dedicated pet entry: a `PetApp` React component (mounted on the `/#/pet` route or a separate
  Vite entry) rendering the SVG mascot + CSS keyframes for the 4 states, plus the context menu.
* Pet ↔ main app communication via Tauri events: pet emits `pet://click`, `pet://menu-action`;
  main window listens and dispatches to existing stores (editor/ai/sidebar).
* Position persistence + enabled state in `settingsStore` (extend existing settings schema).

### Menu
* Extend the `View` submenu in `lib.rs` `setup` with a checkable `MenuItem` bound to a
  `tauri::command` `toggle_pet_mode`; sync its checkmark from pet window visibility events.

### Fullscreen detection (macOS)
* Investigate during implementation: listen to `NSWorkspace.didActivateApplication` /
  `NSWorkspace.activeSpaceDidChange` (or a small `cocoa`/`objc` call) to detect a fullscreen
  Space and hide/show the pet. Persist findings to `research/fullscreen-detection-macos.md`.

### Click-through (macOS)
* Set the window `ignores_mouse_events` toggled per mouse-region, or use a transparent
* `WebKit` hit-test: simplest robust approach is to make transparent areas pass through by
  setting `NSWindow` `ignoresMouseEvents = true` and re-enabling only over the sprite via
  `setFrame:level:` hit-testing — to be validated in implementation.

## Technical Notes

* Tauri v2 supports multiple windows via `WebviewWindowBuilder` and tray icons via
  `tauri::tray::TrayIconBuilder`. The pet is most naturally a **second Tauri window**
  (frameless, transparent, always-on-top, skipTaskbar) rather than a tray icon, because the user
  wants it "on the desktop" not "in the menu bar".
* Consider `decorations: false`, `transparent: true`, `alwaysOnTop: true`, `skipTaskbar: true`,
  `resizable: false`, small `width`/`height` (e.g. 64x64–128x128).
* Frontend: a dedicated pet route/HTML entry or a separate small React component mounted in the
  pet window.
