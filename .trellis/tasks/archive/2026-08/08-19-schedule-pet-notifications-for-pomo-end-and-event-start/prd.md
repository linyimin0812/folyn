# Schedule pet notifications — pomo end + event lead

## Goal

Wire schedule events into the desktop-pet notification system so:
1. When a focus pomodoro (work mode) ends, send a pet notification. A toggle on the pomodoro card controls whether to notify.
2. When an event is about to start, send a pet notification X minutes before. The event modal gets a notification config: enable toggle + lead-minutes input.

## What I already know

- **Pet notification entry**: `dispatchNotification(payload: PetBubblePayload)` from `apps/desktop/src/services/petNotifyDispatcher.ts`. Reads `petStore.notificationForm` ('bubble' | 'corner' | 'off') and routes accordingly; always captures to `petStore.inboxItems`. Payload shape: `{ text, title?, kind?, source?, ... }`. Schedule code runs in the main window so direct import is fine.
- **Pomo state**: `PomoState` in `scheduleStore.ts:32-37` = `{ mode: 'work'|'break', remaining, running, round }`. `tickPomo()` (line 558-574) ticks every 1s (from `setInterval` in `ScheduleWorkbenchPage.tsx:55-59`); on `remaining` hitting 0 it transitions mode, resets remaining, and toasts. Work-end currently calls `toast(pomoWorkEnded)`; break-end calls `toast(pomoRestEnded, { round })`.
- **Event storage**: events live in daily note `## 日程` section as `- @event HH:MM-HH:MM | title | note`. `EVENT_RE` and `buildEventLine` in `markdown.ts`. `ScheduleEvent` type has `{ id, noteDate, start, end, title, note?, lineIndex }` — no notification config field. Event id = `${noteDate}#${lineIndex}` — unstable when lines above change.
- **Event modal**: `ScheduleModal.tsx` handles create/edit for events. Save path: `updateEvent(eventId, { title, start, end, note })` or `addEvent(day, { title, start, end, note })`. `addEvent`/`updateEvent` in `scheduleStore.ts`.
- **Existing 1-min ticker**: `ScheduleWorkbenchPage.tsx:62-66` has `setInterval(() => setNowTick((n) => n + 1), 60_000)` for now-line redraw. Can be reused to also poll upcoming events.

## Open Questions

- (resolved) Q1: Pomo notify on **both** work-end and break-end.
- (resolved) Q2: Event notify config = **Approach A: extend event line format with attr block**.

## Requirements (evolving)

- Add `notify: boolean` to pomodoro state (persisted); when true, work-end (and possibly break-end) emits a pet notification in addition to the existing toast.
- Add a toggle in the pomodoro card UI for this notify flag.
- Add `notify?: boolean` and `notifyLeadMin?: number` to `ScheduleEvent`; persist in daily note; pre-fill + save via event modal.
- Add notification config UI to event modal: enable toggle + lead-minutes input (e.g. 5/10/15 min).
- Add a per-minute ticker that checks upcoming events; for each event with notify=true whose start is exactly `now + leadMin` minutes away, fire `dispatchNotification` once.

## Acceptance Criteria (evolving)

- [ ] Toggling pomodoro notify on; when work session ends, a pet notification surfaces (text: "专注番茄结束，休息一下").
- [ ] Toggling pomodoro notify off; work-end still toasts but no pet notification.
- [ ] Event modal: enabling notify + setting lead=5 min; 5 minutes before event start, pet notification surfaces with the event title.
- [ ] Same event fires only once per lead window (not every minute).
- [ ] Notifications persist in pet inbox (`petStore.inboxItems`).

## Definition of Done

- Lint / typecheck green.
- No regression on pomodoro flow, event add/edit, daily note parse/serialize.
- Persistence: pomo notify toggle survives app restart; event notify config survives daily note reload.

## Out of Scope

- Per-event notify time picker (only "X minutes before" presets).
- Bulk notify config across multiple events.
- Notifying on task due dates (separate feature).

## Technical Approach

**Approach A: extend event line format with attr block** (Recommended)

- New event line: `- @event HH:MM-HH:MM | title | note @{notify:1 lead:5}`
- Update `EVENT_RE` to optionally capture trailing `@{...}` block.
- Update `parseDaily` to read `attrs.notify` / `attrs.lead` (or `notifyLeadMin`).
- Update `buildEventLine` to write the attr block when notify is true.
- Add `notify?: boolean` and `notifyLeadMin?: number` to `ScheduleEvent` type.
- `addEvent` / `updateEvent` signatures extended; event modal passes through.

**Approach B: separate persisted settings slice keyed by `${noteDate}#${title}`**

- Avoid touching event line format. Risk: title collision / rename breaks the link.

**Event notify firing**: add `firedNotifKeys: Set<string>` to schedule store state (in-memory, reset on reload — acceptable since reloading near event time still fires if window is hit). Key = `${eventId}#${leadMin}`. The 1-min ticker iterates events, checks `now + leadMin*60_000` vs event start, fires if matched and key not in set.

**Pomo notify**: in `tickPomo()` work-end branch, if `pomo.notify` is true, call `dispatchNotification({ text: ..., source: 'schedule.pomo' })`.

## Decision (ADR-lite)

Pending: Q1 (pomo scope), Q2 (event storage).

## Technical Notes

- Files: `scheduleStore.ts` (PomoState + ScheduleEvent extensions + event notify ticker + pomo notify call), `markdown.ts` (EVENT_RE / parseDaily / buildEventLine), `types.ts` (ScheduleEvent), `ScheduleModal.tsx` (notify UI + save), `ScheduleWorkbenchPage.tsx` (ticker hook), pomodoro card component (toggle), `i18n/locales/*/schedule.json` (new keys).
