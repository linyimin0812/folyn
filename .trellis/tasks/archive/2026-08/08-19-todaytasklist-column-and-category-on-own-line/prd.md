# TodayTaskList column and category on own line

## Goal

In the schedule page's TodayTaskList (right rail), each task currently shows the category chip inline with the title (`.sw-src` inside `.sw-body`). User wants the category and column label grouped together on a separate line below the title.

## Current state

`TodayTaskList.tsx:33-39`:
```jsx
<span className="sw-body">
  {task.title}
  <span className="sw-src">{category}</span>
</span>
<span className="sw-meta">{due?}{column}</span>
```

CSS `sw-src` has `margin-left: 6px; vertical-align: middle;` (chip styled for inline use).

## Fix

Move `sw-src` out of `sw-body`, prepend to `sw-meta` so title is alone on line 1, category + due + column on line 2. Tweak `sw-src` margin (left→0, add right gap or rely on flex/inline gap).

## Acceptance Criteria

- [ ] Title renders alone on its own line.
- [ ] Category chip + due + column label render together on a second line.

## Out of Scope

- Other rails (Reminders, UnschedDock).
- Reordering fields.

## Technical Notes

- Files: `apps/desktop/src/components/schedule/TodayTaskList.tsx`, `apps/desktop/src/index.css` (`.sw-task .sw-src` rule at line 952).
