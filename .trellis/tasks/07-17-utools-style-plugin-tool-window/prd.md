# utools-style plugin tool window

## Goal

Enable Quill plugins to contribute **their own full-page UI** (like uTools' full-window tools), so plugin authors can build self-contained mini-apps (image viewer, color picker, clipboard manager, etc.) inside Quill — not just markdown directives or commands.

## What I already know

- Manifest types already exist in `packages/plugin-host/src/types.ts`:
  - `ToolContribution` — `{ id, title, icon, window: boolean, entry }`. `window: true` = own window, `window: false` = inline panel. `entry` is "HTML for sandbox, component for trusted".
  - `FeatureContribution` — `{ id, panel: 'left'|'right'|'bottom', component }`. Side-panel UI.
- Current adapters (`apps/desktop/src/services/plugin-host/contributionAdapters.ts`) implement only `commands`, `fileTypes`, `containers`. **No `registerPluginTools` / `registerPluginFeatures` adapter exists yet** — the `tools` contribution in manifests is currently inert.
- Trusted tier loads via blob-URL `import()` (`trustedLoader.ts:90-92`); sandbox tier uses `sandboxLoader.ts` (iframe + postMessage RPC via `quill-plugin://localhost` origin).
- `examples/plugins/hello-tool/` already declares a `tools` contribution (`{ id: "hello", title: "Hello Tool", window: true, entry: "index.html" }`) but it's not wired — proves the manifest shape is settled, this task just delivers the runtime.
- `examples/plugins/markdown-todo/` only uses containers + commands.
- Rust-side `quill-plugin://` URI scheme handler exists in `apps/desktop/src-tauri/src/plugin_commands.rs` — serves static HTML/JS/CSS from `~/.quill/plugins/<id>/`. Path-traversal hardened. **No `/rpc` POST endpoint yet** — this task adds it.
- `PluginPermissions` type in `packages/plugin-host/src/types.ts:89-96` already covers `fs`, `http`, `clipboard`, `dialog`, `window`, `vault: { readActive, insertContent }` — sufficient for MVP, no manifest schema changes needed.
- Prior research exists: `.trellis/tasks/archive/2026-07/07-08-microkernel-plugin-architecture/research/utool-plugin-model.md` covers uTools' manifest, packaging, preload, isolation model.
- `docs/plugin-development.md` already documents `tools` contribution (lines 205-213) — schema is settled; docs note `window: true` opens "its own visible iframe window (sandbox) / webview (trusted)" — but only the iframe path is implemented. This task delivers the webview path.

## Assumptions (temporary)

- "Like uTools" means: plugin contributes a full-window UI triggered by a command / keyword / entry in some launcher; the UI is the plugin's own React component (trusted) or HTML page (sandbox).
- MVP focuses on the **trusted tier** (React component) because that's the simplest path to a working demo; sandbox tier (iframe HTML) is follow-up.
- `ToolContribution` is the right contribution point (matches uTools "feature" most closely); `FeatureContribution` (side panels) is a secondary, smaller follow-up.

## Decision (ADR-lite) — Q1

**Context**: Plugin tool needs an activation surface + window model.
**Decision**: Command-palette trigger + dedicated Tauri `WebviewWindow` per activation (user-chosen option 2).
**Consequences**:
- New OS window = new webview realm; main webview's blob-URL module cache is NOT shared.
- Must re-fetch + re-import the plugin bundle inside the new webview, OR load a plugin-provided HTML (sandbox tier only).
- Cross-window state/calls go via Tauri webview RPC or `@tauri-apps/api/event` (emit/listen), not Zustand direct access.
- Caps: the new webview must be granted plugin-host + fs capabilities (separate from main window's `capabilities/default.json`).
- More faithful to uTools "full-window tool", at the cost of real isolation complexity.

## Decision (ADR-lite) — Q4

**Context**: MVP needs a concrete demo plugin to prove the new tool-window path end-to-end.
**Decision**: Demo plugin = "markdown-table-generator" — textarea takes CSV/TSV, live preview renders a markdown table, "Insert" button writes the table into the active markdown doc via RPC.
**Consequences**:
- Exercises the full round trip: HTML load → `fetch()` RPC → host validates `vault.insertContent` permission → editor store updated → user sees table in the doc.
- Demo lives at `examples/plugins/markdown-table/` (new folder); manifest declares `tier: sandbox`, `permissions: { vault: { insertContent: true } }`, `contributes.tools: [{ id: "table-gen", title: "Markdown Table", icon: "▦", window: true, entry: "index.html" }]`.
- `hello-tool`'s existing inert `tools` contribution will also light up for free once the adapter ships — bonus smoke test.

## Open Questions

(All resolved — see ADR-lite decisions above.)

## Requirements (evolving)

- A plugin can declare a `ToolContribution` in its manifest and have it registered + openable at runtime.
- The tool's UI (React component for trusted tier) mounts and renders.
- A demo plugin ships under `examples/plugins/` that uses `tools` contribution to prove the path works.

## Acceptance Criteria (evolving)

- [ ] `registerPluginTools` adapter exists and wires `ToolContribution` into a tool registry.
- [ ] A user can open the tool's UI via some surface (TBD — see Open Questions).
- [ ] A demo plugin under `examples/plugins/` ships with a `tools` contribution and renders its own full-page UI.
- [ ] Adapter has unit tests (see `contributionAdapters.test.ts` for pattern).
- [ ] Deactivate correctly disposes the tool registration.

## Definition of Done

- Tests added/updated (unit/integration where appropriate)
- Lint / typecheck / CI green
- Docs/notes updated (`docs/plugin-development.md` mentions tools contribution)
- Rollout/rollback considered (none risky — purely additive)

## Decision (ADR-lite) — Q3

**Context**: Plugin's HTML (in its own WebviewWindow) needs a way to call host capabilities (fs, editor, clipboard, etc.).
**Decision**: `quill-plugin://` custom protocol + fetch-style RPC. Plugin JS calls `fetch('quill-plugin://localhost/<id>/rpc', { method: 'POST', body: { method, params } })`; a Rust-side protocol handler validates against `PluginPermissions` (reusing `rpcBridge.ts` logic, ported to Rust or called from Rust) and executes. No Tauri SDK dependency in plugin bundles.
**Consequences**:
- Plugin authors write plain HTML + `fetch()` — zero host framework dependency, true utools-style DX.
- Need a Rust protocol handler for `quill-plugin://localhost/<id>/rpc` (POST) and `quill-plugin://localhost/<id>/<asset>` (GET, for index.html + JS/CSS).
- Validation logic from `rpcBridge.ts` (`isPathInScope`, permission checks) moves to (or is invoked from) Rust — possible port to Rust or a Tauri command that JS-bridges; design TBD in implementation.
- Fetch is req/resp only. Host → plugin runtime pushes (lifecycle events beyond load/unload) are **out of scope** for MVP — plugin is a standalone mini-app, activate = window loaded, deactivate = window closed.
- Existing `sandboxLoader.ts` iframe path continues to serve in-main-webview sandbox plugins; the new protocol handler is shared between iframe-sandbox and window-sandbox URL schemes.

## Decision (ADR-lite) — Q5

**Context**: MVP boundary — how much to include.
**Decision**: Option 2 — MVP includes multi-instance (same tool can open multiple windows). Defer: keyword triggers, `window: false` inline panels, marketplace, `.upx` packaging, per-capability permission prompts.
**Consequences**:
- Need a `ToolWindowManager` that tracks open windows by `label` (e.g. `plugin-<pluginId>-<toolId>-<n>`) and supports multiple concurrent.
- Same plugin's same tool invoked twice → opens a second window (no focus-existing shortcut).
- Window close (user or deactivate) → destroy WebviewWindow + dispose adapter registration for that instance.

## Requirements (final)

- `manifest.contributes.tools[]` with `window: true` registers tool(s) at plugin activation.
- Adapter `registerPluginTools(manifest, bridge)` in `contributionAdapters.ts` wires tools into a new `toolWindowRegistry` (Zustand store or plain registry).
- A user opens a tool via ⌘P → "Open: <tool title>" (one command per registered tool).
- Opening creates a Tauri `WebviewWindow` whose URL is `quill-plugin://localhost/<plugin-id>/<entry>`.
- The `quill-plugin://` URI handler gains a POST `/rpc` route: plugin JS calls `fetch('quill-plugin://localhost/<id>/rpc', { method: 'POST', body: { method, params } })`; handler validates against `PluginPermissions` (reuses `rpcBridge.ts` `isPathInScope` + permission checks) and dispatches to a host-side method table.
- Host method table covers: `vault.getActiveDoc()` (returns `{ id, path }`), `vault.insertContent(text)` (writes to active tab content via `editorStore`).
- Multi-instance: each "Open" call creates a new `WebviewWindow` with a unique label.
- Closing a window (user-initiated or plugin deactivate) destroys the WebviewWindow.
- Plugin deactivate disposes all of that plugin's open tool windows.
- Demo plugin `examples/plugins/markdown-table/` ships with manifest + `index.html` + `index.js` that exercises the full path.
- `hello-tool`'s existing `tools` contribution lights up automatically.

## Acceptance Criteria (final)

- [ ] `registerPluginTools` adapter exists with unit tests (follow `contributionAdapters.test.ts` pattern).
- [ ] ⌘P → "Open: <tool>" creates a WebviewWindow that renders the plugin's HTML.
- [ ] Plugin JS `fetch('quill-plugin://localhost/<id>/rpc', ...)` reaches the host and returns a JSON result.
- [ ] RPC validation: a call to `vault.insertContent` from a plugin whose manifest lacks `permissions.vault.insertContent` is rejected with an error response and a console warning.
- [ ] Markdown-table demo plugin installed end-to-end: user opens it, types CSV, clicks Insert, sees the table appended to the active doc.
- [ ] Multi-instance: opening the same tool twice yields two windows; closing one leaves the other alive.
- [ ] Plugin deactivate (via Settings → Plugins) closes all of that plugin's open tool windows.
- [ ] Rust-side `/rpc` POST handler has unit tests (path-traversal, permission denial, happy path).
- [ ] Lint / typecheck / CI green.
- [ ] `docs/plugin-development.md` `### tools` section updated to document the fetch-RPC protocol (replacing the "its own visible iframe window" stale claim).

## Definition of Done

- Tests added/updated (adapter unit + Rust handler unit + one integration smoke if feasible).
- Lint / typecheck / CI green.
- Docs/notes updated (`docs/plugin-development.md` tools section + new demo plugin README).
- Rollout/rollback considered — purely additive, no risk to existing features; deactivate path tested.

## Technical Approach

1. **Adapter (frontend)**: `registerPluginTools(manifest, bridge)` in `contributionAdapters.ts` — iterates `manifest.contributes.tools`, registers a command per tool via `registerCommand({ id: 'plugin.openTool.<pluginId>.<toolId>', run: () => toolWindowManager.open(manifest.id, tool) })`. Returns a disposable.
2. **ToolWindowManager (frontend)**: new Zustand store `toolWindowStore.ts` — tracks open windows `{ label, pluginId, toolId, webviewWindow }`; `open()` creates a `WebviewWindow` via `@tauri-apps/api/webview-window` with URL `quill-plugin://localhost/<pluginId>/<tool.entry>` and a unique label; `close(label)` destroys it; `closeAllForPlugin(pluginId)` used on deactivate.
3. **Rust RPC handler**: extend `plugin_commands.rs` `quill-plugin://` URI handler — when path ends with `/rpc` and method is POST, parse body as `{ method, params }`, look up plugin record, validate against `PluginPermissions` (port `isPathInScope` + permission checks from `rpcBridge.ts`, or invoke a shared JS function via a new Tauri command — decision in implementation), dispatch to a method table: `vault.getActiveDoc`, `vault.insertContent`.
4. **Demo plugin**: `examples/plugins/markdown-table/` with `manifest.json` (`tier: sandbox`, `permissions: { vault: { insertContent: true } }`, `contributes.tools: [{ id: "table-gen", title: "Markdown Table", icon: "▦", window: true, entry: "index.html" }]`), `index.html` (textarea + preview + Insert button), `index.js` (CSV parse + `fetch('/rpc', ...)` call).

## Implementation Plan (small PRs)

- **PR1**: `registerPluginTools` adapter + `toolWindowStore` + ⌘P open command + unit tests. Hello-tool's tools contribution lights up (loads HTML, no RPC yet).
- **PR2**: Rust `/rpc` POST handler + permission validation + method table (`vault.getActiveDoc`, `vault.insertContent`) + Rust unit tests.
- **PR3**: Markdown-table demo plugin + docs update + integration smoke.

## Out of Scope (explicit)

- uTools-style keyword/regex triggers in a global launcher (uTools `cmds` model) — defer to a later task.
- Marketplace / `.upx` packaging.
- Per-capability permission prompts (binary trust for MVP).
- **Trusted-tier tool windows** (React component rendered by host) — deferred; MVP ships sandbox-only.
- `window: false` inline panel rendering — split to a follow-up task.
- Host → plugin runtime push events (lifecycle beyond load/unload) — out of scope.

## Technical Notes

- `contributionAdapters.ts` is where the new adapter lives; follow the `registerTrustedPluginCommands` pattern.
- `commandRegistry.ts` + `commandPaletteStore.ts` are the existing command surfacing — likely the entry point for "open tool window".
- Tauri `WebviewWindow` (via `@tauri-apps/api/webview-window`) for OS-level window; or an in-app overlay component for modal-style.
- Trusted blob-URL `import()` already works for React components (see `TodoContainer` in markdown-todo) — so a tool's React component export should load the same way.
- `_loadReact` pattern in markdown-todo uses `window.React` — the tool component will hit the same constraint.
- Existing `rpcBridge.ts` does permission-scoped postMessage RPC for iframe sandbox plugins. Its validation logic (`isPathInScope`, `PluginPermissions` checks) is reusable; only the transport changes for the new-window model.
- `sandboxLoader.ts` uses `quill-plugin://localhost/<id>/<html>` custom-scheme URL for iframe src. Same URL scheme can serve a WebviewWindow's `url:` option — no new serving path needed.

## Research References

- `.trellis/tasks/archive/2026-07/07-08-microkernel-plugin-architecture/research/utool-plugin-model.md` — uTools manifest / preload / isolation model (full-window feature = `ToolContribution` equivalent)
