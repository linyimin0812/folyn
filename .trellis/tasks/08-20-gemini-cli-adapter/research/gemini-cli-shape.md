# Research: Gemini CLI Wire Shape

- **Query**: Gemini CLI surface for a Quill `geminiAdapter.ts` — binary, streaming flags, resume, JSONL event shapes, permissions/trust, stdin, config, auth, sidecar precedents, UI wiring, i18n
- **Scope**: mixed (local binary inspection + `--help` capture + installed-bundle source inspection); no online docs consulted; **no live `stream-json` run captured** (Gemini API endpoint unreachable from this machine — see Caveats)
- **Date**: 2026-08-20

## TL;DR

Binary is `gemini` (npm `@google/gemini-cli`, locally v0.56.0 at `/Users/yiminlin/.nvm/versions/node/v25.9.0/bin/gemini`). Non-interactive streaming is `gemini -p "<prompt>" -o stream-json -y --skip-trust` (or set `GEMINI_CLI_TRUST_WORKSPACE=true`). Emits NDJSON, one event per line. No `--dir` flag (must shell-`cd`, same as qoder/codex pattern). No China variant. Config at `~/.gemini/settings.json` (JSON), trust at `~/.gemini/trustedFolders.json`, account pickling at `~/.gemini/google_accounts.json`, per-project history under `~/.gemini/history/<project-slug>/` and `~/.gemini/tmp/<project-slug>/`.

**Wire shape is NOT codex/qoder/opencode-compatible.** Gemini CLI emits six top-level `type` values: `init`, `message`, `tool_use`, `tool_result`, `error`, `result`. The terminal `done` signal is an **explicit `result` event** (status `"success"` or `"error"`) — closer to codex (`turn.completed`) than to qoder/opencode (which rely on process exit). Assistant text arrives as `message` events with `role:"assistant"`, `delta:true` (token-delta style, **multiple events per turn** — unlike opencode's single complete-string `text` event). Tool start and tool result are **two separate events** (`tool_use` then `tool_result`) — unlike opencode's fused single event. Plan: model the adapter on `qoderAdapter.ts` one-shot spawn lifecycle (shell `cd` + `< /dev/null`), write a fresh `translateGeminiEvent`, and use `result` as the authoritative `done` (with `command.on('close')` as fallback).

All findings below are from the locally installed v0.56.0 bundle at `/Users/yiminlin/.nvm/versions/node/v25.9.0/lib/node_modules/@google/gemini-cli/` (`--help` + source grep on `bundle/gemini-KK7AERSF.js`, `bundle/chunk-MYCBWRZE.js`). No real `stream-json` run was captured — see Caveats.

## Findings

### 1. Binary + install

- **Binary**: `gemini` (on `$PATH`).
- **Version**: 0.56.0 (`gemini --version` → `0.56.0`).
- **Install path observed**: `/Users/yiminlin/.nvm/versions/node/v25.9.0/bin/gemini` — npm global install of `@google/gemini-cli`. Bundle root: `/Users/yiminlin/.nvm/versions/node/v25.9.0/lib/node_modules/@google/gemini-cli/` (contains `bundle/`, `package.json`, `README.md`).
- **China variant**: none. Single `gemini` binary; no `-cn` sister binary. If a China endpoint is needed it's a model/provider config concern (model `auto` picks based on `~/.gemini/settings.json` + auth), not a separate binary. Out of scope per the PRD.

### 2. Non-interactive streaming mode

`gemini --help` (captured locally):

```
Usage: gemini [options] [command]

Gemini CLI - Defaults to interactive mode. Use -p/--prompt for non-interactive (headless) mode.

Options:
  -p, --prompt        Run in non-interactive (headless) mode with the given prompt.
                      Appended to input on stdin (if any).  [string]
  -i, --prompt-interactive   Execute the provided prompt and continue in interactive mode [string]
  -o, --output-format The format of the CLI output.
                      [choices: "text", "json", "stream-json"]
  -m, --model         Model  [string]
  -y, --yolo          Automatically accept all actions (YOLO mode)  [boolean] [default: false]
      --approval-mode Set the approval mode: default | auto_edit | yolo | plan  [string]
      --skip-trust    Trust the current workspace for this session.  [boolean] [default: false]
  -s, --sandbox       Run in sandbox?  [boolean]
      --include-directories   Additional directories to include in the workspace  [array]
  -r, --resume        Resume a previous session. Use "latest" for most recent or index number.  [string]
      --session-id    Start a new session with a manually provided UUID.  [string]
      --session-file  Load a session from a JSON file  [string]
      --list-sessions / --delete-session <index>
  -e, --extensions / -l, --list-extensions
      --policy / --admin-policy / --allowed-tools / --allowed-mcp-server-names
  -d, --debug / -v, --version / -h, --help
```

**The flags we need**:
- `-p "<prompt>"` — non-interactive headless mode, prompt as the trailing arg.
- `-o stream-json` — NDJSON event stream, one event per line. Choices are `text` (default TTY), `json` (single-shot final JSON), `stream-json` (streaming NDJSON). This matches the qoder/codex `--output-format stream-json` naming exactly — unlike opencode which uses `--format json`.
- `-y` / `--yolo` — auto-approve all actions (the `--dangerously-skip-permissions` equivalent). Alternative: `--approval-mode yolo`. `-y` is the short form, **preferred** (matches opencode's `--auto` precedent).
- `--skip-trust` — trust the current workspace for this session only. **OR** set env `GEMINI_CLI_TRUST_WORKSPACE=true` (bundle source at `chunk-MYCBWRZE.js:401344` reads this env var). For the Tauri sidecar, `--skip-trust` is the per-invocation switch (no global trust mutation); the env var is the alternative if the sidecar ever wants to trust everything by default.

**Trust quirk**: Gemini CLI refuses to run in an untrusted folder. Without `--skip-trust` (or env), an untrusted workingDir throws `FatalUntrustedWorkspaceError` and the process exits non-zero with the message: *"Gemini CLI is not running in a trusted directory. To proceed, either use `--skip-trust`, set the `GEMINI_CLI_TRUST_WORKSPACE=true` environment variable, or trust this directory in interactive mode."* (bundle `gemini-KK7AERSF.js:10479`). The Quill workingDir (vault root / temp probe dir) is generally not pre-trusted, so `--skip-trust` is **required** on every spawn.

There is no `--dir` flag. Use the shell `cd <dir> && exec gemini …` pattern (see §5).

### 3. Wire shape (the critical unknown) — load-bearing

**Source of truth**: the bundle's `StreamJsonFormatter.emitEvent` writes `JSON.stringify(event) + "\n"` to stdout (`bundle/chunk-MYCBWRZE.js:384624`). The event-type enum (`bundle/chunk-MYCBWRZE.js:363193`):

```js
var JsonStreamEventType = /* @__PURE__ */ ((JsonStreamEventType2) => {
  JsonStreamEventType2["INIT"] = "init";
  JsonStreamEventType2["MESSAGE"] = "message";
  JsonStreamEventType2["TOOL_USE"] = "tool_use";
  JsonStreamEventType2["TOOL_RESULT"] = "tool_result";
  JsonStreamEventType2["ERROR"] = "error";
  JsonStreamEventType2["RESULT"] = "result";
  return JsonStreamEventType2;
})(JsonStreamEventType || {});
```

Six top-level `type` values. Emit points confirmed by grep on `bundle/gemini-KK7AERSF.js` (the legacy/non-interactive entry path; a parallel agent path exists at the same line range in `gemini-2RHAL2LS.js` / `gemini-54R2PJOR.js` with identical shapes). Payload shapes reconstructed from source — **not live-verified** (see Caveats).

#### 3.1 `init` — first event, one per run

```jsonc
{ "type":"init", "timestamp":"<ISO>", "session_id":"<uuid>", "model":"<model-id-or-auto>" }
```

Source: `bundle/gemini-KK7AERSF.js:10956` (and `:11464`). `session_id` comes from `config.getSessionId()`, `model` from `config.getModel()`. **Capture `session_id` here** for resume on the next send. (The user captured the real first line of a real run already: `{"type":"init","timestamp":"...","session_id":"fcd131a3-...","model":"auto"}`.)

Map → `{type:'session_id', sessionId: event.session_id}`.

#### 3.2 `message` — user prompt echo + assistant text deltas

Two sub-shapes, switched on `role`:

**User** (echoed once at start of run, `bundle/gemini-KK7AERSF.js:10994`):

```jsonc
{ "type":"message", "timestamp":"<ISO>", "role":"user", "content":"<full user prompt>" }
```

No `delta` field; `content` is the whole user prompt string.

**Assistant** (one per text delta, `bundle/gemini-KK7AERSF.js:11131`):

```jsonc
{ "type":"message", "timestamp":"<ISO>", "role":"assistant", "content":"<text delta chunk>", "delta":true }
```

**Important**: assistant text arrives as **multiple `message` events** with `delta:true`, one per token chunk — NOT one event with the whole message. This is unlike opencode (one complete `text` event per chunk) and unlike codex (whole `agent_message` at `item.completed`). The translator must **accumulate** deltas OR emit each as an independent `text` event (the Quill UI already handles streaming `text` events by appending; verify in the consumer).

Map → `{type:'text', content: event.content}` for `role:"assistant"`; ignore `role:"user"` (it's the echo of our own prompt, no UI value).

#### 3.3 `tool_use` — tool call start (NOT fused with result)

```jsonc
{ "type":"tool_use", "timestamp":"<ISO>", "tool_name":"<tool>", "tool_id":"<id>", "parameters":{...args} }
```

Source: `bundle/gemini-KK7AERSF.js:11156` and `:11549`. Fields: `tool_name` (e.g. `write_file`, `run_shell_command`, `read_file` — Gemini's built-in tool names), `tool_id` (the call id, also called `requestId` internally), `parameters` (the tool args object). **Only the start is emitted here** — the result comes separately as `tool_result`.

Map → `{type:'tool_start', toolName: event.tool_name, toolId: event.tool_id, toolInput: event.parameters ?? {}}`.

#### 3.4 `tool_result` — tool call end (separate event)

```jsonc
{
  "type":"tool_result",
  "timestamp":"<ISO>",
  "tool_id":"<id>",
  "status":"success" | "error",
  "output":"<display text>" | undefined,
  "error": { "type":"<error-type>", "message":"<msg>" } | undefined
}
```

Source: `bundle/gemini-KK7AERSF.js:11172` (event-stream path) and `:11676` (legacy scheduler path). `status` is `"success"` or `"error"`; when error, the `error` object carries `{type, message}`. `output` is the tool's display text (may be `undefined` if the tool produced no display). The `tool_id` matches the prior `tool_use` `tool_id` — pair them by id.

Map → `{type:'tool_end', toolId: event.tool_id, toolOutput: event.output ?? ''}` (and `{type:'error', content: event.error.message}` when `status === "error"`).

#### 3.5 `error` — non-fatal warning OR fatal error

```jsonc
{ "type":"error", "timestamp":"<ISO>", "severity":"warning" | "error", "message":"<msg>" }
```

Source: `bundle/gemini-KK7AERSF.js:11560` (LoopDetected warning), `:11571` (MaxSessionTurns error), `:11621` (AgentExecutionBlocked warning), `:11651` (InvalidStream error). Three severities observed: `"warning"` (loop detected, blocked, invalid stream retryable) and `"error"` (max turns, fatal invalid stream). The run **may continue** after a `warning`-severity error event — do NOT treat it as terminal. Only `severity:"error"` should also emit a Quill `error` event.

Map → `{type:'error', content: event.message}` when `severity === "error"`; otherwise no-op (or emit a soft warning if the UI wants it).

#### 3.6 `result` — **terminal done signal** (explicit, like codex)

Two shapes:

**Success** (`bundle/gemini-KK7AERSF.js:11590` and `:11720`):

```jsonc
{ "type":"result", "timestamp":"<ISO>", "status":"success", "stats":{ "total_tokens":N, "input_tokens":N, "output_tokens":N, "cached":N, "input":N, "duration_ms":N, "tool_calls":N, "models":{...} } }
```

**Error** (`bundle/gemini-KK7AERSF.js:10663, 10698, 10729, 10764`):

```jsonc
{ "type":"result", "timestamp":"<ISO>", "status":"error", "error":{ "type":"<error-type>", "message":"<msg>" }, "stats":{...} }
```

The `stats` object shape (from `convertToStreamStats`, `bundle/chunk-MYCBWRZE.js:384634`): `{total_tokens, input_tokens, output_tokens, cached, input, duration_ms, tool_calls, models:{<model>:{total_tokens,input_tokens,output_tokens,cached,input}}}`.

**`result` is the authoritative `done` signal.** Map:
- `status:"success"` → `{type:'done'}` (optionally capture `stats` for usage UI).
- `status:"error"` → `{type:'error', content: event.error.message}` then `{type:'done'}`.

This is the **codex pattern** (`turn.completed` → `done`), NOT the opencode pattern (no result event, rely on process exit). The Quill adapter can still rely on `command.on('close')` as a fallback in case the result event is missed (defensive, matches qoder/codex).

#### 3.7 Summary of all `type` values

| `type` | When | Map to Quill event |
|---|---|---|
| `init` | run start, once | `session_id` (persist id) |
| `message` (role=user) | prompt echo, once | (no-op) |
| `message` (role=assistant, delta=true) | per text chunk, multiple | `text` |
| `tool_use` | per tool call start | `tool_start` |
| `tool_result` | per tool call end | `tool_end` (+`error` if status=error) |
| `error` (severity=warning) | retryable issue | (no-op or soft warning) |
| `error` (severity=error) | fatal issue | `error` |
| `result` (status=success) | run end, terminal | `done` |
| `result` (status=error) | run end on failure, terminal | `error` + `done` |

### 4. Session resume

- `-r, --resume <id | "latest" | index>` — resume a previous session. Accepts a session-id UUID, the literal `"latest"`, or a numeric index (e.g. `--resume 5`). `--list-sessions` lists available sessions for the current project; `--delete-session <index>` removes one.
- `--session-id <uuid>` — **start a new** session with a manually-provided UUID (does NOT resume; this is the "I want to pin my own id" switch). For Quill's adapter this is **not** what we want — we want `-r` resume.
- `--session-file <path>` — load a session from a JSON file (out of scope).

**Session id format**: UUID (`fcd131a3-…`, `e752e3c7-…` from the local `logs.json`). Returned on the **first event** (`type:"init"`'s `session_id` field) — capture there and persist for the next send, same strategy as qoder (`system`/`session_id`) / codex (`thread.started`/`thread_id`) / opencode (`step_start`/`sessionID`).

**Where sessions persist**: `~/.gemini/history/<project-slug>/` and `~/.gemini/tmp/<project-slug>/` — per-project. The local machine has `~/.gemini/history/quill/`, `~/.gemini/tmp/quill/` (the project slug is derived from the workingDir path; `~/.gemini/projects.json` maps `/Users/yiminlin/project/quill` → `"quill"`). Per-session chat logs live under `~/.gemini/tmp/<slug>/chats/` and a flat `~/.gemini/tmp/<slug>/logs.json` aggregates entries (`[{sessionId, messageId, type, message, timestamp}]`). The adapter does NOT need to touch these — `--resume <id>` reads from them.

### 5. workingDir — no `--dir` flag

Gemini CLI has **no** `--dir` / `--cwd` / `--worktree` (well, `-w/--worktree` starts a new git worktree — different feature, not for setting workingDir). The workingDir is the process cwd.

**Precedent in this repo**: both `qoderAdapter.ts` and `codexAdapter.ts` use the same shell `cd` wrapper pattern:

```ts
// qoderAdapter.ts:132  /  codexAdapter.ts:109
export function buildXxxShellCommand(cliPath, workingDir, args): string {
  const cliCmd = [cliPath, ...args].map(quoteShellArg).join(' ') + ' < /dev/null';
  return workingDir
    ? `cd ${quoteShellArg(workingDir)} && exec ${cliCmd}`
    : `exec ${cliCmd}`;
}
```

**Recommendation for Gemini**: mirror this exactly. `cd <workingDir> && exec gemini -p <prompt> -o stream-json -y --skip-trust < /dev/null` (resume: prepend `-r <sessionId>`). The `< /dev/null` is required — see §6.

### 6. stdin handling

**Gemini CLI reads stdin** when in `-p` headless mode — the `--help` says *"Appended to input on stdin (if any)"*. Source at `bundle/gemini-KK7AERSF.js:8720-8772` confirms: it sets a 500ms timer (`pipedInputShouldBeAvailableInMs = 500`); if no stdin data arrives within 500ms it resolves with empty data and proceeds. If stdin IS piped, it reads until EOF (or `MAX_STDIN_SIZE`) then resolves.

So:
- With `< /dev/null`: stdin immediately EOFs, no 500ms wait — **fast**.
- Without stdin redirect on a non-TTY (e.g. the Tauri sidecar): the 500ms timer fires, then it proceeds — **works but adds 500ms latency per send**.
- Without stdin redirect on a TTY: would block forever (not the sidecar case).

**Recommendation**: always include `< /dev/null` (matches qoder/codex precedent; avoids the 500ms penalty and any ambiguity). The qoder/codex/opencode adapters all already add `< /dev/null` defensively — for Gemini it's actually load-bearing for latency, not just safety.

### 7. Config + auth

- **User config**: `~/.gemini/settings.json` — JSON (not JSONC, not TOML/YAML). Observed local shape:
  ```json
  {
    "security": { "auth": { "selectedType": "gemini-api-key" } },
    "ui": { "theme": "Default Light" }
  }
  ```
  `selectedType` observed value: `"gemini-api-key"` (API key auth). Other supported types per Gemini CLI docs (not inspected here): OAuth (`google-oauth`) and Vertex AI (`vertex-ai`). The auth type drives how the CLI picks up credentials.
- **Trust state**: `~/.gemini/trustedFolders.json` — `{"<absolute-path>":"TRUST_FOLDER", ...}`. The local file has `{"\/users\/yiminlin\/project\/quill":"TRUST_FOLDER"}` — so once a folder is trusted interactively, it stays trusted. `--skip-trust` is the per-session bypass; `GEMINI_CLI_TRUST_WORKSPACE=true` is the global env bypass.
- **Account state**: `~/.gemini/google_accounts.json` — `{"active": null | "<account-email>", "old": [...]}`. Local file is `{"active": null, "old": []}` (no Google OAuth account active; using API key instead).
- **Installation id**: `~/.gemini/installation_id` (opaque string).
- **Tips state**: `~/.gemini/state.json` — `{"tipsShown": 5}` (UI hint counter).
- **Per-project state**: `~/.gemini/projects.json` (path → slug map), `~/.gemini/history/<slug>/`, `~/.gemini/tmp/<slug>/` (chats, logs).
- **Auth subcommand**: **none**. `gemini --help` shows NO `auth` subcommand (unlike opencode's `opencode providers login`). Auth is configured **entirely** via `~/.gemini/settings.json`'s `security.auth.selectedType` + the relevant credential (API key in env var, OAuth in `google_accounts.json`, etc.). For the adapter: surface `settingsFilePath = ~/.gemini/settings.json` and `settingsFileTemplate = { "security": { "auth": { "selectedType": "gemini-api-key" } } }` (the minimal valid shape). Do **not** auto-login (out of scope, matches qoder/opencode precedent — and there's no login subcommand to call anyway).

For API-key auth specifically: the CLI reads the key from env `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) — not stored in `settings.json`. The adapter does not need to manage this; the user sets the env var out-of-band (Tauri sidecar can pass it through if Quill later wants to surface a per-adapter env var, but that's out of scope per PRD).

### 8. Sidecar precedents in this repo

`apps/desktop/src-tauri/capabilities/default.json` and `pet-panel.json` both register CLI sidecars under `shell:allow-spawn` / `shell:allow-execute`. The pattern (per adapter):

```jsonc
{
  "name": "opencode-cli",   // sidecar name (used by Command.create)
  "cmd": "/bin/sh",
  "args": true
}
```

Observed sidecar names: `claude-cli`, `codex-cli`, `qoder-cli`, `qoder-cli-cn`, `opencode-cli`, `pi-cli`. Binary-on-`$PATH` names differ (`claude`, `codex`, `qodercli`/`qoderclicn`, `opencode`, `pi`) — the sidecar name is `<adapter-id>-cli` (or `-cli-cn` for the China variant), the `cmd` is always `/bin/sh` (the adapter runs `sh -l -c "<cd … && exec <binary> …>"`), and `args: true` allows the shell wrapper.

**For Gemini**: add `{ "name": "gemini-cli", "cmd": "/bin/sh", "args": true }` to **both** `default.json` and `pet-panel.json` (the pet panel has its own ACL — the main window's grant does not extend). No `-cn` variant needed.

The adapter class then calls `Command.create('gemini-cli', ['-l', '-c', shellCmd])` exactly like qoder/codex.

### 9. UI wiring precedents

Three UI files host an `ADAPTER_ICON` map (all read from `apps/desktop/src/assets/agents/<name>.svg`):

- `apps/desktop/src/components/ai/AdapterSelector.tsx` (chat surface adapter picker)
- `apps/desktop/src/components/ai/AgentCliTag.tsx` (inline tag showing which adapter a message used)
- `apps/desktop/src/components/settings/FeatureAdapterDropdown.tsx` (per-feature adapter override)

The map shape (identical in all three):

```ts
import claudeIcon from '@/assets/agents/claude_code.svg';
import codexIcon from '@/assets/agents/codex.svg';
import opencodeIcon from '@/assets/agents/opencode.svg';
import piIcon from '@/assets/agents/pi.svg';
import qoderIcon from '@/assets/agents/qoder.svg';

const ADAPTER_ICON: Record<string, string> = {
  claude: claudeIcon,
  codex: codexIcon,
  opencode: opencodeIcon,
  pi: piIcon,
  qoder: qoderIcon,
  'qoder-cn': qoderIcon,  // China variant reuses the international icon
};
```

Existing SVG files in `apps/desktop/src/assets/agents/`: `claude_code.svg`, `codex.svg`, `opencode.svg`, `pi.svg`, `qoder.svg`.

**For Gemini**: add `gemini: geminiIcon` to all three maps, import `geminiIcon from '@/assets/agents/gemini.svg'`, and drop a `gemini.svg` into the assets dir (one file, no `-cn` variant). Filename convention is the adapter id (e.g. `gemini.svg`, matching `codex.svg` / `opencode.svg` — single word, lowercase).

### 10. i18n precedent

`.trellis/tasks/archive/2026-08/08-20-opencode-cli-adapter/prd.md` Out of Scope says codex/qoder/opencode do NOT get `cli.adapters.<id>` i18n entries — only `claude` and `pi` do.

**Confirmed**: `apps/desktop/src/i18n/locales/en/settings.json` lines 147-154 have only:

```jsonc
"adapters": {
  "claude": { "description": "Anthropic's official CLI; …" },
  "pi": { "description": "Pi coding agent …" }
}
```

No `codex`, `qoder`, `qoder-cn`, or `opencode` entries. Same shape verified for the en locale; the other 5 locales (ja, zh, de, fr, es) each have a `settings.json` with the same `cli.adapters` namespace — they should be consistent (verify on implement, but the en file is the source of truth).

**For Gemini**: do NOT add a `cli.adapters.gemini` i18n entry — matches the codex/qoder/opencode precedent. The adapter's `description` string lives in the adapter class (e.g. `QoderAdapter.description`), not in i18n.

## Plan

Model on `qoderAdapter.ts` (one-shot spawn per send, shell `cd` + `< /dev/null`), but write a **fresh** `translateGeminiEvent` — the wire shape differs from all three existing adapters.

- **Spawn args** (`buildGeminiArgs`):
  - First send: `['-p', prompt, '-o', 'stream-json', '-y', '--skip-trust']` (prompt positional; `--yolo` auto-approves; `--skip-trust` trusts the workingDir for this session only).
  - Resume: `['-p', prompt, '-o', 'stream-json', '-y', '--skip-trust', '-r', resumeSessionId]` (or put `-r <id>` before `-p` — Gemini's yargs parser accepts either order; verify on first authenticated run).
  - Model pin (optional): add `-m <model>` if the user pins a model.
- **Shell command** (`buildGeminiShellCommand`): copy `buildQoderShellCommand` verbatim — `cd <workingDir> && exec <cliPath> <args…> < /dev/null`. `< /dev/null` is **required** (not just defensive) — Gemini's 500ms stdin timer adds latency otherwise.
- **Stream parse** (`handleStdoutChunk`): reuse `splitJsonlLines` from `piAdapter` (U+2028/U+2029 safe), `JSON.parse` each line, dispatch to `translateGeminiEvent`.
- **`translateGeminiEvent`** (pure seam):
  - `init` → `{type:'session_id', sessionId: event.session_id}` (capture for resume).
  - `message` with `role:"assistant"` → `{type:'text', content: event.content}` (each is a delta — emit each, the UI appends).
  - `message` with `role:"user"` → `[]` (echo, no-op).
  - `tool_use` → `{type:'tool_start', toolName: event.tool_name, toolId: event.tool_id, toolInput: event.parameters ?? {}}`.
  - `tool_result` → `{type:'tool_end', toolId: event.tool_id, toolOutput: event.output ?? ''}` (+ `{type:'error', content: event.error.message}` when `status === "error"`).
  - `error` with `severity === "error"` → `{type:'error', content: event.message}`; `severity === "warning"` → `[]` (no-op, run continues).
  - `result` with `status:"success"` → `[{type:'done'}]`; `status:"error"` → `[{type:'error', content: event.error.message}, {type:'done'}]` (terminal; optionally capture `stats` for usage UI — ponytail: skip stats until the UI asks for them).
  - unknown `type` → `[]`.
- **Done**: `result` is the authoritative terminal signal (like codex's `turn.completed`); `command.on('close')` is the fallback (same as qoder/codex). Both emit `{type:'done'}` — the translator's `result` event and the close handler. Whichever fires first resolves the send promise; the second is a no-op duplicate (the UI must be idempotent on `done` — verify in the consumer, or guard with a `this.running` flag like qoder does).
- **Resume**: persist `sessionId` from the first `init` event; pass `-r <sessionId>` on subsequent sends.
- **Sidecar**: one sidecar `gemini-cli` (no `-cn` variant). `cliPathDefault = "gemini"`.
- **Registry**: register a single `GeminiAdapter` instance with `id: 'gemini'` (no China variant — unlike qoder which has `qoder` + `qoder-cn`, Gemini has only one binary).
- **UI**: add `gemini.svg` to `apps/desktop/src/assets/agents/`; add `gemini: geminiIcon` to all three `ADAPTER_ICON` maps; add `gemini-cli` to both capabilities JSON files.
- **i18n**: no `cli.adapters.gemini` entry (matches codex/qoder/opencode precedent).
- **Settings file**: `settingsFilePath = '~/.gemini/settings.json'`; `settingsFileTemplate = { "security": { "auth": { "selectedType": "gemini-api-key" } } }`.

### Surprising / load-bearing callouts

1. **`result` IS the terminal done signal** (closer to codex than opencode). Do NOT rely solely on `command.on('close')` — but keep it as a fallback. The `result` event carries `stats` (token usage) which opencode's `step_finish` also carried but codex's `turn.completed` did not — Quill's UI doesn't currently render stats, so skip.
2. **Assistant text is delta-streamed** (`message` with `delta:true`, multiple per turn). Unlike opencode (one complete chunk per `text` event) and codex (whole `agent_message` at `item.completed`). The translator emits one `text` event per delta — verify the Quill UI appends rather than overwrites.
3. **Tool start and tool result are TWO separate events** (`tool_use` then `tool_result`), paired by `tool_id`. Unlike opencode's fused single `tool_use` event with `state.status`. The translator emits `tool_start` then `tool_end` — cleaner mapping than opencode's.
4. **`--skip-trust` is required on every spawn** (Quill's workingDirs are not pre-trusted). Alternative: `GEMINI_CLI_TRUST_WORKSPACE=true` env var. Prefer the flag (per-session, no global state mutation).
5. **No `auth` subcommand** — unlike opencode's `opencode providers login`. Auth is configured entirely via `~/.gemini/settings.json` + env vars (`GEMINI_API_KEY`). The adapter surfaces only the settings file path; the user handles auth out-of-band.
6. **`< /dev/null` is load-bearing for latency**, not just safety — Gemini's 500ms stdin timer adds a per-send delay otherwise. Always include it.
7. **`error` events are not all fatal** — `severity:"warning"` events (loop detected, blocked, retryable invalid stream) do NOT end the run; only `severity:"error"` and `result` with `status:"error"` are terminal. Treat warnings as no-ops.
8. **Six event types total** (`init`, `message`, `tool_use`, `tool_result`, `error`, `result`) — the enum is closed (source-defined, not arbitrary strings), so the translator's switch is exhaustive.

## Caveats / Not Found

- **No live `stream-json` run captured.** The Gemini API endpoint is currently unreachable from this machine (fetch failed per the task prompt). All payload shapes in §3 are reconstructed from the installed bundle source (`bundle/gemini-KK7AERSF.js` emit points + `bundle/chunk-MYCBWRZE.js` `JsonStreamEventType` enum + `StreamJsonFormatter.emitEvent`/`convertToStreamStats`). The two event shapes already confirmed by the user's partial real run (`init` with `session_id`+`model`, `message` with `role`+`content`) match the source exactly — high confidence in the rest. **Live verification is deferred** — re-run with a reachable API endpoint on first authenticated test and update the translator if any field is off.
- **Tool names not enumerated.** The `tool_name` field in `tool_use` events uses Gemini CLI's built-in tool names (e.g. `write_file`, `run_shell_command`, `read_file`, `edit_file`, `list_directory`…) — these were not enumerated from source (would require grepping the tool registry, out of scope). The translator passes `tool_name` through unchanged; the Quill UI displays it as-is.
- **`--resume` arg ordering vs `-p` not live-verified.** Yargs should accept `-r <id> -p <prompt> …` or `-p <prompt> … -r <id>`; the recommended order (`-p` first, `-r` after) mirrors qoder's `[…flags, '-r', id, prompt]` but reversed (qoder puts `-r` before the prompt; Gemini's `-p` takes the prompt as its value so order should not matter). Verify on first authenticated resume test.
- **`stats.models` sub-shape not fully traced.** The per-model stats object is `{total_tokens, input_tokens, output_tokens, cached, input}` (5 fields) per `convertToStreamStats`. The `cached` and `input` fields are Gemini-specific (cached = cached-content tokens, input = total input including cache). Not load-bearing for the adapter — skip unless the UI later wants usage stats.
- **OAuth/Vertex auth paths not inspected.** Only API-key auth (`selectedType: "gemini-api-key"`) was inspected locally. OAuth (`google-oauth`) and Vertex AI (`vertex-ai`) auth flows are documented elsewhere; out of scope per PRD (the adapter does not manage auth).
- **Online docs not fetched.** All findings from local binary + bundle source. The g.co/geminicli docs site and github.com/google-gemini/gemini-cli README were not consulted.
- **Bundle has parallel emit paths** (`gemini-KK7AERSF.js` legacy + `gemini-2RHAL2LS.js` / `gemini-54R2PJOR.js` agent path) — all three emit the same six event types with the same shapes (verified by grep across all three files). The translator does not need to know which path a given run took.

## Source Artifacts

- Local binary: `/Users/yiminlin/.nvm/versions/node/v25.9.0/bin/gemini` (v0.56.0)
- Local bundle root: `/Users/yiminlin/.nvm/versions/node/v25.9.0/lib/node_modules/@google/gemini-cli/`
- Bundle source (event emit points): `bundle/gemini-KK7AERSF.js` lines 10663, 10698, 10729, 10764 (result/error), 10956, 10994, 11131, 11156, 11172, 11464, 11500, 11533, 11549, 11560, 11571, 11590, 11621, 11651, 11676, 11720 (init/message/tool_use/tool_result/error/result)
- Bundle source (enum + formatter): `bundle/chunk-MYCBWRZE.js` line 363193 (`JsonStreamEventType`), 384611 (`StreamJsonFormatter`), 384634 (`convertToStreamStats`), 401344 (`GEMINI_CLI_TRUST_WORKSPACE` env read)
- Local config: `~/.gemini/settings.json`, `~/.gemini/trustedFolders.json`, `~/.gemini/google_accounts.json`, `~/.gemini/projects.json`, `~/.gemini/state.json`, `~/.gemini/installation_id`
- Local per-project state: `~/.gemini/history/quill/`, `~/.gemini/tmp/quill/{chats,logs,logs.json}`
- Repo reference templates (one-shot spawn): `/Users/yiminlin/project/quill/packages/cli-adapter/src/qoderAdapter.ts`, `/Users/yiminlin/project/quill/packages/cli-adapter/src/codexAdapter.ts`
- Repo sidecar precedents: `/Users/yiminlin/project/quill/apps/desktop/src-tauri/capabilities/default.json`, `/Users/yiminlin/project/quill/apps/desktop/src-tauri/capabilities/pet-panel.json`
- Repo UI precedents: `/Users/yiminlin/project/quill/apps/desktop/src/components/ai/AdapterSelector.tsx`, `/Users/yiminlin/project/quill/apps/desktop/src/components/ai/AgentCliTag.tsx`, `/Users/yiminlin/project/quill/apps/desktop/src/components/settings/FeatureAdapterDropdown.tsx`, `/Users/yiminlin/project/quill/apps/desktop/src/assets/agents/`
- Repo i18n precedent: `/Users/yiminlin/project/quill/apps/desktop/src/i18n/locales/en/settings.json` (lines 142-154)
