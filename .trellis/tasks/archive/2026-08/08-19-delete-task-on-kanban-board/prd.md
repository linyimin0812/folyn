# Delete task on kanban board

## Goal

Allow users to delete a task from the kanban board (BoardView) — mistakes or obsolete entries should be removable cleanly. The store action `deleteTask(taskId)` already exists with undo toast; this task wires up the UI entry point on `TaskCard`.

## What I already know

- `useScheduleStore.deleteTask(taskId)` is fully implemented (scheduleStore.ts:460-487): filters the task out of the daily note via `mutateNote`, updates state, shows an undo toast that re-appends the task on click.
- `BoardColumn` already has a hover × delete pattern for columns (BoardColumn.tsx:99-105, `.sw-col-del`).
- `TaskCard` is rendered only by `BoardColumn` (BoardColumn.tsx:119); click currently does `toast(`「${task.title}」)` — placeholder, no modal.
- Prior task `06-29-delete-schedule-event` explicitly deferred BoardView task deletion as "future task deletion (from BoardView) remains a separate flow" — this is that task.
- `ScheduleModal` has a `taskDetail` intent used by week-grid scheduled-task blocks; its danger button does `unscheduleTask` (clears `scheduledDate`, keeps the task) — appropriate for week grid, wrong for board (board tasks usually aren't scheduled; user wants them gone, not unscheduled).

## Assumptions (temporary)

- MVP = BoardView only. TodayTaskList (right rail) deletion is out of scope (UnschedDock already has delete from the prior task).
- No bulk delete.
- No confirmation dialog — undo toast is the reversibility mechanism (consistent with column delete and event delete).

## Open Questions

- (resolved) Q1: delete entry UI = **Approach A: hover × on TaskCard**. Mirrors existing `BoardColumn` column-delete pattern; shortest diff; no modal/intent churn.

## Requirements (evolving)

- Add a delete entry on `TaskCard` that calls `deleteTask(task.id)`.
- Undo toast (already implemented in store) provides reversibility — no confirm dialog.
- Button must not trigger on drag start (stop propagation, only show on hover).

## Acceptance Criteria (evolving)

- [ ] Hovering a TaskCard shows a delete control (× in top-right corner).
- [ ] Clicking × removes the task from its board column immediately, daily note file reflects the removal, undo toast shows for ~5s.
- [ ] Clicking 撤销 in toast re-adds the task to the board (new id/lineIndex, same content).
- [ ] Dragging a card does not accidentally trigger delete.
- [ ] Other tasks in the same column remain intact.

## Definition of Done

- Lint / typecheck green.
- No regression on drag/drop, column delete, or week-grid scheduled-task unschedule flow.

## Out of Scope (explicit)

- Bulk delete.
- Delete from TodayTaskList (right rail) — follow-up if needed.
- Editing task fields via modal — separate task (TaskCard click is currently a placeholder toast; leave as-is).

## Technical Approach

**Approach A: Hover × on TaskCard** (Recommended)

- Mirror `BoardColumn`'s `.sw-col-del` pattern: a small × button in the card's top-right, visible on hover.
- Call `deleteTask(task.id)` directly; store handles undo toast.
- Files touched: `TaskCard.tsx` (add button + `deleteTask` from store), `index.css` (`.sw-card-del` style), `i18n locales` (tooltip key reuse `schedule:modal.delete` or new `schedule:taskCard.delete`).
- Diff size: ~10 lines TSX + ~5 lines CSS.

**Approach B: Click TaskCard → ScheduleModal taskDetail with 删除 button**

- Wire `onOpenModal` from `ScheduleWorkbenchPage` → `ScheduleView` → `BoardView` → `BoardColumn` → `TaskCard`.
- Replace TaskCard onClick (currently placeholder toast) with `onOpenModal({ kind: 'taskDetail', taskId })`.
- In `ScheduleModal` taskDetail branch, swap or augment the danger button: currently `unscheduleTask`, need `deleteTask`.
- Problem: week grid also uses `taskDetail` intent and needs `unscheduleTask` (not delete). Would need to distinguish the two sources — new intent kind like `boardTaskDetail`, or a flag, or show both buttons.
- Diff size: ~30+ lines across 5 files, plus intent-type churn.

## Decision (ADR-lite)

**Context**: `deleteTask` is already in the store with undo; we need a UI entry on `TaskCard`. Two options: hover × (mirrors column delete) or click → modal (requires new intent kind to avoid clashing with week-grid unschedule flow).

**Decision**: Approach A — hover × on TaskCard top-right corner, calls `deleteTask(task.id)`; undo toast (already in store) provides reversibility; no confirmation dialog.

**Consequences**:
- ~15-line diff. No store changes. No modal/intent changes.
- TaskCard click placeholder toast remains (separate future task).
- TodayTaskList (right rail) deletion remains deferred — separate follow-up.

## Technical Notes

- `deleteTask` already re-parses the daily note and updates state atomically; no store changes needed.
- Undo toast re-appends via `mutateNote(noteDate, fn)` with `{ ...removed, id: '', lineIndex: -1 }` — semantic restore, new id.
- `TaskCard` is drag-source: `onDragStart` sets dragging state; × button must `stopPropagation` and only render when `!dragging` to avoid accidental clicks.
