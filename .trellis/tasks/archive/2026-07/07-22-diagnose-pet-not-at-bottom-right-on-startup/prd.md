# Diagnose Pet Not at Bottom-Right on Startup

## Goal

Add a temporary file-based diagnostic patch to capture the pet window's launch-time positioning flow, so we can pinpoint why the pet appears at the wrong position (not bottom-right) on app startup despite `petPositionX/Y=-1` (first-launch default branch should run).

## Context

- Persisted state (from `<appData>/storage.json` → `settings:all`):
  - `petModeEnabled: true`
  - `petPositionX: -1`, `petPositionY: -1` (no saved position → first-launch default branch)
  - `petSize: medium` (96px), `petPosVersion: 1`, `petSizeVersion: 2`
- Expected: `computeDefaultPetPosition` → bottom-right of work area → `set_pet_position` → pet visible at bottom-right.
- Actual (user report): pet shows, but at wrong position (not bottom-right).
- Existing diagnostic `console.info('[pet] launch position:', ...)` at `PetApp.tsx:549` is in the `pet` window's webview console — user can't easily access it (separate devtools per Tauri window).

## Hypothesis

Race between:
- `usePetHostBridge` (main window) launch-restore → `toggle_pet_mode` → `panel.show()` (orderFrontRegardless) — fires when `petModeEnabled=true`. If this runs BEFORE PetApp's mount effect, pet becomes visible at the `center:true` conf default (screen center) before `set_pet_position` lands.
- `PetApp` (pet window) mount effect → `set_pet_position` → `show()` → `pet_set_topmost_level`.

The race outcome + whether `set_pet_position` actually moves an NSPanel-converted window is unknown without runtime data.

## Requirements

- Diagnostic must persist to a file (not console) — user can't easily reach pet window devtools.
- Capture: timestamp, effect source (PetApp mount vs usePetHostBridge launch-restore), persisted state snapshot, workArea, resolved position, set_pet_position success/failure, outerPosition before/after, order of operations (which effect ran first).
- Non-invasive: must not change existing positioning logic. Only adds observation.
- Must be removable in one commit once root cause is confirmed.

## Acceptance Criteria

- [ ] Patch adds file-based logging at the key points in PetApp's mount effect and usePetHostBridge's launch-restore.
- [ ] Log file written to `<appData>/pet-launch-diag.json` (append per launch with timestamp).
- [ ] User can run the app once, then paste the file contents and we can pinpoint the root cause.
- [ ] No existing tests broken.
- [ ] Patch is clearly marked temporary (comments tagged `ponytail: diagnostic, remove after root cause confirmed`).

## Out of Scope

- Fixing the actual bug — that's a separate task once root cause is confirmed.
- Production-grade telemetry — this is throwaway diagnostic.

## Technical Approach

- In `PetApp.tsx` mount effect (around line 479-630): wrap the existing `console.info('[pet] launch position:', ...)` with a `writeFile` to `<appData>/pet-launch-diag.json` (append JSON line per launch).
- In `usePetHostBridge.ts` launch-restore (line 99-110): log timestamp + whether `toggle_pet_mode` was called + petModeEnabled state to the same file.
- Use existing `@tauri-apps/plugin-fs` `writeTextFile` with append semantics (read-existing-then-write-back, or use a small helper).
- Tag every addition with `// ponytail: diagnostic, remove after root cause confirmed`.
- Single file output: `<appData>/pet-launch-diag.json` — JSONL format, one entry per launch.

## Technical Notes

- `apps/desktop/src/components/pet/PetApp.tsx:479-630` — mount effect (position + show).
- `apps/desktop/src/hooks/usePetHostBridge.ts:99-110` — launch-restore (toggle_pet_mode call).
- `apps/desktop/src/utils/storageClient.ts:14` — `<appData>/storage.json` path precedent.
- petStore state: `petModeEnabled=true`, `petPositionX=-1`, `petPositionY=-1`, `petSize=medium` (confirmed from user's storage.json).
