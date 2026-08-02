# PRD: Persist AI Session Mode Across Restart

## Background

Follow-up to the per-message mode fix (`c4c048c`). The session-level mode
(Agent/Ask/Chat) is still global `aiStore.inputMode` with default `'chat'`
and no persistence. On app restart it resets to Chat, so a session the
user left in Agent mode reopens showing Chat.

Per-session pair (`provider`/`model`) is already persisted on `AiSession`
and survives restart — `setSessionPair` mirrors the pattern this fix needs.

## Root Cause

`aiStore.inputMode` is a single global store field (default `'chat'`,
explicitly not persisted at aiStore.ts:458-460). `aiSessionPersistence`
serializes per-session objects and never touches `inputMode`. There is no
`mode` field on `AiSession` — mode is read globally by `ChatInput.tsx:139`
and written globally by `ChatInput.tsx:740`.

## Requirements

1. Each session remembers the mode it was left in (chat/agent/ask).
2. On restart, the active session restores its mode (not the global default).
3. Mode writes go through a per-session action mirroring `setSessionPair`.
4. Persistence is free — `saveAllSessions` already writes the whole session
   object; adding the field is enough.
5. Legacy sessions persisted before this change have no `mode` field —
   fall back to `'chat'` (matches existing default + the pair optional
   field convention).
6. New sessions seed their mode from the most recent session (mirrors the
   `provider`/`model` seed in `createEmptySession`).

## Non-Goals

- No migration/backfill of historical sessions.
- No removal of the global `inputMode` field — it stays as a session-less
  fallback (used by tests, and as the default when no session is active).
  Per-session `mode` takes precedence when an active session exists.
- No per-(session, mode) pair selection — one pair per session, unchanged.

## Acceptance

- Open a session, switch to Agent mode, quit, relaunch — session still
  shows Agent mode.
- New session created while another session is in Agent mode inherits
  Agent mode (mirrors pair inheritance).
- Legacy session with no `mode` field renders as Chat (no crash).
- Per-message tag (previous fix) still works — the message-level `mode`
  captured at send time is unchanged.
