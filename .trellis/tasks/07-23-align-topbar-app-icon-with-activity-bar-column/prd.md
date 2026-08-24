# Align Topbar app icon with ActivityBar column

## Goal

The Folyn logo in the Topbar (top-left) should visually align with the 36px-wide ActivityBar column directly below it, so the top-left corner reads as one vertical strip instead of a header that's wider than the activity bar.

## What I already know

- `Topbar.tsx`: `<header className="topbar ... px-2.5 ...">` → left padding 10px. Inside, `.tb-left` wraps `.logo` which has `px-2` (8px) + `gap-[7px]` + 24px `folyn.svg` image.
- Net: logo image left edge currently sits at ~18px from window left.
- `index.css` `.activity-bar`: `width: 36px; padding: 8px 0; align-items: center`. Icons are 36px wide, centered.
- ActivityBar is rendered below Topbar in `App.tsx` for `editor`/`schedule`/`study` pages (non-mobile only).
- Topbar spans full window width (including the 36px column above where ActivityBar would sit).

## Assumptions (temporary)

- "Aligned" means: logo occupies the same 36px column as the activity bar icons below.
- Mobile layout is out of scope (Topbar shows hamburger on mobile, ActivityBar hidden).
- Right-side Topbar content (view-mode segment, AI/Export/Lang/Theme buttons) stays as-is.

## Decision (ADR-lite)

**Context**: Logo image left edge currently ~18px; activity bar icons are centered in a 36px column starting at x=0.
**Decision**: Center-align the logo image in the first 36px column of the Topbar (match ActivityBar's centering). Concretely: drop Topbar left padding, wrap the 24px `folyn.svg` in a 36px flex-centered slot, keep the "Folyn" text after with existing gap.
**Consequences**: Logo's left padding goes away — hover bg now starts at x=0. Right-side content untouched. Mobile layout untouched (hamburger branch separate).

## Requirements

- Logo image is centered in the first 36px column of the Topbar.
- Logo's center x matches ActivityBar icon column's center x (x=18).
- No regression on mobile (hamburger still visible, no clipped logo).
- Right-side topbar buttons unchanged.

## Acceptance Criteria

- [ ] Logo image center sits at x=18 (center of 36px column), matching ActivityBar icon column center.
- [ ] Hover bg on logo still works (starts at x=0).
- [ ] Mobile Topbar unchanged (hamburger branch).
- [ ] Right-side topbar actions unchanged.

## Definition of Done

- Visual alignment verified in dev server for editor / schedule / study pages.
- Lint / typecheck green.

## Out of Scope (explicit)

- Mobile Topbar layout.
- Right-side topbar actions.
- Changes to ActivityBar component itself.

## Technical Approach

`apps/desktop/src/components/shell/Topbar.tsx`:
- Header `className`: `px-2.5` → `pl-0 pr-2.5` (drop left padding only).
- `.logo` div: replace `px-2` with `pl-0 pr-2`; wrap `<img>` in a `<div className="w-[36px] h-full flex items-center justify-center">` slot.

No CSS changes needed — all in JSX.

## Technical Notes

- `apps/desktop/src/components/shell/Topbar.tsx` (logo container)
- `apps/desktop/src/index.css` `.activity-bar` (36px reference, `align-items: center`)
- `apps/desktop/src/App.tsx:481-526` (Topbar + ActivityBar stacking)
