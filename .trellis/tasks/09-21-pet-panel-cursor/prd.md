# Pet panel shortcut follows cursor

## Goal
Open the pet panel near the current cursor when summoned by the global shortcut.

## Requirements
- Read the cursor position on each shortcut open and use its monitor work area and scale.
- Place the panel 12 logical points from the cursor, clamped inside the work area.
- Preserve toggle-off, search focus, and post-show frame reassertion.
- Default size is 440×620 logical points. Preserve user-resized dimensions; monitor changes affect position only. Never cache DPI for size persistence or record hidden frames.
- Keep mascot-click placement unchanged; no continuous tracking after opening.

## Validation
Targeted position tests for normal placement, screen edges, negative monitor origins, and oversized panels. No whole-project builds. Native multi-monitor behavior requires manual verification.

## Result
Cursor context is normalized per platform in petCursor.ts. The macOS cursor is scaled by the primary display, whereas monitorFromPoint compares logical CGDisplayBounds. Position and size IPC now use Tauri Position/Size enums; macOS shortcut frames stay logical through both native applies. All existing command callers were updated; no old payload fallback remains.

## Verification
- Initial pure positioning cases: 5 passed.
- Added cursor context regression: 4 failures before normalization (2 no-monitor errors, 2 coordinate mismatches), all 5 pass after the fix.
- Native Tao probe linked against existing artifacts: 2 failing samples on the Retina display before normalization; all 6 samples select the correct monitor after normalization across the 2x laptop display and 1x external display above it.
- Original position test file has 18 pre-existing failures; pristine HEAD reproduced them.
- PetPanelApp suite: 36 passed, 3 failures; pristine HEAD: 35 passed, the same 3 failures (translation/inbox/recent-item actions).
- No whole-project build or full popup smoke test. Rust IPC changes require the updated native backend.

## Size follow-up
- Reproduced stored dimensions changing from 440×620 to 220×310 after moving from 2x to 1x because the persistence poll cached the first scale.
- Removed monitor-size clamping and its obsolete helper. Size resolution no longer takes a work area.
- Poll current DPI, discard samples crossing a DPI transition, and ignore hidden window geometry.
- Cursor, placement, size resolution and persistence regression selection: 17 tests passed.
- Native query smoke test succeeded on both connected displays; full popup UI after native backend restart still requires manual verification.
- Final git diff --check passed.
