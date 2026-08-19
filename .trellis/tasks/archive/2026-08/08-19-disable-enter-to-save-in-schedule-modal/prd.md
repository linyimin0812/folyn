# Disable Enter-to-save in schedule modal

## Goal

In `ScheduleModal`, pressing Enter in the title input currently triggers `save()`. User wants this removed — Enter should not submit. Save only via the Create/Save button.

## Requirements

- Remove `onKeyDown` Enter→save handler from the title input in `ScheduleModal.tsx`.
- Textarea behavior unchanged (Enter = newline, no save trigger).
- Modal closes on Esc unchanged (handled at workbench-page level).

## Acceptance Criteria

- [ ] Typing Enter in the title input does not call `save()`.
- [ ] Clicking Create/Save still works.
- [ ] Esc still closes the modal.

## Out of Scope

- Other modals.
- Adding a different shortcut (e.g. ⌘Enter).

## Technical Notes

- File: `apps/desktop/src/components/schedule/ScheduleModal.tsx:187` — `onKeyDown={(e) => { if (e.key === 'Enter') save(); }}` on the title `<input>`.
