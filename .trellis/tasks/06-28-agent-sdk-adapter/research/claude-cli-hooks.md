# Research: Claude Code (CLI) Hooks — PreToolUse/PostToolUse for Diff-Review Interception

- **Query**: Claude Code hooks config schema, handler invocation protocol (stdin/exit codes/JSON output), reaching the running Folyn app from the hook subprocess, Folyn wiring config without polluting global claude config, matcher + tool_input for Write/Edit/MultiEdit.
- **Scope**: external (Anthropic Claude Code docs) + internal (Folyn `ClaudeAdapter`, `DiffReviewBar`, capabilities)
- **Date**: 2026-06-28
- **Sources note**: Live web fetch was unavailable in this sandbox (no `curl`/WebFetch/`mcp__exa__*` tools exposed). Findings below are from the assistant's training knowledge of Claude Code hooks (stable, core protocol). Items that are version-dependent or that I could not verify against live docs are flagged `[UNVERIFIED]` / `[VERSION-DEPENDENT]`. **Verify against the live docs URLs below before implementing.**

## Primary docs URLs (to fetch/verify)

- Hooks reference: `https://docs.claude.com/en/docs/claude-code/hooks`
- Hooks guide (writing hook scripts): `https://docs.claude.com/en/docs/claude-code/hooks-guide`
- Settings reference (settings.json schema, precedence): `https://docs.claude.com/en/docs/claude-code/settings`
- CLI reference (flags like `--settings`, `--mcp-config`, `--permission-mode`): `https://docs.claude.com/en/docs/claude-code/cli-reference`
- MCP config (`.mcp.json`): `https://docs.claude.com/en/docs/claude-code/mcp`

---

## TL;DR for Folyn

Claude Code supports **`PreToolUse` hooks** that run as a subprocess *before* a tool executes and can **allow / deny / ask** the call. Folyn can register a hook for `Write|Edit|MultiEdit` whose `command` is a tiny bridge that POSTs the proposed `tool_input` to a localhost HTTP endpoint hosted by Folyn's Rust backend, blocks for the user's diff-review decision, and returns `permissionDecision: deny` to block the write (or `allow` to let it through). This replaces the current post-hoc diffing in `ClaudeAdapter` (which runs `--permission-mode bypassPermissions` and reads the file *after* it's already written).

Recommended config plumbing: spawn `claude` with `CLAUDE_CONFIG_DIR` pointed at a Folyn-managed temp dir (or `--settings <file>` + `--mcp-config <file>`), so Folyn's hooks + MCP server are wired without touching the user's `~/.claude`.

---

## Findings

### 1. Hooks config location + schema

**Where claude reads hooks:** the `hooks` key in `settings.json`. Settings are loaded (precedence high → low) `[VERSION-DEPENDENT — verify order]`:

1. Enterprise managed policy (`/Library/Application Support/ClaudeCode/` on macOS, or enforced via env) — highest
2. Command-line args (`--settings <file>`)
3. Project local settings: `.claude/settings.local.json` (gitignored)
4. Project shared settings: `.claude/settings.json` (checked in)
5. User settings: `~/.claude/settings.json` — lowest

Hooks from all levels are **merged** (arrays concatenated), not overwritten — a user-level hook and a project-level hook for the same event both run.

**`CLAUDE_CONFIG_DIR` env var** `[VERSION-DEPENDENT]`: when set, claude reads settings from `<dir>/settings.json` instead of `~/.claude/settings.json`. This is the cleanest way for Folyn to inject config without polluting `~/.claude`. Verify this env var is still honored in the current CLI version.

**JSON shape** (in `settings.json`):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "/abs/path/to/folyn-hook-bridge pre-tool-use"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          { "type": "command", "command": "/abs/path/to/folyn-hook-bridge post-tool-use" }
        ]
      }
    ]
  }
}
```

- Top-level `hooks` object is keyed by **event name**.
- Each event maps to an array of `{ matcher, hooks }` entries.
- `matcher`: a **regex string** matched against the `tool_name`. Omitted/empty = match all tools. For file writes use `"Write|Edit|MultiEdit"` (regex alternation). `[VERSION-DEPENDENT]` some docs show matcher as a simple string, not full regex — verify; `"Write|Edit|MultiEdit"` is the commonly documented form.
- `hooks`: array of hook definitions. `type: "command"` is the only supported type. `command` is a shell command string (run via the shell; must be on `PATH` or an absolute path — prefer absolute).
- **`timeout`** `[VERSION-DEPENDENT]`: each hook entry may accept a `timeout` (seconds, default ~60) after which claude kills the process and treats it as a non-blocking error. Folyn's diff-review must complete within this window or be async (see §3).

**Event names** (the ones relevant here):
- `PreToolUse` — runs before a tool executes; can block/allow/ask. ← primary hook for diff review.
- `PostToolUse` — runs after a tool completes; receives `tool_response`. Useful for Folyn to refresh its file panel after a write is allowed.
- Others (not needed for diff review): `Notification`, `UserPromptSubmit`, `Stop`, `SubagentStop`, `PreCompact`, `SessionStart`, `SessionEnd`.

### 2. Hook handler invocation protocol

Claude Code spawns the `command` as a **subprocess** (via the shell) and:

1. Pipes a **JSON object on stdin**.
2. Reads **stdout** (JSON or text) and **stderr**.
3. Uses the **exit code** to decide behavior.

**Stdin JSON — `PreToolUse`** (the load-bearing fields):

```json
{
  "session_id": "abc123...",
  "transcript_path": "/path/to/.claude/transcript/<session>.jsonl",
  "cwd": "/Users/yiminlin/project/folyn",
  "hook_event_name": "PreToolUse",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "/abs/path/to/file.ts",
    "content": "<full proposed file content>"
  }
}
```

For `PostToolUse`, the same payload plus a `tool_response` field carrying the tool's result.

`[UNVERIFIED — field names]`: I recall `tool_input` (not `input`) and `tool_name` (not `toolName`). Some older docs used `tool_input` only; verify the exact keys against the live hooks-guide page. The presence of `session_id`, `cwd`, `tool_name`, `tool_input` is stable.

**Exit-code semantics** (the original, stable protocol):

| Exit code | Meaning | Stdout/stderr handling |
|---|---|---|
| `0` | Proceed (allow the tool call) | stdout is shown to the user in the claude UI (not fed to the model) |
| `2` | **Block** the tool call | **stderr is fed to the model** as the block reason; the tool is not executed |
| other non-zero | Error (non-blocking) | stderr shown to the user; tool proceeds |

So the simplest possible bridge: on deny, `echo "reason" >&2; exit 2`; on allow, `exit 0`.

**JSON output protocol** (newer, richer — preferred for Folyn) `[VERSION-DEPENDENT — added ~late 2025]`:

If the hook prints a JSON object on stdout, claude parses it instead of relying on exit codes:

```json
{
  "continue": true,
  "suppressOutput": false,
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "User rejected the proposed edit in Folyn diff review."
  }
}
```

- `permissionDecision`:
  - `"allow"` — proceed without further prompting.
  - `"deny"` — block the tool; `permissionDecisionReason` is fed back to the model (so it can adjust).
  - `"ask"` — route through claude's normal permission prompt (Folyn would normally not use this; it makes its own decision).
- `continue: false` + `stopReason` can stop the whole agent turn — not needed for per-tool gating.
- `suppressOutput: true` hides stdout noise.

**Recommendation for Folyn:** use the JSON output protocol (`permissionDecision`) rather than exit-2, because it lets Folyn return a structured reason to the model on denial. If the installed claude version is too old to parse JSON output, fall back to `exit 2` + stderr. **Verify** the user's `claude` version supports `permissionDecision` (check `claude --version` and the hooks docs).

### 3. The "reach the running Folyn app" problem

The hook `command` is a subprocess claude spawns — it has **no direct handle** to the already-running Folyn GUI process or the renderer's diff-review UI. It must communicate over a side channel.

**Recommended architecture (composes with the sibling MCP-server research):**

```
claude (spawned by ClaudeAdapter via Tauri shell)
  │
  │  PreToolUse on Write|Edit|MultiEdit
  ▼
folyn-hook-bridge (tiny subprocess: shell script or small binary)
  │  reads stdin JSON (tool_name, tool_input, session_id)
  │  HTTP POST to http://127.0.0.1:<port>/v1/hooks/pre-tool-use
  │  blocks for response
  ▼
Folyn Rust backend (localhost HTTP server — SAME endpoint that hosts the MCP server)
  │  maps session_id → active AI session
  │  emits Tauri event to renderer
  ▼
Renderer (DiffReviewBar) — shows diff, user Accept/Reject
  │  result flows back: Tauri invoke → Rust
  ▼
Rust responds to the pending HTTP request with {permissionDecision, reason}
  │
  ▼
folyn-hook-bridge translates → JSON stdout (permissionDecision) → exit 0
```

Key points:

- **Same localhost HTTP server** as the MCP server from the sibling research file (`mcp-server-in-tauri.md` — not yet present in `research/`, but the architecture is: Rust backend hosts `http://127.0.0.1:<port>`). One server, two concerns (MCP tools + hook callbacks). Port should be dynamic (assigned at startup, written into the generated settings.json so the bridge knows it).
- **The bridge must be a real executable on disk** that claude can spawn via `command`. Options, best-worst:
  1. **A tiny shell script** (`#!/bin/sh`, uses `curl` to POST and `jq`/`python3` to parse) — simplest, but depends on `curl`+`jq` being on `PATH` (macOS ships `curl`; `jq` is not guaranteed). Use `python3` (ships on macOS) for JSON parse + HTTP to avoid the `jq` dependency.
  2. **A small binary** bundled with the Tauri app (e.g., a Rust-built `folyn-hook-bridge` placed in the app resources) — most robust, no system deps. Recommended for shipping.
  3. A Node script — requires Node on `PATH`; avoid (Folyn shouldn't assume Node is installed for the CLI-only path).
- **Blocking semantics**: the hook subprocess blocks until the user decides. Claude's hook `timeout` (default ~60s `[VERSION-DEPENDENT]`) will kill it if the user is idle. Folyn should either (a) configure a long `timeout` in the hook entry, or (b) make the UI prompt immediately and have a reasonable default (auto-deny on timeout). A blocked hook blocks the entire claude turn — the streaming `tool_start` event has already fired in `ClaudeAdapter`'s stream, so the UI should show "awaiting review".
- **Session correlation**: the hook's stdin `session_id` is the same `session_id` that `ClaudeAdapter` captures from the `system/init` stream event (`claudeAdapter.ts:140-143`). Folyn should keep a map `claude session_id → folyn AI session id` in the Rust backend (or adapter manager) so the HTTP handler routes the review request to the right renderer session.
- **Security**: bind the localhost HTTP server to `127.0.0.1` only, and validate the `session_id` on every request. The bridge should pass the session_id as a header or in the body. Consider a per-session random token written into the settings.json `command` (e.g., `folyn-hook-bridge --token <secret>`) to prevent other local processes from approving writes. `[UNVERIFIED]` whether claude redacts the command string in transcripts — if it logs the command, a token in the command line could leak via transcript; prefer passing the token via an env var set in the hook `command` (e.g., `FOLYN_HOOK_TOKEN=... /path/to/bridge`).

### 4. Folyn setting the config (no global pollution)

Folyn needs `claude` to load Folyn's hooks + MCP config **only for the Folyn-spawned session**, without writing into the user's `~/.claude`.

**Options (preferred first):**

1. **`CLAUDE_CONFIG_DIR` env var** `[VERSION-DEPENDENT — verify]`: set it to a Folyn-managed temp dir (e.g., `<app data>/claude-config-<session>/`) containing `settings.json` (with hooks) and optionally `.mcp.json`. `ClaudeAdapter` already spawns via `Command.create('claude-cli', ['-l', '-c', shellCmd])` — prepend `FOLYN_CONFIG_DIR=... ` or `CLAUDE_CONFIG_DIR=... ` to the shell command, or set it via the Tauri shell `Command` env. This is the cleanest isolation: the user's `~/.claude` is untouched.
2. **`--settings <path>` CLI flag** `[VERSION-DEPENDENT — verify this flag exists]`: pass an explicit settings file. Combined with `--mcp-config <path>` (which definitely exists for MCP). This is per-invocation and doesn't touch `~/.claude`.
3. **`--mcp-config <path>`** for MCP servers (stable, documented) + `--settings` for hooks. If `--settings` is unavailable in the installed version, fall back to `CLAUDE_CONFIG_DIR`.

**Important**: `ClaudeAdapter` currently uses `--permission-mode bypassPermissions` (`claudeAdapter.ts:64`). With PreToolUse hooks in place, Folyn should **drop `bypassPermissions`** (or switch to `--permission-mode default`) so the hook's `deny` is honored. With `bypassPermissions`, hooks still run but the permission model is bypassed — `[UNVERIFIED]` whether a hook `deny` overrides `bypassPermissions`. Do not rely on it; use `default` or `acceptEdits` and let the hook be the gate. **Verify** the interaction between `--permission-mode` and hook `permissionDecision` in the current version.

**Generated settings.json** (Folyn writes this to the temp config dir before spawning):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          { "type": "command", "command": "FOLYN_HOOK_TOKEN=<token> /abs/path/to/folyn-hook-bridge", "timeout": 300 }
        ]
      }
    ]
  }
}
```

Plus a `.mcp.json` pointing the MCP server at the same localhost port (see sibling MCP research). The port + token are generated at Folyn startup and interpolated into both files.

**`--mcp-config`** path: `[VERSION-DEPENDENT]` claude reads `.mcp.json` from the project root or `~/.claude/.mcp.json` by default; `--mcp-config <file>` overrides. If using `CLAUDE_CONFIG_DIR`, place `.mcp.json` in that dir.

### 5. PreToolUse for Write/Edit/MultiEdit — matcher + tool_input

**Matcher**: `"Write|Edit|MultiEdit"` (regex alternation). This is the documented form for matching multiple file-write tools. `[UNVERIFIED]` whether tool names are case-sensitive in the matcher; the docs use exact capitalization `Write`, `Edit`, `MultiEdit` — match that.

**What the hook receives in `tool_input` (the proposed change):**

| Tool | `tool_input` fields | Enough for a diff? |
|---|---|---|
| `Write` | `file_path`, `content` (full proposed file content) | Yes — diff against current file on disk (read it) or treat as "new file" if it doesn't exist. |
| `Edit` | `file_path`, `old_string`, `new_string` | Partial — shows the hunks. To show a full-file diff, read the current file from disk, apply `old_string→new_string` to compute the "after" content. |
| `MultiEdit` | `file_path`, `edits: [{old_string, new_string}, ...]` | Same as Edit, apply all edits sequentially to compute "after". |

So the bridge should, on receiving `PreToolUse` for these tools:
1. Read the current file from `file_path` (the hook runs with `cwd` = the project dir, but `file_path` is absolute in the tool_input) to get "before" content. If the file doesn't exist, "before" is empty (new file).
2. Compute "after" content: for `Write`, it's `tool_input.content`; for `Edit`, apply `old_string→new_string` to "before"; for `MultiEdit`, apply all edits in order.
3. POST `{session_id, tool_name, file_path, before, after, old_string, new_string}` to Folyn's localhost endpoint.
4. The renderer's `DiffReviewBar` (already exists at `apps/desktop/src/components/work-area/DiffReviewBar.tsx`) renders the diff and returns accept/reject.

**Note on `old_string` matching**: Claude Code's `Edit` requires `old_string` to appear exactly once in the file. If applying the edit to the "before" content fails to match (race: file changed since claude read it), the bridge should still be able to show `new_string` and let the user decide; or return `deny` with a "stale file" reason.

**`tool_input` field-name caveat** `[UNVERIFIED]`: I recall `content` for Write and `old_string`/`new_string` for Edit. Some SDK/streaming surfaces use `file_text` instead of `content` for the Write tool. **Verify the exact field names** in the PreToolUse stdin payload against the live hooks-guide before parsing. The current `ClaudeAdapter` reads `input.file_path || input.path || input.filePath` defensively (`claudeAdapter.ts:219`) — the bridge should do the same defensive read.

---

## Mapping onto Folyn's constraints

| Constraint | How hooks fit |
|---|---|
| Tauri desktop app, Rust backend | Rust hosts the localhost HTTP endpoint that the hook bridge calls. Same server as MCP. |
| Renderer holds diff-review UI | `DiffReviewBar.tsx` already exists. Rust forwards hook requests to the renderer via Tauri events; renderer returns the decision. |
| No Node/Agent SDK assumed | Hooks are a native CLI feature — no SDK needed. The bridge can be a shell script or a small bundled binary. |
| Don't pollute global claude config | Use `CLAUDE_CONFIG_DIR` (or `--settings`/`--mcp-config` flags) pointing at a Folyn-managed temp dir. |
| Existing `ClaudeAdapter` spawn path | `Command.create('claude-cli', ['-l', '-c', shellCmd])` (`claudeAdapter.ts:81`). Add env (`CLAUDE_CONFIG_DIR`, `FOLYN_HOOK_TOKEN`, `FOLYN_HOOK_PORT`) to the shell command, and drop `--permission-mode bypassPermissions`. |
| Existing `file_change` event flow | `AiPanel` already handles `file_change` events (`AiPanel.tsx:317`). With pre-approval hooks, the flow becomes: hook → review → on `allow`, claude writes the file → `PostToolUse` hook (or the existing stream `tool_result`) → emit `file_change` for the accepted write. On `deny`, no write occurs, no `file_change` emitted. |

---

## Internal files relevant to this work

| File Path | Description |
|---|---|
| `packages/cli-adapter/src/claudeAdapter.ts` | Current adapter: spawns `claude -p --output-format stream-json --permission-mode bypassPermissions --bare`. Does post-hoc file diffing by re-reading the file after `tool_use` (`snapshotBeforeWrite`, `checkFileChange`). Pre-approval hooks would replace lines 64 (`bypassPermissions`) and 210-292 (the post-hoc diff logic). |
| `packages/cli-adapter/src/types.ts` | `CliStreamEvent`, `FileChange`, `CliAdapterConfig` types. `FileChange` already has `oldContent`/`newContent`/`status: 'pending'|'accepted'|'rejected'` — fits pre-approval. |
| `apps/desktop/src/components/ai/AiPanel.tsx` | Consumes `file_change` events → `addFileChange` (lines 317-318). Would also need to handle a new "review-requested" event from the Rust backend (hook callback). |
| `apps/desktop/src/components/work-area/DiffReviewBar.tsx` | Existing diff-review UI (`enterDiffReview`, `exitDiffReview`, `diffOldContent`, `diffNewContent`). Reusable for the pre-approval flow. |
| `apps/desktop/src-tauri/capabilities/default.json` | Tauri shell capability: allows spawning `claude-cli` (`/bin/sh`, args true). Would also need `shell:allow-execute`/HTTP-server permissions if the Rust backend hosts a localhost server (or the HTTP server is pure Rust with no Tauri permission needed). |

## Related specs

- `.trellis/spec/cli-adapter/frontend/*.md` — cli-adapter package specs (directory structure, state management, etc.). Implementation will live here.
- Sibling research (not yet present): `research/mcp-server-in-tauri.md` — the localhost HTTP server in Rust backend. **This hooks design depends on that server existing** (same endpoint). Recommend the MCP research file be created to capture the shared server.

---

## Caveats / Not Found

- **Could not fetch live docs** (no web access in this sandbox). All findings are from training knowledge. The **core protocol** (settings.json `hooks` shape, `PreToolUse`/`PostToolUse` events, `matcher` regex, stdin JSON with `session_id`/`tool_name`/`tool_input`, exit-0/exit-2 semantics) is stable and I'm confident in it. The **JSON output protocol** (`permissionDecision: allow|deny|ask`) and the `--settings` / `CLAUDE_CONFIG_DIR` flags are `[VERSION-DEPENDENT]` — verify against the live docs URLs above before implementing.
- **`--settings` flag existence** `[UNVERIFIED]` — I'm not 100% sure this flag is in the current CLI. `CLAUDE_CONFIG_DIR` is the safer, better-isolated mechanism; prefer it. `--mcp-config` is stable.
- **`bypassPermissions` vs hook `deny` interaction** `[UNVERIFIED]` — whether a hook `deny` overrides `--permission-mode bypassPermissions`. Don't rely on it; switch to `default`/`acceptEdits` when hooks are active.
- **`tool_input` exact field names** (`content` vs `file_text` for Write) `[UNVERIFIED]` — verify against hooks-guide examples; parse defensively.
- **Hook `timeout` default + max** `[VERSION-DEPENDENT]` — verify the max configurable value; Folyn needs a long timeout for human review.
- **Whether the `command` string is redacted in transcripts** `[UNVERIFIED]` — affects whether a token can be passed inline vs must be via env var. Use env var to be safe.
- **Sibling `mcp-server-in-tauri.md` is missing** from `research/` — only `agent-sdk-runtime-and-api.md`, `auth-and-billing-impact.md`, `tauri-sidecar-node-packaging.md` exist. The shared localhost HTTP server design should be captured there; this hooks design composes with it.
