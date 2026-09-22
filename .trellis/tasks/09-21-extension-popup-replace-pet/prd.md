# Replace the pet panel in place with an extension popup

## Requirements
- Before launching a tool from the pet panel, align its actual current top-left position to the shared extension-tool panel.
- The extension popup has its own 720×560 default size. Preserve manual extension resizing on later opens; only inherit the pet panel top-left position, including negative screen origins and mixed-DPI displays.
- Cover extension results, built-in translation, inbox commands and recent-extension chips.
- Preserve direct launches elsewhere and existing hide/focus behavior.
- Near screen edges, shift the pet panel and its replacement inward using their actual dimensions. Keep the configured/user size; work-area visibility takes priority over exact alignment or mascot clearance.

## Approach
A dedicated awaited native placement command runs before dispatching the open event. macOS aligns AppKit top-left corners on the main thread while retaining the target frame size; other platforms copy physical position. No persisted-position lookup, transient global origin flags or changes to the command registry.

## Validation
Targeted UI routing tests assert placement precedes open dispatch and hide. No whole-project builds. Native popup handoff requires desktop verification.

## Verification
- New ordering regression failed before implementation (placement call absent).
- PetPanelApp.test.tsx: all 40 tests passed. Corrected the three outdated restoreFocus=true expectations in touched popup paths to their existing restoreFocus=false contract.
- Standalone AppKit probe using existing cocoa build artifacts copied hidden native frames exactly at (100,100) 440×620, (-200,1100) 500×700 and (800,200) 280×360.
- Command registration, platform cfg branches, oneshot completion and imports reviewed; git diff --check passed.
- No whole-project build. End-to-end popup handoff still needs verification after restarting the native backend.

## Larger extension popup follow-up
- Default extension dimensions changed to 720×560. Placement no longer replaces extension dimensions with the smaller pet-panel size.
- Subsequent opens preserve the extension window size chosen by the user.

## Edge-placement follow-up
- Added containment cases for four corners, central/edge anchors and negative-coordinate displays. Two cases failed before the fix.
- Mascot-click placement now clamps its preferred corner using the existing clampPanelPosition helper. Updated old overflow/no-overlap tests to the new visibility priority.
- macOS click opens retain logical units through IPC; non-macOS work-area coordinates are normalized before computing bounds.
- Extension placement clamps the target origin to the source monitor work area, with the extension's own size and appropriate DPI.
- Targeted panel/cursor/clamp tests: 28 passed. Native probe extracted the actual macOS placement block: 16 corner cases on 2 connected monitors passed, including 720×560 and 800×800 targets; sizes preserved.
- Windows/Linux code reviewed, not executed. No whole-project build.
