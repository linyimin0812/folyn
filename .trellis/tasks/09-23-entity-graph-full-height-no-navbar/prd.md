# Entity graph page: remove breadcrumb bar, full-bleed layout

## Requirements
1. Remove the breadcrumb path bar at the top of EntityGraphView (「… › prev › current」).
2. The group-instance sidebar (right aside) must fill the page — no blank strip at the bottom / right edge. Cause: the graph tab sits inside ActivityPage's `p-8 max-w-[1200px] mx-auto` wrapper; graph tab must be full-bleed instead.

## Decisions
- Navigation back via breadcrumb is intentionally dropped (user confirmed). History-based center switching via node clicks stays.
- Page header (title/tabs/period picker) stays; it gets its own padding so the graph area can go edge-to-edge.
- `breadcrumbIndices` in display.ts becomes dead → delete it and its tests.

## Files
- apps/desktop/src/components/activity/EntityGraphView.tsx
- apps/desktop/src/components/activity/ActivityPage.tsx
- apps/desktop/src/components/activity/display.ts / display.test.ts
