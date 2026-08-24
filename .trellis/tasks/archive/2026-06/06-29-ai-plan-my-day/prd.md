# AI Plan My Day (schedule planning assistant)

## Goal

Add an **"AI 规划今日"** experience to the Schedule workbench: given today's existing
events + the last 7 days' backlog of unfinished tasks, the AI proposes a time-blocked plan
for the day (schedule tasks into free slots, propose a few new tasks/breaks), the user
reviews a timeline overlay with per-item accept/edit, and on apply Folyn calls
`scheduleStore` actions. First killer AI feature on the Schedule surface — built
lightweight (Pattern B: AI as JSON advisor), no dependency on the agent-sdk-adapter task.

## What I already know

- Schedule feature (built): `apps/desktop/src/store/scheduleStore.ts` — `events` (timed:
  title/start/end/category/note, stored in daily notes by `noteDate`+`lineIndex`),
  `tasks` (board with `TaskColumn`, `priority`, `scheduledStart/End`, `dueMmDd`,
  `category`), pomodoro (`POMO_WORK`/`POMO_BREAK`), calendar filter. Actions: `addEvent`,
  `quickAddTask`, `scheduleTask`, `unscheduleTask`, `moveTaskStatus`, `setTaskDue`,
  `updateTask`. `start`/`end` are numbers (minutes since midnight).
- `apps/desktop/src/schedule/dailyScan.ts` — `extractDailyNotePaths`, `dateFromString`,
  `dateToString`.
- `apps/desktop/src/components/schedule/ScheduleWorkbenchPage.tsx` + `ScheduleView.tsx`
  — the UI surface where the "plan my day" button + preview overlay live.
- Existing AI: `AiPanel` + `claudeAdapter` + `adapterManager`; `DailyDigest`; `clipService`
  is the precedent pattern — **AI generates structured JSON → user confirms → Folyn applies
  via store actions** (no direct AI state mutation). Reuse `clipService`'s adapter-call +
  JSON-parse + error-handling shape.

## Decision (ADR-lite)

**Context**: The Schedule workbench has events + a task board + pomodoro but no AI. The
killer feature is "plan my day". The agent-sdk-adapter (MCP/tools) task isn't started;
building "plan my day" on Pattern B (JSON advisor) avoids waiting for it and matches the
light-footprint preference.

**Decision**:
- **Pattern B**: AI returns a structured plan JSON; Folyn parses → preview → user accepts
  per-item → Folyn applies via `scheduleStore`. No direct AI state mutation; reuses
  existing AI/adapter.
- **Scope S2**: schedule existing backlog into free slots + AI may propose a few **new**
  tasks (e.g. break a goal into subtasks) and necessary **break/buffer** blocks. No
  moving/shortening existing events, no cross-day carry-over (those are S3, out of scope).
- **Time constraints T2**: AI free-schedules — given today's date + existing events only,
  the AI decides work hours, breaks, and granularity itself. No settings guardrails for
  MVP (simpler; the AI is instructed to respect existing events and not double-book, and
  to keep blocks within reasonable hours).
- **Preview U1**: a **timeline overlay** on today's `ScheduleView` renders proposed blocks
  semi-transparent/dashed (vs confirmed solid); each item has ✓/✗ and drag-tweak; Accept
  applies checked items, Reject discards.
- **Backlog window W3**: scan the last **7 days** of daily notes for unfinished tasks
  (column != done) as the planning input.
- **Plan JSON shape**: `{ scheduledTasks: [{ taskId?: string, title?: string, start: number, end: number, priority?: number }], newEvents: [{ title, start, end, category, note? }], notes: string }`.
  `scheduledTasks` with `taskId` = schedule an existing task; with `title` (no taskId) =
  create a new task then schedule it.
- **Apply order**: create new tasks first (capture ids) → `scheduleTask` for all
  scheduled items (existing + new) → `addEvent` for new events. Fail-soft: one failed
  item doesn't abort the rest; report which applied/failed.
- Existing events are respected (AI must not double-book; preview shows proposed blocks
  only in free slots).

**Consequences**:
- + Delivers the killer feature now, lightweight, no adapter dependency.
- + Reuses clipService's proven AI-JSON→confirm→apply pattern + ScheduleView rendering.
- − T2 (AI free-schedule) may produce odd hours/granularity — mitigated by an instruction
  to keep within reasonable hours; if it misbehaves, upgrade to T1 (settings guardrails) later.
- − Timeline overlay with per-item edit is the heaviest piece (PR2).

## Requirements

- "AI 规划今日" button in `ScheduleWorkbenchPage` (+ a ⌘P command).
- Context gatherer: today's existing events + last-7-days unfinished tasks (via
  `scheduleStore`/`dailyScan`), serialized for the AI prompt.
- `planMyDayService`: call the AI (reuse `clipService`'s adapter-call pattern), parse the
  returned plan JSON; graceful on parse failure (show error, don't apply).
- Preview overlay on `ScheduleView`: render proposed blocks (semi-transparent/dashed),
  per-item ✓/✗ + drag-tweak, Accept/Reject.
- Apply: create new tasks → `scheduleTask` (existing + new) → `addEvent`; fail-soft.
- Empty-backlog state (no unfinished tasks in 7 days) → AI proposes a light plan or a
  "no backlog, create tasks?" hint.

## Acceptance Criteria

- [ ] "AI 规划今日" button in ScheduleWorkbenchPage (+ ⌘P command) gathers today's events + last-7-days backlog.
- [ ] AI returns a structured plan JSON (scheduledTasks / newEvents / notes); parse failure shows a friendly error, applies nothing.
- [ ] Preview overlay renders proposed blocks on today's timeline (semi-transparent/dashed, distinct from confirmed), each item ✓/✗ + drag-tweak.
- [ ] Existing events are respected — proposed blocks land in free slots only (no double-booking).
- [ ] Accept applies only checked items via `scheduleStore` (create new tasks → `scheduleTask` → `addEvent`); Reject discards.
- [ ] Fail-soft: a failed apply item doesn't abort the rest; result reports applied/failed.
- [ ] Empty-backlog state handled.
- [ ] Tests: context gather (7-day backlog), plan-JSON parse (valid/invalid), apply (mock AI → assert scheduleStore calls). tsc + build green.

## Definition of Done

- Tests added (gather, parse, apply).
- Lint / typecheck / build green.
- No new runtime dependency; reuses existing AI/adapter + ScheduleView.

## Out of Scope (explicit)

- Pattern A (AI directly manipulates schedule via tools) — future, after agent-sdk-adapter.
- S3 (move/shorten existing events, cross-day carry-over) — future.
- T1 settings guardrails (work hours / granularity config) — future if T2 misbehaves.
- Auto-apply without preview (always preview-first).
- Recurring events / long-term scheduling.
- Multi-day planning (today only).

## Implementation Plan (small PRs)

- **PR1 — `planMyDayService` + context gather + tests**: new `services/planMyDayService.ts`
  — gather today's events + last-7-days unfinished tasks (via `scheduleStore` + `dailyScan`),
  build the prompt (JSON schema + "respect existing events, no double-book, reasonable
  hours, S2 scope"), call the adapter (mirror `clipService`), parse plan JSON, handle
  parse errors. Pure service + unit tests (mock AI; assert gather + parse + apply-order
  logic against a fake `scheduleStore`).
- **PR2 — Preview overlay UI**: `PlanMyDayPreview` component overlaid on `ScheduleView` —
  render proposed blocks semi-transparent/dashed on today's timeline, per-item ✓/✗ +
  drag-tweak, Accept/Reject; wire the "AI 规划今日" button in `ScheduleWorkbenchPage` +
  ⌘P command; loading/error/empty states.
- **PR3 — Apply + polish**: apply checked items (create new tasks → `scheduleTask` →
  `addEvent`), fail-soft reporting, transactional-ish cleanup on reject, final tests +
  tsc/build.

## Technical Notes

- `apps/desktop/src/store/scheduleStore.ts` — `events`/`tasks`/`addEvent`/`quickAddTask`/`scheduleTask`/`moveTaskStatus`; `start`/`end` = minutes since midnight.
- `apps/desktop/src/schedule/dailyScan.ts` — `extractDailyNotePaths`/`dateFromString`/`dateToString` for the 7-day window.
- `apps/desktop/src/components/schedule/{ScheduleWorkbenchPage,ScheduleView}.tsx` — button host + overlay host.
- `apps/desktop/src/services/clipService.ts` — precedent for AI-JSON→confirm→apply (adapter call + parse + error handling).
- `apps/desktop/src/components/ai/adapterManager.ts` — AI invocation.
- `apps/desktop/src/services/commandRegistry.ts` — ⌘P command registration pattern.
