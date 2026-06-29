# Research: Running the Agent SDK as a Tauri 2 Sidecar

- **Query**: How to run a Node.js script (the Claude Agent SDK driver) as a Tauri 2 sidecar, since the renderer webview has no Node. Options, size, cross-platform feasibility, IPC.
- **Scope**: external (Tauri 2 docs + npm metadata) + internal (repo's current shell-plugin approach)
- **Date**: 2026-06-28

## TL;DR

The Tauri renderer has no Node, and the Claude Agent SDK needs Node 18+ plus a ~225 MB native binary (see `research/agent-sdk-runtime-and-api.md`). Four packaging strategies exist. **For this repo — a small desktop app that already requires the user to have the `claude` CLI installed — the most practical path is (b): keep spawning a host `node` (or `claude`) via the Tauri shell plugin, but run a small Node driver script that uses the Agent SDK instead of shelling out to `claude -p`.** This avoids bundling any binary, keeps the install small, and reuses the user's existing Node. If zero-dependency distribution is later required, strategy (c) (`bun build --compile`) is the best compile-to-binary option.

## Findings

### Current architecture (this repo)

`packages/cli-adapter/src/claudeAdapter.ts` does **not** bundle or sidecar anything. It uses `@tauri-apps/plugin-shell`'s `Command.create('claude-cli', ['-l', '-c', shellCmd])` to spawn `/bin/sh` which then `exec`s the user-installed `claude` CLI with `--output-format stream-json`. The `claude-cli` shell command is allowlisted in `apps/desktop/src-tauri/capabilities/default.json` (`shell:allow-spawn` / `shell:allow-execute` with `cmd: "/bin/sh"`, `args: true`). IPC is **NDJSON over the spawned process's stdout** — `command.stdout.on('data', ...)` lines are JSON-parsed into `CliStreamEvent`s. There is no `externalBin`/sidecar in `tauri.conf.json` (`bundle.resources: []`).

This is the pattern to preserve or replace.

### Tauri 2 sidecar / external-binary mechanism

Tauri 2 supports bundling external binaries via the **`externalBin` array** in `tauri.conf.json` `bundle` config. Each entry is a path to a binary; Tauri appends the **target-triple suffix** (e.g. `mybin-x86_64-apple-darwin`, `mybin-aarch64-apple-darwin`, `mybin-x86_64-pc-windows-msvc.exe`, `mybin-x86_64-unknown-linux-gnu`) and bundles the matching one per build target. The binary is then spawned from Rust via `tauri-plugin-shell`'s `Command::new_sidecar("mybin")` or from the renderer via `Command.create('mybin', [...args])` (allowlisted in capabilities). The binary must be present at build time, one file per target triple.

Key constraint: **`externalBin` is for self-contained executables, not `node script.js`.** You can bundle either (a) a standalone executable, or (b) bundle `node` itself and a script as a resource.

### Strategy comparison

| # | Strategy | Bundle size added | Per-platform work | License concerns | Feasibility |
|---|---|---|---|---|---|
| a | Bundle `node` binary itself as a sidecar + ship the SDK driver script + the SDK's native binary as a resource | ~40–70 MB (node) + ~225 MB (Agent SDK native binary) **per platform** | Build/ship node + the SDK's per-platform native pkg for mac/win/linux × glibc/musl | Node is OSI-license-compatible but ~225 MB is huge; SDK native binary license in README (unread) | Cross-platform feasible but **massive** (≈265 MB+ per platform) and fragile (must match SDK native pkg triple to the Tauri target) |
| b | Require user-installed `node` (and `claude` CLI already required); spawn a Node driver script via the shell plugin (like today's `claude` shell-out) | **0 MB** (reuses host node + host SDK install, or `npx`) | None — no bundled binary | None | **Most practical for this repo**; matches current UX (user already must have `claude` installed) |
| c | Compile the SDK driver to a standalone executable via `bun build --compile` / `deno compile` / Node SEA / `pkg`; bundle that one exe as a Tauri sidecar | ~50–90 MB standalone exe (includes a JS runtime) **per platform**; still must ship the SDK's ~225 MB native binary alongside, or have the user provide `claude` | Build the exe per target triple | Bun/Deno compile is allowed; SDK native binary is the catch | Feasible **only if the SDK native binary is also bundled or supplied by the user**; otherwise the exe still needs the engine |
| d | Run the Agent SDK in the **Rust backend** by having Rust own a Node sidecar (Rust spawns `node`, pipes NDJSON) | Same as (a) or (b) depending on whether node is bundled | Rust-side process management | Same as (a)/(b) | Cleanest IPC (Tauri commands), but Rust must manage the child process lifecycle; doesn't remove the node/engine requirement |
| e | Managed Agents (Anthropic-hosted containers) instead of the Agent SDK | 0 MB local; all execution on Anthropic's infra | None | Beta; pay-per-token API | Different billing model (see `research/auth-and-billing-impact.md`); loses local-file working-directory execution |

### Why the SDK native binary dominates the decision

The Agent SDK is not pure JS — it declares platform-specific **optional dependencies** (`@anthropic-ai/claude-agent-sdk-darwin-arm64` etc.) that each ship a **~225 MB native engine** (measured: `unpackedSize: 224,683,224` bytes for `darwin-arm64` v0.3.195; see Topic 1). Any strategy that bundles the SDK must therefore also bundle this ~225 MB native binary **per target triple**, or rely on the user having the `claude` CLI installed (the CLI is the same engine at the same version — `@anthropic-ai/claude-code` is also `2.1.195`).

This makes strategies (a) and (c) **~225–265 MB per platform** — disproportionate for a "small desktop app." It also means bundling the SDK has essentially **no size advantage over bundling the `claude` CLI itself**, because they are the same engine.

### Recommendation for this repo

**Strategy (b) — spawn a host Node driver via the shell plugin.** Rationale:

1. The app **already requires the user to have the `claude` CLI installed** (claudeAdapter.ts:58 `cliPath || 'claude'`). Since the `claude` CLI is itself a Node program (or bundled Node), the user effectively already has Node available — either directly or transitively.
2. The Agent SDK is the **same engine** as the `claude` CLI (`claudeCodeVersion: 2.1.195`). Switching from "shell out to `claude -p`" to "run a Node script that calls `query()`" gives programmatic control (typed messages, `canUseTool` callbacks, no shell-quoting) **without bundling anything new** — provided the user has `node` and the SDK installed, or the app runs the driver via `npx`/a bundled `node_modules`.
3. Zero added install size; no per-platform binary to ship; no license review for redistribution.
4. The driver script can live in the repo (e.g. `packages/cli-adapter/src/sdk-driver.mjs`) and be invoked as `node /path/to/sdk-driver.mjs` through the existing `claude-cli` shell allowlist (already `/bin/sh -lc`).

**Fallback if "user must have node+SDK" is too friction-y:** ship a **precompiled standalone driver via `bun build --compile`** (strategy c) that bundles a JS runtime but **calls the user-installed `claude` CLI's engine** rather than bundling the SDK's native binary — i.e. the driver is a thin orchestrator. This keeps the bundle to ~50 MB and still requires the user's `claude` install. Verify the SDK can target an external engine path before committing.

**Avoid** strategy (a) (bundling `node` + the SDK native binary) unless offline/no-prereq distribution is a hard requirement — the ~225 MB per-platform cost is the same as just bundling the `claude` CLI, which you already require the user to have.

### IPC between renderer and the Node sidecar

| IPC option | How it works | Verdict |
|---|---|---|
| **stdin/stdout NDJSON via shell plugin** (current pattern) | `Command.create('claude-cli', [...]).spawn()`; `stdout.on('data')` lines; write to `stdin` for interrupts. | **Cleanest and already implemented.** The SDK driver just needs to write `SDKMessage` JSON lines to stdout and read control lines from stdin. No Rust changes, no new capabilities. Reuse `ClaudeAdapter`'s `handleStdoutLine`/`processEvent` almost verbatim — only the producer changes (SDK stream → `JSON.stringify(msg)` per line, instead of the CLI's `stream-json`). |
| Tauri commands (Rust owns the sidecar) | Rust spawns the node process with `tauri::api::process::Command` or `tokio::process`, pipes stdio, and exposes `#[tauri::command]`s (`send_prompt`, `cancel`) + `app.emit("agent-event", ...)` for streaming. | More typed/ergonomic, but requires writing Rust process-management code and a new capabilities surface. Worth it only if you want strong typing or the renderer shouldn't own the child process. |
| Local websocket | Node driver opens a WS server; renderer connects via Tauri's HTTP/WS support. | Over-engineered for a single local process; adds a port-allocation/port-forwarding headache. |
| stdio via shell plugin + Tauri events | Same as row 1, but the adapter re-emits events via `app.emit`. | The current `ClaudeAdapter` already does the equivalent (emits `CliStreamEvent` to React). No change needed. |

**Recommendation: keep NDJSON-over-stdio via the shell plugin.** The migration is purely "swap the producer": today the producer is `claude -p --output-format stream-json`; tomorrow it is `node sdk-driver.mjs` that loops `for await (const msg of query({...}))` and writes `JSON.stringify(msg)` + `\n` to stdout. The `ClaudeAdapter` consumer side (parse → `CliStreamEvent`) is reused as-is because the message shapes are the same.

## Related Specs / Repo Files

- `packages/cli-adapter/src/claudeAdapter.ts` — current CLI shell-out adapter; the file a SDK adapter would replace or parallel.
- `packages/cli-adapter/src/types.ts` — `CliAdapter` / `CliStreamEvent` interface the new adapter must satisfy.
- `apps/desktop/src-tauri/capabilities/default.json` — `shell:allow-spawn` / `shell:allow-execute` for `claude-cli` (`/bin/sh`, `args: true`); reusable for `node` if the command name is added.
- `apps/desktop/src-tauri/tauri.conf.json` — `bundle.resources: []`, no `externalBin`; where a sidecar would be declared if strategy (c) is chosen.
- `apps/desktop/src-tauri/Cargo.toml` — already depends on `tauri-plugin-shell = "2"`.

## External References

- Tauri 2 `externalBin` / sidecar: `https://v2.tauri.app/develop/sidecar/` (could not fetch; from training knowledge — verify against current Tauri 2 docs)
- Tauri 2 shell plugin: `https://v2.tauri.app/plugin/shell/`
- `@tauri-apps/plugin-shell` `Command.create`/`spawn` — already used in this repo.
- Bun compile: `https://bun.sh/docs/bundler/executables`
- Agent SDK native binary size: npm metadata for `@anthropic-ai/claude-agent-sdk-darwin-arm64@0.3.195` (fetched 2026-06-28)

## Caveats / Not Found

- Tauri 2 sidecar docs could not be fetched directly (network restricted); the `externalBin` + target-triple-suffix behavior is from training knowledge and matches Tauri 1's mechanism. Verify the exact config key (`bundle.externalBin` vs `app.externalBin`) and target-triple naming against the current Tauri 2 schema before committing to strategy (c).
- Whether the Agent SDK can target an **external** engine path (point at the user's installed `claude` CLI instead of its bundled native binary) was not confirmed from the README. If yes, strategy (c) becomes far cheaper (~50 MB exe only). If no, any local execution path requires either bundling the ~225 MB native binary or relying on the host `claude` install via the CLI (i.e. staying with the current shell-out, or strategy (b) with the SDK calling into the host engine).
- The SDK native binary's redistribution license (`SEE LICENSE IN README.md`) could not be read; check before bundling it in a Tauri sidecar.
