# ActivityBar: Expand Collapsed Sidebar on Panel Click

## Goal
When the sidebar is hidden (collapsed), clicking any panel button in the ActivityBar (e.g. the files icon) expands the sidebar and shows that panel.

## Approach
Lift `collapsed` state from `Sidebar.tsx` up to `App.tsx` (width stays local to Sidebar). `handlePanelChange` in App.tsx calls `setSidebarCollapsed(false)` alongside `setActivePanel`/`setCurrentPage`.

## Files
- `App.tsx`: hold `sidebarCollapsed` state, pass to `<Sidebar collapsed=… onCollapsedChange=…>`, un-collapse in `handlePanelChange`.
- `Sidebar.tsx`: accept `collapsed` + `onCollapsedChange` as props instead of local useState; drop the local `collapsed` state.

## Out of scope
- Schedule/study/settings nav clicks (they route to full pages, sidebar isn't visible there).
- Persisting collapse state across reloads.
