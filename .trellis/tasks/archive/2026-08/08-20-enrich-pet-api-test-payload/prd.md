# Enrich Pet API Test Payload

## Problem
The Pet External API settings block (`PetExternalApiBlock`) currently fires and copies a minimal `{"action":"notify","kind":"info","text":"hi"}` payload. Users don't see what the API can actually do (title / source / actions / launch), and have no field reference when constructing their own requests.

## Goal
Replace the "hi" sample with a full showcase payload that exercises title + source + text + actions + launch, and annotate the displayed curl with field meaning comments so users can copy a working, self-documenting example.

## Scope
- Single file: `apps/desktop/src/components/settings/NotificationsSettings.tsx`
- Optional i18n: leave existing keys; field comments stay in the curl string literal (zh-enough for now, matches the rest of the page's zh locale).

## Non-Goals
- Backend (`pet_api/dispatch.rs`) changes — payload contract is already rich enough.
- New i18n keys for field docs — comments live in the curl string.
- Multi-payload examples / picker — one canonical sample.

## Spec
- Payload shape must conform to what `build_notify` in `apps/desktop/src-tauri/src/pet_api/dispatch.rs` accepts:
  - `action: "notify"`, `kind` ∈ {info, reminder, message, event}
  - `text` required non-empty ≤4096 chars
  - `title` / `source` (≤128) optional non-empty
  - `actions`: array of `{id, label}` (or any objects) — empty array serialized as absent
  - `launch`: `{type: "url"|"app", value}` — url must be http(s), app must match `[A-Za-z0-9 .\-]+`
- Sample choice: `kind=reminder`, `title=任务待处理`, `source=folyn`, `text=测试通知已送达`, one action `{"id":"ok","label":"知道了"}`, `launch={type:url, value:https://example.com}`.

## Implementation
1. Add a single `SAMPLE_NOTIFY_BODY` constant string in `PetExternalApiBlock` (or module scope) holding the canonical JSON.
2. `curl` string: `# field doc lines\n` + `curl -XPOST 127.0.0.1:${port}/pet/action -d '${SAMPLE_NOTIFY_BODY}'` — shell-valid, comments above the command.
3. `handleTest` body: reuse `SAMPLE_NOTIFY_BODY`.
4. Remove the duplicated `"hi"` literals.

## Test
- Manual: open settings → Pet External API block → click 测试 → pet bubble shows reminder kind with title/source/text/action button/launch link. Click 复制 curl → paste in terminal → same bubble.
- Type-check passes (`pnpm -F desktop typecheck` or equivalent — user runs).

## Risk
- `actions` and `launch` rendering depends on `PetBubbleApp` supporting them. Already supported per `dispatch.rs` tests and the TS contract note (`PetBubblePayload`). If the bubble doesn't render actions, that's a separate bubble-rendering bug, not this task.
