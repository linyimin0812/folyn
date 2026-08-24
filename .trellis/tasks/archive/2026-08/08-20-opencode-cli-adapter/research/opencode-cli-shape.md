# Research: opencode CLI Wire Shape

- **Query**: opencode CLI surface for a Folyn `opencodeAdapter.ts` — binary, streaming flags, resume, JSONL event shapes, permissions, stdin, config, auth, subcommands
- **Scope**: mixed (local binary inspection + `--help` capture + real `run --format json` traces); no online docs consulted (see Caveats)
- **Date**: 2026-08-20

## TL;DR

Binary is `opencode` (npm-installed, on `$PATH`). Non-interactive streaming is `opencode run --format json --auto "<prompt>"` — emits NDJSON, one event per line. Resume is `opencode run -s <sessionID> "<prompt>"` (or `-c` for last session). Sessions persist in a SQLite DB at `~/.local/share/opencode/opencode.db`; user config is `~/.config/opencode/opencode.jsonc` (JSONC). Auth via `opencode providers login` → `~/.local/share/opencode/auth.json`.

**Wire shape is NOT codex/qoder-compatible.** opencode's JSONL uses `{type, timestamp, sessionID, part}` where `part.type` discriminates the inner event (`step-start`, `text`, `tool`, `step-finish`). There is **no** `system`/`assistant`/`result` envelope, **no** explicit terminal `result`/`done` event — the process just exits after the final `step_finish` with `reason: "stop"`. The codex/qoder `translateXxxEvent` template does **not** map 1:1; opencode needs its own translator. Plan: model the adapter on the qoder one-shot spawn lifecycle but write a fresh `translateOpencodeEvent`.

All findings below are from the locally installed `opencode` v1.18.18 at `/Users/yiminlin/.nvm/versions/node/v25.9.0/bin/opencode` with real captured `--format json` output. No online docs fetched.

## Findings

### 1. Binary name

- **Binary**: `opencode` (on `$PATH`).
- **Version**: 1.18.18 (`opencode --version` → `1.18.18`).
- **Install path observed**: `/Users/yiminlin/.nvm/versions/node/v25.9.0/bin/opencode` — installed via npm (the `package.json` next to it depends on `@opencode-ai/plugin`).
- **Installer (per `--help` subcommands)**: `opencode upgrade [target]` upgrades in place; `opencode uninstall` removes. The docs site (opencode.ai) advertises a curl installer `curl -fsSL https://opencode.ai/install | bash` — not run-verified here, but the binary name is the same `opencode` regardless of install method.
- **No platform-specific binary variant** observed (single `opencode` binary; no `-cn` sister binary, unlike qoder). China routing, if needed, would be a provider config concern, not a separate binary.

### 2. Non-interactive streaming mode

`opencode run --help` (captured locally):

```
opencode run [message..]

run opencode with a message

Positionals:
  message  message to send                                                     [array] [default: []]

Options:
      --print-logs   print logs to stderr                                  [boolean]
      --log-level    log level           [string] [choices: "DEBUG","INFO","WARN","ERROR"]
      --pure         run without external plugins                          [boolean]
      --command      the command to run, use message for args             [string]
  -c, --continue    continue the last session                              [boolean]
  -s, --session     session id to continue                                 [string]
      --fork        fork the session before continuing
                    (requires --continue or --session)                     [boolean]
      --share       share the session                                       [boolean]
  -m, --model      model to use in the format of provider/model           [string]
      --agent      agent to use                                             [string]
      --format     format: default (formatted) or json (raw JSON events)
                 [string] [choices: "default", "json"] [default: "default"]
  -f, --file      file(s) to attach to message                              [array]
      --title      title for the session                                    [string]
      --attach     attach to a running opencode server                      [string]
  -p, --password  basic auth password (defaults to OPENCODE_SERVER_PASSWORD) [string]
  -u, --username  basic auth username                                       [string]
      --dir        directory to run in                                       [string]
      --port       port for the local server                                [number]
      --variant    model variant (provider-specific reasoning effort)       [string]
      --thinking   show thinking blocks                                      [boolean]
  -i, --interactive  run in direct interactive split-footer mode   [boolean] [default: false]
      --auto       auto-approve permissions that are not explicitly denied
                    (dangerous!)                                  [boolean] [default: false]
```

**The flags we need**:
- `--format json` — raw JSON events, one per line (NDJSON). **Not** `--output-format stream-json` (qoder/codex naming) — opencode uses `--format json`. The default `default` is human-formatted TTY output.
- `--auto` — auto-approve permissions (see §5).
- Prompt is the trailing positional `[message..]` (variadic, joined).
- `--dir <dir>` lets us avoid a shell `cd`; this is the working-dir switch (mirrors qoder's `--cwd`, but as `--dir`).
- `--model <provider/model>` if the user pins a model.
- `--thinking` surfaces reasoning blocks (optional; emit as text or skip).

Note `run` does **not** have a `-p/--print` flag — that name is taken by `--password`. Non-interactivity is implied by `run` (vs the default TUI subcommand) and by `--format json`. There is no `--print` equivalent.

### 3. Session resume

- `-s, --session <id>` — resume a specific session by id. Verified: `opencode run --format json --auto -s ses_fe2770611ffe46zIHDQgh1Oypk "what file did you just create"` returned a continuation turn with the **same** `sessionID` on every event — opencode remembered the prior turn.
- `-c, --continue` — continue the most recent session (no id needed).
- `--fork` — fork before continuing (requires `-c` or `-s`); creates a new session branched from the resumed one.
- `--share` — share the session (out of scope for the adapter).

**Session id format**: `ses_<22+ char alphanumeric>` (e.g. `ses_fe2771f9fffek0fYnCyPJEvBqU`). Always present on every streamed event as the top-level `sessionID` field — the adapter captures it from the **first** event (any `type`) and persists it for the next send, same strategy as the qoder/codex adapters.

**Where sessions persist**: `~/.local/share/opencode/opencode.db` (SQLite; `opencode.db`, `opencode.db-shm`, `opencode.db-wal` all present). There is **no** per-session JSON file on disk — sessions live in the DB. `opencode session list` enumerates them; `opencode export <sessionID>` dumps one as JSON. The adapter does not need to touch the DB — `--session <id>` reads from it.

`opencode session list` output (real run):

```
Session ID                      Title                                   Updated
───────────────────────────────────────────────────────────────────────────────
ses_fe2770611ffe46zIHDQgh1Oypk  New session - 2026-08-20T04:58:31.278Z  12:58 PM
ses_fe2771f9fffek0fYnCyPJEvBqU  New session - 2026-08-20T04:58:24.736Z  12:58 PM
```

`opencode session delete <sessionID>` removes one.

### 4. JSONL event shape (load-bearing)

Captured from real `opencode run --format json --auto "<prompt>"` runs. Each line is a JSON object; top-level envelope is:

```jsonc
{ "type": "<envelope-type>", "timestamp": <ms-epoch>, "sessionID": "ses_...", "part": { ...inner event... } }
```

`part.type` discriminates the inner event. Observed envelope `type` values: `step_start`, `text`, `tool_use`, `step_finish`. (There is **no** `system` init event and **no** `result`/`done` terminal event — the stream ends when the process exits.)

#### 4.1 `step_start` — turn begins (one per assistant message)

```json
{"type":"step_start","timestamp":1787201906425,"sessionID":"ses_fe2771f9fffek0fYnCyPJEvBqU","part":{"id":"prt_01d88e6f6001K1c1v6kC04WObi","messageID":"msg_01d88e1d1001lvRfAs5i4gIvSP","sessionID":"ses_fe2771f9fffek0fYnCyPJEvBqU","type":"step-start"}}
```

Use: capture `sessionID` here on the first event; otherwise no-op (or emit a turn-start marker if the UI wants one).

#### 4.2 `text` — assistant text chunk

```json
{"type":"text","timestamp":1787201907266,"sessionID":"ses_fe2771f9fffek0fYnCyPJEvBqU","part":{"id":"prt_01d88ea23001SjPlJzN0CA9hVJ","messageID":"msg_01d88e1d1001lvRfAs5i4gIvSP","sessionID":"ses_fe2771f9fffek0fYnCyPJEvBqU","type":"text","text":"Hi!","time":{"start":1787201907235,"end":1787201907241}}}
```

Map: `part.text` → adapter `text` event `{type:'text', content: part.text}`. Note `text` is a **single complete string per event** (not a streaming delta) — opencode appears to emit one `text` event per finished text chunk, not token-by-token. Verify on a longer run whether multiple `text` events arrive for one assistant message; the captured "Done. Created `hello.txt`..." turn emitted exactly one `text` event with the whole sentence.

#### 4.3 `tool_use` — tool call (start + result fused into one event)

```json
{"type":"tool_use","timestamp":1787201913861,"sessionID":"ses_fe2770611ffe46zIHDQgh1Oypk","part":{"type":"tool","tool":"write","callID":"call_00_U8OlS51kSIMFHsQWj7lf3455","state":{"status":"completed","input":{"filePath":"/private/tmp/octest/hello.txt","content":"hi"},"output":"Wrote file successfully.","metadata":{"diagnostics":{},"filepath":"/private/tmp/octest/hello.txt","exists":false,"truncated":false},"title":"private/tmp/octest/hello.txt","time":{"start":1787201913815,"end":1787201913831}},"id":"prt_01d8902e7001jNzRS7o68tIQyt","sessionID":"ses_fe2770611ffe46zIHDQgh1Oypk","messageID":"msg_01d88fb7b001ZA7Ccm6SqT1mCd"}}
```

**Important**: opencode fuses tool-call-start and tool-result into a **single** `tool_use` event with `part.state.status` already `"completed"` and `part.state.output` populated. There is no separate `tool_call_start` / `tool_result` pair streamed in the observed trace (the write tool finished within ~16ms, before the event was emitted). The `state.status` field supports `running`/`completed`/`error` per the protocol, so a long-running tool **may** emit two events (one `status:"running"`, one `status:"completed"`) — but this was not observed for the fast `write` tool. Treat `status === "running"` (or absent output) as `tool_start`, and `status === "completed"`/`"error"` as `tool_end` (emit both if you see both events; emit just `tool_end` if the fused single event arrives).

Map:
- `tool_start`: `{type:'tool_start', toolName: part.tool, toolId: part.callID, toolInput: part.state.input ?? {}}`
- `tool_end`: `{type:'tool_end', toolId: part.callID, toolOutput: part.state.output}` (and `tool_error` if `status === "error"` — `part.state.output` likely carries the error text).

Fields: `part.tool` (tool name, e.g. `write`, `read`, `bash`, `edit`), `part.callID` (id, e.g. `call_00_...`), `part.state.input` (tool args object), `part.state.output` (string result), `part.state.metadata` (tool-specific), `part.state.title` (human label).

#### 4.4 `step_finish` — turn ends (one per assistant message)

```json
{"type":"step_finish","timestamp":1787201907266,"sessionID":"ses_fe2771f9fffek0fYnCyPJEvBqU","part":{"id":"prt_01d88ea2f001WeJAZGx0XiK6Tx","reason":"stop","messageID":"msg_01d88e1d1001lvRfAs5i4gIvSP","sessionID":"ses_fe2771f9fffek0fYnCyPJEvBqU","type":"step-finish","tokens":{"total":12719,"input":12705,"output":3,"reasoning":11,"cache":{"write":0,"read":0}},"cost":0.00178262}}
```

`part.reason` observed values:
- `"stop"` — clean end of an assistant message (turn done, no further tool calls).
- `"tool-calls"` — assistant message ended because it emitted tool calls; expect a follow-up `step_start` for the next assistant message after tools complete. **This is NOT a terminal event** — the run continues. Only `reason: "stop"` on the final `step_finish` signals end-of-run (and even then, rely on process exit, not the event, as the `done` signal — see §4.5).

Map: ignore for stream-progress purposes; capture `tokens`/`cost` if the UI wants usage stats.

#### 4.5 Terminal / done / error — **no explicit event**

Unlike codex/qoder, opencode does **not** emit a `{type:"result"}` or `{type:"done"}` final event. The stream simply ends when the process exits. The adapter's `command.on('close')` handler (the qoder/codex pattern) is the **authoritative** `done` signal — exactly the fallback the qoder adapter already uses. Do NOT wait for a `result` event; it will never arrive.

Error path (auth failure, bad model, etc.) was not observed live — opencode logs to stderr and the `step_finish` may carry a non-`stop` reason or the process exits non-zero. The adapter should treat non-zero exit code OR a stderr line as `error` + `done`. (If a future authenticated-error run reveals an `error` event shape, update the translator — same caveat qoder's research file flagged.)

### 5. Permissions / autonomy flag

- **`--auto`** — "auto-approve permissions that are not explicitly denied (dangerous!)". This is opencode's `--dangerously-skip-permissions` equivalent. Default `false`. This is the flag the Tauri sidecar needs (no TTY to approve interactively).
- There is **no** `--dangerously-skip-permissions` / `--yolo` / `--allow-all` flag — opencode's only autonomy switch is `--auto`. Permissions are otherwise driven by config (an `opencode.jsonc` permissions block, not inspected here).
- `--auto` applies to both `opencode run` and the default TUI invocation (`opencode --auto`).

### 6. stdin handling

**opencode does NOT block on stdin** when run as `opencode run --format json --auto "<prompt>"`. Verified: ran without any stdin redirect, process exited cleanly with `EXIT=0` and emitted all expected events. (qoder and codex both need `< /dev/null`; opencode does not.)

The adapter can still add `< /dev/null` defensively — it's harmless — but it is not required. The prompt is a positional arg, not read from stdin, so there is no stdin-read path to block on.

### 7. Config file path

- **User config**: `~/.config/opencode/opencode.jsonc` (JSONC — JSON with comments). Schema advertised in-file as `"$schema": "https://opencode.ai/config.json"`.
- **Minimal valid shape**: the local file is currently just `{"$schema":"https://opencode.ai/config.json"}` — i.e., an empty config is valid; opencode runs with defaults.
- **Sibling files in `~/.config/opencode/`**: `node_modules/`, `package.json` (deps `@opencode-ai/plugin` for plugin loading), `package-lock.json`.
- **Data dir (state, not config)**: `~/.local/share/opencode/` — contains `opencode.db` (sessions/messages), `auth.json` (credentials), `log/`, `repos/`, `snapshot/`.
- **State dir**: `~/.local/state/opencode/` (XDG state; less relevant).
- **Cache dir**: `~/.cache/opencode/`.
- **Override**: `opencode run --dir <dir>` sets the working dir per-run (no need for `cd`). No `--config-dir` flag observed (unlike qoder); config dir follows XDG (`XDG_CONFIG_HOME`).
- **Format**: JSONC (comments allowed). NOT TOML, NOT YAML.

For the adapter: `settingsFilePath` should be `~/.config/opencode/opencode.jsonc` per the PRD's `~`-prefix rule; `settingsFileTemplate` is `{ "$schema": "https://opencode.ai/config.json" }`.

### 8. Auth model

- **Subcommand**: `opencode providers` (alias `opencode auth`). Subcommands:
  - `opencode providers list` (alias `ls`) — list providers and credentials.
  - `opencode providers login [url]` — log in to a provider (interactive browser/clipboard flow).
  - `opencode providers logout [provider]` — log out.
- **Credentials file**: `~/.local/share/opencode/auth.json` — a JSON object keyed by provider name. Observed shape (values redacted):

  ```jsonc
  {
    "deepseek": { "type": "api", "key": "<REDACTED>" }
  }
  ```

  `type` observed: `"api"` (API key). Other types (OAuth) presumably exist for providers that support login; not inspected.
- **API key flow**: edit `auth.json` directly with `{"<provider>": {"type":"api","key":"..."}}` — or run `opencode providers login`. The local install used the direct-edit path for DeepSeek and it worked.
- **Env var override**: `OPENCODE_SERVER_PASSWORD` / `OPENCODE_SERVER_USERNAME` are for the **server** basic auth (`opencode serve`), not model-provider auth. Do not confuse them with model API keys.
- For the adapter: do **not** auto-login (out of scope, matches qoder precedent). Surface `settingsFilePath = ~/.config/opencode/opencode.jsonc` and let the user run `opencode providers login` out-of-band. The auth file lives under `~/.local/share/opencode/auth.json` — not user-editable as a "setting", so it stays out of the adapter's settings surface.

### 9. Skills / commands subcommands

opencode's subcommand surface (full top-level list, captured from `opencode --help`):

```
opencode completion          generate shell completion script
opencode acp                 start ACP (Agent Client Protocol) server
opencode mcp                 manage MCP (Model Context Protocol) servers
opencode [project]           start opencode tui                       [default]
opencode attach <url>        attach to a running opencode server
opencode run [message..]     run opencode with a message
opencode debug               debugging and troubleshooting tools
opencode providers           manage AI providers and credentials      [aliases: auth]
opencode agent               manage agents
opencode upgrade [target]    upgrade opencode
opencode uninstall           uninstall opencode
opencode serve               starts a headless opencode server
opencode web                 start opencode server and open web interface
opencode models [provider]   list all available models
opencode stats               show token usage and cost statistics
opencode export [sessionID]  export session data as JSON
opencode import <file>       import session data from JSON file or URL
opencode github              manage GitHub agent
opencode pr <number>         fetch and checkout a GitHub PR branch, then run opencode
opencode session             manage sessions
opencode plugin <module>     install plugin and update config          [aliases: plug]
opencode db                  database tools
```

- **No `skills` subcommand.** opencode does not have a claude-style `/skills` surface.
- **`opencode plugin <module>`** (alias `plug`) — installs an npm plugin module and updates config. Flags: `-g, --global` (install in global config), `-f, --force` (replace existing). This is the closest analog to a skills/commands surface — but it's a plugin **installer**, not a runtime list/dispatcher. Out of scope for the MVP adapter (matches the qoder precedent: `qodercli plugins` exists but is not wired).
- **`opencode agent`** — `agent create` / `agent list`. Agents are configured personas (system prompts); not a runtime skills surface either.
- **`opencode mcp`** — MCP server management. Relevant if Folyn later wants to share its MCP graph with opencode; out of scope for MVP.

For the adapter: inherit `BaseCliAdapter`'s `listSkills/listCommands → []` default, matching qoder. Plugins/agents/MCP are out of scope per the PRD.

## Recommendation for the adapter template

Model on `qoderAdapter.ts` (one-shot spawn per send), but write a **fresh** `translateOpencodeEvent` — the wire shape differ enough that the qoder translator cannot be reused.

- **Spawn**: `opencode run --format json --auto --dir <workingDir> <prompt>` (resume: add `-s <sessionId>`). No `< /dev/null` needed (opencode doesn't block on stdin), but harmless to keep for symmetry with qoder/codex.
- **Stream parse**: each stdout line is a JSON object. Discriminate on `event.type`:
  - `step_start` → capture `sessionID` (first event); no-op otherwise.
  - `text` → emit `{type:'text', content: part.text}`.
  - `tool_use` → emit `tool_start` (always) + `tool_end` when `part.state.status === "completed"` or `"error"` (fused event; see §4.3). If a future run shows a separate `status:"running"` event first, emit only `tool_start` for it.
  - `step_finish` → ignore (or capture usage). `reason: "stop"` is the clean-end signal but not the `done` signal — rely on `command.on('close')`.
- **Done**: `command.on('close')` → emit `{type:'done'}`. Non-zero exit or stderr line → `{type:'error'}` then `{type:'done'}`. No `result` event exists.
- **Resume**: pass `-s <sessionId>` (or `-c` if we ever want "last session"); persist `sessionId` from the first event's top-level `sessionID`.
- **Sidecar**: one sidecar `opencode` (no `-cn` variant). Binary is the npm-installed `opencode` on `$PATH`; `cliPathDefault = "opencode"`.

## Caveats / Not Found

- **No online docs consulted.** All findings from the locally installed v1.18.18 binary (`opencode --help`, `opencode run --help`, real `opencode run --format json --auto` traces, `~/.config/opencode/` and `~/.local/share/opencode/` contents). The opencode.ai docs site and github.com/sst/opencode README were not fetched.
- **Long-running tool event shape not observed.** The `write` tool finished in ~16ms, so only the fused `status:"completed"` `tool_use` event was captured. Whether opencode emits a separate `status:"running"` `tool_use` event first for slow tools (e.g. `bash` running a 30s build) is unverified. The translator should handle both cases (one fused event OR a running-then-completed pair) — see §4.3.
- **Streaming text chunking not verified for long outputs.** All captured `text` events carried one complete sentence. Whether a long assistant turn arrives as multiple `text` events (token-delta style) or one big `text` event is unverified. The translator treats each `text` event as an independent `text` emission either way, so it's safe.
- **Error event shape not observed.** Auth-failure / bad-model / runtime-error paths were not exercised. The adapter's error handling should rely on non-zero exit + stderr lines, and treat any unrecognized event `type` as a no-op (same as qoder's translator). Update on first real failure.
- **`--format` choices** are only `default` and `json` per `--help`. There is **no** `stream-json` choice — opencode's `json` already streams (NDJSON), unlike codex/qoder where `json` is single-shot and `stream-json` is the streaming one.
- **China variant**: not present in the binary surface. If a China provider endpoint is needed, it's a provider config concern (`auth.json` entry + `opencode.jsonc` model routing), not a separate binary. Out of scope per PRD.

## Source Artifacts

- Local binary: `/Users/yiminlin/.nvm/versions/node/v25.9.0/bin/opencode` (v1.18.18)
- Local config: `/Users/yiminlin/.config/opencode/opencode.jsonc`, `/Users/yiminlin/.config/opencode/package.json`
- Local state: `/Users/yiminlin/.local/share/opencode/opencode.db`, `/Users/yiminlin/.local/share/opencode/auth.json`
- Captured traces: `opencode run --format json --auto` runs in `/tmp` and `/tmp/octest` (text-only + tool-use + resume)
- Repo reference template (one-shot spawn): `/Users/yiminlin/project/folyn/packages/cli-adapter/src/qoderAdapter.ts`
- Repo reference template (one-shot spawn, codex): `/Users/yiminlin/project/folyn/packages/cli-adapter/src/codexAdapter.ts`
