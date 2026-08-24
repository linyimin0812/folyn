# Added task missing from board view

## Goal

User reports: on Board view, opened new-task modal via "+", picked a default (non-done) column, entered title, created — task does not appear in the board column. Reproduce and fix.

## What I already know

- Entry: Board view → "+" or ⌘N → ScheduleModal with `intent = { kind: 'task', col: 'todo', day: today, hour: 9 }`.
- Modal `save()` for new task (ScheduleModal.tsx:138-149): `await addTask(day, { title, column: col, category, priority, due: undefined, progress, subtasks: 0, assignees: ['YL'] })`, then `onClose()`.
- `addTask(noteDate, t)` (scheduleStore.ts:321-340): `mutateNote` writes the task line, re-parses, `set` replaces tasks for that noteDate with reparsed set, toasts `taskAdded`.
- `mutateNote` (scheduleStore.ts:121-134): `readNoteContent` (creates template if missing — template has no `## 任务` section) → `parseDaily` → `fn` (appends new task with lineIndex -1) → `serializeDaily` (appends to `## 任务` section, creating it if absent via `appendToSection`) → `writeNoteContent` → `refreshFileTree` → re-parse returns.
- BoardView filter (BoardView.tsx:27-37): task shows in column `colId` iff `t.column === colId` AND (`t.noteDate.slice(5) === anchorMmDd` OR `t.due === anchorMmDd` OR (today anchor AND !done AND overdue)). For a task created today with no due, the first clause matches when anchor is today.
- `anchor` in BoardView is `useState(() => today)` — initialized at mount to today's local midnight. `anchorMmDd` derived from `anchor`.
- ScheduleWorkbenchPage (line 39-50) subscribes to fileTree; on fileTree change, debounced 300ms → `refresh()` re-reads all daily notes and sets `tasks`.
- Recent commits: fc6bc57c removed EventCategory (task `cat` preserved); 8cba4259 added `saving` guard to modal save; my 8c7a2495 added hover × on TaskCard (no logic change).

## Hypotheses (to confirm/rule out)

- **H1**: The daily note file for today is not being written at all (mutateNote silently fails, or vault path misconfigured). Check: does `__daily__/2026-08-19.md` contain the task line after add?
- **H2**: The task line IS written but doesn't parse on re-read (e.g., attribute block format drift, or section heading mismatch). Check: file content vs. TASK_RE.
- **H3**: The task parses but `t.column` doesn't match any board column id (e.g., user customized board columns and the default `todo` id no longer exists, so the task is written with `col:todo` but no column renders that id). Check: user's `boardColumns` setting.
- **H4**: Race — `refresh()` runs between `set` (optimistic) and fileTree debounce, and reads a stale snapshot of the daily note (file write not yet flushed), wiping the task from state. Check: timing — does the task appear briefly then disappear, or never appear?
- **H5**: Anchor is not today — user navigated DayCalAside to a different day. Check: is the day-cell highlighted as "today" in DayCalAside?

## Reproduction needs

Need from user:
- Today's daily note content (`__daily__/2026-08-19.md`).
- Whether the task appears briefly then disappears, or never appears.
- Whether the modal closed after Create (i.e., did save() reach `onClose()`).
- Console errors during add.

## Open Questions

- (resolved) Q1: file has the task line (ruled out H1).
- (resolved) Q2: task never appeared (ruled out H4).
- (resolved) Root cause = **H3 confirmed**. User's `boardColumns` (`~/.folyn/storage/schedule.json`) is customized: only `待处理 (col-mszw4q86-s9q6)` and `已完成 (done)` remain — the default `todo` column was deleted. But `ScheduleWorkbenchPage` onNew callback (line 132) and ⌘N shortcut (line 73) hardcoded `col: 'todo'` in the modal intent. `ScheduleModal`'s `<select>` options come from `boardColumns` (no `todo`), but `value='todo'` doesn't match any option → browser visually renders the first option ("待处理") but state `col` stays `'todo'`. User clicks Create thinking they chose "待处理"; task is written with `col:todo` to the daily note. BoardView filter iterates `boardColumns` (`col-mszw4q86-s9q6`, `done`) — no column id matches `'todo'`, so the task never renders.

## Requirements

- `ScheduleWorkbenchPage` must derive the new-task intent's `col` from the user's actual `boardColumns`, not a hardcoded `'todo'`. Use the first non-done column id (fallback `'todo'` only if no non-done column exists).
- Fix applies to both the `+` button (`onNew`) and the ⌘N shortcut.

## Acceptance Criteria

- [ ] On a vault with customized board columns (no `todo` column), clicking `+` on Board view opens the new-task modal with a valid column pre-selected (the first non-done column).
- [ ] Creating the task writes the task line with the chosen column id, and the task appears in the corresponding board column immediately.
- [ ] ⌘N shortcut behaves identically.
- [ ] Vaults with default board columns (`todo`/`doing`/`review`/`done`) still work — `todo` is the first non-done column.

## Decision (ADR-lite)

**Context**: New-task intent hardcoded `col:'todo'`, but users can delete the default `todo` column. The HTML `<select>` silently swallows the value-vs-options mismatch, hiding the bug behind a misleading visual.

**Decision**: Derive `newTaskCol` from `useBoardColumns()` at the call site — `columns.find(c => !c.isDone)?.id ?? 'todo'`. Pass it through both `onNew` and the ⌘N effect.

**Consequences**:
- Existing orphan tasks in the daily note with `col:todo` (added before this fix) still won't render — user can delete via the new hover × on TaskCard... actually they can't, because the card never renders. User can either edit the daily note file directly to remap `col:todo` → `col:<valid-id>`, or delete those lines. Out of scope for this fix.
- No defensive guard in `ScheduleModal` itself — if a future caller passes an invalid `intent.col`, the same bug recurs. Trade-off: smaller diff, root cause at the actual bad call site.

## Definition of Done

- Root cause identified and fixed.
- Lint / typecheck green.
- No regression on add-event, move-task, schedule-task flows.

## Out of Scope (explicit)

- Bulk add.
- Editing other modal fields.

## Technical Notes

- Files: `ScheduleModal.tsx`, `scheduleStore.ts` (addTask/mutateNote), `BoardView.tsx` (filter), `markdown.ts` (parseDaily/serializeDaily), `ScheduleWorkbenchPage.tsx` (refresh subscriber).
- Likely narrow bug; once reproduced, fix is small.
