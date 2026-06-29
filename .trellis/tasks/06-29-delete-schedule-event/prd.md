# Delete schedule event

## Goal

Allow users to delete a schedule event (and possibly a scheduled task) from the week grid, so mistakes or obsolete entries can be removed cleanly.

## What I already know

- `EventBlock.tsx` renders events with `eventId` prop; click currently only toasts a summary.
- `useScheduleStore` has `addEvent`, `moveEvent`, `scheduleTask` etc. but no delete action.
- `mutateNote(noteDate, fn)` already re-parses after write and returns canonical ParsedDaily; deleting = fn filters out the event by id/lineIndex.
- Event id format: `${noteDate}#${i}` (assigned by `parseDaily`).
- Scheduled tasks render via the same `EventBlock` (with `taskId`); unsched tasks live in TodayTaskList/UnschedDock/BoardView.

## Assumptions (temporary)

- Delete scope: events only (user said "删除日程"). Scheduled-task blocks could be removed by unscheduling (clearing scheduledDate), not deleting the task itself.
- No bulk delete in MVP — one event at a time.

## Open Questions

- (resolved) Q1: entry = click event → detail modal with delete button.
- (resolved) Q2: no confirmation + undo toast.
- (resolved) Q3: scope = event delete + task unschedule.

## Requirements

- **`deleteEvent(eventId)`** in `useScheduleStore`:
  - Locates event by id; reads its `noteDate`.
  - `mutateNote(noteDate, fn)` where fn filters out the event with that id (by lineIndex or id).
  - State updates: replace that noteDate's events with reparsed set.
  - Returns the removed event so caller can build an undo payload.
- **`unscheduleTask(taskId)`** in `useScheduleStore`:
  - Clears `scheduledDate`/`scheduledStart`/`scheduledEnd` on the task (task stays in daily note, returns to unscheduled).
  - Reuses `mutateNote` to update the task line in place.
  - State updates: replace that noteDate's tasks with reparsed set.
  - Returns previous schedule info for undo.
- **Toast extension**: `toast(msg, action?)` where action = `{ label: '撤销', run: () => void }`. Toast UI renders a button when action present. Auto-dismiss extended to ~5s when action present (1.8s default for plain msgs).
- **Event Detail Modal**: a new modal (or extend `ScheduleModal`) opened by clicking an event block. Shows title/time/category/note read-only (or editable in v2), with 「删除」(events) or「取消排程」(scheduled tasks) and「关闭」. Calls deleteEvent/unscheduleTask then closes.
- **Undo flow**: after delete, toast「已删除 〈标题〉，撤销」; clicking 撤销 re-adds the event (or re-schedules the task) via a new `restoreEvent(event)` helper (re-adds with new id) / `scheduleTask` with previous values.

## Acceptance Criteria

- [ ] Click an event block opens the Event Detail Modal.
- [ ] Click「删除」in modal: event removed from grid immediately, daily note file reflects removal, toast「已删除…，撤销」shows for ~5s.
- [ ] Click「撤销」in toast: event reappears in grid (with a new id), file re-contains the event line.
- [ ] Click a scheduled task block: modal shows「取消排程」; clicking it clears scheduledDate/Start/End, block disappears from week grid, task remains in TodayTaskList/UnschedDock/BoardView. Undo re-schedules it.
- [ ] Other events/tasks on the same day remain intact after delete/unschedule.
- [ ] After undo, file on disk matches the pre-delete state (semantically — line may be appended at section end due to id/lineIndex change).

## Definition of Done

- Lint / typecheck / build green.
- No regression on add/move/schedule flows.

## Out of Scope (explicit)

- Bulk delete.
- Editing event fields in the detail modal (read-only for v1; edit mode is a separate task).
- Delete from TodayTaskList/BoardView (only dock + week grid covered).

## Added Scope: 待排程 dock 删除任务

- **`deleteTask(taskId)`** in `useScheduleStore`:
  - Locates task by id; reads its `noteDate`.
  - `mutateNote(noteDate, fn)` where fn filters out the task with that id (by lineIndex or id).
  - Returns the removed task so caller can build undo payload.
  - Undo: `restoreTask(task)` re-adds the task line via `mutateNote` append.
- **`DockChip` 删除入口**：在 `UnschedDock` 的 chip 上加一个删除按钮（hover 显示 × 或右键菜单），点击后调用 `deleteTask`，弹撤销 toast。
  - 待排程 = `!scheduledDate && !done`，删除从 dock 移除并从 daily note 删行。
- Toast 撤销：复用 `toast(msg, action)` API；撤销把任务重新写回 daily note（`restoreTask`）。

## Technical Notes

- Files: `apps/desktop/src/store/scheduleStore.ts`, `apps/desktop/src/components/schedule/EventBlock.tsx`, `apps/desktop/src/components/schedule/ScheduleModal.tsx`, `apps/desktop/src/components/schedule/Toast.tsx`, `apps/desktop/src/index.css`.
- `mutateNote` already re-parses; delete fn just filters `parsed.events` (by id or lineIndex).
- `toast(msg, action?)` API is backward-compatible — existing callers unaffected.
- `restoreEvent(event)`: re-add via `mutateNote(noteDate, fn)` where fn appends `{...event, id:'', lineIndex:-1}`; reparsed gives new id.
- `unscheduleTask` symmetric to `scheduleTask`; just clears the three fields (sets to undefined).

## Decision (ADR-lite)

**Context**: Need a way to remove events from the calendar; also surfaced scheduled-task unscheduling for parity.

**Decision**:
- Click event/task block → detail modal (read-only) with delete/unschedule button.
- No confirmation dialog; use undo toast (~5s) for reversibility.
- Scope: event delete + task unschedule. No task deletion (handled by board view in future).

**Consequences**:
- Toast component must support action buttons — small API change, backward-compatible.
- Undo for delete re-adds the event with a new id/lineIndex — semantic restore, not byte-identical line position.
- Future task deletion (from BoardView) remains a separate flow.
