# PRD: Fix AI Message Mode Persistence Across Restart

## Background

AI Panel session has an `inputMode` (`chat` / `agent` / `ask`). When the user
sends a message in Agent mode, the message tag correctly shows "Agent" at
send time. After app quit + relaunch, the same message re-renders as "Chat".

## Root Cause

`inputMode` is a single global field on `aiStore` (default `'chat'`,
deliberately not persisted). The per-message `Agent`/`Chat`/`Ask` label is
computed at render time from the **current global `inputMode`**, not from
anything stored on the message. On restart `inputMode` resets to `'chat'`,
so every previously-Agent message relabels to Chat.

`CliMessage` (packages/cli-adapter/src/types.ts:22) has `provider?`/`model?`
optional fields used to tag Chat-mode messages the same way — mode is the
missing sibling.

## Requirements

1. Each message remembers the mode it was sent in (chat/agent/ask).
2. The render-time tag (`renderPairTag` in `AiPanel.tsx`) reads the mode
   off the message, not the global `inputMode`.
3. Persistence round-trips the field automatically (it already serializes
   `CliMessage` as-is), so no schema migration needed.
4. Legacy messages persisted before this change have no `mode` field —
   fall back to `'chat'` (matches the existing default).

## Non-Goals

- No migration/backfill of historical messages.
- No changes to how `inputMode` itself is selected or persisted.
- No new persistence layer or schema version bump.

## Acceptance

- Send a message in Agent mode → quit → relaunch → message still tagged "Agent".
- Send a message in Chat mode → still tagged with provider/model pair.
- Send a message in Ask mode → still tagged "Ask".
- Legacy messages (no `mode` field on disk) render as Chat (no crash, no
  missing tag).
