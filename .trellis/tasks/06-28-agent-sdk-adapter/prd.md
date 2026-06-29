# Expose Quill as an MCP server + Claude Code hooks (programmatic AI control)

> **Pivot note (ADR)**: This task started as "replace the claude-CLI shell with the
> Claude Agent SDK". Brainstorm + research showed the Agent SDK requires a Node runtime
> (no Rust binding exists) and the ~225MB engine bundle — incompatible with Quill's
> "no node, no bundle, local claude, programmatic control" constraints. The MCP+CLI-hooks
> approach below satisfies all four. The original SDK research files (`agent-sdk-*`,
> `tauri-sidecar-*`, `auth-and-billing-impact.md`) are retained as historical context
> for the explored-and-rejected path; the MCP/hooks files are authoritative. The
> `auth-and-billing-impact.md` finding (subscription-transparent, never inject
> `ANTHROPIC_API_KEY`) still applies.

## Goal

Give the AI in Quill **programmatic control** — custom tools + pre-approval hooks —
WITHOUT adding a Node runtime or bundling the Agent SDK. Expose Quill's file/editor/domain
operations as **MCP tools** the locally-installed `claude` CLI (Claude Code) can call, and
use Claude Code's native **PreToolUse hooks** to route file-write proposals through
Quill's existing diff-review UI before they apply. Quill still spawns `claude` via the
existing shell plugin (now with MCP + hooks config); the `BaseCliAdapter` contract +
all AI consumers stay unchanged.

## What I already know

- `packages/cli-adapter/src/claudeAdapter.ts` — current adapter spawns `claude` via `@tauri-apps/plugin-shell`, runs `--permission-mode bypassPermissions` (line ~64), parses NDJSON, and does **post-hoc** file diffing (lines ~210–292). The hooks approach **replaces** both: drop `bypassPermissions`, replace post-hoc diff with a PreToolUse hook.
- `BaseCliAdapter` contract (`start/send/stop/onEvent` + `CliStreamEvent`) — keep; consumers (AiPanel, clipService, wikiIngestService, githubAnalysisService, DailyDigest, WebViewer) unchanged.
- Quill = Tauri 2 (Rust backend `apps/desktop/src-tauri`) + React 18 renderer. Renderer holds Zustand state (`vaultStore`, `editorStore`, etc.); Rust owns Tauri commands + process spawn. `invoke` is renderer→Rust only.
- `apps/desktop/src-tauri/Cargo.toml` currently has **no** HTTP server deps.
- `tauri-plugin-http` is a CLIENT plugin — cannot host a server.

## Research References (authoritative)

* [`research/mcp-server-in-tauri.md`](research/mcp-server-in-tauri.md) — Streamable HTTP MCP hosted by Rust (`axum`) over stdio (stdio is the wrong shape — claude would have to spawn an already-running GUI app); `.mcp.json` field shapes (stdio `command`/`args` vs HTTP `url`/`type`); JSON-RPC methods (`initialize`/`tools/list`/`tools/call` + `isError` + `inputSchema`); SDK choice (`rmcp` Rust crate vs hand-rolled); Rust→renderer routing (Tauri `emit` w/ correlation id → renderer executes → `mcp_tool_result` Tauri command → `oneshot`); lifecycle (start axum in `setup`, bind `127.0.0.1:0`, write URL to `$APPDATA`, claude connects per-session, no mid-session reconnect → Quill must run first).
* [`research/claude-cli-hooks.md`](research/claude-cli-hooks.md) — Claude Code `PreToolUse`/`PostToolUse` hooks: settings.json `hooks` schema (matcher for `Write`/`Edit`/`MultiEdit`), stdin JSON (session_id, tool_name, tool_input), exit-code/JSON-output protocol (`permissionDecision: allow/deny/ask`), the bridge-to-Quill architecture (hook subprocess POSTs to Quill's localhost HTTP), config isolation via `CLAUDE_CONFIG_DIR`, and the `tool_input` contents for Write/Edit/MultiEdit (enough for diffing).

## Open Technical Unknowns (verify in PR1 against the installed `claude`)

- `.mcp.json` exact key naming for HTTP servers (`type` vs `transport`, whether `url` alone suffices).
- The hooks JSON `permissionDecision` output protocol; the `--settings` flag; `CLAUDE_CONFIG_DIR` env var; exact `tool_input` field names (`content` vs `file_text` for Write). (Research flagged these `[VERSION-DEPENDENT]`/`[UNVERIFIED]` — no live web access during research.)
- Whether a hook `deny` overrides `--permission-mode bypassPermissions` (if not, bypassPermissions must be dropped — which we're doing anyway).
- The hook-handler subprocess: must be a real executable Quill ships (a tiny Rust bridge binary bundled as a Tauri resource/sidecar — no node). Decide in PR2 whether to ship a bridge binary or use a `curl`-one-liner `command` (fragile — prefer the bridge binary).

## Decision (ADR-lite)

**Context**: Wanted programmatic AI control (custom tools/hooks/permissions). The Agent SDK path needs Node + a 225MB engine bundle (no Rust binding) — incompatible with Quill's constraints. MCP+CLI-hooks delivers the same control using the already-installed `claude` CLI, with zero new runtime.

**Decision**:
- **Quill's Rust backend hosts a localhost HTTP server (axum)** serving two roles: (1) the **MCP JSON-RPC endpoint** exposing Quill tools, (2) the **hook-bridge endpoint** that PreToolUse hook subprocesses POST to for diff-review approval.
- **Quill still spawns `claude`** via the existing shell plugin, but now with `--mcp-config` (pointing at Quill's HTTP MCP server URL) + a `CLAUDE_CONFIG_DIR` containing the `PreToolUse` hooks settings (Write/Edit/MultiEdit → bridge command → POSTs to Quill). No pollution of the user's global claude config.
- **Drop `--permission-mode bypassPermissions`** and the post-hoc diffing in `ClaudeAdapter`; replace with the PreToolUse hook → Quill diff-review UI → allow/deny.
- **Custom tools (full T1+T2+T3)** exposed via MCP:
  - T1: `read_file`/`write_file`/`list_files`/`edit_file`/`create_dir` routed through `vaultStore` (respect `excludePatterns`/`__*__`, refresh tree, unsaved-buffer-safe). (Note: T1 file-write via MCP tool would bypass the PreToolUse hook since it's not a Write/Edit *tool call* the hook matches — resolve in PR3: either the MCP write tool itself shows the diff-review before applying, or route writes through the same approval path. The claude CLI's built-in Write/Edit tools hit the hook; Quill's MCP write tool is a separate path and must implement its own pre-approval.)
  - T2: `open_file`/`insert_content_at_cursor`/`set_view_mode` (editor actions via `editorStore`).
  - T3: `wiki_query`/`clip`/`search_notes` (Quill domain features).
- **Routing**: Rust MCP server / hook-bridge → Tauri `emit` (correlation id) → renderer executes against stores → `mcp_tool_result` / `hook_decision` Tauri command back → `oneshot` completes.
- **Auth**: subscription-transparent (unchanged from today — claude CLI uses the user's subscription); never inject `ANTHROPIC_API_KEY`.
- **No node, no Agent SDK, no ~225MB bundle.** New Rust deps: `axum` + `tokio` (optionally `rmcp`).

**Consequences**:
- + Programmatic tools + pre-approval hooks — the stated motivation — via the existing CLI, no new runtime.
- + Subscription billing unchanged; `BaseCliAdapter` contract + consumers unchanged.
- − New Rust HTTP server + Rust↔renderer IPC surface (axum, tokio, oneshot channels) — net-new backend code.
- − Must drop `bypassPermissions` + replace the working post-hoc diff with the hook flow (behavior change; verify diff-review UX stays equivalent).
- − A tiny hook-bridge executable must ship (Tauri resource) — small but real.
- − Several claude-CLI config details are version-dependent (see Open Unknowns) — PR1 verifies against the installed CLI.

## Requirements

- A localhost HTTP server in the Rust backend (axum) exposing the MCP JSON-RPC endpoint + the hook-bridge endpoint; started in Tauri `setup`, bound to `127.0.0.1` (OS-assigned port written to `$APPDATA` so the spawned claude + hook bridge can find it).
- `ClaudeAdapter` spawns `claude` with `--mcp-config` (Quill's MCP URL) + `CLAUDE_CONFIG_DIR` (PreToolUse hooks for Write/Edit/MultiEdit → bridge binary → POST to Quill). Drop `bypassPermissions`; drop post-hoc diffing.
- MCP tools T1/T2/T3 routed Rust→renderer→stores; T1 writes pre-approved via the diff-review UI (the MCP write tool itself triggers review, since it isn't matched by the Write/Edit hook).
- PreToolUse hook bridge: claude's Write/Edit/MultiEdit → bridge binary → POST to Quill → diff-review UI → allow/deny → bridge exits with the right code/JSON.
- Subscription auth preserved; no `ANTHROPIC_API_KEY` injection.

## Acceptance Criteria

- [ ] PR1: axum HTTP server starts in `setup`; `initialize`/`tools/list` (empty)/`tools/call` JSON-RPC works; Rust→renderer routing (emit + oneshot + `mcp_tool_result` command) verified; claude spawned with `--mcp-config` connects and lists the (empty) toolset. The Open Unknowns (`.mcp.json` keys, `CLAUDE_CONFIG_DIR`, hook protocol fields) verified against the installed `claude`.
- [ ] AI panel chat still streams text + thinking + tool calls (NDJSON parsing unchanged).
- [ ] All existing AI features work through `adapterManager` unchanged.
- [ ] T1: MCP file tools route through `vaultStore` (tree refreshes, `__*__` hidden, unsaved-buffer-safe); MCP write tool triggers the diff-review UI before applying.
- [ ] PreToolUse hook: claude's Write/Edit/MultiEdit → Quill diff-review UI → allow/deny honored by claude (file applies on allow, blocked on deny).
- [ ] `--permission-mode bypassPermissions` removed; post-hoc diffing removed.
- [ ] T2: `open_file`/`insert_content_at_cursor`/`set_view_mode` tools drive the editor.
- [ ] T3: `wiki_query`/`clip`/`search_notes` tools invoke the Quill features.
- [ ] No node runtime, no Agent SDK, no ~225MB bundle; only new Rust deps (`axum`/`tokio`).
- [ ] Config isolation: user's global claude config untouched (Quill uses `CLAUDE_CONFIG_DIR` + project `--mcp-config`).
- [ ] Tests: MCP JSON-RPC handler, Rust↔renderer routing, hook-bridge allow/deny, tool routing. tsc + `cargo check` + build green.

## Definition of Done

- Tests added (MCP handler, routing, hook bridge, tool routing).
- `cargo check` + tsc + build green.
- Packaging: axum server + hook-bridge binary ship as part of the Tauri app (no external runtime).
- Auth: documented subscription-transparent; `ANTHROPIC_API_KEY` non-injection documented.
- Open Unknowns resolved against the installed `claude` (documented in PR1).

## Out of Scope (explicit)

- The Claude Agent SDK / Node driver / bundled-engine packaging (explored + rejected — see ADR).
- Bundling the `node` runtime or a compiled standalone driver.
- Exposing MCP resources/subscriptions (tools only for MVP).
- Letting an externally-launched `claude` (not spawned by Quill) connect to Quill's MCP server (Quill spawns its own claude with config; user-launched claude is a future enhancement).
- Retrofitting the SDK's skills/managed-agents surfaces.
- Migrating adapter tests out of `packages/cli-adapter`.

## Implementation Plan (small PRs)

- **PR1 — Rust HTTP server + MCP skeleton + routing + verify unknowns**: add `axum`+`tokio` to `Cargo.toml`; HTTP server in `setup` bound to `127.0.0.1:0`; implement `initialize`/`tools/list` (empty)/`tools/call` JSON-RPC; Rust→renderer routing (Tauri `emit` w/ correlation id + `mcp_tool_result` command + `oneshot`); write URL to `$APPDATA`; spawn `claude` with `--mcp-config` and verify it connects + lists empty tools. **Verify all Open Unknowns** against the installed `claude` (`.mcp.json` keys, `CLAUDE_CONFIG_DIR`, hook protocol, `tool_input` fields) — document findings; if a core mechanism is unsupported, stop + revisit.
- **PR2 — PreToolUse hook + diff-review + drop bypassPermissions**: ship the hook-bridge binary (tiny Rust, Tauri resource); implement the hook-bridge HTTP endpoint + renderer diff-review flow (reuse the existing diff UI); write `CLAUDE_CONFIG_DIR` hooks settings (Write/Edit/MultiEdit matcher → bridge); drop `--permission-mode bypassPermissions` + post-hoc diffing in `ClaudeAdapter`. Tests for allow/deny.
- **PR3 — T1 MCP file tools**: `read_file`/`write_file`/`list_files`/`edit_file`/`create_dir` routed through `vaultStore`; the MCP write tool triggers the same diff-review before applying (since it isn't matched by the Write/Edit hook). Tests for routing + buffer safety + `__*__` exclusion.
- **PR4 — T2 + T3 tools + polish**: `open_file`/`insert_content_at_cursor`/`set_view_mode` + `wiki_query`/`clip`/`search_notes`; lifecycle polish (server start/stop, port fallback); final tests + `cargo check`/tsc/build.

## Technical Notes

- `packages/cli-adapter/src/claudeAdapter.ts:64` (`bypassPermissions`) + `:210–292` (post-hoc diff) — removed in PR2.
- `apps/desktop/src-tauri/src/{commands,lib,main}.rs` + `Cargo.toml` — add axum server + routing.
- `apps/desktop/src/components/ai/adapterManager.ts` — consumer; unchanged.
- `apps/desktop/src/store/{vaultStore,editorStore,...}.ts` — MCP tool handlers call into these via the renderer routing.
- Existing diff-review UI (`DiffView`/`ReviewItemList`/`DiffReviewBar`/`aiFileChangeActions`) — reused by the hook flow.
- `research/mcp-server-in-tauri.md` + `research/claude-cli-hooks.md` — authoritative design refs.
