# Quill Plugin Development Guide

Quill's microkernel lets you extend the editor at runtime: install a plugin
folder and its file types, commands, container directives, feature panels, or
tool windows become available immediately — no recompile, no repackage.

This guide covers the manifest schema, the two execution tiers, contribution
points, the permissions model, lifecycle, the TOFU approval flow, local
development, and packaging. It references the two sample plugins in
[`examples/plugins/`](../examples/plugins/).

- [Quick start](#quick-start)
- [The two tiers](#the-two-tiers)
- [manifest.json schema](#manifestjson-schema)
- [Contribution points](#contribution-points)
- [The PluginModule export contract (trusted tier)](#the-pluginmodule-export-contract-trusted-tier)
- [The sandbox RPC protocol (sandbox tier)](#the-sandbox-rpc-protocol-sandbox-tier)
- [Permissions model](#permissions-model)
- [Lifecycle: activate / deactivate / dispose](#lifecycle-activate--deactivate--dispose)
- [TOFU approval flow](#tofu-approval-flow)
- [Integrity upgrade path (ed25519 scaffolding)](#integrity-upgrade-path-ed25519-scaffolding)
- [Local development](#local-development)
- [Packaging](#packaging)
- [Reference: sample plugins](#reference-sample-plugins)

---

## Quick start

The fastest path: copy [`examples/plugins/markdown-todo`](../examples/plugins/markdown-todo)
into a folder, then install it from **Settings → Plugins → 从文件夹安装…**.
Pick the folder (its name must be the plugin's kebab-case id, e.g.
`markdown-todo`), and the plugin appears in the list. Trusted-tier plugins
need an extra **批准并授权** click (see [TOFU](#tofu-approval-flow)).

After install + activate:

- The `markdown-todo` plugin contributes a `:::todo` container directive
  (type `/todo` in the slash menu) and a **Todo: Insert Checklist** command
  (⌘P → "Todo: Insert Checklist").
- The `hello-tool` plugin (sandbox tier) contributes a **Hello: Greet**
  command that writes to the clipboard via the host RPC bridge.

---

## The two tiers

Every plugin declares `tier: "sandbox" | "trusted"` in its manifest. The tier
determines the loader, isolation boundary, capability surface, and which
contribution points are available.

| | **sandbox** | **trusted** |
|---|---|---|
| Loader | hidden `<iframe sandbox="allow-scripts">` (no `allow-same-origin`), loaded from `quill-plugin://localhost/<id>/<html>` | `import(/* @vite-ignore */ blobUrl)` into the **main webview realm** |
| Isolation | cross-origin opaque origin; no parent DOM, no Tauri APIs, no localStorage | none — runs in the host realm; can read Zustand stores, call Tauri, touch the DOM |
| Capability surface | host RPC bridge (`postMessage`) only; manifest `permissions` gate every call | full host realm access; `grant_plugin_capabilities` adds scoped Tauri caps (largely redundant — see [Design reality](#permissions-model)) |
| Trust gate | none (sandbox IS the boundary) | TOFU: user must **批准并授权** before activation |
| Allowed contribution points | `commands`, `tools` (window) | `commands`, `fileTypes`, `containers`, `features`, `tools` |
| Hot unload | destroy iframe element | `dispose()` adapters + `URL.revokeObjectURL(blobUrl)` |
| Bundle requirement | HTML + JS loaded by the iframe via `quill-plugin://` | self-contained ESM bundle (no relative/remote imports at eval time — blob URLs can't resolve them) |

**When to use which:**

- **sandbox** when the plugin is a self-contained tool/launcher that doesn't
  need to render inside the editor (no file-type handlers, no Markdown
  container directives). Safest for untrusted third-party code.
- **trusted** when the plugin must render inline React/CodeMirror components
  (file-type handler, `:::container` directive, feature panel) or needs deep
  host integration. Requires the user to explicitly approve (TOFU).

---

## manifest.json schema

Every plugin folder has a `manifest.json` at its root. Full schema:

```jsonc
{
  // Required. Globally-unique kebab-case id (matches ^[a-z0-9]+(-[a-z0-9]+)+$).
  // The folder name under ~/.quill/plugins/ MUST equal this id.
  "id": "my-plugin",
  // Required. Human-readable display name.
  "name": "My Plugin",
  // Required. Semver-ish version string.
  "version": "1.0.0",
  "author": "Jane Doe",
  // Engine compat, e.g. ">=0.1.0". Optional but recommended.
  "quill": ">=0.1.0",
  // Required. "sandbox" or "trusted" (see above).
  "tier": "trusted",
  // Required. Entry module path (relative to the plugin folder).
  //   sandbox: the JS loaded inside the iframe (typically "index.js")
  //   trusted: the ESM bundle import()-ed into the host realm
  "main": "index.js",
  // Required for sandbox tier. HTML entry loaded into the iframe.
  "html": "index.html",

  // Optional. Declared capabilities the plugin may use. Enforced differently
  // per tier — see "Permissions model" below.
  "permissions": {
    "fs":     { "scope": ["data/**", "vault:read-active"] },
    "http":   { "origins": ["https://api.example.com"] },
    "clipboard": true,
    "dialog": true,
    "window": true,
    "vault":  { "readActive": true, "insertContent": true }
  },

  // Optional. The contribution points this plugin adds to the app.
  "contributes": {
    "commands":   [{ "id": "greet", "title": "Greet", "icon": "👋", "keywords": ["hi"], "run": "greet" }],
    "fileTypes":  [{ "id": "json", "extensions": [".json"], "handler": "default", "defaultViewMode": "edit" }],
    "containers": [{ "name": "callout", "icon": "💡", "label": "Callout", "category": "layout", "component": "callout", "template": ":::callout\n:::", "description": "A callout" }],
    "features":   [{ "id": "my-panel", "panel": "right", "component": "my-panel" }],
    "tools":      [{ "id": "my-tool", "title": "My Tool", "icon": "🛠", "window": true, "entry": "index.html" }]
  },

  // Optional. Lazy activation triggers. The plugin's code is loaded only when
  // one of these fires (mirrors VSCode activation events).
  "activation": {
    "onCommand": "greet",        // activate when this command is invoked
    "onFileType": [".json"],     // activate when a file with this extension opens
    "onLanguage": ["markdown"]   // activate when a doc of this language opens
  },

  // Optional (PR4 scaffolding). ed25519 signature + pinned publisher key.
  // MVP does NOT require these — see "Integrity upgrade path".
  "signature": "<base64 ed25519 signature over the canonicalized manifest>",
  "publisherPublicKey": "<base64 ed25519 public key>"
}
```

### Validation rules

The manifest is validated at install time (Rust `validate_manifest` + TS
`PluginHost.validateManifest`). The rules:

- `id` must be kebab-case (`^[a-z0-9]+(-[a-z0-9]+)+$`) — at least one hyphen,
  lowercase alphanumerics only. `my-plugin` ✓; `MyPlugin` ✗; `myplugin` ✗.
- `version` must be a non-empty string.
- `tier` must be `sandbox` or `trusted`.
- `main` must be a non-empty string.
- `sandbox` tier requires `html`.

---

## Contribution points

Each contribution is a plain-data descriptor in `contributes`. The host
adapts it into the matching app registry when the plugin activates.

### commands

```jsonc
"commands": [{ "id": "greet", "title": "Greet", "icon": "👋", "keywords": ["hi"], "run": "greet" }]
```

- `id` is the command's local id; the registered palette id becomes
  `plugin.<pluginId>.<id>` (e.g. `plugin.hello-tool.greet`).
- `title` is the palette label (prefixed with the plugin name in the UI).
- `run` is the **entry-ref** — a string indexing into the plugin module's
  `commands` map (trusted) or the command id dispatched to the iframe
  (sandbox).

### fileTypes (trusted only)

```jsonc
"fileTypes": [{ "id": "json", "extensions": [".json"], "handler": "default", "defaultViewMode": "edit" }]
```

- `handler` is the entry-ref into the module's `handlers` map. The handler
  must be a complete `FileTypeHandler` (see
  `apps/desktop/src/components/file-types/types.ts`).
- `defaultViewMode` is optional (`split` / `edit` / `preview` / `visual` /
  `source`).

### containers (trusted only)

```jsonc
"containers": [{ "name": "todo", "icon": "✅", "label": "Todo", "category": "data", "component": "todo", "template": ":::todo\n- [ ] item\n:::", "description": "A todo list" }]
```

- `name` is the directive name (what follows `:::` in Markdown).
- `component` is the entry-ref into the module's `containers` map. The
  component must be a React component accepting `ContainerProps`
  (`{ children?, attributes?, name? }`).
- `category` is `layout` / `media` / `ai` / `data` / `custom` (slash-menu
  grouping).
- `template` is the Markdown inserted when the user picks the directive from
  the `/` slash menu.

### features (trusted only; MVP stub)

```jsonc
"features": [{ "id": "my-panel", "panel": "right", "component": "my-panel" }]
```

- `panel` is `left` / `right` / `bottom`.
- `component` is the entry-ref into the module's `features` map.
- **MVP limitation**: the full ActivityBar integration (adding an icon to the
  activity bar + routing) is deferred. PR4 registers panels in an in-memory
  registry (`getPluginFeaturePanels`) but does not yet render them in the
  ActivityBar. A follow-up wires the real slot.

### tools

```jsonc
"tools": [{ "id": "hello", "title": "Hello Tool", "icon": "🛠", "window": true, "entry": "index.html" }]
```

- `window: true` opens the tool in its own visible iframe window (sandbox) /
  webview (trusted). `window: false` renders inline (MVP: window=true only).
- `entry` is the HTML entry (sandbox) or component entry-ref (trusted).

---

## The PluginModule export contract (trusted tier)

A trusted plugin's `main` is an ESM module. The host `import()`-s it and
reads its **named exports** as a `PluginModule`:

```ts
// index.js — a self-contained ESM bundle
export const handlers: Record<string, FileTypeHandler> = { 'default': { ... } };
export const containers: Record<string, ComponentType<ContainerProps>> = { 'todo': TodoComp };
export const commands: Record<string, () => void | Promise<void>> = { 'greet': () => {} };
export const features: Record<string, ComponentType<unknown>> = { 'my-panel': Panel };
export function activate(ctx: PluginContext) { /* optional */ }
export function deactivate(ctx: PluginContext) { /* optional */ }
```

The maps are **keyed by entry-ref** — the strings in the manifest's
`contributes.*[].run` / `.handler` / `.component`. An entry-ref missing from
the module's exports is skipped with a console warning (best-effort: a
partial plugin still loads its other contributions).

A default-export factory `(ctx) => PluginModule` is also accepted (the loader
normalizes both shapes). See `contributionAdapters.ts` for the exact
resolution rules.

### Trusted tier bundling

The trusted loader wraps your `main` in a **blob URL** and `import()`-s it.
Blob URLs have no path, so:

- **relative imports do not resolve** (`./utils.js` fails)
- **remote imports are blocked** by the `quill-plugin://` CSP
- **bare specifiers** (`react`, `@/store/...`) resolve against the host
  realm's already-loaded modules ONLY if Vite leaves them as runtime
  `import()`. To be safe, **bundle your deps** (Vite/Rollup/esbuild) so the
  blob-URL `import()` is fully self-contained.

The `markdown-todo` sample sidesteps this by keeping all bare-specifier
imports **inside functions** (lazy, not at module-eval time) and using a
variable specifier so Vite doesn't statically resolve them. That works for a
demo; a real plugin should bundle.

---

## The sandbox RPC protocol (sandbox tier)

A sandbox plugin's `index.html` + `index.js` run inside a sandboxed iframe
with origin `null` (opaque). The ONLY bridge to host capabilities is
`window.parent.postMessage`. The host's `RpcBridge` validates every call
against the manifest's `permissions`.

Message protocol (see `rpcBridge.ts`):

```
iframe → host: { type: 'request',        id, method, params }   // RPC call
host → iframe: { type: 'response',       id, result?, error? }  // RPC response
host → iframe: { type: 'lifecycle',      event: 'activate'|'deactivate' }
host → iframe: { type: 'invoke',         id, command, params? } // host invoking a declared command
iframe → host: { type: 'invoke-result',  id, result?, error? }
```

Available RPC methods (all gated by the manifest `permissions`):

| Method | Params | Permission |
|---|---|---|
| `fs:read` | `{ path }` | `fs.scope` (glob, relative to plugin data dir) |
| `fs:write` | `{ path, content }` | `fs.scope` |
| `fs:list` | `{ path }` | `fs.scope` |
| `http:fetch` | `{ url, init? }` | `http.origins` (allowlist) |
| `clipboard:read` | `{}` | `clipboard: true` |
| `clipboard:write` | `{ text }` | `clipboard: true` |
| `dialog:open` | `{}` | `dialog: true` |
| `dialog:save` | `{ content }` | `dialog: true` |
| `vault:read-active-doc` | `{}` | `vault.readActive: true` |
| `vault:insert-content` | `{ content }` | `vault.insertContent: true` |
| `window:open` | `{ toolId }` | `window: true` |

See `examples/plugins/hello-tool/index.js` for a complete iframe script that
wraps `postMessage` in a Promise-based `rpc()` helper.

#### `http:fetch` routing (CSP bypass)

`http:fetch` does NOT run `fetch()` in the host webview. The host webview's
CSP `connect-src 'self' ipc: http://ipc.localhost` does not include the
plugin-declared origins, so a direct `fetch()` would be blocked in release
(dev does not inject CSP, which masked the bug). Instead the RPC bridge
invokes the Rust command `plugin_http_fetch(plugin_id, url, method?, headers?, body?)`,
which performs the request with `reqwest` (no CSP) and returns a buffered
`{ status, headers, body }` matching the old `fetch()` shape.

Origin enforcement is double-layered:

1. **JS fast-fail** — `rpcBridge` calls `isOriginAllowed(url, manifest.permissions.http.origins)`
   before the IPC hop; a non-allowlisted origin never reaches Rust.
2. **Rust defense-in-depth** — `plugin_http_fetch` re-reads the plugin's
   on-disk `manifest.json` `permissions.http.origins` and re-checks the
   origin before issuing the request, so a future JS-bridge bypass still
   cannot exfiltrate to an undeclared origin.

Streaming responses are out of scope for the MVP (buffered `{body: string}`).

---

## Permissions model

The two tiers enforce permissions very differently. **This is the central
design trade-off** (see prd.md ADR-lite + research/vscode-extension-host.md
§3).

### sandbox tier — host-mediated (hard boundary)

The iframe has **no Tauri APIs at all**. Every privileged call goes through
the `postMessage` RPC bridge, which checks the manifest's declared
`permissions` before dispatching. A sandbox plugin cannot bypass this — there
is no path to raw Tauri. This is the VSCode-extension-host model: isolation
makes the capability-scoped API enforceable.

### trusted tier — TOFU + design reality (soft boundary)

Trusted plugins run **in the main webview realm**, which already has broad
Tauri capabilities from `capabilities/default.json` (`fs:scope-home-recursive`,
`shell:allow-spawn`, etc.). The `grant_plugin_capabilities` Rust command
calls `add_capability` with scoped permissions — but this is **additive /
redundant**, NOT a confinement. A trusted plugin can still call
`import('@tauri-apps/api/core')` directly with the main window's existing
caps.

**The real security boundary for the trusted tier is the TOFU gate**
(integrity + user-pin), NOT `add_capability`. Once you approve a trusted
plugin, it has full power. This is the VSCode "in-process host = soft consent
gate" trade-off, explicitly accepted for the trusted tier:

> TOFU-pinned = user explicitly trusted = full power.

Do NOT pretend `grant_plugin_capabilities` is a hard sandbox. If you need a
hard boundary for a third-party plugin, use the **sandbox tier**.

---

## Lifecycle: activate / deactivate / dispose

The host calls your plugin's optional `activate(ctx)` / `deactivate(ctx)`
hooks. Every contribution you register returns a `Disposable`; the host
reaps all disposables on deactivate, so your contributions are
auto-unregistered even if your `deactivate` is missing or throws.

- **install** → `installed` state. No code loaded yet.
- **activate** → loader loads your module; contribution adapters wire your
  commands/fileTypes/containers/features into the app registries; your
  `activate(ctx)` runs (if present).
- **deactivate** → your `deactivate(ctx)` runs (if present); all
  disposables reaped (commands unregistered, containers removed, blob URL
  revoked for trusted / iframe destroyed for sandbox).
- **uninstall** → deactivate (if active) + remove from `plugins.json` +
  delete the plugin folder.

A failed activate/deactivate sets the state to `failed` with the error
surfaced in the Settings → Plugins UI.

---

## TOFU approval flow

Sandbox plugins auto-activate on install (their boundary is the iframe, no
approval needed). Trusted plugins require explicit approval:

1. Install the trusted plugin (Settings → Plugins → 从文件夹安装…). It
   appears in the list with state "已安装" and a **批准并授权** button.
2. Click **批准并授权**. A consent modal opens listing the declared
   permissions + contributions, with a warning that trusted plugins have
   full host power.
3. Confirm → `approve_plugin(id)` sets `trusted: true` in `plugins.json`
   and emits `plugin://approved`. The host's listener activates the plugin.
4. Cancel → the plugin stays installed but unapproved. You can still
   uninstall it.

Once approved, the plugin activates immediately and on every subsequent app
launch (the hydrate loop in `App.tsx` sees `trusted: true` and activates).

---

## Integrity upgrade path (ed25519 scaffolding)

PR3 computes a per-file SHA-256 integrity map at install time and the
trusted loader verifies `main`'s hash before `import()`. This is the **MVP
gate** — it proves the bytes on disk match the bytes that were approved
(tamper detection), but it does NOT prove publisher identity.

PR4 adds **ed25519 signature scaffolding** on top:

- The manifest MAY carry `signature` (base64 ed25519 signature over the
  canonicalized manifest JSON) and `publisherPublicKey` (base64 ed25519
  public key).
- `verify_plugin_signature(manifest, signature, publicKey)` is a pure Rust
  function: returns `Ok(())` when no signature is present (MVP: optional),
  verifies when present.
- At install, if a signature is present, it's verified best-effort
  (non-fatal — logged to stderr; SHA-256 is still the gate).
- The `verify_plugin_signature_cmd` Tauri command lets a future diagnostics
  UI surface "signature invalid" before approval.

### Migration path to required signatures

When a marketplace launches:

1. Add a config flag (e.g. `requireSignatures: true` in settingsStore).
2. In `verify_plugin_signature`, return `Err` when `signature` is `None`
   and the flag is on.
3. Surface "this plugin is unsigned" in the consent modal.
4. Pin publisher keys in a trusted set (config file or hardcoded for MVP);
   TOFU-pin on first approve (the `publisherPublicKey` is persisted in
   `plugins.json` so a later update with a different key re-triggers
   consent).

No breaking change to existing plugins — unsigned plugins keep working
until the flag flips. The scaffolding is in place; the gate is just
not yet enforced.

---

## Local development

### Drop a folder in ~/.quill/plugins/

The simplest dev loop: copy your plugin folder to
`~/.quill/plugins/<plugin-id>/`. On next app launch, the hydrate loop in
`App.tsx` reads `plugins.json` + each manifest and installs/activates. For
sandbox plugins, changes to the HTML/JS are picked up by reloading the app
(the iframe re-fetches from `quill-plugin://`). For trusted plugins, bump
the blob URL (the loader creates a fresh one per activation, so deactivate →
activate picks up new code).

### Install-from-folder UI

Use Settings → Plugins → 从文件夹安装… and pick your dev folder. The folder
name must be the plugin's kebab-case id. This copies the folder into
`~/.quill/plugins/<id>/` and installs it.

### Dev server (sandbox tier)

Because `html` is loaded from `quill-plugin://localhost/<id>/<html>`, you
can't point it at `http://localhost:5173` directly (cross-origin). For hot
reload, either:

- re-install after each change (fastest for small plugins), or
- run a dev server and proxy it through the `quill-plugin://` scheme (future
  enhancement — not in MVP).

### Trusted tier + Vite

A trusted plugin that uses JSX/TSX needs a build step. Minimal `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { lib: { entry: 'index.tsx', formats: ['es'], fileName: 'index' } },
});
```

Output `dist/index.js` and set `main: "dist/index.js"` in the manifest. The
bundle must be self-contained (inline React or mark it external and rely on
the host realm — see "Trusted tier bundling" above).

---

## Packaging

MVP: **unpacked folder**. The install command copies a folder containing
`manifest.json` + assets into `~/.quill/plugins/<id>/`. There is no zip /
tarball / npm-pack support yet — zip extraction is explicitly deferred.

To distribute a plugin today: ship the folder (zip it yourself for download;
users unzip to a local path and install via the folder dialog).

Future: a `.quill-plugin` archive (zip of the folder) + marketplace download
will land when the signature chain is enforced. The ed25519 scaffolding (see
above) is already in place for that.

---

## Reference: sample plugins

- [`examples/plugins/hello-tool`](../examples/plugins/hello-tool) — sandbox
  tier. Contributes a command + a tool. The iframe script wraps
  `postMessage` in a Promise-based `rpc()` helper and demonstrates
  `clipboard:read` / `clipboard:write`.
- [`examples/plugins/markdown-todo`](../examples/plugins/markdown-todo) —
  trusted tier. Contributes a `:::todo` container directive (interactive
  checkbox list) + a **Todo: Insert Checklist** command. Pure ESM, no
  bundler step needed (lazy-imports React + the editor store inside
  functions so the blob-URL `import()` loads cleanly).

Install both via Settings → Plugins → 从文件夹安装… to manually QA the full
pipeline.
