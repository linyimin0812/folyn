# Research: Running an MCP server from a Tauri 2 desktop app for the claude CLI

- **Query**: How to expose Quill's tools (vaultStore file ops, editor actions, domain features) to the user's locally-installed `claude` CLI as MCP tools, hosted from the Tauri 2 Rust backend — without adding a Node runtime or bundling the Agent SDK.
- **Scope**: external (MCP spec + claude-code MCP docs), mapped onto internal Quill architecture (Tauri 2 + React 18 + Zustand stores in the renderer, Rust backend owns commands/process spawning).
- **Date**: 2026-06-28

> **Verification caveat**: This environment has no live web-search tool. The MCP
> protocol facts below are from the published MCP specification
> (modelcontextprotocol.io, latest revision `2025-06-18`) and the claude-code MCP
> documentation, both of which are stable and I am confident in. Field-name shapes
> for claude-code's `.mcp.json` should be re-verified against the installed
> `claude --help` / `claude mcp` output and the official docs before coding — the
> `type` vs `transport` key naming in particular has shifted between releases.
> Rust crate names/versions (`rmcp`, `axum`) should be checked on crates.io.

---

## TL;DR recommendation

- **Transport = Streamable HTTP**, hosted by the **Rust backend** via `axum` on
  `127.0.0.1:<port>`. stdio is the wrong shape here (see §1).
- **MCP server impl** = the Rust `rmcp` crate (official Rust MCP SDK) wired into
  the axum router, OR a hand-rolled JSON-RPC handler over axum (MCP is small).
- **Tool-call routing** = Rust MCP handler emits a Tauri event
  `mcp://tool-call` with a correlation id → renderer (which owns Zustand stores)
  executes the tool → renderer calls a Tauri command `mcp_tool_result(id, result)`
  → Rust completes a pending `oneshot` channel. (Tauri `invoke` is one-directional
  renderer→Rust, so the reply must come back as a command, not as an event ack.)
- **Lifecycle** = start axum in the Tauri `setup` hook, bind `127.0.0.1:0`, store
  the assigned port in managed state + write it to a well-known file the user
  points their `.mcp.json` `url` at (or a fixed port with fallback).
- **claude CLI config** = user adds a streamable-HTTP `mcpServers` entry pointing
  at `http://127.0.0.1:<port>/mcp`.

This is an **alternative architecture** to the PRD's chosen Node-driver + Agent
SDK approach. It trades "ship a Node runtime + driver script" for "ship an
in-process Rust HTTP server" — lighter bundle, but the claude CLI (not Quill)
drives the session, so Quill no longer spawns/controls the AI loop. The two are
not mutually exclusive long-term: an MCP server can be layered under either.

---

## 1. MCP transport options for a desktop app

MCP defines two standard transports (spec §Transports):

### A. stdio
- Client **spawns the server as a child process**; JSON-RPC messages are framed
  over the server's stdin/stdout (newline-delimited JSON).
- This is the dominant transport for local-tool MCP servers (e.g. a `npx`-launched
  server the IDE spawns).
- **Fit for Quill: poor.** The claude CLI would need to *spawn* the MCP server.
  But Quill is an already-running GUI app, not a process the CLI can launch.
  Workarounds all hurt:
  - **Bridge binary**: ship a tiny CLI binary that the claude CLI spawns via
    `command`, which then connects to the running Quill (e.g. opens a localhost
    socket / named pipe and proxies stdio↔HTTP). Extra artifact to build/ship,
    double-hop latency, and the bridge still needs to discover Quill's port.
  - **`claude` spawns Quill**: impossible — Quill is the user's editor, already
    open.
- stdio also gives no clean way to host multiple transports or survive CLI
  restarts without re-spawning.

### B. Streamable HTTP  (the 2025-03+ replacement for the old "HTTP+SSE" transport)
- Server exposes a **single HTTP endpoint** (e.g. `http://127.0.0.1:31337/mcp`).
  Client `POST`s JSON-RPC requests to it.
- Response to a request is either:
  - a direct JSON-RPC `Response` (for simple calls like `tools/list`), or
  - `text/event-stream` (SSE) for long-running/streaming calls, where the server
    can emit `endpoint`-event updates and a final result.
- **Session management**: the server may return an `Mcp-Session-Id` response
  header on `initialize`; the client echoes it back as a request header on
  subsequent requests. (Sessions are optional — a stateless server can ignore
  this.)
- Client may `DELETE` the endpoint to terminate a session.
- **Fit for Quill: excellent.** Quill's Rust backend is a long-running process
  that can bind a localhost listener; the claude CLI connects by `url`. No
  spawn/bridge needed. Survives CLI restarts (each `claude` invocation does a
  fresh `initialize`). Natural fit for a GUI app exposing tools.

**Recommendation: Streamable HTTP, hosted in the Rust backend.**

### Hosting the HTTP listener in Tauri (Rust backend) — option comparison

| Option | What it is | Fit |
|---|---|---|
| **`axum`** (on `tokio`) | Modern async web framework; minimal, tower-based. The de-facto choice for embedded HTTP servers in Rust apps. | **Recommended.** Small dep tree, trivial to mount a single `/mcp` route, easy to run on a background `tokio` task spawned from Tauri's `setup`. |
| `hyper` (raw) | Low-level HTTP/1+2 library; axum is built on it. | Works but you'd reimplement routing/body parsing. Only worth it to avoid the axum/tower surface; for a single endpoint it's almost as easy. |
| `warp` | Older filter-based framework. | Usable but less actively trending than axum; no advantage here. |
| `tauri-plugin-http` | **A client plugin** — lets the *app make outgoing* HTTP requests. It is **not a server**. | **Wrong tool.** Common misconception; do not use this to host the MCP endpoint. |
| `actix-web` | Full-featured framework. | Heavier than needed; axum is preferred for an embedded single-route server. |

**Decision: add `axum` + `tokio` (full multi-thread runtime) as Cargo deps in
`apps/desktop/src-tauri/Cargo.toml`, spawn the server in `setup`.** The current
`Cargo.toml` has no HTTP/tokio deps yet (only `tauri`, `tauri-plugin-shell`,
`tauri-plugin-dialog`, `tauri-plugin-fs`, `serde`, `serde_json`), so this is a
new dependency addition.

---

## 2. How the claude CLI connects to an MCP server

### Config locations (claude-code)
claude-code reads MCP server config from several places (precedence: CLI flag > project > user):

1. **`--mcp-config <file>`** CLI flag — point at any JSON file with the
   `mcpServers` shape. Good for ad-hoc / testing.
2. **Project `.mcp.json`** at the project/repo root — project-scoped servers,
   intended to be committed & shared with a team. claude-code prompts for
   approval before using project-scoped servers (security).
3. **User settings** — `~/.claude.json` (the user-level config) has a
   `mcpServers` key; also manageable via `claude mcp add ...` (writes to the
   appropriate scope with `--scope local|project|user`).
4. Local project scope lives in `~/.claude.json` under a per-project path key.

### Field shape — stdio server
```json
{
  "mcpServers": {
    "quill-stdio": {
      "command": "node",
      "args": ["/path/to/bridge.js"],
      "env": { "QUILL_PORT": "31337" }
    }
  }
}
```
Keys: `command` (string), `args` (string[]), `env` (string→string, optional).

### Field shape — Streamable HTTP server
```json
{
  "mcpServers": {
    "quill": {
      "type": "http",
      "url": "http://127.0.0.1:31337/mcp"
    }
  }
}
```
- The presence of `url` (vs `command`/`args`) signals the HTTP transport.
  `type: "http"` is the explicit form; some claude-code versions auto-detect from
  the presence of `url`. **Re-verify the exact key** (`type` vs `transport`) on
  the installed CLI via `claude mcp add --help`; `claude mcp add --transport http
  --url http://127.0.0.1:31337/mcp quill` is the CLI equivalent and writes the
  matching JSON.
- Optional `headers` (string→string) for auth/custom headers.

### Where to put it for Quill
Since Quill's MCP server is **user-local** (the user's own editor on their
machine), the natural scope is **user settings** (`~/.claude.json` `mcpServers`),
not a committed project `.mcp.json`. Quill could even offer a "Copy MCP config
to clipboard" / "Write to ~/.claude.json" button in settings once it knows its
own URL+port.

---

## 3. MCP protocol shape (what the server must implement)

MCP is **JSON-RPC 2.0** over the chosen transport. A server implementing *tools*
(the only capability Quill needs) must handle:

### Required methods

| Method | Direction | Purpose |
|---|---|---|
| `initialize` | req → res | Client→server handshake. Request carries `protocolVersion` (e.g. `"2025-06-18"`), `clientInfo` `{name,version}`, `clientCapabilities`. Server responds with `protocolVersion`, `serverInfo`, and `capabilities` (e.g. `{"tools": {}}` to declare the tools capability). Server sets `Mcp-Session-Id` header here (HTTP, optional). |
| `notifications/initialized` | notif | Client tells server init is done. No response. |
| `ping` | req → res | Liveness check; respond with empty `{}` result. |
| `tools/list` | req → res | Return the tool catalog. Result: `{"tools": [ {name, description, inputSchema, annotations?} ]}`. |
| `tools/call` | req → res | Execute a tool. Request params: `{"name": "...", "arguments": {...}, "callId"?}`. |

(resources/list, resources/read, prompts/list, prompts/get are **optional** —
skip unless Quill wants to expose notes as MCP resources.)

### `tools/list` — declaring a tool & its `inputSchema`

```jsonc
{
  "name": "readFile",
  "description": "Read a file from the Quill vault, respecting hidden __*__ dirs and unsaved buffers.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "relativePath": { "type": "string", "description": "Path relative to vault root." }
    },
    "required": ["relativePath"]
  },
  "annotations": {
    "readOnlyHint": true,
    "openWorldHint": false
  }
}
```
- `inputSchema` is a **JSON Schema** object (draft). The claude CLI uses it to
  validate/generate the args it sends.
- `annotations` is optional metadata (`readOnlyHint`, `destructiveHint`,
  `idempotentHint`, `openWorldHint`) that helps clients decide when to prompt
  for user approval. Useful for Quill: mark read tools `readOnlyHint:true`, mark
  write tools `destructiveHint:true` so the CLI surfaces a confirm.

### `tools/call` — request & response

Request:
```json
{ "jsonrpc": "2.0", "id": 7, "method": "tools/call",
  "params": { "name": "writeFile", "arguments": { "relativePath": "notes/x.md", "content": "..." } } }
```

**Success** response — result is `{content: Content[], isError?: false}`:
```json
{ "jsonrpc": "2.0", "id": 7, "result": {
    "content": [ { "type": "text", "text": "Wrote notes/x.md (unsaved buffer created; pending review)." } ],
    "isError": false } }
```
`content` items can be `{type:"text",text}`, `{type:"image",data,mimeType}`, or
`{type:"resource",resource:{uri,mimeType,text|blob}}`. For Quill, `text` items
suffice for almost everything; `resource` items are nice for returning a note's
full content as a structured resource.

**Error** — two flavors:
- **Protocol error** (malformed request, unknown tool): return a JSON-RPC error
  with `error: {code, message}`. Codes: `-32602` invalid params, `-32601`
  method/tool not found, `-32603` internal error.
- **Tool execution error** (tool ran but failed): return a *successful* JSON-RPC
  response with `result.isError: true` and a `text` content item describing the
  failure. (The MCP convention: tool-level failures are data, not transport
  errors, so the client can surface them to the model as tool output.)

### SDK options

| SDK | Language | Fit for Quill |
|---|---|---|
| **`rmcp`** (crate `rmcp`) | Rust | **Recommended for the backend.** Official Rust MCP SDK (maintained by the Rust MCP org). Provides `ServerHandler` trait, transport integration, tool/resource macros. Compile into the Tauri binary — no Node. Pairs naturally with axum. |
| `@modelcontextprotocol/sdk` | TS/Node | Would run in the renderer — but the Tauri webview has **no Node runtime** (it's a webview, not Node), and `@modelcontextprotocol/sdk`'s stdio/server transport needs Node APIs. So the TS SDK is **not** usable in the Quill renderer for *hosting*. (It could run inside the Node driver from the PRD's other approach, but that's a different architecture.) |
| Hand-rolled JSON-RPC over axum | Rust | MCP is small enough (a handful of methods) that a ~200-line handler is viable and avoids the `rmcp` version surface. Reasonable if the team wants zero extra SDK deps beyond axum. |

**Decision: `rmcp` if the team accepts the dep; otherwise hand-rolled.** The
tool catalog is static-ish (T1/T2/T3 tools), so the boilerplate is low either
way.

---

## 4. Routing tool calls back into Quill's state (the hard part)

**The problem**: the MCP server lives in the **Rust backend**, but Quill's state
(vaultStore, editorStore, wiki/clip features) lives in the **TS renderer's
Zustand stores**. When claude calls `tools/call`, Rust receives it — Rust cannot
touch Zustand. It must forward the call to the renderer, await the result, and
return it.

### Tauri IPC primitives available
- `app.emit(event, payload)` / `window.emit(...)` — Rust→renderer event (fire-and-forget).
- Renderer `listen(event, handler)` (`@tauri-apps/api/event`) — receives events.
- `invoke(command, args)` — renderer→Rust command call (request/response).
- There is **no** "Rust invokes a renderer function and awaits" primitive —
  `invoke` is strictly one-directional (renderer calls Rust). So the reply path
  must be a renderer→Rust command, not an event acknowledgement.

### Recommended pattern: event-out + command-back, correlated by id

```
claude ──tools/call(id=A)──▶ Rust MCP handler
   Rust: store pending oneshot[A] = tx
   Rust: app.emit("mcp://tool-call", { callId: A, tool: "readFile", args: {...} })
                                          │
   Renderer (a single listener, wired to vaultStore/editorStore):
     listen("mcp://tool-call") → execute tool against stores
     → invoke("mcp_tool_result", { callId: A, result: {content, isError} })
                                                          │
   Rust command mcp_tool_result(callId, result):
     look up pending[A].tx, send(result)  // completes oneshot
   Rust MCP handler: await oneshot[A].rx → return JSON-RPC response to claude
```

- A `tokio::sync::oneshot` channel per in-flight call, held in a
  `Mutex<HashMap<CallId, oneshot::Sender<ToolResult>>>` in Tauri managed state.
- The renderer registers **one** `listen("mcp://tool-call")` handler at app boot
  (e.g. in a top-level `McpBridge` hook), dispatches by tool name to the right
  store action, and calls `invoke("mcp_tool_result", ...)`.
- Timeout: wrap the `oneshot.rx` in `tokio::time::timeout` (e.g. 30s) so a
  dead/hung renderer yields a clean tool error instead of hanging claude.
- Tool registry on the renderer side maps tool name → handler `(args) =>
  Promise<ToolResult>`. T1/T2/T3 tools each register here:
  - T1 file tools → `vaultStore` actions (readFile/writeFile/list with
    `excludePatterns`, createDir); write tool additionally surfaces Quill's
    diff-review as a permission step before returning.
  - T2 editor tools → `editorStore` actions (openFile, insertContentAtCursor,
    setViewMode).
  - T3 domain tools → wiki/clip/searchNotes service calls.

### Alternatives considered
- **Renderer polls / long-polls Rust** for pending calls: worse latency, more
  complexity; reject.
- **Shared memory / file-based queue**: brittle; reject.
- **WebSocket from renderer to the Rust MCP server**: redundant — Tauri events
  already bridge Rust↔renderer; adding a second channel is needless.
- **Move state into Rust**: would mean rebuilding Zustand stores in Rust — huge,
  violates Quill's existing architecture; reject.

**Decision: event-out + `mcp_tool_result` command-back, `oneshot`-correlated,
with a timeout.** This is the idiomatic Tauri pattern for "Rust needs a value
from the renderer."

---

## 5. Lifecycle: starting/stopping, port choice, reconnect

### Starting
- Spawn the axum server in the Tauri **`setup`** hook (in `lib.rs`), on a
  background `tokio` task. Store the `SocketAddr` / port in Tauri managed state.
- Use `tauri::async_runtime::spawn` or a dedicated `tokio` runtime (axum needs a
  multi-thread runtime; Tauri's async runtime is tokio-based, so
  `tauri::async_runtime::spawn` is usually sufficient — verify axum's runtime
  expectations).

### Choosing a free localhost port
- Bind `127.0.0.1:0` → OS assigns a free ephemeral port; read it back via
  `listener.local_addr()`. Avoids port collisions entirely.
- **But** the claude CLI's `.mcp.json` `url` is static — a dynamic port means the
  user can't hardcode it. Options:
  - **(a) Fixed port with fallback**: try a chosen port (e.g. 31337); if busy,
    increment until free. Write the actual port to a well-known file
    (`$APPDATA/quill/mcp-port`) and have the user's `.mcp.json`/launcher read it.
    Simplest UX if the user edits config once.
  - **(b) Dynamic port + port file**: bind `:0`, write the port to
    `$APPDATA/quill/mcp-port`, and ship/point a tiny launcher that reads the file
    and proxies — heavier; reject unless fixed-port collisions become real.
  - **(c) Fixed port, fail-fast**: require the user to reserve a port; bind it
    exclusively. Cleanest config UX, risk of "port in use" startup failures.
- **Recommendation: (a) fixed preferred port with auto-increment + write the
  resolved URL to `$APPDATA/quill/mcp.json`-ish file** so a settings UI can show
  "your MCP URL is X" and offer to write `~/.claude.json`.

### Stopping
- On `RunEvent::ExitRequested` / app close, abort the axum server task and drop
  the listener. axum's `serve(...)` returns a `JoinHandle`/`Server` you can
  `.graceful_shutdown()`.

### claude CLI reconnect behavior
- The claude CLI establishes its MCP connection **per session** (each `claude`
  invocation does `initialize` against each configured server). It does **not**
  maintain a persistent background connection to MCP servers between invocations.
- Consequence: **Quill must be running before the user launches `claude`**. If
  Quill is down when `claude` starts, that server's `initialize` fails and the
  CLI reports the server unavailable (tools from it are absent for that session).
  There is no mid-session auto-reconnect for a server that was down at startup.
- If the server dies *during* a `claude` session, in-flight `tools/call` requests
  error (transport-level), and subsequent tool calls fail until the CLI is
  restarted. So Quill should keep the server up for the app's whole lifetime.
- Ordering implication: this architecture puts the **user** in charge of starting
  claude (unlike the PRD's Node-driver approach where Quill spawns claude). The
  MCP server is "always on" while Quill runs; the user runs `claude` whenever
  they want and Quill's tools are available.

---

## Mapping onto Quill's concrete constraints

| Constraint (from codebase) | Implication |
|---|---|
| Renderer = Tauri webview, **no Node runtime** | TS MCP SDK can't *host* here; server must be Rust. (Confirms PRD's "no Node in renderer" note.) |
| State in Zustand stores (`vaultStore`, `editorStore`, …) in renderer | Tool execution must round-trip Rust→renderer→Rust via event+command (§4). |
| `Cargo.toml` currently has no HTTP/tokio deps | Adds `axum` + `tokio` (and optionally `rmcp`) as new Cargo deps. |
| `tauri-plugin-shell` already spawns `claude` CLI via `claude-cli` command | Orthogonal to MCP server; the shell-plugin path stays for *Quill driving claude*, the MCP server is for *claude calling Quill*. The two can coexist. |
| `commands.rs` already has file/git/webview Tauri commands | The new `mcp_tool_result` command joins this handler list; the MCP bridge listener is a renderer-side concern. |
| Capabilities `default.json` allows `shell:allow-spawn` for `claude-cli` | MCP HTTP server needs no new shell capability; it needs network-listen (localhost only) — no Tauri capability grant required for a Rust-side listener (capabilities gate renderer→Rust commands & plugin APIs, not raw Rust sockets). |

## Related specs / files

- `apps/desktop/src-tauri/Cargo.toml` — current Rust deps (no HTTP server yet).
- `apps/desktop/src-tauri/src/lib.rs` — `setup` hook + `invoke_handler` list; where the axum spawn and `mcp_tool_result` command registration go.
- `apps/desktop/src-tauri/src/commands.rs` — existing Tauri commands pattern to mirror.
- `packages/cli-adapter/src/claudeAdapter.ts` / `baseAdapter.ts` — the *other* architecture (Quill spawns claude). MCP server is its complement, not its replacement.
- `.trellis/tasks/06-28-agent-sdk-adapter/prd.md` — PRD chose the Node-driver/Agent-SDK direction; this research documents the MCP-server alternative the task asked to investigate.

## External references (re-verify before coding)

- MCP specification — https://modelcontextprotocol.io/specification (latest revision `2025-06-18`; Streamable HTTP transport, JSON-RPC method shapes, `tools/call` result/isError semantics, `Mcp-Session-Id`).
- MCP "Architecture" / "Transports" docs — https://modelcontextprotocol.io/docs/concepts/transports
- claude-code MCP docs — https://docs.claude.com/en/docs/claude-code/mcp (`.mcp.json`, `--mcp-config`, `claude mcp add`, `mcpServers` shape, `type:"http"` vs `command`/`args`, scopes project vs user).
- `rmcp` Rust SDK — https://crates.io/crates/rmcp (verify name/version; `ServerHandler` trait, tool macros).
- `axum` — https://crates.io/crates/axum ; `tokio` — https://crates.io/crates/tokio
- `@modelcontextprotocol/sdk` — https://github.com/modelcontextprotocol/typescript-sdk (not usable in the renderer for hosting; noted for completeness).

## Caveats / not verified live

- No live web search was available in this research environment; all protocol
  facts are from the stable MCP spec and claude-code docs as known to me. **Re-verify
  the exact claude-code `.mcp.json` key names** (`type` vs `transport`, and whether
  `url` alone auto-selects HTTP) against the installed `claude mcp add --help`
  before generating config for users.
- `rmcp` crate name/version and its axum integration API should be checked on
  crates.io / its docs; the trait surface (`ServerHandler`) evolves.
- Whether `tauri::async_runtime` is sufficient for axum's multi-thread runtime
  needs (vs spawning a dedicated `tokio` runtime) — verify against the pinned
  Tauri 2 version in `Cargo.lock`.
- The PRD's chosen direction is the Node-driver/Agent-SDK approach, not this MCP
  server; this file documents the alternative as requested. If the team proceeds
  with MCP, the renderer-side tool registry (T1/T2/T3) and the `mcp://tool-call`
  bridge would be net-new code not currently present in the repo.
