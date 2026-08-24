# Connection test history bloat

## Goal

Stop the model-services "检测连接" flow from accumulating chat history across clicks. Today each click appends a user+assistant turn to `~/.folyn/chat-sessions/__connection_test__.json`; after enough clicks the reconstructed history pushes the request past the upstream model's context window (火山引擎 returns 400 `prompt_tokens_too_large` at 1.3M tokens). A connection test is a one-shot ping — it must not carry prior test history.

## What I already know

- `apps/desktop/src/components/settings/model-services/TestChatModal.tsx:107` calls `testChatConnection`.
- `apps/desktop/src/services/rigChat.ts:118-169` `testChatConnection` calls `runRigChat` with fixed `sessionId: '__connection_test__'` and `prompt: 'ping'`.
- `apps/desktop/src-tauri/src/chat.rs:232` `chat_stream`:
  - `load_history` (chat.rs:253) reads `~/.folyn/chat-sessions/{session_id}.json` and rebuilds rig `Message` history (user/assistant).
  - streams `prompt_msg + &history` to the upstream provider.
  - `save_history` (chat.rs:518) appends this turn's user+assistant messages back to the same file.
- `chat_stream` is the same path used by real chat — can't just nuke history handling for everyone.

## Assumptions (temporary)

- A connection test should send **only** the `'ping'` prompt (plus preamble) — no prior turns, no persisted result.
- Other callers (pet chat, AI panel) still want full load/save behavior.
- We don't need to clean up the existing bloated `__connection_test__.json` file — once we stop appending, it just sits there. (Could optionally delete on first ephemeral call.)

## Technical Approach (chosen — enum history_mode)

`ChatParams` gains `history_mode: Option<HistoryMode>` (default `LoadSave`).

```rust
pub enum HistoryMode { LoadSave, None, LoadOnly, SaveOnly }

pub struct ChatParams {
  ...
  #[serde(default)]
  pub history_mode: Option<HistoryMode>,
}
```

| Mode        | load_history | save_history | Caller                          |
|-------------|--------------|--------------|---------------------------------|
| LoadSave    | ✓            | ✓            | pet chat, AI panel (default)    |
| None        | ✗            | ✗            | testChatConnection              |
| LoadOnly    | ✓            | ✗            | (reserved, no caller yet)       |
| SaveOnly    | ✗            | ✓            | (reserved, no caller yet)       |

All 4 branches wired in `chat_stream` via `should_load` / `should_save` gates:

```rust
let mode = params.history_mode.unwrap_or(HistoryMode::LoadSave);
let should_load = matches!(mode, HistoryMode::LoadSave | HistoryMode::LoadOnly);
let should_save = matches!(mode, HistoryMode::LoadSave | HistoryMode::SaveOnly);
let hist = if should_load { load_history(&app, &params.session_id)? } else { Vec::new() };
// ... stream chat ...
if should_save { save_history(&app, &params.session_id, &hist)?; }
```

`testChatConnection` in `rigChat.ts` sets `historyMode: 'none'`. TS string literal mirrors the serde-renamed Rust enum variant.

### Decision (ADR-lite)

**Context**: Connection test was rebuilding + extending `~/.folyn/chat-sessions/__connection_test__.json` every click → 1.3M tokens 400 from upstream. One-shot ping must not carry history.

**Decision**: Enum `HistoryMode` on `ChatParams`, defaulting to `LoadSave`. `None` mode skips both load and save. Caller `testChatConnection` opts in.

**Consequences**:
- Future "replay a session without extending it" (LoadOnly) and "fresh prompt into existing session" (SaveOnly) are expressible without another schema change.
- Two enum variants (`LoadOnly`, `SaveOnly`) ship with no caller — but their branches are 1-line gates on `should_load`/`should_save`, not separate code paths. Ponytail-acceptable: the diff is 2 lines either way.

## Requirements

- `chat_stream` accepts `history_mode: Option<HistoryMode>`; default `LoadSave` preserves current behavior.
- `None` mode skips both `load_history` and `save_history`.
- `LoadOnly` and `SaveOnly` are defined variants; their branches are wired (skip the other side) but have no caller today.
- `testChatConnection` sets `historyMode: 'none'`.
- Existing chat callers (pet, AI panel) unaffected — they omit the field, default `LoadSave` holds.
- After fix, repeated "检测连接" clicks must not grow `__connection_test__.json`.

## Acceptance Criteria

- [ ] `ChatParams.history_mode: Option<HistoryMode>` exists; `HistoryMode` has 4 variants `LoadSave | None | LoadOnly | SaveOnly`.
- [ ] Default (absent or `LoadSave`) preserves today's load+save behavior — existing chat tests unchanged.
- [ ] `None` mode: `load_history` returns empty, `save_history` is skipped — no file write.
- [ ] `LoadOnly` mode: loads, skips save.
- [ ] `SaveOnly` mode: skips load, saves.
- [ ] `testChatConnection` passes `historyMode: 'none'`.
- [ ] Unit test in chat.rs: with `history_mode = None`, calling `chat_stream` against a stub provider does not create `~/.folyn/chat-sessions/<id>.json`.
- [ ] `rigChat.ts` types updated; existing chat tests still pass.

## Definition of Done

- Tests added/updated.
- Lint / typecheck / clippy green.
- Existing chat behavior unchanged for non-test callers.

## Out of Scope

- Cleaning up pre-existing bloated `__connection_test__.json` files on disk (user can delete manually, or we leave it).
- Generalizing to other "ephemeral" chat callers (none today).
- Migrating `__connection_test__` sessionId to per-call UUID.

## Technical Notes

- Files touched: `apps/desktop/src-tauri/src/chat.rs` (struct + 2 conditional branches), `apps/desktop/src/services/rigChat.ts` (param plumbing), `apps/desktop/src/components/settings/model-services/TestChatModal.tsx` (no change needed — `testChatConnection` handles it).
- `chat.rs:518` save_history is the write site; `chat.rs:253` load_history is the read site.
- Unit-test approach: call `chat_stream` with `ephemeral=true` against a mock/in-process provider, assert session file is not created. Existing tests at `chat.rs:595+` show the pattern.
