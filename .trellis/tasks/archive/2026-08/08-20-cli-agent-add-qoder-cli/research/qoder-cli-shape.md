# Research: Qoder CLI Wire Shape (International vs China)

- **Query**: Qoder CLI agent shape — binary names, command line, streaming output, session/resume, config locations, intl vs CN differences, auth
- **Scope**: mixed (local binary inspection + binary string analysis; authoritative online docs not browsed — see Caveats)
- **Date**: 2026-08-20

## TL;DR

The PRD's assumed binary names (`qoder` / `qoder-cn`) are **wrong**. Actual names are `qodercli` (international) and `qoderclicn` (China). Both are the **same codebase** shipped as two binaries, switching behavior on an internal `QODERCLI_SITE` flag (`global` vs `cn`). CLI shape is essentially **identical to `codex exec --json`**: one-shot per process, JSONL stream via `-p --output-format stream-json`, sessions resumable via `-r <id>` / `-c` / `--session-id <id>`. Recommend the **codex one-shot + JSONL template**, not the pi long-rpc template.

All findings below come from inspecting a real installed binary at `~/.qoder/bin/qodercli/qodercli-1.1.26` (v1.1.26, Mach-O arm64, 103MB). No online docs were consulted — see Caveats.

## Findings

### 1. Binary names

| Variant | Binary name | npm package | Site flag | Observed on disk |
|---|---|---|---|---|
| International | `qodercli` | `@qoder-ai/qodercli` | `QODERCLI_SITE=global` | `~/.qoder/bin/qodercli/qodercli-1.1.26` |
| China | `qoderclicn` | `@qodercn-ai/qoderclicn` | `QODERCLI_SITE=cn` | (not installed locally; inferred from binary strings) |

Evidence (from `strings` on the installed binary):
- `A.includes("/node_modules/@qoder-ai/qodercli/")||A.includes("/node_modules/@qodercn-ai/qoderclicn/")` — both npm package paths hard-coded for the Homebrew-vs-npm detection.
- Reserved env vars `QODER_CLI` / `QODERCN_CLI` and `QODER_CONFIG_DIR` / `QODERCN_CONFIG_DIR` exist as parallel pairs.
- Internal branch: `QODERCLI_SITE==="cn"?"cn":"global"` picks `QODERCN_CONFIG_DIR_NAME` vs `QODER_CONFIG_DIR_NAME`.

The China binary file name follows the same pattern as the intl one (versioned suffix), i.e. `qoderclicn-1.1.26`. The launcher (`QODERCN_CLI` env) is set by the IDE/launcher; the binary itself reads its site from a compile-time constant.

### 2. Command-line shape (non-interactive / programmatic)

`qodercli --help` (full output captured locally):

```
Usage: qodercli [options] [command] [query...]

Qoder CLI - Defaults to interactive mode. Use -p/--print for non-interactive output.

Options:
  -p, --print                       Print response and exit (non-interactive)
  -o, --output-format <format>      The format of the CLI output
  --input-format <format>           The format of the CLI input
  -m, --model <model>               Model for the current session
  --reasoning-effort <level>        Set reasoning effort level
  --context-window <size>           Explicit context window
  --permission-mode <mode>          default | accept_edits | bypass_permissions | dont_ask | auto
  --dangerously-skip-permissions    Bypass all permission checks
  --tools <tools...>                Restrict available built-in tools
  --allowed-tools <tool>            Tools to allow
  --disallowed-tools <tool>         Tools to deny
  --attachment <file>               Attach files to the initial prompt
  --add-dir <dir>                   Additional directories to include
  -w, --cwd <dir>                   Change working directory before startup
  --config-dir <dir>                Use a custom user-level config root for this run
  --agent <name>                    Agent for the current session
  --agents <json>                   JSON object defining custom agents
  --append-system-prompt <text>    Append to the default system prompt
  --system-prompt <text>            System prompt for the session
  --output-style <style>            Output style
  --max-output-tokens <size>        Set maximum model output tokens
  --mcp-config <config>             Load MCP servers from JSON file(s) or inline JSON
  --strict-mcp-config                Only use MCP servers from --mcp-config
  --setting-sources <source>        Setting sources to load (user, project, local)
  --settings <json>                  Load additional settings from a JSON file path or inline JSON string
  -c, --continue                    Continue the most recent session
  --fork-session                    Create a new session from a resumed conversation
  -r, --resume [id]                 Resume a previous session by identifier
  -n, --name <name>                 Set a display name for this session
  --session-id <id>                 Use a specific session ID
  --no-session-persistence          Disable session persistence (only with --print)
  --list-sessions                   List available sessions and exit
  --delete-session <index>          Delete a session by index number
  --list-models                     List available models
  -v, --version
  -h, --help

Commands: mcp, plugins, skills, hooks, agents, login, commit, rollback, update, remote-control, status, security, feedback, wiki
```

**Output format** — `--help` does not enumerate the choices for `--output-format`, but probing shows two valid values (very likely the full set, since the shape mirrors codex exactly):

- `--output-format json` (with `-p`): emits a **single** final JSON object.
- `--output-format stream-json` (with `-p`): emits **JSONL** — one JSON object per line, streaming as the agent runs.

The `stream-json` stream shape (captured from a real `echo "say hi" | qodercli -p --output-format stream-json --no-session-persistence` run):

```
{"type":"system","subtype":"init","apiKeySource":"none","qodercli_version":"1.1.26","protocol_version":"1.2.0","cwd":"...","tools":[...],"mcp_servers":[],"model":"auto","permissionMode":"default","slash_commands":[...],"output_style":"default","agents":[...],"skills":[...],"plugins":[],"capabilities":[...],"fast_mode_state":"off","uuid":"...","session_id":"..."}
{"type":"assistant","message":{"id":"...","model":"<synthetic>","role":"assistant","content":[{"type":"text","text":"..."}],"usage":{...},"stop_reason":"stop_sequence"},"parent_tool_use_id":null,"session_id":"...","uuid":"...","error":"authentication_failed"}
{"type":"result","subtype":"success","is_error":true,"duration_ms":0,"duration_api_ms":0,"num_turns":1,"result":"...","stop_reason":"stop_sequence","session_id":"...","total_cost_usd":0,"total_credits":0,"usage":{...},"modelUsage":{},"permission_denials":[],"terminal_reason":"completed","uuid":"..."}
```

This is **field-for-field compatible with the codex exec --json stream** (`type` ∈ `system`/`assistant`/`result`, `session_id`, `is_error`, `stop_reason`, `usage`, `terminal_reason`). The codex adapter's `translateCodexEvent` shape should map almost 1:1. Note `stream-json` emits `system`/`assistant`/`result` lines; tool-use events presumably also appear as `{"type":"assistant","message":{...,"content":[{"type":"tool_use",...}]}}` or a `tool_*` event (not observed live because the test run was not authenticated — but the protocol_version and shape mirror codex, so the codex tool-event mapping is the right default; verify when an authenticated run is possible).

**Input format** — `--input-format <format>` mirrors codex; presumably `stream-json` accepts NDJSON on stdin for multi-turn, but not verified live. For the adapter's first version, plain-text stdin (the codex pattern) is sufficient.

### 3. Session / resume

Resumable, multiple mechanisms:

- `-r, --resume [id]` — resume a previous session by identifier (positional id, matches codex `exec resume <id>` semantics but as a flag).
- `-c, --continue` — continue the most recent session in this project.
- `--session-id <id>` — use a specific session ID (lets the caller pre-generate one).
- `--fork-session` — new session from a resumed conversation.
- `--list-sessions` / `--delete-session <index>` — session management.

`--list-sessions` output (real run):

```
Available sessions for this project (2):
  1. hello (54 minutes ago) [0400f1e3-ced9-4410-ace3-0a3417aea735]
  2. hello (1 hour ago) [041355d9-2c09-40b6-89f5-4f0e6101e932]
```

Session IDs are UUIDs. The CLI prints them on the `system` init event (`session_id`) and on every subsequent event, so the adapter can capture `resumeSessionId` from the stream the same way codex does.

### 4. Config file locations

| Variant | Default config root | Override env vars |
|---|---|---|
| International | `~/.qoder/` | `QODER_CONFIG_DIR` (absolute path), `QODER_CONFIG_DIR_NAME` (dir name only) |
| China | `~/.qodercn/` (inferred) | `QODERCN_CONFIG_DIR`, `QODERCN_CONFIG_DIR_NAME` |

Observed `~/.qoder/` layout (real install):

```
~/.qoder/
├── .auth/              # credentials, machine_id, dynamic error/text catalogs
├── .bin/               # runtime helper: runtime-info-darwin-arm64-<hash>
├── .cache/, cache/
├── .last-cleanup
├── .models/            # default model + per-uid catalog
├── bin/qodercli/qodercli-1.1.26   # the binary itself
├── entry/, installation_id, logs/, plugins/, projects/, security/, session-env/
├── settings.json       # user settings (securityScan, permissions, auth.selectedType)
├── shell-snapshots/, state.json, tasks/, tmp/
```

`--config-dir <dir>` (CLI flag) overrides per-run for either variant. The `settingsFilePath` for the adapter should be `~/.qoder/settings.json` (intl) and `~/.qodercn/settings.json` (CN), per the PRD's "`~` prefix" rule.

### 5. International vs China differences

Concretely — same source code, same `--help`, same `stream-json` protocol. Differences:

| Aspect | International | China |
|---|---|---|
| Binary name | `qodercli` | `qoderclicn` |
| npm package | `@qoder-ai/qodercli` | `@qodercn-ai/qoderclicn` |
| Site flag (compile-time) | `QODERCLI_SITE=global` | `QODERCLI_SITE=cn` |
| Config dir | `~/.qoder/` | `~/.qodercn/` |
| Config-dir env vars | `QODER_CONFIG_DIR`, `QODER_CONFIG_DIR_NAME` | `QODERCN_CONFIG_DIR`, `QODERCN_CONFIG_DIR_NAME` |
| Launcher env | `QODER_CLI` | `QODERCN_CLI` |
| API endpoint | `https://openapi.qoder.sh` | `https://openapi.qoder.com.cn` |
| CDN | `https://download.qoder.com/qodercli/` | `https://static.qoder.com.cn/qoder-cli-cn` |
| Companion ext | (qoder-cli-vscode-ide-companion) | (QODER_CN_IDE) |
| Git bash / shell env | `QODER_GIT_BASH_PATH`, `QODER_SHELL_PREFIX` | `QODERCN_GIT_BASH_PATH`, `QODERCN_SHELL_PREFIX` |

Other URLs found in the binary (informational, not part of CLI surface): `https://docs.qoder.com`, `https://qoder.com/cli`, `https://qoder-ide.oss-accelerate.aliyuncs.com` (China OSS mirror), `https://test.qoder.ai`, `https://daily.qoder.ai`, `https://test-openapi.qoder.com.cn`, `https://daily-openapi.qoder.sh`. Region env vars `QODER_API_DOMAIN_US` / `_JP` / `_SG` / `_SUFFIX` exist for international multi-region routing.

**For the adapter this means**: a single implementation class parameterized by (binary name, config dir, site) is correct. No code-path divergence beyond that. Both binaries accept the same `--print --output-format stream-json --no-session-persistence` invocation.

### 6. Auth

Three mechanisms, all observed in the binary's reserved env vars and the local `settings.json`:

1. **Browser OAuth login** — `qodercli login` (subcommand, no args, "Sign in to your Qoder account through the browser"). This is the default end-user flow. Stores a managed token under `~/.qoder/.auth/`.
2. **Personal Access Token (PAT)** — set the `qoder-pat` auth type in `settings.json` (observed: `"security":{"auth":{"selectedType":"qoder-pat"}}`) and provide the token via env var `QODER_PAT` / `QODER_PERSONAL_ACCESS_TOKEN` (also `QODER_ENV_PAT`, `QODER_SDK_ACCESS_TOKEN`, `QODER_AUTH_MANAGED_TOKEN` for various embedded-SDK contexts). The China binary reads the same env vars.
3. **Service account / CI** — `QODER_ENV_SERVICE_ACCOUNT_KEY`, `QODER_ENV_JOB_TOKEN`, `QODER_DEVICE_TOKEN` for non-interactive CI/embedded use.

Auth state lives under `~/.qoder/.auth/` (intl) / `~/.qodercn/.auth/` (CN). The local install has `machine_id`, `dynamic-error-codes.json`, `dynamic-texts.json`, `.credential-transaction` there.

For the adapter: do **not** attempt auto-login (the PRD already scopes this out). Recommend the adapter surface a `settingsFilePath` pointing at `~/.qoder/settings.json` / `~/.qodercn/settings.json` and let the user run `qodercli login` / `qoderclicn login` out-of-band. If a PAT flow is needed later, the env var to plumb through is `QODER_PAT`.

## Recommendation for the adapter template

Pick the **codex one-shot + JSONL template** (`codexAdapter.ts`), not the pi long-rpc template. Concrete mapping:

- Spawn: `/bin/sh -lc "qodercli -p --output-format stream-json --no-session-persistence --permission-mode <mode> --add-dir <dir> ... -- <prompt>"` (or `qoderclicn` for CN).
- Stream parse: each line is a JSON object; `type` discriminates `system` (capture `session_id` → emit `session_id` event), `assistant` (extract `message.content[].text` → emit `text`; `content[].type==="tool_use"` → emit `tool_start`/`tool_end` pair — verify shape on an authenticated run), `result` (emit `done` or `error` based on `is_error`).
- Resume: pass `-r <sessionId>` (or `--session-id <id>` to pre-generate) — same field the codex adapter already exposes via `CliSendOptions.resumeSessionId`.

Two sidecars to register: `qoder-cli` and `qoder-cli-cn`, mirroring how `codex-cli` is registered today. Binaries are not bundled — the user must install `@qoder-ai/qodercli` / `@qodercn-ai/qoderclicn` (or Homebrew cask, see below) separately; the adapter shells out to whichever is on `$PATH`.

## Caveats / Not Found

- **No online docs consulted.** All findings are from inspecting the locally installed international binary (`~/.qoder/bin/qodercli/qodercli-1.1.26`, v1.1.26) and reading its embedded strings/help output. The China binary was not installed locally; all China-specific claims (binary name `qoderclicn`, config dir `~/.qodercn/`, env var pair `QODERCN_*`) are **inferred from string constants present in the international binary**, which hard-codes both variants side-by-side — high confidence but not run-verified.
- **Tool-use event shape in `stream-json` not observed live** because the test run was unauthenticated and returned only `system`/`assistant`(text)/`result`. The protocol_version `1.2.0` and field names (`type`, `message.content[].type`) match codex's, so the codex tool-event translation is a reasonable default — confirm on first authenticated run.
- **Homebrew cask / formula names** not confirmed. The binary contains a Homebrew-vs-npm path detector referencing both npm packages; the actual cask name (`qoder`? `qoder-cli`?) was not verified. The PRD's `qoder`/`qoder-cn` guess may come from a cask name rather than the binary name — but the **binary** that ends up on `$PATH` is `qodercli` / `qoderclicn`.
- **`--input-format` choices** not enumerated by `--help`; presumed `text` (default) and `stream-json` (NDJSON on stdin) by symmetry with codex, not verified.
- **Qoder Agent SDK** (`@qoder-ai/qoder-agent-sdk`, `QODER_AGENT_SDK_*` env vars) exists as a separate programmatic entrypoint, but it is out of scope for this CLI-adapter task.

## Source Artifacts

- Local binary: `/Users/yiminlin/.qoder/bin/qodercli/qodercli-1.1.26` (v1.1.26, Mach-O arm64, 103920016 bytes)
- Local config: `/Users/yiminlin/.qoder/settings.json`, `/Users/yiminlin/.qoder/.auth/`, `/Users/yiminlin/.qoder/.models/default`
- Repo reference template: `/Users/yiminlin/project/quill/packages/cli-adapter/src/codexAdapter.ts` (one-shot + JSONL)
- Repo reference template: `/Users/yiminlin/project/quill/packages/cli-adapter/src/piAdapter.ts` (long rpc — not recommended for qoder)
