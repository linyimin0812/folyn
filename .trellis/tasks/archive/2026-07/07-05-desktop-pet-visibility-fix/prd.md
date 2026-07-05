# Desktop Pet Visibility Fix

## Goal

Fix two bugs causing the desktop pet to be invisible / misplaced when enabled, found during
manual verification of the desktop-pet-mode feature (commit `ab46e8c`).

## Root Causes (confirmed by code inspection)

### Bug 1 — Pet window is NOT transparent (R1 violation)
* `apps/desktop/index.html` hardcodes `<html data-theme="light">`.
* `apps/desktop/src/index.css` sets `html, body { background: var(--bg); }`, and under
  `[data-theme="light"]` `--bg: #f0f2f8` (opaque).
* `apps/desktop/src/main.tsx` imports `./index.css` for BOTH the main app and the pet window
  (single entry). So the pet window's `<body>` gets an opaque `#f0f2f8` background instead of
  being transparent.
* Result: the pet renders as an opaque 120x120 light-gray square (with the blue mascot on top),
  not a transparent window with just the mascot. Violates R1 (transparent) and undermines R6
  (click-through on transparent regions — there are no transparent regions).

### Bug 2 — Position unit mismatch (possible off-screen window)
* `apps/desktop/src/components/pet/PetApp.tsx` default-position calc:
  `x = monitor.size.width / scale - 140` — `monitor.size` is physical px, `/ scale` yields
  **logical** px. So `x` is logical.
* `apps/desktop/src-tauri/src/commands.rs::set_pet_position` uses
  `pet.set_position(PhysicalPosition::new(x, y))` — treats the input as **physical** px.
* Mismatch: a logical value is interpreted as physical. On a retina (scale=2) 2880-physical /
  1440-logical screen, default x ≈ 1300 (intended logical) → applied as physical 1300 = logical
  650 (mid-screen, not bottom-right as intended).
* Position-persistence path stores `outerPosition()` (physical) and re-feeds it to
  `set_pet_position` (physical) — that round-trip is consistent, but the **default** calc and any
  logical/physical mixing can place the window at an unexpected or off-screen spot, especially
  across multi-monitor / different-scale setups.

## Requirements

* R-F1. The pet window must be truly transparent on macOS: only the mascot sprite is visible,
  no opaque body background. (restores R1)
* R-F2. The pet window must not inherit the main app's opaque theme background. The pet window
  may still need `--acc` (mascot color) — keep the accent variable available, but force the
  body/html background to transparent.
* R-F3. Position handling must use one consistent unit. Pick **physical px** everywhere (Rust
  `PhysicalPosition` is the source of truth): default-position calc must produce physical px,
  `set_pet_position` takes physical px, persistence stores physical px. Default must place the
  pet at the bottom-right of the primary monitor, fully on-screen.
* R-F4. No regression to the main editor window's theming (the fix is scoped to the pet window
  only).

## Acceptance Criteria

* [ ] AC1: Enabling pet mode shows ONLY the mascot sprite (blue ink-drop + quill) on the
  desktop — no opaque 120x120 square around it. Transparent regions show the desktop beneath.
* [ ] AC2: The mascot appears at the bottom-right of the primary monitor on first launch
  (no saved position), fully on-screen (not clipped off any edge).
* [ ] AC3: Dragging the pet moves it; after drag, releasing and relaunching restores the pet at
  the last position (consistent units, no jump).
* [ ] AC4: The main editor window's theme/background is unchanged.
* [ ] AC5: `cargo check`, `tsc -b`, pet tests pass; no new lint regressions.

## Definition of Done

* Tests updated where feasible (position-unit consistency, transparent-bg assertion if practical).
* Lint / typecheck / CI green.
* Spec note: extend `tauri-window-patterns.md` with the "transparent window must override body
  bg" gotcha if not already covered.

## Technical Approach

* Bug 1 fix: in `apps/desktop/src/components/pet/pet.css`, add `html, body { background:
  transparent !important; }` scoped to the pet window. Since `pet.css` is imported in `main.tsx`
  for both windows, scope the override so it ONLY applies to the pet window — e.g. gate by the
  `#/pet` hash (add a class to `<html>` or use a body selector unique to the pet route). Simplest
  robust approach: in `main.tsx`, when `isPetWindow`, add `document.documentElement.classList.add('is-pet-window')`, then in `pet.css`: `html.is-pet-window, html.is-pet-window body { background: transparent !important; }`. Keep `--acc` available (the mascot uses `var(--acc, #3a6ef0)` fallback, which is fine even without a theme).
* Bug 2 fix: in `PetApp.tsx` default-position calc, produce **physical** px to match
  `set_pet_position`'s `PhysicalPosition`. `monitor.size` is already physical; do NOT divide by
  scale. Use `x = monitor.size.width - 140` (physical), `y = monitor.size.height - 140`
  (physical). Account for the dock/menu bar approximately (the -140 offset already does). Verify
  `outerPosition()` (physical) round-trips correctly (it does). Add a clamp so the default never
  goes negative.
* Spec: add a "Common Mistake: transparent window inherits opaque body bg" section to
  `tauri-window-patterns.md` if not already present.

## Out of Scope

* Arbitrary-foreground-app fullscreen detection (still deferred — separate issue).
* Position clamp on monitor disconnect (still deferred).
* Windows/Linux.

## Technical Notes

* Files to touch: `apps/desktop/src/components/pet/pet.css`, `apps/desktop/src/main.tsx`,
  `apps/desktop/src/components/pet/PetApp.tsx`, possibly
  `.trellis/spec/desktop/frontend/tauri-window-patterns.md`.
* No Rust changes expected (set_pet_position is correct as physical-px input; the bug is the
  frontend sending logical px for the default).
