# Sidebar Hide Button in Files Panel Header

## Goal
Add a button in the left files panel header that hides the sidebar (collapses it to zero width). Uses the `PanelLeftClose` icon from `lucide-react`.

## Scope
- Add `onCollapse?: () => void` to `SidebarContext`.
- `Sidebar.tsx` passes `() => setCollapsed(true)` via context.
- `FilesPanel.tsx` renders a `PanelLeftClose` button at the end of the header actions (both compact and non-compact variants).
- Add i18n tip key `sidebar:filesPanel.actions.hideSidebar` (en + zh).

## Out of scope
- Other panels (wiki/clips/calendar/analysis) — they don't need a hide button.
- Persisting collapsed state across reloads (existing behavior already doesn't persist).
