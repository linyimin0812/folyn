# Research: Claude Agent SDK — Runtime, API, and Auth

- **Query**: What is the Claude Agent SDK, how is it invoked, what runtime does the TS version require, does it stream, what are its tools/file-editing/session/auth capabilities, latest version + install size.
- **Scope**: external (npm registry + Anthropic docs via claude-api skill)
- **Date**: 2026-06-28

## TL;DR

The **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) is the Claude Code agentic engine repackaged as a Node.js library. It is **not** the same as the plain Anthropic SDK (`@anthropic-ai/sdk`); it embeds a **native per-platform binary** (~225 MB) that is the Claude Code runtime (currently `claudeCodeVersion: 2.1.195`). It streams SDK messages, has the full Claude Code built-in toolset (bash, file edit, read/write, grep, glob, MCP), supports session resume, and reuses the **same credential chain as the `claude` CLI** — including Claude Code subscription OAuth. It **cannot run in a browser/webview**: it requires Node 18+ and a native binary plus filesystem/child_process access.

## Findings

### Package facts (authoritative — npm registry, fetched 2026-06-28)

| Field | Value |
|---|---|
| Name | `@anthropic-ai/claude-agent-sdk` |
| Latest version | `0.3.195` (published 2026-06-26) |
| First published | 2025-09-27 |
| `engines.node` | `>=18.0.0` |
| Module type | ESM (`"type": "module"`, `main: "sdk.mjs"`) |
| `bin` | *(none — it is a library, not a CLI)* |
| License | `SEE LICENSE IN README.md` |
| Repo | `github.com/anthropics/claude-agent-sdk-typescript` |
| `description` | "SDK for building AI agents with Claude Code's capabilities. Programmatically interact with Claude to understand codebases, edit files, and execute workflows." |
| `claudeCodeVersion` | `2.1.195` (embeds Claude Code 2.1.195) |
| Main pkg unpacked size | ~3.5 MB (`3,667,767` bytes, 15 files) |

**Exports** (subpaths):
- `.` — main SDK (`sdk.mjs` / `sdk.d.ts`)
- `./bridge` — `bridge.mjs` (internal transport between JS and the native engine)
- `./browser` — `browser-sdk.js` (a browser-facing build; see "Browser feasibility" below — it is NOT the full agent runtime)
- `./extract` — `extractFromBunfs.js` (Bun filesystem extraction helper)
- `./sdk-tools` — tool type definitions

### Native per-platform binary (the Claude Code engine)

The SDK declares **platform-specific optional dependencies**, each a separate npm package containing the native Claude Code engine for one target triple:

| Optional dep package | Target |
|---|---|
| `@anthropic-ai/claude-agent-sdk-darwin-x64` | macOS Intel |
| `@anthropic-ai/claude-agent-sdk-darwin-arm64` | macOS Apple Silicon |
| `@anthropic-ai/claude-agent-sdk-linux-x64` | Linux x64 (glibc) |
| `@anthropic-ai/claude-agent-sdk-linux-x64-musl` | Linux x64 (musl/Alpine) |
| `@anthropic-ai/claude-agent-sdk-linux-arm64` | Linux arm64 (glibc) |
| `@anthropic-ai/claude-agent-sdk-linux-arm64-musl` | Linux arm64 (musl) |
| `@anthropic-ai/claude-agent-sdk-win32-x64` | Windows x64 |
| `@anthropic-ai/claude-agent-sdk-win32-arm64` | Windows arm64 |

**Size (measured, `darwin-arm64` v0.3.195):** `unpackedSize: 224,683,224` bytes ≈ **225 MB**, 4 files. npm installs only the one matching the host platform (it is an `optionalDependency` with `os`/`cpu` constraints), so a single-platform install is ~3.5 MB main + ~225 MB native binary + peer deps.

**Peer dependencies** (must be supplied by the consumer):
- `zod` `^4.0.0`
- `@anthropic-ai/sdk` `>=0.93.0` (the standard Anthropic SDK; latest is `0.106.0`)
- `@modelcontextprotocol/sdk` `^1.29.0`

For comparison, the standalone `@anthropic-ai/claude-code` CLI npm package is also at `2.1.195` with `engines.node >=18.0.0` and `bin: { claude: 'bin/claude.exe' }` — i.e. the Agent SDK and the `claude` CLI are the same engine at the same version, one shipped as a library + native binary, the other as a CLI.

### Runtime requirements — CANNOT run in a webview

- Requires **Node.js ≥ 18** (an actual Node runtime — not a browser JS engine).
- Loads a **native binary** (the Claude Code engine) matched to the OS/arch triple. A Tauri webview has no Node and cannot load native `.node`/native addons or spawn child processes.
- The agent's built-in tools (bash, file read/write/edit) need a real filesystem and `child_process` — none of which exist in a renderer/webview sandbox.
- The `./browser` export is a **browser-safe build**, but it is not the full agent runtime: the full agent loop, tool execution, and native engine live server-/Node-side. A browser build can at most act as a transport client to a Node/host backend. **Confirmed: the full Agent SDK cannot run inside the Tauri renderer.** It must run in a Node process (sidecar) or a host that owns a Node runtime.

### Programmatic API (TypeScript)

The TS SDK exposes a `query()` function (async generator) that streams `SDKMessage` objects. Shape (from package docs / training knowledge of the `0.x` surface — verify exact field names against the installed `sdk.d.ts` before writing code):

```ts
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";

const stream = query({
  prompt: "Fix the failing tests",
  options: {
    cwd: "/path/to/repo",          // working directory for tools
    model: "claude-opus-4-8",      // optional model override
    permissionMode: "bypassPermissions", // or "default" / "plan" / "acceptEdits"
    allowedTools: ["Read", "Write", "Edit", "Bash", "Grep", "Glob"],
    disallowedTools: [],
    maxTurns: 50,
    resume: "<session-id>",        // resume a prior session
    continue: true,                // continue most recent session
    env: { ... },                  // env vars for the agent + tools
    // Optional callbacks for streaming events:
    canUseTool: async (toolName, input) => "allow" | "deny" | { behavior, message },
  },
});

for await (const message of stream) {
  // message: SDKMessage — see streaming section
}
```

> ⚠️ **Caveat:** exact option/field names (`permissionMode`, `allowedTools`, `maxTurns`, `resume` vs `sessionId`) drift across `0.x` releases. The package has had **195+ patch releases** since Sep 2025 and is still pre-`1.0`. Before depending on a field name, read the installed `sdk.d.ts` (the `./sdk-tools` subpath also exports tool types). Treat the API as unstable.

### Streaming — message shape

`query()` yields an async iterable of **`SDKMessage`** objects. The message types mirror the `claude` CLI's `stream-json` output that this repo's `ClaudeAdapter` already parses (see `packages/cli-adapter/src/claudeAdapter.ts`):

| `type` | What it carries |
|---|---|
| `system` | Init/meta, including `session_id` (subtype `init`) |
| `assistant` | `message.content[]` blocks: `text`, `thinking`, `tool_use` |
| `user` | `message.content[]` containing `tool_result` blocks |
| `result` | Final result of the turn (`result` string, `is_error`, `session_id`, `usage`) |
| `stream-event` | Lower-level streaming deltas (text deltas, `input_json_delta` for tool args) |

Content block shapes are the same as the standard Anthropic Messages API:
- `text` block → `{ type: "text", text: "..." }`
- `thinking` block → `{ type: "thinking", thinking: "..." }`
- `tool_use` block → `{ type: "tool_use", id, name, input }`
- `tool_result` block → `{ type: "tool_result", tool_use_id, content, is_error? }`

**Mapping onto our repo:** the existing `ClaudeAdapter.processEvent()` (claudeAdapter.ts:139–208) already parses this exact `system`/`assistant`/`user`/`result` shape from the CLI's `--output-format stream-json`. The Agent SDK emits the **same message types as native JS objects** rather than NDJSON lines, so an adapter wrapping the SDK would replace `handleStdoutLine` (JSON.parse) with a direct `for await (const msg of stream)` loop and call the same `processEvent(msg)` — the event-to-`CliStreamEvent` mapping (`text`/`thinking`/`tool_start`/`tool_end`/`session_id`/`error`/`done`) stays essentially identical.

### Tool use + file editing

The SDK ships with the **full Claude Code built-in toolset** (the same tools the `claude` CLI exposes):
- `Read`, `Write`, `Edit` (str-replace), `Glob`, `Grep` — file read/write/search against the `cwd`.
- `Bash` — shell command execution (spawns a child process).
- `WebSearch` / `WebFetch` — web tools.
- MCP server tools — configurable via `mcpServers` option.
- Custom user-defined tools — via `canUseTool` callback / tool definitions.

These run against the `cwd` working directory and operate on the real filesystem. The `write`/`edit` tools are exactly what the current `ClaudeAdapter.handleToolUse()` (claudeAdapter.ts:210–252) already snapshots (it watches `write`/`edit`/`write_file`/`edit_file` tool names). With the SDK, file changes can additionally be observed directly from the tool-result content rather than only by re-reading the file from disk.

### Session / resume

- `options.resume: "<session-id>"` resumes a specific prior session (the CLI's `--resume <id>`).
- `options.continue: true` continues the most recent session (the CLI's `--continue`).
- The `system` init message and the `result` message both carry `session_id`, matching what `ClaudeAdapter` already captures into `this.sessionId` (claudeAdapter.ts:140–143) and emits as `{ type: 'session_id', sessionId }`.

### Auth — CRITICAL

The Agent SDK resolves credentials using the **same chain as the `claude` CLI and the `ant` CLI**. Per the claude-api skill's `anthropic-cli.md` doc: *"Claude Code and the Claude Agent SDK honor the same profile resolution."* The precedence (first match wins):

1. Explicit API key passed to the SDK / `ANTHROPIC_API_KEY` env var — **Anthropic API key, pay-per-token**.
2. `ANTHROPIC_AUTH_TOKEN` env var — an OAuth bearer token (e.g. from `ant auth print-credentials --access-token`).
3. The `ANTHROPIC_PROFILE`-selected (or active) **OAuth profile on disk** — the same interactive-login subscription credential the `claude` CLI uses (Pro/Max subscription). Stored under `~/.config/anthropic/` (Linux/macOS) or `%APPDATA%\Anthropic` (Windows) as `credentials/<profile>.json`.
4. Workload Identity Federation env vars (`ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID`, `ANTHROPIC_SERVICE_ACCOUNT_ID`, `ANTHROPIC_IDENTITY_TOKEN_FILE`).
5. The default profile on disk.

**Subscription OAuth IS supported** — this is the headline. A user logged into the `claude` CLI via their Pro/Max subscription (`claude /login`) has an OAuth profile on disk; the Agent SDK picks it up automatically with no API key required. See `research/auth-and-billing-impact.md` for the billing implications.

**Bedrock / Vertex:** the underlying engine supports `CLAUDE_CODE_USE_BEDROCK=1` / `CLAUDE_CODE_USE_VERTEX=1` env vars (plus region/project config) to route through Amazon Bedrock or Google Vertex AI, same as the CLI. Not the default path.

**Foot-gun (from the skill):** a stale exported `ANTHROPIC_API_KEY` (even set to `""`) silently overrides every profile — the SDK would then authenticate with an empty/legacy key instead of the subscription. Before relying on subscription auth, ensure `ANTHROPIC_API_KEY` is truly unset.

## External References

- npm registry: `https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk` (metadata fetched 2026-06-28)
- GitHub: `https://github.com/anthropics/claude-agent-sdk-typescript`
- Python equivalent: `claude-agent-sdk` on PyPI (same engine, Python `query()` async generator)
- Auth/profile resolution: claude-api skill → `shared/anthropic-cli.md` (states "Claude Code and the Claude Agent SDK honor the same profile resolution")
- Standard SDK auth precedence & WIF: claude-api skill → SKILL.md §Workload Identity Federation

## Caveats / Not Found

- **README content could not be fetched** (raw GitHub fetch and `npm view readme` both blocked by the environment). The `query()` option/field names above are from training knowledge of the `0.x` API and the npm package description; **verify against the installed `sdk.d.ts` before writing adapter code.** The package is pre-`1.0` with 195+ releases — names drift.
- Exact `SDKMessage` discriminated-union field names should be confirmed from `sdk.d.ts` at the pinned version.
- The `./browser` subpath's capabilities were not verified — it is almost certainly a transport client, not a full agent; do not assume the agent loop can run in a browser.
- Native binary license terms for redistribution inside a Tauri bundle are in `README.md` ("SEE LICENSE IN README.md") — could not be read here; check before bundling.
