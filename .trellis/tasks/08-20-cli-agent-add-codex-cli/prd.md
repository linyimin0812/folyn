# CLI Agent — Add Codex CLI adapter

## Goal

Add OpenAI Codex CLI (`codex`) as a third selectable CLI adapter in
`@quill/cli-adapter`, surfaced in the desktop AI Panel / pet Chat adapter
selector alongside Claude Code and Pi. Users who prefer Codex can switch
to it end-to-end (prompt → streaming text/tool events → session resume).

## What I already know

- `packages/cli-adapter/src/` is flat; pattern is `BaseCliAdapter` + one
  concrete `<name>Adapter.ts` per CLI.
- `PiAdapter` (`piAdapter.ts`, 472 lines) is the closest sibling: non-
  Anthropic CLI, flat JSONL event protocol, `translatePiEvent` pure seam
  exported for unit tests. **No file_change synthesis** (comment: "follow-up").
- `ClaudeAdapter` (447 lines) is the streaming template (Tauri
  `Command.create` → `spawn()` → stdout line-buffered JSON → `processEvent`
  → `CliStreamEvent` fan-out). Codex mirrors this pattern but with a flat
  event protocol like Pi's.
- `registry.ts` has a `ADAPTERS` record keyed by id (`claude`, `pi`); each
  descriptor carries `displayName`, `description`, `factory`,
  `settingsFilePath` (with `~`), `settingsFileTemplate`.
- Desktop consumer `AdapterSelector.tsx` renders `listAdapters()`; needs
  `ADAPTER_ICON[id]` entry. Icon path:
  `apps/desktop/src/assets/agents/<name>.svg`.
- Public barrel `packages/cli-adapter/index.ts` re-exports adapters +
  helpers.

## Research References

- [`research/codex-streaming-and-resume.md`](research/codex-streaming-and-resume.md)
  — Codex CLI 0.145.0 probed empirically. Key takeaways:

### Codex CLI core facts (confirmed)

- **Invocation**: `codex exec --json [--cd <dir>] [--skip-git-repo-check]
  [--sandbox <mode>] [--dangerously-bypass-approvals-and-sandbox]
  [--ephemeral] [--ignore-user-config] [--ignore-rules] [PROMPT]` with
  stdin closed (`< /dev/null`) when prompt is passed as argv.
- **Output**: JSONL, one flat event per line (same framing as pi rpc).
- **Events** (top-level `type`):
  - `thread.started` `{thread_id}` → `session_id` (first event; persist for resume)
  - `turn.started` `{}` → ignore (turn boundary, no payload)
  - `item.started` `{item:{id, type, ...}}` → `tool_start` when `item.type !== 'agent_message'`
  - `item.completed` `{item:{id, type, ...}}`:
    - `item.type === 'agent_message'` → `text` (whole message, **no deltas** — `item.text`)
    - `item.type === 'command_execution'` → `tool_end` (`toolOutput=item.aggregated_output`)
    - any other `item.type` (`apply_patch` / `mcp_call`) → `tool_end` with `toolName=item.type` (generic)
  - `turn.completed` `{usage:{...}}` → `done` (terminal)
- **Resume**: `codex exec resume <SESSION_ID> [PROMPT] --json [flags]`.
  `--last` resumes most recent. Sessions stored at
  `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`; the adapter
  does NOT read these — `codex exec resume` handles it.
- **No long-lived child** (unlike pi rpc). Each `send()` spawns a fresh
  `codex exec` (or `codex exec resume`) process via
  `Command.create('codex-cli', ['-l', '-c', shellCmd])`. `this.child` is
  per-send, not per-session.
- **Settings file**: `~/.codex/config.toml` (TOML; **empty file is valid** —
  Codex boots with defaults).
- **No on-disk skills/commands**: `~/.codex/agents/`, `~/.codex/commands/`,
  `~/.codex/prompts/` do not exist in Codex 0.145.0. `listSkills()` /
  `listCommands()` return `[]` (inherit `BaseCliAdapter` default — do not override).
- **Stderr noise**: ignore `Reading additional input from stdin...` (non-JSON
  line Codex prints when stdin is `/dev/null`).
- **Reasoning streaming gap**: Codex does reasoning internally but does
  NOT expose it in `codex exec --json` stdout. `CliStreamEvent.thinking`
  is never emitted by the codex adapter — documented gap, not a bug.

## Requirements

- `CodexAdapter` class in `packages/cli-adapter/src/codexAdapter.ts`
  extending `BaseCliAdapter`. One-shot spawn per `send()` (no long-lived
  child); `codex exec` on first send, `codex exec resume <thread_id>` on
  subsequent sends when a `thread_id` was persisted.
- Pure helper `translateCodexEvent(event: unknown): CliStreamEvent[]`
  exported for unit tests, mirroring `translatePiEvent`. Switch on
  `event.type` per the event taxonomy above. Generic `item.type` fallback
  for `apply_patch` / `mcp_call` / unknown types.
- Pure helpers `buildCodexArgs(prompt, options)` + `buildCodexShellCommand
  (cliPath, workingDir, args)` (or a single `buildCodexShellCommand`
  helper if simpler) — shell-quoted, `cd <workingDir> && exec codex … < /dev/null`
  pattern matching `buildClaudeShellCommand`. Reuse `quoteShellArg` from
  `claudeAdapter.ts`.
- Register in `registry.ts`:
  - `id: 'codex'`
  - `displayName: 'Codex'`
  - `description`: 中文 one-liner about OpenAI Codex CLI
  - `settingsFilePath: '~/.codex/config.toml'`
  - `settingsFileTemplate: ''` (empty file is valid TOML)
- Export `CodexAdapter` + `translateCodexEvent` + arg/shell helpers from
  `index.ts`.
- Icon `apps/desktop/src/assets/agents/codex.svg` + `ADAPTER_ICON.codex`
  entry in `AdapterSelector.tsx`.
- Unit tests `packages/cli-adapter/src/codexAdapter.test.ts` mirroring
  `piAdapter.test.ts` shape: `translateCodexEvent` cases (each event type
  + item.type dispatch + unknown item.type fallback) + arg builder cases.

## Acceptance Criteria

- [ ] `listAdapters()` returns `codex` alongside `claude` + `pi`.
- [ ] `createAdapter('codex')` returns a `CodexAdapter` instance.
- [ ] `CodexAdapter.send(prompt)` spawns `codex exec --json …` and emits
      `session_id` (from `thread.started`) → `text`/`tool_start`/`tool_end`
      → `done` (from `turn.completed` or close).
- [ ] Second `send()` uses `codex exec resume <thread_id>` when the first
      send persisted a `thread_id`.
- [ ] `AdapterSelector` shows the Codex entry with the correct icon.
- [ ] `translateCodexEvent` unit tests cover: `thread.started`,
      `agent_message`, `command_execution` start+complete, generic
      `item.type` fallback, `turn.completed`.
- [ ] `listSkills()` / `listCommands()` return `[]` (inherit base default).

## Definition of Done

- Unit tests added (`codexAdapter.test.ts`); existing tests still green.
- Lint / typecheck green.
- Registry + index + desktop selector + icon wired in one coherent diff.
- Rollout: additive (default selection unchanged; no migration).

## Out of Scope

- file_change synthesis (Pi has none; out of parity scope).
- Streaming text deltas (Codex doesn't expose them; whole-message at
  `item.completed`).
- `thinking` events (Codex doesn't expose reasoning content in stdout).
- `apply_patch` patch-field parsing (treated as generic tool call).
- `--add-dir` mapping (Quill's `CliSendOptions.addDir` exists but Codex
  plumbing can land in a follow-up; YAGNI for v1).
- `--bare` parity (no single flag in Codex; `--ignore-user-config` +
  `--ignore-rules` + `--skip-git-repo-check` approximate it; project
  `AGENTS.md` is still loaded from cwd — out of scope for v1).

## Technical Approach

Per-send lifecycle (one-shot, no long-lived child):

1. First `send(prompt, opts)`:
   - `thread_id = null` → spawn `codex exec --json --cd <workingDir>
     --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox <prompt> < /dev/null`
     (shell-quoted).
   - On `thread.started` event: persist `this.threadId = event.thread_id`,
     emit `session_id`.
   - On `item.completed` with `item.type === 'agent_message'`: emit `text`.
   - On `item.started` with non-`agent_message` `item.type`: emit
     `tool_start`.
   - On `item.completed` with non-`agent_message` `item.type`: emit
     `tool_end` (with `aggregated_output` for `command_execution`).
   - On `turn.completed` OR `command.on('close')`: emit `done`, resolve
     send promise.
2. Subsequent `send()` with persisted `this.threadId`:
   - spawn `codex exec resume <threadId> <prompt> --json … < /dev/null`.
3. `stop()`: kill in-flight child if any, reset `this.threadId`? No —
   keep `threadId` so a stopped-then-resumed session still resumes.
4. Stderr: emit `error` events for non-empty stderr lines EXCEPT
   `Reading additional input from stdin...` (noise).

### Decision (ADR-lite)

**Context**: Codex CLI has no long-lived stdin-driven rpc mode (unlike pi);
  it does support `codex exec --json` one-shot + `codex exec resume`.
**Decision**: One-shot spawn per `send()` (mirrors ClaudeAdapter's `-p`
  pattern, not PiAdapter's rpc child). Pure `translateCodexEvent` seam
  exported for tests (mirrors `translatePiEvent`). No file_change (Pi
  parity). No skills/commands override (Codex has no on-disk surface;
  inherit base default).
**Consequences**: Simpler than PiAdapter (no stdin framing, no pending-
  resolver queue, no agent_settled edge case). Spawn cost per send is
  same as ClaudeAdapter. Resume works via `codex exec resume`. Reasoning
  content gap is documented (not fixable from adapter side).

## Technical Notes

- Spec: `.trellis/spec/cli-adapter/frontend/directory-structure.md` —
  "Adding a New Adapter" steps 1–4.
- Reference: `packages/cli-adapter/src/piAdapter.ts` (closest sibling).
- Reuse `quoteShellArg` from `claudeAdapter.ts` (already exported).
- Codex CLI binary: `codex` (Homebrew cask `codex`); version 0.145.0
  probed. Settings file `~/.codex/config.toml`; sessions
  `~/.codex/sessions/`; auth `~/.codex/auth.json`.
- Research: [`research/codex-streaming-and-resume.md`](research/codex-streaming-and-resume.md).
