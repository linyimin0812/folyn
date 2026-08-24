# Research: Codex CLI — Streaming Event Protocol + Session Resume

- **Query**: Inform `CodexAdapter` (`packages/cli-adapter/src/codexAdapter.ts`) wrapping `codex` CLI the same way `piAdapter.ts` wraps `pi` (Tauri `Command.create` → spawn → line-buffered stdout JSON → translate to `CliStreamEvent` union).
- **Scope**: mixed (local `codex --help` + live `codex exec --json` probes + binary strings + README/AGENTS.md)
- **Date**: 2026-08-20
- **Codex version probed**: `codex-cli 0.145.0` at `/opt/homebrew/Caskroom/codex/0.145.0/codex-aarch64-apple-darwin`

## TL;DR for the adapter author

- One-shot streaming command: `codex exec --json --skip-git-repo-check --sandbox <mode> [approval flags] [--cd <dir>] [PROMPT]` with stdin closed (`< /dev/null`) when prompt is passed as argv.
- Output is **JSONL, one flat event object per line** — same shape family as pi (flat `event.type`), NOT Claude's nested content-block envelope.
- Text is delivered as a **complete message** at `item.completed` (`item.type === 'agent_message'`, `item.text`) — there are **no token deltas** in the stdout stream.
- Session id is exposed in the very first event: `{"type":"thread.started","thread_id":"…"}` — persist this for resume.
- Resume: `codex exec resume <SESSION_ID> [PROMPT] --json` (non-interactive). `--last` resumes most recent. `--ephemeral` disables session persistence.
- Config file is `~/.codex/config.toml` (TOML, may be absent — Codex boots with defaults).
- Codex CLI has **no on-disk skills/commands directory** like Claude's `~/.claude/skills` or pi's `~/.pi/agent/prompts`. `listSkills()` / `listCommands()` should return `[]` (match `BaseCliAdapter` default).

## Findings

### 1. CLI invocation for one-shot streaming

#### Subcommand: `codex exec`

From `codex exec --help` (probed locally):

```
Usage: codex exec [OPTIONS] [PROMPT]
       codex exec [OPTIONS] <COMMAND> [ARGS]

Arguments:
  [PROMPT]   Initial instructions for the agent. If not provided as an argument
             (or if `-` is used), instructions are read from stdin. If stdin is
             piped and a prompt is also provided, stdin is appended as a
             `<stdin>` block.
```

Key flags (full set in `codex exec --help`):

| Flag | Purpose |
|---|---|
| `--json` | **Print events to stdout as JSONL** — required for streaming parse. |
| `-C, --cd <DIR>` | Working root (Codex uses this, NOT process cwd, when set). |
| `--add-dir <DIR>` | Extra writable dirs alongside primary workspace. |
| `-s, --sandbox <mode>` | `read-only` / `workspace-write` / `danger-full-access`. |
| `--dangerously-bypass-approvals-and-sandbox` | Skip approvals + sandbox (for externally-sandboxed envs — closest to pi's `--approve` / claude's bare autonomy). |
| `--dangerously-bypass-hook-trust` | Run hooks without persisted trust. |
| `--skip-git-repo-check` | Allow running outside a git repo (Folyn's temp/probe dirs are not always git repos). |
| `--ephemeral` | **Run without persisting session files to disk** — pass when the adapter does NOT need to resume (matches pi's `--no-session`). |
| `--ignore-user-config` | Do not load `~/.codex/config.toml` (closest to claude's `--bare` for user config; auth still uses `CODEX_HOME`). |
| `--ignore-rules` | Do not load user/project execpolicy `.rules` files. |
| `-c, --config <key=value>` | Override a TOML config value, e.g. `-c model="o3"`. Repeatable. |
| `-m, --model <MODEL>` | Override model. |
| `--strict-config` | Error on unrecognized `config.toml` fields. |
| `-i, --image <FILE>...` | Attach images to the initial prompt (maps to `CliStreamEvent.image`). |
| `-o, --output-last-message <FILE>` | Write the agent's final message to a file (alternative to parsing `agent_message`). |
| `--output-schema <FILE>` | JSON Schema constraining the final response shape. |
| `--color always|never|auto` | Color setting (default `auto`); use `never` for clean stdout. |

#### Stdin behavior

Probed: when prompt is passed as argv and stdin is redirected from `/dev/null`, Codex still prints `Reading additional input from stdin...` to stderr/stdout (a non-JSON noise line the adapter must tolerate), then runs to completion. So:

- **Prompt on argv, stdin closed** (`< /dev/null`) → works. Adapter should ignore the `Reading additional input from stdin...` line.
- **Prompt on stdin** (`echo "$PROMPT" | codex exec --json -`) → also works (argv prompt is then `-`).
- **Long-lived rpc-style mode (pi's `--mode rpc`): NOT available.** Codex has no stdin-driven long-lived protocol. Each `send()` must spawn a fresh `codex exec` (or `codex exec resume`) process. The adapter cannot keep one child alive across turns — unlike pi. This is the biggest architectural difference from `PiAdapter`.

#### Line format

JSONL — one JSON object per line, `\n`-separated. Same framing as pi rpc; `splitJsonlLines` (split on `\n` only, NOT a Unicode-aware reader — same rationale as pi rpc.md) can be reused verbatim.

Confirmed by capturing actual runs:

```
$ codex exec --json --skip-git-repo-check --sandbox read-only \
    --dangerously-bypass-approvals-and-sandbox "say hi in one word" < /dev/null
Reading additional input from stdin...
{"type":"thread.started","thread_id":"01a01c9d-d8e1-7643-a52e-53addc1e25ba"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Hi"}}
{"type":"turn.completed","usage":{"input_tokens":10747,"cached_input_tokens":0,"cache_write_input_tokens":0,"output_tokens":16,"reasoning_output_tokens":14}}
```

### 2. Event taxonomy

Codex emits a **flat** event object: `event.type === '<snake_case>'`. Like pi's `message_update`/`tool_execution_start`, NOT Claude's nested `{type:'assistant', message:{content:[{type:'text'...}]}}`.

Observed top-level `type` values (probed via real runs + binary string extraction):

| `type` | Payload shape | Maps to `CliStreamEvent` |
|---|---|---|
| `thread.started` | `{thread_id: string}` — emitted first, before any turn. | `session_id` (use `thread_id`) |
| `turn.started` | `{}` (turn id implicit). Optional signal; the adapter can ignore or use as a "turn boundary". | (no direct mapping; skip) |
| `item.started` | `{item: {id, type, ...}}` — tool call begins. `item.type === 'command_execution'` with `{command, aggregated_output:'', exit_code:null, status:'in_progress'}`. | `tool_start` (`toolId=item.id`, `toolName=item.type`, `toolInput={command}`) |
| `item.completed` | `{item: {id, type, ...}}` — tool result OR final assistant text. Two observed `item.type`s: `command_execution` and `agent_message`. See below. | `tool_end` or `text` (see below) |
| `turn.completed` | `{usage: {input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens, reasoning_output_tokens}}` — terminal event for the turn; process exits after. | `done` |

#### `item.completed` sub-shapes (by `item.type`)

**`agent_message`** (assistant final text — complete message, NOT delta):

```json
{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"The file contains the text \"test content here\"."}}
```

→ `CliStreamEvent = { type: 'text', content: item.text }`

> **No streaming deltas.** Even for multi-paragraph responses (`Count from 1 to 5…`), the entire text arrives in a single `item.completed` event. There is no `text_delta` / `item.started` for `agent_message`. The adapter emits one `text` event per `agent_message`; the UI renders it as a whole block. If/when Codex adds delta streaming, map here.

**`command_execution`** (shell tool call result):

```json
{"type":"item.completed","item":{"id":"item_0","type":"command_execution","command":"/bin/zsh -lc 'cat file.txt'","aggregated_output":"test content here\n","exit_code":0,"status":"completed"}}
```

→ `CliStreamEvent = { type: 'tool_end', toolId: item.id, toolOutput: item.aggregated_output }`

`item.started` for the same id precedes it:

```json
{"type":"item.started","item":{"id":"item_0","type":"command_execution","command":"/bin/zsh -lc 'cat file.txt'","aggregated_output":"","exit_code":null,"status":"in_progress"}}
```

→ `CliStreamEvent = { type: 'tool_start', toolName: 'command_execution', toolId: item.id, toolInput: { command: item.command } }`

#### Other item types (referenced in binary strings / instructions but not observed in stdout stream with this provider)

- **`apply_patch`** — Codex's built-in file-edit tool (referenced in the default base instructions: `"Always use apply_patch for manual code edits."`). With this provider (custom deepseek proxy), the model preferred shell `printf > file` and never emitted `apply_patch`. The likely shape (based on the `item.started`/`item.completed` pattern + `apply_patch_tool_type: "freeform"` string in binary) is `{item:{type:'apply_patch', id, …patch fields…, status}}`. The adapter should handle it generically: if `item.type` is neither `agent_message` nor `command_execution`, still emit `tool_start`/`tool_end` with `toolName = item.type`.
- **reasoning / thinking** — Codex does reasoning internally (config `model_reasoning_effort`), but the `codex exec --json` stdout stream does NOT expose reasoning content. The only reasoning signal is `usage.reasoning_output_tokens` in `turn.completed`. So `CliStreamEvent.thinking` is **never emitted** by the codex adapter (no source). Document this gap; don't synthesize.
- **mcp_call** — possible via `codex mcp` registered servers, but not observed. Treat generically like `apply_patch`.
- **error** — No dedicated `{type:"error"}` event was observed. Errors surface as non-zero exit code + stderr text. The adapter's stderr handler (mirrors `PiAdapter.command.stderr.on('data')`) emits `{type:'error', content: line}` for non-empty stderr lines. A `turn.completed` may not be emitted if the process crashes mid-turn — the adapter's `close` handler must still emit `done` (as `PiAdapter` does).

#### Nested content blocks?

**No.** Unlike Claude's `{type:'assistant', message:{content:[{type:'text', text}, {type:'tool_use'…}]}}`, Codex flattens: each item is its own top-level event. `agent_message.text` is a plain string, not a content-block array. The adapter does NOT need a content-block walker.

### 3. Session resume

#### Non-interactive resume: `codex exec resume`

From `codex exec resume --help`:

```
Usage: codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]

Arguments:
  [SESSION_ID]  Conversation/session id (UUID) or thread name. UUIDs take
                precedence if it parses. If omitted, use --last to pick the
                most recent recorded session.
  [PROMPT]      Prompt to send after resuming the session. If `-` is used,
                read from stdin.

Options:
      --last          Resume the most recent recorded session (newest) without specifying an id
      --all           Show all sessions (disables cwd filtering)
      --json          Print events to stdout as JSONL
      --skip-git-repo-check
      --ephemeral     Run without persisting session files to disk
      --ignore-user-config
      --ignore-rules
      ...
```

- Resume vector: `codex exec resume <SESSION_ID> "<prompt>" --json [sandbox/approval flags] [--cd <dir>]`.
- The resumed session's `thread.started` event re-emits the same `thread_id` (so the adapter can verify resume worked).
- `--last` resumes the most recent session (cwd-filtered by default; `--all` disables cwd filter).
- Session id is also accepted as a **thread name** (human-readable alias), not just UUID.

#### Interactive resume (TUI): `codex resume`

```
Usage: codex resume [OPTIONS] [SESSION_ID] [PROMPT]
…
      --last   Continue the most recent session without showing the picker
      --all    Show all sessions (disables cwd filtering and shows CWD column)
      --include-non-interactive   Include non-interactive sessions in the picker
```

The adapter uses **`codex exec resume`** (non-interactive), NOT `codex resume` (which opens a TUI picker). Don't confuse them.

#### Where session state lives

Probed:

```
$ ls ~/.codex/sessions/
2026/
$ find ~/.codex/sessions -type f | head
/Users/yiminlin/.codex/sessions/2026/07/16/rollout-2026-07-16T22-41-36-019f6b60-3abb-73d0-91ac-5c228ac188f5.jsonl
```

- Path: `~/.codex/sessions/YYYY/MM/DD/rollout-<ISO timestamp>-<session-uuid>.jsonl`
- One JSONL file per session, named with the session id (UUID). The adapter does NOT need to read these — `codex exec resume <id>` does it internally.
- `$CODEX_HOME` env var relocates the whole `~/.codex` directory (sessions, config, auth, logs). Default `~/.codex`.
- `--ephemeral` skips writing the rollout file.

#### Does the init event expose the session id?

**Yes.** The first stdout line is `{"type":"thread.started","thread_id":"<uuid>"}`. The adapter persists this `thread_id` and passes it to `codex exec resume` on the next `send()`.

The adapter's flow per send (one-shot model, no long-lived child):

1. First send: spawn `codex exec --json … "<prompt>"`, capture `thread_id` from `thread.started`, emit `session_id`, stream items, emit `done` on `turn.completed` / process close.
2. Subsequent sends: spawn `codex exec resume <thread_id> "<prompt>" --json …`, stream items, emit `done`.

(Contrast with `PiAdapter` which spawns one long-lived `pi --mode rpc` child and writes `prompt` commands to stdin. Codex has no equivalent long-lived mode, so each send is a fresh process. This is fine — the spawn cost is the same as claude's one-shot `-p`.)

### 4. Working directory + isolation

- **Working dir flag**: `-C, --cd <DIR>` (also top-level `codex --cd <DIR>`). Without it, Codex inherits process cwd (Tauri spawn cwd). Use it: `codex exec --json --cd <workingDir> …`.
- **Extra writable dirs**: `--add-dir <DIR>` (repeatable). Mirrors claude's `--add-dir`. Folyn's adapter currently drops addDir for pi; for codex, emit `--add-dir` per entry if `options.addDirs` is added to `CliSendOptions` later (YAGNI for v1).
- **No `--bare`-equivalent**. Closest approximations:
  - `--ignore-user-config` — skip `~/.codex/config.toml` (auth still loaded from `CODEX_HOME`). This is the closest to claude's `--bare` for skipping user-scope config.
  - `--ignore-rules` — skip user/project execpolicy `.rules` files.
  - `--skip-git-repo-check` — needed when workingDir is not a git repo (Folyn probe dirs).
  - Project-level `AGENTS.md` is loaded from cwd by default; there is **no flag to skip project AGENTS.md specifically**. If a project's AGENTS.md would interfere with feature-agent prompts, the adapter must use a different cwd or pre-emend the file — out of scope for v1.
- **Sandbox/approval**: `--sandbox read-only|workspace-write|danger-full-access` + `--dangerously-bypass-approvals-and-sandbox` for full autonomy (the adapter should default to `workspace-write` + `--dangerously-bypass-approvals-and-sandbox` to match pi's `--approve` behavior, OR expose a config knob — TBD by PRD).

### 5. Settings / config

- **Path**: `~/.codex/config.toml` (TOML). Confirmed by `-c` flag help text: *"Override a configuration value that would otherwise be loaded from `~/.codex/config.toml`."* Relocated by `$CODEX_HOME`.
- **Format**: TOML. Sample real file (`~/.codex/config.toml`):

  ```toml
  model_provider = "custom"
  model = "deepseek-v4-flash"
  model_reasoning_effort = "high"
  disable_response_storage = true

  [model_providers.custom]
  name = "deepseek"
  base_url = "http://127.0.0.1:15721/v1"
  wire_api = "responses"
  requires_openai_auth = true
  ```

- **Minimal valid content**: an **empty file** (zero bytes) is valid — Codex boots with defaults. No required section. The user can bootstrap auth separately via `codex login`.
- **Auth**: stored at `~/.codex/auth.json` (mode 0600). Separate from config. Loaded even when `--ignore-user-config` is passed.
- **Other notable state files in `~/.codex/`**: `history.jsonl` (prompt history), `logs_2.sqlite` (event log DB), `.codex-global-state.json` (UI state), `installation_id`, `keybindings.json`.
- **Profiles**: `-p, --profile <name>` layers `~/.codex/<name>.config.toml` on top of base config (alternative to multiple `~/.codex/config.toml` edits).

### 6. Skills / commands / agents discovery

**Codex CLI has NO on-disk skills/commands concept** like Claude's `~/.claude/skills/` + `~/.claude/commands/` or Pi's `~/.pi/agent/prompts/`.

Probed:

```
$ ls ~/.codex/agents/        → No such file or directory
$ ls ~/.codex/commands/      → No such file or directory
$ ls ~/.codex/prompts/       → No such file or directory
```

- `~/.codex/AGENTS.md` exists (empty, 0 bytes) — this is Codex's user-scope instructions file (the AGENTS.md convention), NOT a skills/commands registry.
- The project-level `AGENTS.md` (at the cwd root) is the only on-disk "agent instruction" source Codex reads. It is plain markdown, not YAML-frontmatter skill files.
- The `.codex/agents/` directory mentioned in the project's `/Users/yiminlin/project/folyn/AGENTS.md` ("optional custom subagents") refers to a future/experimental concept that does not exist on disk in this codex version (0.145.0). Not a discovery source.
- Codex's extensibility primitives are **plugins** (`codex plugin` subcommand, `[plugins."name@market"]` entries in `config.toml`) and **MCP servers** (`codex mcp` subcommand). Neither is a simple `*.md`-in-a-dir discovery model that the adapter could enumerate with `collectSkills`/`collectCommands`.
- **Recommendation for `CodexAdapter`**: `listSkills()` and `listCommands()` return `[]` (inherit `BaseCliAdapter` default — do not override). This matches the Folyn convention of "return [] when the CLI has no on-disk skill/command concept" and avoids inventing a non-existent discovery surface. Document this in the adapter JSDoc so a future reader doesn't think it's a TODO.

## Adapter shape sketch (informational, not a spec)

For the implementer — the codex adapter diverges from `PiAdapter` in two load-bearing ways:

1. **No long-lived child.** Each `send()` spawns a fresh `codex exec` (or `codex exec resume`) process via `Command.create('codex-cli', ['-l', '-c', shellCmd])`. `this.child` is per-send, not per-session. `stop()` just kills the in-flight child if any.
2. **No stdin-driven prompt framing.** Prompt goes on argv (shell-quoted) or piped to stdin (echo | codex exec --json -). The pi `buildPromptCommand` / `child.write(JSON.stringify(...) + '\n')` pattern does NOT apply.
3. **Event translator** is a flat `translateCodexEvent(event)` switch on `event.type`, mirroring `translatePiEvent` but with codex's four event types + `item.type` dispatch inside `item.completed`. Text is whole-message, so `agent_message` → one `{type:'text', content}` event (no delta accumulation).
4. **Done signal**: `turn.completed` → emit `done` and resolve the send promise. Also wire `command.on('close')` as a fallback done (in case the process exits without a `turn.completed`, e.g. crash).
5. **Stderr noise**: ignore the `Reading additional input from stdin...` line (non-JSON); only emit `error` events for non-empty non-`Reading additional input` stderr lines.

## Caveats / Not Found

- **Reasoning streaming**: not exposed in `codex exec --json` stdout. Only `usage.reasoning_output_tokens` count in `turn.completed`. `CliStreamEvent.thinking` is never emitted by the codex adapter — documented gap, not a bug.
- **`apply_patch` item shape**: inferred from binary strings + base-instructions reference, not directly observed (the custom deepseek provider preferred shell `printf`). The adapter should handle unknown `item.type` generically (emit `tool_start`/`tool_end` with `toolName = item.type`) so `apply_patch` and `mcp_call` items don't break the stream.
- **Error event**: no dedicated `{type:"error"}` event observed. Real production errors (auth failure, model 429, sandbox violation) may emit a different shape — the adapter should (a) treat any JSON line whose `type` is not in the known set as a potential error and (b) rely on stderr + non-zero exit as the error signal. Verify against a real auth-failure case when implementing.
- **`--bare` parity**: Codex has no single flag that disables ALL user/project context (claude `--bare` semantics). `--ignore-user-config` + `--ignore-rules` + `--skip-git-repo-check` together approximate it for config/rules/git but do NOT skip project `AGENTS.md`. If the feature-agent prompt must be pristine, the adapter must spawn from a clean cwd — out of scope for v1.
- **Codex repo source**: the OpenAI/codex Rust source was not fetched from GitHub in this research pass; event taxonomy was derived empirically from `codex exec --json` runs on the installed binary (0.145.0). The `codex` repo's `docs/` and Rust event structs (if public) would confirm the `apply_patch` / `mcp_call` / `error` shapes — a follow-up WebFetch pass to `https://github.com/openai/codex/blob/main/docs/` is recommended if the implementer hits an unmapped item type.
- **`codex exec review`** subcommand exists for non-interactive code review — not researched; likely emits the same JSONL stream. Out of scope for the Folyn adapter.
