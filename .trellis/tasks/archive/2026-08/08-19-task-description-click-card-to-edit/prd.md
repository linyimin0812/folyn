# Task description + click card to edit

## Goal

Show task description on TaskCard and open the edit modal when clicking a card. Adds a first-class `desc` field to ScheduleTask (currently tasks have no description — only events have `note`).

## What I already know

- `ScheduleTask` (types.ts:35-68) has no description/note field. Existing `extraAttrs` mechanism passes through unknown attrs but `ATTR_RE = /(\w+):(\S+)/g` (markdown.ts:21) only captures non-whitespace values — can't handle descriptions with spaces.
- `TASK_RE = /^- \[([ x])\] (.+?)\s+@\{([^}]*)\}\s*$/` (markdown.ts:20) — title then `@{attrs}` block, no trailing text.
- `buildTaskLine` (markdown.ts:157-172) writes attrs as `key:value` space-joined.
- `ScheduleModal` has a desc textarea (line 191-198) + i18n `modal.descLabel` / `modal.descPlaceholder`. For events, desc → `editingEvent.note`. For tasks, desc is dropped (addTask/updateTask don't accept desc).
- `ScheduleWorkbenchPage` owns `modalIntent` state and passes `onOpenModal` only to `ScheduleView` (line 137). `BoardView` doesn't receive it.
- `ScheduleView` → `WeekGrid` → `EventBlock` already uses `onOpenModal({ kind: 'taskDetail', taskId })` for week-grid scheduled-task blocks.
- In `taskDetail` mode, the modal's danger button does `unscheduleTask` (ScheduleModal.tsx:276-279) — meaningful only when the task has `scheduledDate`. For unscheduled board tasks it's a no-op.
- Prior task `08-19-delete-task-on-kanban-board` added hover × on TaskCard for delete (Approach A). Hover × is the delete entry; the modal can focus on edit.

## Open Questions

- (resolved) Q1: Description storage = **Approach A: `desc:"..."` quoted attr**. Extend ATTR_RE to support quoted values; strip quotes on parse; assume no `"` inside desc (documented limit).
- (resolved) Q2: Danger button = conditional. If `editingTask.scheduledDate` → "取消排程" (unscheduleTask, existing week-grid behavior). Else → "删除" (deleteTask). Board tasks typically unscheduled → delete button.

## Requirements (evolving)

- ScheduleTask gains a first-class `desc?: string` field.
- `parseDaily` parses `desc`, `serializeDaily` writes it back.
- `addTask` / `updateTask` accept and persist `desc`.
- `ScheduleModal` saves desc for tasks (currently drops it); pre-fills from `editingTask.desc`.
- `TaskCard` renders `desc` below the title (reuse `.sw-card p` style).
- `TaskCard` click → `onOpenModal({ kind: 'taskDetail', taskId })`; toast placeholder removed.
- `onOpenModal` prop wired: ScheduleWorkbenchPage → BoardView → BoardColumn → TaskCard.

## Acceptance Criteria (evolving)

- [ ] Adding a task with a description via modal persists desc to daily note file.
- [ ] TaskCard renders the description below the title (truncated if long).
- [ ] Clicking a TaskCard opens the modal in edit mode with all fields pre-filled.
- [ ] Editing desc in modal and saving updates the file and re-renders the card.
- [ ] Drag still works (click vs drag distinguished — use the existing `dragging` flag).
- [ ] Hover × delete still works (not broken by click handler).

## Definition of Done

- Lint / typecheck green.
- No regression on event add/edit, task add/edit, drag/drop, scheduled-task unschedule flow.

## Out of Scope

- Markdown rendering in desc (plain text only for v1).
- Desc on TodayTaskList / UnschedDock chips (only board TaskCard shows it for now).

## Technical Approach

**Approach A: `desc:"..."` quoted attr in the `@{...}` block** (Recommended)

- Extend `ATTR_RE` to support quoted values: `/(\w+):("[^"]*"|\S+)/g`. Strip surrounding quotes on parse.
- `buildTaskLine` writes `desc:"<value>"` when desc present (with internal `"` escaped or just don't support internal quotes — ponytail: escape by doubling or use backslash; simpler: assume no `"` in desc, document the limit).
- Add `desc` to KNOWN_KEYS so it's not duplicated in extraAttrs.
- `parseDaily` reads `attrs.desc` (strip quotes) → `task.desc`.
- Add `desc?: string` to ScheduleTask type.
- `addTask` / `updateTask` signatures extended; modal passes `desc: desc.trim() || undefined`.

**Approach B: separate sub-line under the task**

- `- [ ] title @{attrs}` followed by `  > <desc>` or `  - <desc>` indented line.
- More invasive to parser (multi-line task records); bigger refactor.
- Rejected: too disruptive for v1.

## Decision (ADR-lite)

Pending: Q1 (syntax), Q2 (modal danger button behavior for unscheduled tasks).

## Technical Notes

- Files to touch: `types.ts`, `markdown.ts` (parseDaily/buildTaskLine/ATTR_RE/KNOWN_KEYS), `scheduleStore.ts` (addTask/updateTask), `ScheduleModal.tsx` (save desc for tasks, pre-fill, hide unschedule button when not scheduled), `ScheduleWorkbenchPage.tsx` (pass onOpenModal to BoardView), `BoardView.tsx` + `BoardColumn.tsx` + `TaskCard.tsx` (prop chain + click handler + desc render).
- Existing `.sw-card p` CSS (index.css:1038) already styled for description text — reuse.
- Drag-vs-click: TaskCard already tracks `dragging` state; `onClick={() => { if (!dragging) ... }}` pattern. Keep.
