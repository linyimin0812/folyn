# Quill Plugin Development Guide

Quill's microkernel lets you extend the editor at runtime: install a plugin
folder and its file types, commands, container directives, feature panels, or
tool windows become available immediately — no recompile, no repackage.

This guide covers the manifest schema, the two execution tiers, contribution
points, the permissions model, lifecycle, the TOFU approval flow, local
development, and packaging. It references the two sample plugins in
[`examples/plugins/`](../examples/plugins/).

- [Quick start](#quick-start)
- [At a glance: what the host provides](#at-a-glance-what-the-host-provides)
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

## At a glance: what the host provides

A Quill plugin is a folder under `~/.quill/plugins/<id>/` with a
`manifest.json` + assets. The host gives you five things:

### 1. Two execution tiers

| Tier | Isolation | Capability surface | Trust gate |
|---|---|---|---|
| `sandbox` | separate `WebviewWindow` or iframe, origin `quill-plugin://localhost` | host RPC bridge only — no Tauri APIs | none (sandbox IS the boundary) |
| `trusted` | main webview realm (in-process) | full host realm + Zustand stores + Tauri | TOFU: user must **批准并授权** |

### 2. Contribution points

Declared in `contributes` in the manifest; wired into host registries on
activate; auto-unregistered on deactivate.

| Point | Sandbox? | Trusted? | What it adds |
|---|---|---|---|
| `commands` | ✓ | ✓ | palette entry (⌘P) — `plugin.<pluginId>.<id>` |
| `tools` (with `window: true`) | ✓ | ✓ | "Open: <title>" command → Tauri WebviewWindow |
| `fileTypes` | ✗ | ✓ | file extension → handler mapping |
| `containers` | ✗ | ✓ | `:::name` Markdown directive → React component |
| `features` | ✗ | ✓ | sidebar panel slot (activity bar icon + component) — left only (MVP) |
| `exporters` | ✗ | ✓ | custom export format → "Export as <label>" palette command |
| `fileTemplates` | ✗ | ✓ | new-file template → "New <label>" palette command |
| `keybindings` | ✗ | ✓ | Tauri accelerator → command id (app-scope keydown) |
| `exportEnhancers` | ✗ | ✓ | post-render DOM mutation during HTML/PDF export |

### 3. RPC method table (sandbox tier — host-mediated)

Sandbox plugins call host capabilities via `postMessage` (iframe transport) or
`fetch('quill-plugin://localhost/<id>/rpc', ...)` (tool-window transport). Both
hit the same `dispatchPluginRpc` table — same permission checks, same path
resolution.

| Method | Params | Required permission | Returns |
|---|---|---|---|
| `fs:read` | `{ path }` | `fs.scope` (glob) | `string` (file contents) |
| `fs:write` | `{ path, content }` | `fs.scope` | `void` → `{ ok: true }` |
| `fs:list` | `{ path }` | `fs.scope` | `DirEntry[]` |
| `http:fetch` | `{ url, init? }` | `http.origins` (allowlist) | `{ status, headers, body }` |
| `clipboard:read` | `{}` | `clipboard: true` | `string \| null` |
| `clipboard:write` | `{ text }` | `clipboard: true` | `void` → `{ ok: true }` |
| `dialog:open` | `{}` | `dialog: true` | `string \| null` (file path) |
| `dialog:save` | `{ content }` | `dialog: true` | `string \| null` |
| `vault:read-active-doc` | `{}` | `vault.readActive: true` | `{ path, content } \| null` |
| `vault:insert-content` | `{ content }` | `vault.insertContent: true` | `{ ok: true }` |
| `window:open` | `{ toolId }` | `window: true` | `{ opened: true, toolId }` |
| `ai:chat` | `{ sessionId, prompt }` | `ai.chat: true` | streams `ai-stream` events, final `response` (sandbox only — trusted uses `ctx.ai.chat`) |
| `env:get` | `{}` | _(none — env is non-sensitive)_ | `{ theme: 'light'\|'dark', locale: string }` |

**Host-pushed env events** (no request needed; the host pushes these to the
iframe whenever the user switches theme or locale mid-session):

```jsonc
{ "type": "env-event", "event": "theme",  "value": "dark" }
{ "type": "env-event", "event": "locale", "value": "zh" }
```

Plugins should call `env:get` on `activate` to seed the initial values, then
listen for `env-event` messages to update in place.

**Response shape**: success → JSON object per the "Returns" column; failure →
`{ "error": "<message>" }` with HTTP 200; timeout (30 s) → HTTP 504 with
`{ "error": "rpc timeout" }`. Always check `json.error` before reading
`json.result`-shape fields.

### 4. Manifest validation rules (the spec authors must follow)

- `id`: kebab-case, `^[a-z0-9]+(-[a-z0-9]+)+$` (at least one hyphen). Folder
  name under `~/.quill/plugins/` MUST equal `id`.
- `version`: non-empty string (semver-ish recommended).
- `tier`: `"sandbox"` or `"trusted"`.
- `main`: non-empty string (relative path to entry module).
- `sandbox` tier requires `html` (HTML entry loaded into the iframe/window).
- File integrity: per-file SHA-256 computed at install time; trusted tier
  re-verifies `main`'s hash before `import()`. Tampering → activation refused.
- Optional ed25519 `signature` + `publisherPublicKey` (MVP: not enforced;
  scaffolding for future marketplace gate).

### 5. CSP for sandbox plugins (what HTML/JS can do)

Every `quill-plugin://localhost/<id>/<file>` response carries this CSP header:

```
default-src 'none';
  script-src 'unsafe-inline' quill-plugin:;
  style-src  'unsafe-inline';
  connect-src quill-plugin:;
```

What this means for authors:

- ✓ Inline `<script>` and inline `<style>` in your HTML.
- ✓ `<script src="index.js">` (same-scheme, your plugin's own files).
- ✓ `fetch('quill-plugin://localhost/<id>/rpc', ...)` (the RPC bridge).
- ✗ No remote scripts, styles, fonts, images, or `connect-src` to any other
  origin. If you need network access, declare `http.origins` and call
  `http:fetch` — the host performs the request in Rust (no CSP).
- ✗ No `iframe` embedding, no web workers from blob: (only `quill-plugin:`).
- ✗ No `default-src` fallback — every directive is explicit.

Note: `'self'` is intentionally NOT used. Chromium does not resolve `'self'`
to the document origin for custom schemes like `quill-plugin://`, so the
explicit scheme source `quill-plugin:` is required instead.

---

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

### Install the SDK

Type your manifest against `quill-plugin-sdk` — the publishable type package
(manifest schema, contribution points, `PluginModule`, AI capability types,
and dev helpers like `definePlugin` / `validateManifest`). It has no runtime
dependency; React is a peer type only (erased at build for type-only
consumers).

```bash
npm install quill-plugin-sdk
```

```ts
// index.ts — a trusted-tier plugin's entry module
import type { PluginModule, ExporterHandler } from 'quill-plugin-sdk';

const exportTxt: ExporterHandler = async (content, ctx) =>
  `# ${ctx.filePath}\n\n${content}`;

export const exporters: Record<string, ExporterHandler> = { 'txt-with-header': exportTxt };
export const commands = { ping: () => console.info('pong') };
```

Internal workspace plugins depend on `@quill/plugin-host` (which re-exports
the full SDK surface) — `import` from either works. The runtime microkernel
(`PluginHost`, `pluginHost` singleton) lives in `@quill/plugin-host`; the SDK
stays publishable and runtime-free.

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
    "features":   [{ "id": "my-panel", "panel": "left", "component": "my-panel", "icon": "<svg>...</svg>", "title": "My Panel", "order": 50, "badge": "NEW" }],
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
- `supportedViewModes` (optional) declares the handler's view modes — the
  host merges manifest-declared ids into the handler's own set so the
  shell's view-mode switcher surfaces them. Beyond the 5 built-ins
  (`split`/`edit`/`preview`/`visual`/`source`), a plugin may declare
  **custom** mode ids (e.g. `canvas`); the handler's own `Editor`/`Preview`
  then renders that mode.

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

### features (trusted only; left panel only in MVP)

```jsonc
"features": [
  {
    "id": "my-panel",
    "panel": "left",
    "component": "my-panel",
    "icon": "<svg width=\"16\" height=\"16\" viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\"><path d=\"...\"/></svg>",
    "title": "My Panel",
    "order": 50,
    "badge": "NEW"
  }
]
```

- `id` is the panel's local id; it must NOT collide with the reserved
  built-in ids (`files`, `wiki`, `clips`, `analyze`, `calendar`). A collision
  (with a built-in or an already-registered plugin panel) is logged and the
  second registration is refused.
- `panel` is `left` / `right` / `bottom`. **MVP implements `left` only** —
  `right` and `bottom` declarations are logged + skipped (right/bottom shell
  slots are a follow-up task).
- `component` is the **entry-ref** into the module's `features` map (see the
  `PluginModule` export contract below). The component must be a React
  component (renders inside `PanelErrorBoundary`, so a throwing plugin panel
  won't white-screen the sidebar).
- `icon` is **required**. Either a raw inline SVG string
  (`<svg ...>...</svg>`) or a `ThemeIcon` name resolved against the host's
  `assets/icons/*.svg`. Raw SVG is the self-contained path for plugin authors.
- `title` is the tooltip + accessibility label. Defaults to
  `<pluginId>/<id>` if absent.
- `order` is optional. Built-ins occupy slots 0 (files), 10 (wiki), 20
  (clips), 30 (analyze), 40 (calendar). A plugin panel that omits `order` is
  assigned the next-after-builtin slot (≥100) by registration order. The
  activity bar renders panels sorted by `(order, registration seq)`.
- `badge` is optional (`string | number`). When present it renders as a small
  accent-colored text dot on the activity-bar icon. Useful for unread counts
  or status flags.
- **Trusted-tier only** (Decision Q1). Sandbox plugins cannot contribute
  sidebar panels — they contribute `tools` (tool windows) for full-page UI
  instead. The asymmetry is intentional: sandbox isolation can't mount a
  same-realm React component.
- **Deactivate fallback**: when the plugin deactivates, its panel is
  unregistered. If the panel was active at deactivate time, the active panel
  falls back to `files` (and `editorStore.activePanel` is synced so WorkArea's
  tab filter follows).
- **Persisted-active fallback**: if `editorStore.activePanel` points at an
  uninstalled plugin's panel id on next launch, the `registerBuiltinPanels`
  mirror re-routes it to `files`.

#### Reference: sample feature-panel plugin

- [`examples/plugins/feature-panel-sample`](../examples/plugins/feature-panel-sample)
  — minimal trusted-tier plugin that contributes a left sidebar panel
  (`notes-panel`) with a raw inline-SVG icon, an `order`, and a `badge`. The
  panel is a scratchpad textarea; an "Insert into doc" button writes the
  scratchpad into the active markdown doc via the in-process editor store
  (trusted tier = direct store access). Also contributes a **Notes: Open
  Panel** command (⌘P) that activates the panel.

### tools

```jsonc
"tools": [{ "id": "hello", "title": "Hello Tool", "icon": "🛠", "window": true, "entry": "index.html" }]
```

- `window: true` opens the tool in its own Tauri `WebviewWindow` that loads
  the plugin's HTML entry from `quill-plugin://localhost/<id>/<entry>`. The
  window's origin is `quill-plugin://localhost` (macOS/Linux) /
  `http://quill-plugin.localhost` (Windows) — isolated from the main app.
  `window: false` would render inline (MVP: `window: true` only; inline
  panels are a follow-up).
- `entry` is the HTML entry file (sandbox tier). Trusted tier uses a
  component entry-ref (deferred — this MVP ships sandbox-only tool windows).
- The host registers an "Open: <title>" command per tool, so ⌘P →
  "Open: Hello Tool" creates a new window. Multi-instance: each invocation
  opens a fresh window with a unique label.
- The plugin's HTML reaches host capabilities via **fetch-RPC** over the
  `quill-plugin://` scheme:

  ```js
  // POST quill-plugin://localhost/<plugin-id>/rpc
  // body: { "method": "<rpc-method>", "params": { ... } }
  // response: 200 with `<return-value>` (object/string/null per method) on
  //           success, or 200 with `{ "error": "<msg>" }` on RPC failure,
  //           or 504 with `{ "error": "rpc timeout" }` after 30s.
  const res = await fetch('quill-plugin://localhost/<plugin-id>/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'vault:insert-content', params: { content: '\nhello\n' } }),
  });
  const json = await res.json();           // { ok: true } on success
  if (!res.ok || json?.error) {            // null-safe: success body may be a primitive
    throw new Error(json?.error || `HTTP ${res.status}`);
  }
  ```

  The Rust URI handler emits a `plugin-rpc-request` event that the main
  webview dispatches through the shared `dispatchPluginRpc` (same permission
  checks + path resolution as the iframe bridge). See "At a glance" above for
  the method table and "Sandbox RPC protocol" below for protocol details. No
  Tauri SDK dependency in the plugin bundle — plain `fetch()` only.
- Closing the WebviewWindow (user OS-close or plugin deactivate) destroys
  the window. Plugin deactivate closes ALL of that plugin's open tool
  windows in the same dispose pass that unregisters commands.

#### Reference: sample tool plugins

- [`examples/plugins/hello-tool`](../examples/plugins/hello-tool) — minimal
  sandbox tool that writes to the clipboard via the RPC bridge.
- [`examples/plugins/markdown-table`](../examples/plugins/markdown-table) —
  end-to-end demo: textarea → markdown table → Insert button →
  `vault:insert-content` RPC → table appended to the active doc.

### exporters (trusted only)

```jsonc
"exporters": [
  { "id": "txt-with-header", "format": "txt-header", "label": "Text with header", "fileExtension": "txt", "run": "txt-with-header" }
]
```

- `format` is the output format id (unique within the plugin); the palette
  command id becomes `plugin.<pluginId>.export.<format>`.
- `label` is the menu label; the registered command is titled
  `Export as <label>`.
- `fileExtension` is the output extension without the dot (e.g. `txt`).
- `run` is the **entry-ref** into the module's `exporters` map. The handler
  has signature `(content: string, ctx: { filePath, vaultRoot }) => Promise<Blob | string>`.
  A `string` return is wrapped in a `text/plain` Blob. Running the command
  reads the active doc via the host's `getActiveDocument`, calls the handler,
  and writes the result through the shared `downloadBlob` chokepoint (the
  same save-dialog + `writeFile` path built-in exporters use).

### fileTemplates (trusted only)

```jsonc
"fileTemplates": [
  { "id": "meeting-notes", "label": "Meeting Notes", "fileName": "meeting-notes.md", "template": "# Meeting Notes\n\n", "icon": "📝" }
]
```

- Declarative — no module map. Each entry registers into a host
  `fileTemplateRegistry` (keyed `<pluginId>.<templateId>`) and surfaces a
  palette command `plugin.<pluginId>.new.<templateId>` titled
  `New <label>`. Running the command prompts for a save path (default under
  the current vault root) and writes `template` verbatim, then refreshes the
  file tree.
- ponytail: the file-tree right-click "新建" submenu is NOT wired yet — its
  inline-rename flow keys file content off the extension via
  `prefsStore.fileTemplates`, which can't carry an arbitrary body. The
  palette command is the MVP surface; the submenu group is the upgrade path
  (read `getPluginFileTemplates()`).

### keybindings (trusted only)

```jsonc
"keybindings": [
  { "command": "plugin.my-plugin.greet", "key": "Control+Alt+Shift+T", "mac": "Cmd+Alt+Shift+T", "when": "..." }
]
```

- `command` is a command id — a plugin-contributed command
  (`plugin.<pluginId>.<id>`) or a built-in (e.g. `action.toggle-theme`).
  The host looks it up in `commandRegistry` and runs it when the key fires.
- `key` is a Tauri accelerator string (`Cmd+Shift+K`, `Control+Alt+T`).
- `mac` overrides for macOS. `when` is an optional activation clause
  (opaque string, reserved for forward-compat — MVP registers globally).
- ponytail: the project has no `@tauri-apps/plugin-global-shortcut`
  dependency, so bindings are app-scope `keydown` listeners — they fire
  only while the app window has focus, not when backgrounded. The OS-global
  upgrade path is `plugin-global-shortcut`'s `register(accelerator, handler)`
  + `unregister(accelerator)` in dispose.

### exportEnhancers (trusted only)

```jsonc
"exportEnhancers": [
  { "name": "quote", "run": "enhance-quote" }
]
```

- `name` is the key the enhancer matches on: a `:::` container directive
  `name` **OR** a file extension (without the dot). The host tries both
  lookups so a single enhancer can serve either surface.
- `run` is the **entry-ref** into the module's `exportEnhancers` map. The
  handler signature is
  `(body: HTMLElement, ctx: ExporterContext) => Promise<void>` — it mutates
  the rendered DOM element in place to be self-contained for export (e.g.
  canvas→SVG capture, inlining async content, stripping action buttons).
- The handler runs **host-realm** on a real `HTMLElement` after the in-DOM
  render has settled (inside `renderMarkdownToHtmlViaDom`, after
  `processFilePreviews`). It can use `body.querySelector` /
  `body.appendChild` directly — the plugin module runs in the host realm as
  a trusted blob-URL `import()`.
- The `body` handed to the enhancer is the `[data-container]` element
  itself, unless it contains a `[data-file-preview-body]` child (a
  file-preview rendered inside a container directive), in which case the
  inner body is used. Action buttons are stripped before the call.
- ponytail: enhancer failures are swallowed best-effort
  (`.catch(() => {})`) — a broken enhancer must not abort the whole export.
  Multiple plugins registering for the same key → last-registered-wins; the
  upgrade path is a per-plugin precedence list if colliding enhancers ever
  need to compose.

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
export const exporters: Record<string, ExporterHandler> = { 'txt-with-header': exportTxt };
export const exportEnhancers: Record<string, ExportEnhancerHandler> = { 'enhance-quote': enhanceQuote };
export function activate(ctx: PluginContext) { /* optional */ }
export function deactivate(ctx: PluginContext) { /* optional */ }
```

The maps are **keyed by entry-ref** — the strings in the manifest's
`contributes.*[].run` / `.handler` / `.component` / `.entry`. An entry-ref
missing from the module's exports is skipped with a console warning
(best-effort: a partial plugin still loads its other contributions).
`fileTemplates` and `keybindings` are declarative — no module map.

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

## AI capability (`permissions.ai`)

Quill's AI surface (chat via `runRigChat` + feature agents via
`runFeatureAgent`) is exposed to plugins as a host-mediated capability. The
host owns provider/model/apiKey; plugins never see credentials.

### Permission declaration

```json
"permissions": {
  "ai": { "chat": true, "agents": ["study"], "edit": true }
}
```

- `chat` (boolean) — required for `ctx.ai.chat` (trusted) or `ai:chat` RPC
  (sandbox).
- `agents` (string[]) — whitelist of feature names the plugin may drive via
  `ctx.ai.agent`. Empty/absent = no agent calls. **Trusted tier only.**
- `edit` (boolean) — required for `ctx.ai.editFile` / `ctx.ai.createFile`
  (trusted only). The host applies the resulting file changes through the
  shared editor/vault chokepoint; the plugin never writes the filesystem
  directly.

### Trusted tier — `PluginContext.ai`

```ts
ctx.ai.chat({
  sessionId: 'my-plugin-session',   // plugin-owned; rig persists history by id
  prompt: 'Summarize the active doc',
  onEvent: (e) => { /* e.type ∈ 'text'|'thinking'|'error'|'done' */ },
  useSharedSession: true,            // optional: also surface in aiPanel
});

ctx.ai.agent({
  feature: 'study',                  // must be in permissions.ai.agents
  instruction: 'Review my notes',
  onEvent: (e) => { /* 'done' | 'error' */ },
});

// AI-driven file edits (trusted only — requires permissions.ai.edit). The
// host reads/writes the file through the vault manager; the plugin only
// states intent + receives streaming progress.
await ctx.ai.editFile({
  path: 'notes/summary.md',           // vault-relative
  instruction: 'Summarize as 3 bullets',
  onEvent: (e) => { /* 'text' | 'error' | 'done' */ },
});
await ctx.ai.createFile({
  path: 'notes/new-note.md',
  instruction: 'Draft a meeting notes skeleton',
  onEvent: (e) => {},
});
```

`onEvent` mirrors `CliStreamEvent` but filters out `tool_*` / `file_change`
events — plugins see only text / thinking / error / done. Provider/model
come from the host's `useAiConfigStore`; apiKey never appears in `ctx` or
RPC params.

### Sandbox tier — `ai:chat` RPC

```js
const id = crypto.randomUUID();
window.addEventListener('message', (ev) => {
  const m = ev.data;
  if (m.id !== id) return;
  if (m.type === 'ai-stream') {
    // m.event: { type: 'text'|'thinking'|'error'|'done', content? }
  } else if (m.type === 'response') {
    // stream terminates — check m.error
  }
});
window.parent.postMessage(
  { type: 'request', id, method: 'ai:chat',
    params: { sessionId: 's', prompt: 'hello' } },
  '*',
);
```

Sandbox plugins cannot call feature agents (canonical agent files live
under the vault's `__<feature>__/` directory; sandbox isolation makes
exposing them safely out-of-scope). Use the trusted tier if you need
`ai.agent`.

### Examples

- `examples/plugins/ai-chat-demo/` — trusted, demonstrates `ctx.ai.chat` +
  `ctx.ai.agent` (study).
- `examples/plugins/ai-chat-sandbox-demo/` — sandbox, demonstrates `ai:chat`
  RPC + `ai-stream` event consumption.

---

## Host environment (theme + locale)

Plugins that render UI need to track the host's resolved theme (bright/dark)
and the user's locale, and react when the user switches either mid-session.
The host signals the current values and pushes change events; **plugins bring
their own i18n bundles** — the host's `t()` is NOT exposed. Only the locale
identifier string (e.g. `'zh'`, `'en'`) is delivered.

### Trusted tier — `PluginContext.env`

```ts
import type { PluginContext } from 'quill-plugin-sdk';

export function activate(ctx: PluginContext) {
  console.log('theme:', ctx.env?.theme, 'locale:', ctx.env?.locale);

  ctx.addDisposable(
    ctx.env!.onThemeChange((t) => {
      // re-render with the new theme
    }),
  );

  ctx.addDisposable(
    ctx.env!.onLocaleChange((l) => {
      // swap your i18n bundle to the new locale
    }),
  );
}
```

- `env.theme`: resolved `'light' | 'dark'` — `'system'` is resolved by the
  host before delivery, plugins never see `'system'`.
- `env.locale`: current locale string.
- `env.onThemeChange(cb)` / `env.onLocaleChange(cb)`: subscribe to mid-session
  changes; return a `Disposable` for cleanup (push into `ctx.addDisposable`).

### Sandbox tier — `env:get` RPC + `env-event` push

Sandbox plugins call `env:get` on activate to seed, then listen for
`env-event` messages to update in place:

```js
// In the sandbox iframe
window.parent.postMessage({
  type: 'request', id: 'env-seed', method: 'env:get', params: {}
}, '*');

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (msg.type === 'response' && msg.id === 'env-seed') {
    applyEnv(msg.result.theme, msg.result.locale);
  }
  if (msg.type === 'env-event') {
    if (msg.event === 'theme') applyTheme(msg.value);
    if (msg.event === 'locale') applyLocale(msg.value);
  }
});
```

No permission declaration is required — env is non-sensitive (no file system,
no network, no credentials; just the current theme + locale string).

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
- [`examples/plugins/feature-panel-sample`](../examples/plugins/feature-panel-sample)
  — trusted tier. Contributes a `features` sidebar panel (`notes-panel`,
  left slot, inline-SVG icon, `order`, `badge`) + a **Notes: Open Panel**
  command. Demonstrates the data-driven activity bar / sidebar mounting
  path and the in-process editor-store access from a panel component.
- [`examples/plugins/plugin-export-demo`](../examples/plugins/plugin-export-demo)
  — trusted tier. Exercises the contribution points in one tiny plugin: an
  `exporters` entry (active doc → `.txt` with a header), a
  `fileTemplates` entry (**New Meeting Notes** palette command), a
  `keybindings` entry (`Cmd/Ctrl+Alt+Shift+T` → a **Demo: Ping** command), a
  `containers` entry (`:::quote` blockquote via `window.React` + `createElement`),
  and an `exportEnhancers` entry (post-render DOM mutation during export).
  Pure ESM, no JSX, no bundler step.

Install any via Settings → Plugins → 从文件夹安装… to manually QA the full
pipeline.
