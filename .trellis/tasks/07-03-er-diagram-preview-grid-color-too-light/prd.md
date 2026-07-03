# ER diagram preview grid color too light

## Goal

The DBML ER diagram preview's background dot grid is barely visible. Make the grid visible enough that users can perceive it as a grid (for spatial orientation when panning/zooming) without becoming visually noisy.

## What I already know

- File: `apps/desktop/src/components/file-types/dbml/ErDiagramPreview.tsx:357-364`
- Current grid: SVG `<pattern>` 20×20, dot = `<circle cx={0} cy={0} r={1} fill="var(--brd2)" />`
- `--brd2` values (from `apps/desktop/src/index.css`):
  - Light: `#c8d0e8` (pale lavender)
  - Dark: `#252d4a` (dark navy)
- `--bg` values: light `#f0f2f8`, dark `#0b0d14`
- Grid dots `r=1` at 20px spacing → dots occupy ~0.8% of area, very low contrast against `--bg`
- Grid lives inside the zoom/pan transform group, so it scales with zoom
- Toggle via toolbar already exists (`showGrid` state)

## Open Questions

- (resolved) — see Decision

## Requirements

- Grid dots must be clearly visible at default zoom (100%) in both light and dark themes
- Should not become overwhelming at high zoom or invisible at low zoom
- No change to grid spacing (20px), toggle behavior, or pan/zoom mechanics

## Acceptance Criteria

- [ ] At default zoom, user can see the dot grid on empty canvas area in light theme
- [ ] At default zoom, user can see the dot grid on empty canvas area in dark theme
- [ ] Grid still toggles off via toolbar button

## Decision (ADR-lite)

**Context**: Grid uses `r=1` + `--brd2` (pale border token), barely visible against `--bg`.
**Decision**: Bump to `r=1.5` and switch fill to `var(--t3)` (muted text token, ~1 step darker than `--brd2`).
**Consequences**: ~125% dot area + 1-step darker color → clearly visible without adding a new CSS token. If still too light in dark theme, revisit later.

## Out of Scope

- Grid spacing changes
- Re-templating to a line grid (keep dot pattern)
- Other ER diagram styling (table cards, refs, markers)

## Technical Notes

- `ErDiagramPreview.tsx:363` is the single line to change
- Reuse existing CSS variables — no new tokens
- `--brd2` is already used elsewhere as border emphasis; `--t3` (muted text) is darker; `--brd` is the standard border
