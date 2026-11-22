# Folyn Extension Development Guide

Folyn's microkernel lets you extend the editor at runtime: install a extension
folder and its file types, commands, container directives, feature panels, or
tool windows become available immediately — no recompile, no repackage.

This guide covers the manifest schema, the two execution tiers, contribution
points, the permissions model, lifecycle, the TOFU approval flow, local
development, and packaging. It references the two sample extensions in
[`examples/extensions/`](../examples/extensions/).

- [Quick start](#quick-start)
- [At a glance: what the host provides](#at-a-glance-what-the-host-provides)
- [The two tiers](#the-two-tiers)
- [manifest.json schema](#manifestjson-schema)
- [Contribution points](#contribution-points)
- [The ExtensionModule export contract (trusted tier)](#the-extensionmodule-export-contract-trusted-tier)
- [The sandbox RPC protocol (sandbox tier)](#the-sandbox-rpc-protocol-sandbox-tier)
- [Permissions model](#permissions-model)
- [Lifecycle: activate / deactivate / dispose](#lifecycle-activate--deactivate--dispose)
- [TOFU approval flow](#tofu-approval-flow)
- [Local development](#local-development)
- [Packaging](#packaging)
- [Collectors (activity collection)](#collectors-activity-collection)
- [Reference: sample extensions](#reference-sample-extensions)

---

## At a glance: what the host provides

A Folyn extension is a folder under `~/.folyn/extensions/<id>/` with a
`manifest.json` + assets. The host gives you five things:

### 1. Two execution tiers

| Tier      | Isolation                                                             | Capability surface                       | Trust gate                     |
| --------- | --------------------------------------------------------------------- | ---------------------------------------- | ------------------------------ |
| `sandbox` | separate `WebviewWindow` or iframe, origin `folyn-extension://localhost` | host RPC bridge only — no Tauri APIs     | none (sandbox IS the boundary) |
| `trusted` | main webview realm (in-process)                                       | full host realm + Zustand stores + Tauri | TOFU: user must **批准并授权** |

### 2. Contribution points

Declared in `contributes` in the manifest; wired into host registries on
activate; auto-unregistered on deactivate.

| Point                         | Sandbox? | Trusted? | What it adds                                                         |
| ----------------------------- | -------- | -------- | -------------------------------------------------------------------- |
| `commands`                    | ✓        | ✓        | palette entry (⌘P) — `extension.<extensionId>.<id>`                        |
| `tools` (with `window: true`) | ✓        | ✓        | "Open: <title>" command → Tauri WebviewWindow                        |
| `fileTypes`                   | ✗        | ✓        | file extension → handler mapping                                     |
| `containers`                  | ✗        | ✓        | `:::name` Markdown directive → React component                       |
| `features`                    | ✗        | ✓        | sidebar panel slot (activity bar icon + component) — left only (MVP) |
| `exporters`                   | ✗        | ✓        | custom export format → "Export as <label>" palette command           |
| `fileTemplates`               | ✗        | ✓        | new-file template → "New <label>" palette command                    |
| `keybindings`                 | ✗        | ✓        | Tauri accelerator → command id (app-scope keydown)                   |
| `exportEnhancers`             | ✗        | ✓        | post-render DOM mutation during HTML/PDF export                      |
| `markdownCodeRenderers`       | ✗        | ✓        | lang-tagged fenced code block → React renderer                       |
| `editorLanguages`             | ✗        | ✓        | CodeMirror language support for fenced source blocks in the editor     |
| `highlightGrammars`          | ✗        | ✓        | highlight.js grammar for fenced code blocks in preview + CodeFileViewer |
| `storageProviders`             | ✗        | ✓        | cloud object-storage provider in Settings → Storage & Sharing       |
| `collectors`                   | ✗        | ✓        | activity collector (poll / webhook) → events in the activity timeline |
| `activityDisplay`              | ✗        | ✓        | icon/color/detail-fields/metric card for event types (declarative)   |
| `entityTypes`                  | ✗        | ✓        | custom entity types for the entity graph (declarative)               |

### 3. RPC method table (sandbox tier — host-mediated)

Sandbox extensions call host capabilities via `postMessage` (iframe transport) or
`fetch('folyn-extension://localhost/<id>/rpc', ...)` (tool-window transport). Both
hit the same `dispatchExtensionRpc` table — same permission checks, same path
resolution.

| Method                  | Params                  | Required permission             | Returns                                                                                  |
| ----------------------- | ----------------------- | ------------------------------- | ---------------------------------------------------------------------------------------- |
| `fs:read`               | `{ path }`              | `fs.scope` (glob)               | `string` (file contents)                                                                 |
| `fs:write`              | `{ path, content }`     | `fs.scope`                      | `void` → `{ ok: true }`                                                                  |
| `fs:list`               | `{ path }`              | `fs.scope`                      | `DirEntry[]`                                                                             |
| `http:fetch`            | `{ url, init? }`        | `http.origins` (allowlist)      | `{ status, headers, body }`                                                              |
| `clipboard:read`        | `{}`                    | `clipboard: true`               | `string \| null`                                                                         |
| `clipboard:write`       | `{ text }`              | `clipboard: true`               | `void` → `{ ok: true }`                                                                  |
| `dialog:open`           | `{}`                    | `dialog: true`                  | `string \| null` (file path)                                                             |
| `dialog:save`           | `{ content }`           | `dialog: true`                  | `string \| null`                                                                         |
| `vault:read-active-doc` | `{}`                    | `vault.readActive: true`        | `{ path, content } \| null`                                                              |
| `vault:insert-content`  | `{ content }`           | `vault.insertContent: true`     | `{ ok: true }`                                                                           |
| `window:open`           | `{ toolId }`            | `window: true`                  | `{ opened: true, toolId }`                                                               |
| `ai:chat`               | `{ sessionId, prompt, provider?, model?, images? }` | `ai.chat: true` | iframe: streams `ai-stream` events, final `response`; tool window: `{ jobId }` (poll `ai:chat-poll`) |
| `ai:chat-poll`          | `{ jobId }`             | `ai.chat: true`                 | tool window only: `{ done, error?, text, thinking }` (deltas since last poll) |
| `storage:get`           | `{ key }`               | _(none — own-namespace)_        | stored value or `null` — same keys as trusted `api.storage`              |
| `storage:set`           | `{ key, value }`        | _(none — own-namespace)_        | `{ ok: true }` — shares the trusted `api.storage` backend               |
| `env:get`               | `{}`                    | _(none — env is non-sensitive)_ | `{ theme: 'light'\|'dark', locale: string }`                                             |

**Host-pushed env events** (no request needed; the host pushes these to the
iframe whenever the user switches theme or locale mid-session):

```jsonc
{ "type": "env-event", "event": "theme",  "value": "dark" }
{ "type": "env-event", "event": "locale", "value": "zh" }
```

Extensions should call `env:get` on `activate` to seed the initial values, then
listen for `env-event` messages to update in place.

**Response shape**: success → JSON object per the "Returns" column; failure →
`{ "error": "<message>" }` with HTTP 200; timeout (30 s) → HTTP 504 with
`{ "error": "rpc timeout" }`. Always check `json.error` before reading
`json.result`-shape fields.

### 4. Manifest validation rules (the spec authors must follow)

- `id`: kebab-case, `^[a-z0-9]+(-[a-z0-9]+)+$` (at least one hyphen). Folder
  name under `~/.folyn/extensions/` MUST equal `id`.
- `version`: non-empty string (semver-ish recommended).
- `tier`: `"sandbox"` or `"trusted"`.
- `main`: non-empty string (relative path to entry module).
- `sandbox` tier requires `html` (HTML entry loaded into the iframe/window).
- File integrity: per-file SHA-256 computed at install time; trusted tier
  re-verifies `main`'s hash before `import()`. Tampering → activation refused.

### 5. CSP for sandbox extensions (what HTML/JS can do)

Every `folyn-extension://localhost/<id>/<file>` response carries this CSP header:

```
default-src 'none';
  script-src 'unsafe-inline' folyn-extension:;
  style-src  'unsafe-inline';
  connect-src folyn-extension:;
```

What this means for authors:

- ✓ Inline `<script>` and inline `<style>` in your HTML.
- ✓ `<script src="index.js">` (same-scheme, your extension's own files).
- ✓ `fetch('folyn-extension://localhost/<id>/rpc', ...)` (the RPC bridge).
- ✗ No remote scripts, styles, fonts, images, or `connect-src` to any other
  origin. If you need network access, declare `http.origins` and call
  `http:fetch` — the host performs the request in Rust (no CSP).
- ✗ No `iframe` embedding, no web workers from blob: (only `folyn-extension:`).
- ✗ No `default-src` fallback — every directive is explicit.

Note: `'self'` is intentionally NOT used. Chromium does not resolve `'self'`
to the document origin for custom schemes like `folyn-extension://`, so the
explicit scheme source `folyn-extension:` is required instead.

---

---

## Quick start

The fastest path: copy [`examples/extensions/markdown-todo`](../examples/extensions/markdown-todo)
into a folder, then install it from **Settings → Extensions → 从文件夹安装…**.
Pick the folder (its name must be the extension's kebab-case id, e.g.
`markdown-todo`), and the extension appears in the list. Trusted-tier extensions
need an extra **批准并授权** click (see [TOFU](#tofu-approval-flow)).

After install + activate:

- The `markdown-todo` extension contributes a `:::todo` container directive
  (type `/todo` in the slash menu) and a **Todo: Insert Checklist** command
  (⌘P → "Todo: Insert Checklist").
- The `hello-tool` extension (sandbox tier) contributes a **Hello: Greet**
  command that writes to the clipboard via the host RPC bridge.

### Install the SDK

Type your manifest against `folyn-extension-sdk` — the type package published on
[npm](https://www.npmjs.com/package/folyn-extension-sdk)
(manifest schema, contribution points, `ExtensionModule`, AI capability types,
and dev helpers like `defineExtension` / `validateManifest`). It has no runtime
dependency; React is a peer type only (erased at build for type-only
consumers).

```bash
npm install folyn-extension-sdk
```

```ts
// index.ts — a trusted-tier extension's entry module
import type { ExtensionModule, ExporterHandler } from "folyn-extension-sdk";

const exportTxt: ExporterHandler = async (content, ctx) =>
  `# ${ctx.filePath}\n\n${content}`;

export const exporters: Record<string, ExporterHandler> = {
  "txt-with-header": exportTxt,
};
export const commands = { ping: () => console.info("pong") };
```

Internal workspace extensions depend on `@folyn/extension-host` (which re-exports
the full SDK surface) — `import` from either works. The runtime microkernel
(`ExtensionHost`, `extensionHost` singleton) lives in `@folyn/extension-host`; the SDK
stays publishable and runtime-free.

---

## The two tiers

Every extension declares `tier: "sandbox" | "trusted"` in its manifest. The tier
determines the loader, isolation boundary, capability surface, and which
contribution points are available.

|                             | **sandbox**                                                                                                            | **trusted**                                                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Loader                      | hidden `<iframe sandbox="allow-scripts">` (no `allow-same-origin`), loaded from `folyn-extension://localhost/<id>/<html>` | `import(/* @vite-ignore */ blobUrl)` into the **main webview realm**                                                                      |
| Isolation                   | cross-origin opaque origin; no parent DOM, no Tauri APIs, no localStorage                                              | none — runs in the host realm; can read Zustand stores, call Tauri, touch the DOM                                                         |
| Capability surface          | host RPC bridge (`postMessage`) only; manifest `permissions` gate every call                                           | full host realm access; no per-extension runtime ACL, `permissions` informational (see [Permissions model](#permissions-model))        |
| Trust gate                  | none (sandbox IS the boundary)                                                                                         | TOFU: user must **批准并授权** before activation                                                                                          |
| Allowed contribution points | `commands`, `tools` (window)                                                                                           | `commands`, `fileTypes`, `containers`, `features`, `tools`, `markdownCodeRenderers`, `editorLanguages`, `highlightGrammars`, `storageProviders`, `collectors` |
| Hot unload                  | destroy iframe element                                                                                                 | `dispose()` adapters + `URL.revokeObjectURL(blobUrl)`                                                                                     |
| Bundle requirement          | HTML + JS loaded by the iframe via `folyn-extension://`                                                                   | self-contained ESM bundle (no relative/remote imports at eval time — blob URLs can't resolve them)                                        |

**When to use which:**

- **sandbox** when the extension is a self-contained tool/launcher that doesn't
  need to render inside the editor (no file-type handlers, no Markdown
  container directives). Safest for untrusted third-party code.
- **trusted** when the extension must render inline React/CodeMirror components
  (file-type handler, `:::container` directive, feature panel) or needs deep
  host integration. Requires the user to explicitly approve (TOFU).

### Render isolation (trusted tier — host guarantee)

Because the `extension-sdk` is public and third-party authors ship extensions, the
host treats **render isolation as a hard contract**: no extension render throw,
lazy-factory throw, or `activate()` failure may crash the host app. You do
not need to do anything to get this — it is applied host-side, at the
adapter that registers your component, regardless of how your component is
written. Specifically:

- A component you contribute (`fileTypes[].Editor`/`Preview`,
  `markdownCodeRenderers[].component`, `containers[].component`,
  `features[].component`) that **throws during render** is caught by a
  `PanelErrorBoundary`. The broken surface shows an inline "面板加载失败"
  fallback; the rest of the app (other tabs, the sidebar, the editor) keeps
  working. **Your throw never white-screens the host.**
- Isolation is per-instance: one broken `:::box` or ` ```lang ` block does
  not disable its siblings.
- The throw is recorded to the extension's row in Settings → Extensions (an ⚠
  "render error" line with the surface label + a Clear button), so the user
  can see which extension errored.
- If your `activate()` throws **after** registering contributions, the host
  rolls back everything registered during that activation (commands, file
  types, containers, …) so no half-wired extension lingers. The extension enters
  the `failed` state; the user can fix and re-activate.

Practical guidance: you may still `throw` from render for genuine
invariant violations (the host will contain it), but prefer rendering an
inline error state for expected failure modes (missing data, bad input) so
the user sees your message rather than the generic boundary fallback.

---

## manifest.json schema

Every extension folder has a `manifest.json` at its root. Full schema:

```jsonc
{
  // Required. Globally-unique kebab-case id (matches ^[a-z0-9]+(-[a-z0-9]+)+$).
  // The folder name under ~/.folyn/extensions/ MUST equal this id.
  "id": "my-extension",
  // Required. Human-readable display name.
  "name": "My Extension",
  // Required. Semver-ish version string.
  "version": "1.0.0",
  "author": "Jane Doe",
  // Engine compat, e.g. ">=0.1.0". Optional but recommended.
  "folyn": ">=0.1.0",
  // Required. "sandbox" or "trusted" (see above).
  "tier": "trusted",
  // Required. Entry module path (relative to the extension folder).
  //   sandbox: the JS loaded inside the iframe (typically "index.js")
  //   trusted: the ESM bundle import()-ed into the host realm
  "main": "index.js",
  // Required for sandbox tier. HTML entry loaded into the iframe.
  "html": "index.html",

  // Optional. Declared capabilities the extension may use. Enforced differently
  // per tier — see "Permissions model" below.
  "permissions": {
    "fs": { "scope": ["data/**", "vault:read-active"] },
    "http": { "origins": ["https://api.example.com"] },
    "clipboard": true,
    "dialog": true,
    "window": true,
    "vault": { "readActive": true, "insertContent": true },
  },

  // Optional. The contribution points this extension adds to the app.
  "contributes": {
    "commands": [
      {
        "id": "greet",
        "title": "Greet",
        "icon": "👋",
        "keywords": ["hi"],
        "run": "greet",
      },
    ],
    "fileTypes": [
      {
        "id": "erd",
        "extensions": ["erd"],
        "handler": "erd",
      },
    ],
    "containers": [
      {
        "name": "callout",
        "icon": "💡",
        "label": "Callout",
        "category": "layout",
        "component": "callout",
        "template": ":::callout\n:::",
        "description": "A callout",
      },
    ],
    "features": [
      {
        "id": "my-panel",
        "panel": "left",
        "component": "my-panel",
        "icon": "<svg>...</svg>",
        "title": "My Panel",
        "order": 50,
        "badge": "NEW",
      },
    ],
    "tools": [
      {
        "id": "my-tool",
        "title": "My Tool",
        "icon": "🛠",
        "window": true,
        "entry": "index.html",
      },
    ],
  },
}
```

### Validation rules

The manifest is validated at install time (Rust `validate_manifest` + TS
`ExtensionHost.validateManifest`). The rules:

- `id` must be kebab-case (`^[a-z0-9]+(-[a-z0-9]+)+$`) — at least one hyphen,
  lowercase alphanumerics only. `my-extension` ✓; `MyExtension` ✗; `myextension` ✗.
- `version` must be a non-empty string.
- `tier` must be `sandbox` or `trusted`.
- `main` must be a non-empty string.
- `sandbox` tier requires `html`.

---

## Contribution points

Each contribution is a plain-data descriptor in `contributes`. The host
adapts it into the matching app registry when the extension activates.

### commands

```jsonc
"commands": [{ "id": "greet", "title": "Greet", "icon": "👋", "keywords": ["hi"], "run": "greet" }]
```

- `id` is the command's local id; the registered palette id becomes
  `extension.<extensionId>.<id>` (e.g. `extension.hello-tool.greet`).
- `title` is the palette label (prefixed with the extension name in the UI).
- `run` is the **entry-ref** — a string indexing into the extension module's
  `commands` map (trusted) or the command id dispatched to the iframe
  (sandbox).

### fileTypes (trusted only)

```jsonc
"fileTypes": [{ "id": "erd", "extensions": ["erd"], "handler": "erd" }]
```

- `handler` is the entry-ref into the module's `handlers` map: a
  `FileTypeProvider`. The manifest entry gives the type's `id` and
  `extensions`; everything about how it opens is on the provider.
- `modes` lists how the file can be shown, and the editor's mode switch
  offers them. A mode is the host's own editor (`kind: 'shell-editor'`), your
  component (`kind: 'component'`, receiving `EditorProps` or `PreviewProps`),
  or two other modes side by side (`kind: 'split'`). Ids are free: `edit` /
  `split` / `preview` are the usual ones, a custom id (`canvas`) works too.
  `defaultMode` picks the one a file opens in (else the first).
- For a text format without a grammar of its own, `editorLanguage` names the
  language the host editor highlights it as (`'SQL'`), and `editorAccessory`
  is a component laid over that editor (a status button).
- `label` names the type in the file tree's 新建 menu; `contributes.fileTemplates`
  gives new files their starter content.

```ts
import type { ExtensionModule, FileTypeProvider } from 'folyn-extension-sdk';

const erd: FileTypeProvider = {
  id: 'erd',
  extensions: ['erd'],
  needsFileContent: true,
  defaultMode: 'split',
  modes: [
    { id: 'edit', kind: 'shell-editor' },                                  // the host's CodeMirror
    { id: 'split', kind: 'split', split: { left: 'edit', right: 'preview' } },
    { id: 'preview', kind: 'component', component: ErdPreview },           // receives PreviewProps
  ],
};

export default { handlers: { erd } } satisfies ExtensionModule;
```

### containers (trusted only)

```jsonc
"containers": [{ "name": "todo", "icon": "✅", "label": "Todo", "category": "data", "component": "todo", "template": ":::todo\n- [ ] item\n:::", "description": "A todo list" }]
```

- `name` is the directive name (what follows `:::` in Markdown).
- `icon` accepts three forms: an inline `<svg>...</svg>` string (rendered verbatim via the host's `IconFromSvg`), a `.svg` file path relative to the extension install dir (the host reads it at activate via `read_extension_file`; missing file → warn + empty fallback), or an emoji/short string rendered as plain text (the builtin convention, e.g. `💡`).
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
  built-in ids (`files`, `wiki`, `calendar`). A collision
  (with a built-in or an already-registered extension panel) is logged and the
  second registration is refused.
- `panel` is `left` / `right` / `bottom`. **MVP implements `left` only** —
  `right` and `bottom` declarations are logged + skipped (right/bottom shell
  slots are a follow-up task).
- `component` is the **entry-ref** into the module's `features` map (see the
  `ExtensionModule` export contract below). The component must be a React
  component (renders inside `PanelErrorBoundary`, so a throwing extension panel
  won't white-screen the sidebar).
- `icon` is **required**. Either a raw inline SVG string
  (`<svg ...>...</svg>`) or a `ThemeIcon` name resolved against the host's
  `assets/icons/*.svg`. Raw SVG is the self-contained path for extension authors.
- `title` is the tooltip + accessibility label. Defaults to
  `<extensionId>/<id>` if absent.
- `order` is optional. Built-ins occupy slots 0 (files), 10 (wiki), 20
  (clips), 40 (calendar). A extension panel that omits `order` is
  assigned the next-after-builtin slot (≥100) by registration order. The
  activity bar renders panels sorted by `(order, registration seq)`.
- `badge` is optional (`string | number`). When present it renders as a small
  accent-colored text dot on the activity-bar icon. Useful for unread counts
  or status flags.
- **Trusted-tier only** (Decision Q1). Sandbox extensions cannot contribute
  sidebar panels — they contribute `tools` (tool windows) for full-page UI
  instead. The asymmetry is intentional: sandbox isolation can't mount a
  same-realm React component.
- **Deactivate fallback**: when the extension deactivates, its panel is
  unregistered. If the panel was active at deactivate time, the active panel
  falls back to `files` (and `editorStore.activePanel` is synced so WorkArea's
  tab filter follows).
- **Persisted-active fallback**: if `editorStore.activePanel` points at an
  uninstalled extension's panel id on next launch, the `registerBuiltinPanels`
  mirror re-routes it to `files`.

#### Reference: sample feature-panel extension

- [`examples/extensions/feature-panel-sample`](../examples/extensions/feature-panel-sample)
  — minimal trusted-tier extension that contributes a left sidebar panel
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
  the extension's HTML entry from `folyn-extension://localhost/<id>/<entry>`. The
  window's origin is `folyn-extension://localhost` (macOS/Linux) /
  `http://folyn-extension.localhost` (Windows) — isolated from the main app.
  `window: false` would render inline (MVP: `window: true` only; inline
  panels are a follow-up).
- `entry` is the HTML entry file (sandbox tier). Trusted tier uses a
  component entry-ref (deferred — this MVP ships sandbox-only tool windows).
- The host registers an "Open: <title>" command per tool, so ⌘P →
  "Open: Hello Tool" creates a new window. Multi-instance: each invocation
  opens a fresh window with a unique label.
- The extension's HTML reaches host capabilities via **fetch-RPC** over the
  `folyn-extension://` scheme:

  ```js
  // POST folyn-extension://localhost/<extension-id>/rpc
  // body: { "method": "<rpc-method>", "params": { ... } }
  // response: 200 with `<return-value>` (object/string/null per method) on
  //           success, or 200 with `{ "error": "<msg>" }` on RPC failure,
  //           or 504 with `{ "error": "rpc timeout" }` after 30s.
  const res = await fetch("folyn-extension://localhost/<extension-id>/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      method: "vault:insert-content",
      params: { content: "\nhello\n" },
    }),
  });
  const json = await res.json(); // { ok: true } on success
  if (!res.ok || json?.error) {
    // null-safe: success body may be a primitive
    throw new Error(json?.error || `HTTP ${res.status}`);
  }
  ```

  The Rust URI handler emits a `extension-rpc-request` event that the main
  webview dispatches through the shared `dispatchExtensionRpc` (same permission
  checks + path resolution as the iframe bridge). See "At a glance" above for
  the method table and "Sandbox RPC protocol" below for protocol details. No
  Tauri SDK dependency in the extension bundle — plain `fetch()` only.

  **Streaming chat from a tool window**: the fetch transport has no push
  channel (no `ai-stream` events), so `ai:chat` there starts the chat as a
  host-side job and returns `{ jobId }` immediately. Poll `ai:chat-poll` every
  ~150ms and append the returned `text` / `thinking` deltas to the UI until
  `done` (or `error`). This also sidesteps the 30s fetch timeout — long turns
  no longer hold a single request open.

- Closing the WebviewWindow (user OS-close or extension deactivate) destroys
  the window. Extension deactivate closes ALL of that extension's open tool
  windows in the same dispose pass that unregisters commands.

#### Reference: sample tool extensions

- [`examples/extensions/hello-tool`](../examples/extensions/hello-tool) — minimal
  sandbox tool that writes to the clipboard via the RPC bridge.
- [`examples/extensions/markdown-table`](../examples/extensions/markdown-table) —
  end-to-end demo: textarea → markdown table → Insert button →
  `vault:insert-content` RPC → table appended to the active doc.

### exporters (trusted only)

```jsonc
"exporters": [
  { "id": "txt-with-header", "format": "txt-header", "label": "Text with header", "fileExtension": "txt", "run": "txt-with-header" }
]
```

- `format` is the output format id (unique within the extension); the palette
  command id becomes `extension.<extensionId>.export.<format>`.
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
  `fileTemplateRegistry` (keyed `<extensionId>.<templateId>`) and surfaces a
  palette command `extension.<extensionId>.new.<templateId>` titled
  `New <label>`. Running the command prompts for a save path (default under
  the current vault root) and writes `template` verbatim, then refreshes the
  file tree.
- ponytail: the file-tree right-click "新建" submenu is NOT wired yet — its
  inline-rename flow keys file content off the extension via
  `prefsStore.fileTemplates`, which can't carry an arbitrary body. The
  palette command is the MVP surface; the submenu group is the upgrade path
  (read `getExtensionFileTemplates()`).

### keybindings (trusted only)

```jsonc
"keybindings": [
  { "command": "extension.my-extension.greet", "key": "Control+Alt+Shift+T", "mac": "Cmd+Alt+Shift+T", "when": "..." }
]
```

- `command` is a command id — a extension-contributed command
  (`extension.<extensionId>.<id>`) or a built-in (e.g. `action.toggle-theme`).
  The host looks it up in `commandRegistry` and runs it when the key fires.
- `key` is a Tauri accelerator string (`Cmd+Shift+K`, `Control+Alt+T`).
- `mac` overrides for macOS. `when` is an optional activation clause
  (opaque string, reserved for forward-compat — MVP registers globally).
- ponytail: the project has no `@tauri-apps/extension-global-shortcut`
  dependency, so bindings are app-scope `keydown` listeners — they fire
  only while the app window has focus, not when backgrounded. The OS-global
  upgrade path is `extension-global-shortcut`'s `register(accelerator, handler)`
  - `unregister(accelerator)` in dispose.

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
  `body.appendChild` directly — the extension module runs in the host realm as
  a trusted blob-URL `import()`.
- The `body` handed to the enhancer is the `[data-container]` element
  itself, unless it contains a `[data-file-preview-body]` child (a
  file-preview rendered inside a container directive), in which case the
  inner body is used. Action buttons are stripped before the call.
- ponytail: enhancer failures are swallowed best-effort
  (`.catch(() => {})`) — a broken enhancer must not abort the whole export.
  Multiple extensions registering for the same key → last-registered-wins; the
  upgrade path is a per-extension precedence list if colliding enhancers ever
  need to compose.

### markdownCodeRenderers (trusted only)

```jsonc
"markdownCodeRenderers": [
  { "language": "plantuml", "aliases": ["puml", "pu"], "component": "PlantUmlMarkdownBlock" }
]
```

- `language` is the fenced code block language label (the string after the
  opening ` ``` `) that this renderer handles. The host's
  `MarkdownPreview` looks up the fence's `language-*` class on the rendered
  `<pre>` against the registry; a hit dispatches to the extension component
  instead of the default `CodeBlockWrapper`.
- `aliases` (optional) are alternate language labels that resolve to the
  same renderer (e.g. `puml` / `pu` for PlantUML).
- `component` is the **entry-ref** into the module's `markdownCodeRenderers`
  map. The component receives `MarkdownCodeRendererProps`
  (`{ source, language, resolvedLanguage, filePath }`) and renders the
  block (typically a transformed/preview rendering of `source`).
- Builtin `mermaid` registers before extensions at app boot, so extension
  registrations for the same `language` are first-registered-wins. A miss
  falls back to `CodeBlockWrapper` (the default syntax-highlighted `<pre>`).
- ponytail: the renderer is host-realm React (the trusted blob `import()`
  shares the host's Reactor); bundle React yourself and you'll get the
  "Invalid hook call" two-React error. Use `window.React` via a
  `resolveReact()` helper (mirror of `resolveCodemirror()` below). See
  `folyn-extension-sdk/folyn-extension-plantuml/src/index.ts` `PlantUmlMarkdownBlock` for
  the canonical shape.

### editorLanguages (trusted only)

```jsonc
"editorLanguages": [
  { "id": "plantuml", "aliases": ["puml", "pu"], "entry": "plantumlLanguage" }
]
```

- `id` is the language id the markdown editor feeds to CodeMirror's
  `codeLanguages` lookup so fenced ` ```lang ` blocks get the right
  `LanguageSupport` extension. The host iterates `editorLanguageRegistry`
  (aliases included) before falling back to `@codemirror/language-data`.
- `aliases` (optional) are alternate ids that resolve to the same
  `LanguageSupport` factory (so ` ```puml ` and ` ```plantuml `
  both light up the editor).
- `entry` is the **entry-ref** into the module's `editorLanguages` map. The
  factory's type is `EditorLanguageFactory = () => unknown`; the host
  narrows the return to `LanguageSupport` for CodeMirror 6.
- **Trusted-tier `window.codemirrorLanguage` requirement**: trusted
  extensions load via blob URL, so `import '@codemirror/language'` resolves
  to a _second_ module instance whose `LanguageSupport` the host's
  `EditorState` won't reliably apply (module-instance mismatch — same
  failure mode as bundling your own React). Resolve the host's
  `@codemirror/language` lazily via a `resolveCodemirror()` helper that
  reads `window.codemirrorLanguage` (the host sets it in `main.tsx` before
  any trusted extension is `import()`-ed). See
  `folyn-extension-sdk/folyn-extension-plantuml/src/codemirror.ts` for the canonical
  pattern — it mirrors the `resolveReact()` approach for `window.React`.

### highlightGrammars (trusted only)

Registers a highlight.js grammar so the preview's fenced ` ```lang ` code
blocks and the `CodeFileViewer` get syntax highlighting for languages the
built-in `hljs` bundle doesn't ship. Distinct from `editorLanguages`:
`editorLanguages` lights up the **CodeMirror editor** (in-place editing),
`highlightGrammars` lights up the **rendered preview / file viewer** (read-only
`<pre><code>` via highlight.js).

```jsonc
"highlightGrammars": [
  { "name": "plantuml", "aliases": ["puml", "pu"], "entry": "plantumlGrammar" }
]
```

- `name` is the highlight.js language name to register (e.g. `plantuml`). It
  becomes the canonical id; `aliases` are registered as additional lookup
  keys via hljs's own alias mechanism.
- `aliases` (optional) are alternate fence languages / file extensions that
  resolve to this grammar (so ` ```puml ` hits the same grammar as
  ` ```plantuml `).
- `entry` is the **entry-ref** into the module's `highlightGrammars` map.
  The factory's type is `HighlightGrammarFn = (hljs: unknown) => unknown`;
  it receives the host's `hljs` instance and returns a language definition
  the host registers via `hljs.registerLanguage(name, fn)`. Typed `unknown`
  because the SDK has no `highlight.js` dependency — the host narrows.

### storageProviders (trusted only)

Adds a cloud object-storage provider to **Settings → Storage & Sharing**
(image hosting + HTML sharing), alongside the built-in R2 / Qiniu / OSS.

```jsonc
"storageProviders": [
  {
    "id": "smms",
    "labelKey": "ext.smms.label",
    "icon": "🖼️",
    "capabilities": { "image": true, "html": false },
    "configForm": "form",
    "isConfigured": "isConfigured",
    "uploadImage": "uploadImage",
    "defaultConfig": { "token": "" }
  }
]
```

- `id` is unique across built-ins + extensions. It keys the on-disk config
  file (`~/.folyn/image-hosts/<id>.json`) and the store entry.
- `labelKey` is an i18n key the settings selector resolves with the host's
  `t()`; ship your own bundle (the host does **not** expose its message
  catalog) and call `useTranslation()` in your form.
- `icon` is an emoji, inline `<svg>`, `.svg` path, or a host `ThemeIcon`
  name (the settings UI renders a `ThemeIcon` when the name is known,
  else the string as text).
- `capabilities.image` / `capabilities.html` declare which upload paths
  this provider serves. Declare `image: true` only if you ship an
  `uploadImage`; `html: true` only if you ship an `uploadHtml`.
- `configForm` is the **entry-ref** into the module's `storageProviders`
  map for a React component of shape `ComponentType<StorageConfigFormProps>`
  — `{ config: unknown; onSave: (cfg) => Promise<void>; onRemove: () =>
  Promise<void> }`. Own your draft state; narrow the opaque `config` to
  your own type at the boundary. The host wraps the form in an error
  boundary so a render throw is isolated.
- `isConfigured` is the **entry-ref** to a `(config: unknown) => boolean`
  — whether the saved config is populated enough to attempt an upload.
  Controls whether the selector shows the provider as configured.
- `uploadImage` / `uploadHtml` are **entry-refs** to
  `(bytes, ext, config) => Promise<publicUrl>` and
  `(html, config) => Promise<publicUrl>`. The config is whatever your
  form saved (opaque to the host). Since trusted code runs in-realm, you
  can `fetch()` your cloud API directly with your own signing.
- `defaultConfig` is seeded into the store when the provider is first
  selected.

The host routes the settings UI and the image-paste / markdown→HTML share
flows through one `StorageProviderRegistry`; built-in and extension
providers are the same kind of thing, so an uninstall cleanly removes your
entry and its saved config resets to your `defaultConfig`.

### Collectors (activity collection — trusted only)

A collector pulls or receives data from one source and converts it into
standard activity events (activity timeline + entity graph). The collector
never touches storage, dedup, or entity resolution — the host owns the whole
ingest pipeline. Full field tables (`contributes.collectors[]`,
`activityDisplay[]`, `entityTypes[]`, `CollectorEvent`, `CollectorContext`):
see `extension-sdk-reference.md` "Collectors (activity collection)". Canonical
example: [`extensions/file-collector`](../../extensions/file-collector)
(poll mode, snapshot-diff cursor, `authSchema` with `allowAiSummary`, its own
`configForm` for the file filters).

#### Modes

- **`poll`** — the host scheduler calls your `collect(ctx)` on an interval.
  Declared default `pollIntervalMs` is floored at **60 s** (no collector polls
  faster); the user can raise it, turn polling off per-collector, or trigger
  立即采集 manually — manual runs share the exact same collect→push→cursor
  path as scheduled ticks.
- **`webhook`** — the host runs a local webhook server (127.0.0.1) that routes
  inbound payloads to your `onWebhook(payload, config)`. No cursor; the
  produced events go straight to push.

#### The golden cursor rule

`collect()` returns `{ events, nextCursor }`. **The cursor is only persisted
after a successful push** — a failed cycle (collect throw, rejected push, no
vault open) re-reads the exact same window next time, so there are never
gaps or double-advances. Design your cursor as an opaque string the host
stores for you (the file collector uses a JSON snapshot blob; a timestamp or
commit hash works for monotonic sources). Return the cursor **unchanged**
when you produced no events.

#### Privacy (host-side, before every push)

- The event's `raw` field is **stripped unless the user's keepRaw switch is
  on** — treat `raw` as debug data that may vanish, never as something the
  UI can rely on.
- The user's redact regexes are applied to `title` and `summary`. **Don't put
  secrets in title/summary** — they are the fields shown in the timeline.

#### What a collector can reach

`ctx.api` is the extension's own `ExtensionApi` — the object
`activate(api, ctx)` receives. A collector uses it like any other extension
code, under the manifest `permissions` the user approved at install:

| Need | Use | Declared in the manifest as |
| --- | --- | --- |
| A remote API | `ctx.api.network.fetch(url, init)` — runs in Rust (no CORS) and times out on its own | `permissions.http.origins` (exact origin) |
| A local program (`git`, `osascript`, a helper of your own) | `ctx.api.process.exec(program, args, { cwd })` — see [Running local programs](#running-local-programs-trusted-tier) | `permissions.exec.programs` (exact program string) |
| A mail server or another non-HTTP service | `ctx.api.network.connect(host, port)` — a TLS socket; see [Talking a protocol other than HTTP](#talking-a-protocol-other-than-http-trusted-tier) | `permissions.net.hosts` (`host:port`, or `*:port`) |
| The frontmost app and window title | `ctx.api.system.frontWindow()` — fixed host queries; `null` when unreadable. macOS asks the user for Automation permission on first use | `permissions.system.frontWindow: true` |
| The vault's files | `ctx.api.vault.listFiles({ exclude, includeHidden })` (each with `size` / `mtimeMs`), `ctx.api.vault.readText(path, { maxBytes })` (at most that many bytes; `null` for binary) | — |

A collector that needs another origin or another program declares it. Nothing
changes in the host.


#### `authSchema` → the settings config form

An `authSchema` (JSON-schema-ish `{ type: 'object', properties }`, string and
boolean types) is rendered **automatically as the collector's config form in
the 采集器 settings view**. Saved values arrive in `ctx.config` on every
collect/webhook call. Convention from the file collector: a `boolean`
`allowAiSummary` gate for the AI event-summary block in the detail panel.

#### `configForm` → settings a schema cannot express

A list of accounts, editable chips, a field that depends on another: give the
collector its own form. It is a React component on the collector's module
entry, drawn above the `authSchema` fields in the same settings card.

```tsx
import type { CollectorConfigFormProps } from 'folyn-extension-sdk';

function MyConfigForm({ config, update, api }: CollectorConfigFormProps) {
  const accounts = Array.isArray(config.accounts) ? config.accounts : [];
  return (
    <button onClick={() => update({ accounts: [...accounts, { username: '' }] })}>
      + account
    </button>
  );
}

const module: ExtensionModule = {
  collectors: { 'my-source': { id: 'my-source', collect, configForm: MyConfigForm } },
};
```

- `config` is the saved config — the object `collect()` receives as
  `ctx.config`. The form and the schema fields share it, so pick keys that do
  not collide.
- `update(patch)` merges `patch` into it and saves at once. There is no draft
  and no save button for the form's part.
- `api` is the extension's `ExtensionApi` (`api.env.locale` for your own
  strings, `api.vaultConfig` for the user's settings).
- The component renders in the host's React tree: bundle with `hostModules()`
  (see [Trusted tier bundling](#trusted-tier-bundling)). A render error is
  contained to the collector's card.

Examples: [`extensions/email-collector`](../../extensions/email-collector)
(a list of mailboxes), [`extensions/file-collector`](../../extensions/file-collector)
(filter chips).

#### Declared `activityTypes` are validated

Every event's `type` must be in the collector's declared
`contributes.collectors[].activityTypes` — the Rust ingest rejects events
whose type is not declared (and stamps `source` from the collector id
itself, overwriting whatever the event carried). `id` is the dedup key:
conventionally `${source}:${externalId}`; a stable id pushed twice is
silently deduped, which is also your crash/restart safety net.

#### Minimal wiring

```jsonc
"contributes": {
  "collectors": [{ "id": "my-source", "activityTypes": ["my_event"], "mode": "poll", "pollIntervalMs": 300000 }],
  "activityDisplay": [{ "type": "my_event", "icon": "star", "color": "blue" }],
  "entityTypes": [{ "id": "my_thing", "label": "Thing", "color": "green" }]
}
```

```ts
import type { ExtensionModule } from 'folyn-extension-sdk';

const module: ExtensionModule = {
  collectors: {
    'my-source': {
      id: 'my-source',
      async collect(ctx) {
        const cursor = ctx.cursor ?? '';
        // pull since cursor via ctx.api.network / ctx.api.process / ctx.api.vault ...
        return { events: [], nextCursor: cursor };
      },
    },
  },
};
export default module;
```

`module.collectors` is keyed by the collector **id** (not an entry-ref
string). Conflict rule: a second extension registering the same `entityTypes`
id is skipped with a log line + a conflict badge on the store entry.

---

## The ExtensionModule export contract (trusted tier)

A trusted extension's `main` is an ESM module. The host `import()`-s it and
reads its **named exports** as a `ExtensionModule`:

```ts
// index.js — a self-contained ESM bundle
export const handlers: Record<string, FileTypeProvider> = { 'erd': { ... } };
export const containers: Record<string, ComponentType<ContainerProps>> = { 'todo': TodoComp };
export const commands: Record<string, () => void | Promise<void>> = { 'greet': () => {} };
export const features: Record<string, ComponentType<unknown>> = { 'my-panel': Panel };
export const exporters: Record<string, ExporterHandler> = { 'txt-with-header': exportTxt };
export const exportEnhancers: Record<string, ExportEnhancerHandler> = { 'enhance-quote': enhanceQuote };
export const markdownCodeRenderers: Record<string, ComponentType<MarkdownCodeRendererProps>> = { 'PlantUmlMarkdownBlock': PlantUmlBlock };
export const editorLanguages: Record<string, EditorLanguageFactory> = { 'plantumlLanguage': () => plantumlLanguage() };
export const highlightGrammars: Record<string, HighlightGrammarFn> = { 'plantumlGrammar': (hljs) => plantumlGrammar(hljs) };
export const storageProviders: Record<string, unknown> = {
  form: SmmsForm,                 // ComponentType<StorageConfigFormProps>
  isConfigured: (cfg: unknown) => !!(cfg as { token?: string }).token,
  uploadImage: async (bytes, ext, cfg) => { /* fetch your API, sign privately */ return url; },
};
export function activate(ctx: ExtensionContext) { /* optional */ }
export function deactivate(ctx: ExtensionContext) { /* optional */ }
```

The maps are **keyed by entry-ref** — the strings in the manifest's
`contributes.*[].run` / `.handler` / `.component` / `.entry`. An entry-ref
missing from the module's exports is skipped with a console warning
(best-effort: a partial extension still loads its other contributions).
`fileTemplates` and `keybindings` are declarative — no module map.

`markdownCodeRenderers` is keyed by the manifest's `component` string;
`editorLanguages` by `entry`; `highlightGrammars` by `entry`. See `folyn-extension-sdk/folyn-extension-plantuml` for a
working example of all four maps (`handlers`, `exporters`,
`markdownCodeRenderers`, `containers`, `exportEnhancers`, `editorLanguages`, `highlightGrammars`).

A default-export factory `(ctx) => ExtensionModule` is also accepted (the loader
normalizes both shapes). See `contributionAdapters.ts` for the exact
resolution rules.

### Trusted tier bundling

The trusted loader wraps your `main` in a **blob URL** and `import()`-s it.
Blob URLs have no path, so:

- **relative imports do not resolve** (`./utils.js` fails)
- **remote imports are blocked** by the `folyn-extension://` CSP
- **bare specifiers** (`react`, `lodash`) do not resolve either

So bundle everything into one ESM file — except the modules the host shares.
Your components render in the host's React tree, and a second React copy
breaks hooks ("Invalid hook call"). `hostModules()` from
`folyn-extension-sdk/build` is the esbuild `alias` map that sends `react`,
`react/jsx-runtime`, `react-dom`, `react-dom/client` and `react-i18next` to the
host's instances:

```js
// build.mjs
import esbuild from 'esbuild';
import { hostModules } from 'folyn-extension-sdk/build';

await esbuild.build({
  entryPoints: ['src/index.tsx'],
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  alias: hostModules(),
  outfile: 'dist/index.js',
});
```

Using lucide-react icons? List the ones you import, and they come from the
host's copy too (lucide's own ESM does not tree-shake correctly under
esbuild): `hostModules({ lucideIcons: ['Bold', 'Italic'] })`. A name you
forget fails the build with "No matching export".

### Fetching remote resources (trusted tier)

The main webview's CSP is build-time-fixed in `tauri.conf.json` and does
NOT include third-party origins. **Direct `fetch()` and `<img src=remote>`
in a trusted extension are blocked in packaged builds** (dev mode does not
enforce CSP, masking the bug). Extensions that need to reach a remote
origin must go through `ctx.http.fetch`, which routes the request through
the Rust `extension_http_fetch` command (reqwest, outside the webview) and
enforces `permissions.http.origins` from the manifest.

**Step 1 — declare the origin in the manifest:**

```jsonc
{
  "permissions": {
    "http": { "origins": ["https://www.example.com"] }
  }
}
```

**Step 2 — stash `ctx.http` in `activate()`, use it everywhere:**

```ts
import type { ExtensionContext, ExtensionHttpCapability } from 'folyn-extension-sdk';

let hostHttp: ExtensionHttpCapability | undefined;
export async function activate(ctx: ExtensionContext) { hostHttp = ctx.http; }
function http(): ExtensionHttpCapability {
  if (!hostHttp) throw new Error('extension: activate() not called');
  return hostHttp;
}

// Render path: fetch → data URL → <img>
async function renderDiagram(source: string) {
  const { body, status } = await http().fetch(`https://www.example.com/svg/${encode(source)}`);
  if (status !== 200) throw new Error(`HTTP ${status}`);
  // base64-encode UTF-8 SVG text for <img src>
  const dataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(body)))}`;
  return dataUrl;
}

// Data path: fetch → JSON
const { body } = await http().fetch('https://api.example.com/data.json');
const data = JSON.parse(body);
```

**Binary files — `download`.** `fetch` decodes the body as text, so it cannot
carry a ZIP or PDF. Trusted extensions use `api.network.download(url, init)`,
which streams the body to `~/.folyn/extension-data/<id>/downloads/` in Rust. That
directory survives updates and reinstalls and is not removed on uninstall. Same
origin check as `fetch`; redirects are not followed, so a token header cannot
reach an undeclared origin.

```ts
const result = await api.network.download(url, {
  method: 'POST',
  headers,
  body,
  onProgress: ({ received, total }) => showProgress(received, total),
});
if (!result.saved) return showError(result.body); // non-2xx or JSON: nothing written

// `api.downloads` locates the saved files:
const path = await api.downloads.path(result.name); // absolute path
const saved = await api.downloads.list();           // [{ name, size, modifiedMs }]
await api.downloads.reveal(result.name);            // reveal in the OS file manager
```

List saved files with `list()` so a page can offer **open** for one it already
downloaded instead of downloading again.

**Showing and editing a file — `api.fileView.component()`.** This hands you the
Vault editor's own editor and preview: `FolynEditor` (the CodeMirror instance the
editor page mounts, so keybindings, highlighting and the user's editor
preferences are the Vault's) plus the file type's own preview component. It owns
the edit / split / preview switch, so your page shows the same three modes
without reimplementing them. Never download a single document just to display
it: read the text and pass it in.

```tsx
const FileView = api.fileView.component();   // once, in activate()

// Remote text (e.g. an OpenAPI text/read): pass the text plus a name with its
// extension, which selects the handler. `onSave` fires on ⌘/Ctrl+S.
<FileView path="Java.md" content={text} onSave={saveBack}/>

// A saved download: pass its absolute path and let its own handler read it
// (images, PDFs open straight in preview).
<FileView path={await api.downloads.path('截图.png')}/>
```

`onChange` fires on every keystroke. A format the app cannot display renders an
in-pane notice instead of failing.

**File icons.** `api.icons.render(fileName, { isDir })` returns the same 16×16
markup the Vault file tree uses (extension map, extension-provided icons,
light/dark theme), so a remote listing looks native:
`<span dangerouslySetInnerHTML={{ __html: icon.svg }} />`.

**Why this design**: the manifest is the single source of truth — adding
a new remote origin does not require editing Folyn source or the main
window CSP. The host enforces the allowlist twice (JS-side fast-fail +
Rust-side re-check from the on-disk manifest).

**Render format**: prefer `data:image/svg+xml;base64,...` URLs over
`blob:` URLs (no lifecycle, CSP already allows `img-src data:`) or
inline `<svg>` (carries script-injection surface).

### Talking a protocol other than HTTP (trusted tier)

For IMAP, SMTP or any other protocol over TLS, open a socket and speak it
yourself — the host only moves bytes.

**Step 1 — declare the hosts in `manifest.json`:**

```jsonc
"permissions": {
  "net": { "hosts": ["imap.gmail.com:993"] }   // or "*:993": any host, that port only
}
```

**Step 2 — `api.network.connect`:**

```ts
const socket = await api.network.connect('imap.gmail.com', 993);
await socket.write('a1 NOOP\r\n');
for (let chunk; (chunk = await socket.read()) !== null; ) {
  // bytes in arrival order; a line or a message may span several chunks
}
await socket.close();
```

- TLS only; the certificate is verified for the host you pass.
- `read()` resolves `null` once the connection is closed — by the peer, by
  `close()`, or a read error (`socket.error` then says why). One read at a time.
- At most 8 open connections per extension. Close what you open.
- Example: `extensions/email-collector/src/imap.ts`, an IMAP client on top of it.

### Running local programs (trusted tier)

When the host has no API for something — a `git log`, an AppleScript query, a
helper binary — run a program instead of asking for a host change.

**Step 1 — declare the programs in `manifest.json`:**

```jsonc
"permissions": {
  "exec": { "programs": ["git", "osascript"] }
}
```

Each entry is a name resolved on `PATH` or an absolute path. The consent
dialog lists them, and the host runs nothing else.

**Step 2 — call `api.process.exec`:**

```ts
const { stdout, stderr, exitCode } = await api.process.exec(
  'git',
  ['log', '--since=1.day', '--format=%H %s'],
  { cwd: repoPath },
);
if (exitCode !== 0) throw new Error(stderr);
```

- `program` must be spelled exactly as declared: declaring `git` does not
  allow `/usr/bin/git`.
- Arguments are passed as given. There is no shell, so nothing is expanded or
  injected; to run a shell, declare `sh` and pass `['-c', script]`.
- A non-zero exit resolves normally — you decide what it means. The call
  rejects only when the program is not declared or cannot be started.
- A desktop app's `PATH` is short (on macOS, `/usr/bin:/bin:/usr/sbin:/sbin`).
  Declare an absolute path for a program installed elsewhere.

---

## The sandbox RPC protocol (sandbox tier)

A sandbox extension's `index.html` + `index.js` run inside a sandboxed iframe
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

| Method                  | Params              | Permission                                     |
| ----------------------- | ------------------- | ---------------------------------------------- |
| `fs:read`               | `{ path }`          | `fs.scope` (glob, relative to extension data dir) |
| `fs:write`              | `{ path, content }` | `fs.scope`                                     |
| `fs:list`               | `{ path }`          | `fs.scope`                                     |
| `http:fetch`            | `{ url, init? }`    | `http.origins` (allowlist)                     |
| `clipboard:read`        | `{}`                | `clipboard: true`                              |
| `clipboard:write`       | `{ text }`          | `clipboard: true`                              |
| `dialog:open`           | `{}`                | `dialog: true`                                 |
| `dialog:save`           | `{ content }`       | `dialog: true`                                 |
| `vault:read-active-doc` | `{}`                | `vault.readActive: true`                       |
| `vault:insert-content`  | `{ content }`       | `vault.insertContent: true`                    |
| `window:open`           | `{ toolId }`        | `window: true`                                 |

See `examples/extensions/hello-tool/index.js` for a complete iframe script that
wraps `postMessage` in a Promise-based `rpc()` helper.

#### `http:fetch` routing (CSP bypass)

`http:fetch` does NOT run `fetch()` in the host webview. The host webview's
CSP `connect-src 'self' ipc: http://ipc.localhost` does not include the
extension-declared origins, so a direct `fetch()` would be blocked in release
(dev does not inject CSP, which masked the bug). Instead the RPC bridge
invokes the Rust command `extension_http_fetch(extension_id, url, method?, headers?, body?)`,
which performs the request with `reqwest` (no CSP) and returns a buffered
`{ status, headers, body }` matching the old `fetch()` shape.

Origin enforcement is double-layered:

1. **JS fast-fail** — `rpcBridge` calls `isOriginAllowed(url, manifest.permissions.http.origins)`
   before the IPC hop; a non-allowlisted origin never reaches Rust.
2. **Rust defense-in-depth** — `extension_http_fetch` re-reads the extension's
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
`permissions` before dispatching. A sandbox extension cannot bypass this — there
is no path to raw Tauri. This is the VSCode-extension-host model: isolation
makes the capability-scoped API enforceable.

### trusted tier — TOFU + full host realm (explicit model)

Trusted extensions run **in the main webview realm**, which already has
full host Tauri capabilities from `capabilities/default.json` (`fs:scope:
[{"path":"**"}]`, `shell:allow-spawn`, dialog, clipboard, …). **There is
no per-extension runtime ACL.** `grant_extension_capabilities` /
`add_capability` does not exist and is not wired — the scoped-permission
entry format it would have used corrupts Tauri's runtime ACL (`error
deserializing scope: … EntryRaw` on every later fs check), so it was never
connected. The manifest's `permissions` block is **informational for the
trusted tier**: it is not enforced at runtime, because a trusted extension
can reach the host realm's full surface directly (e.g.
`import('@tauri-apps/api/core')` with the main window's caps).

The host's own APIs still check what they are asked for against the manifest:
`api.network` against `http.origins`, `api.process.exec` against
`exec.programs`, `api.ai` against `ai`. So the consent dialog states what
those calls can do. That is a declaration the user reads and approves, not a
sandbox.

**The sole boundary on trusted code is the TOFU gate** (user-pin +
SHA-256 integrity match on `main`, verified by the trusted loader before
`import()`). Once you approve a trusted extension, it has full power. This
is the VSCode "in-process host = soft consent gate" trade-off, explicitly
accepted for the trusted tier:

> TOFU-pinned = user explicitly trusted = full power.

Need a hard, permission-scoped boundary for a third-party extension? Use
the **sandbox tier** — that's the one where `permissions` is actually
enforced (every RPC call checked against the manifest).

---

## AI capability (`permissions.ai`)

Folyn's AI surface (chat via `runRigChat` + feature agents via
`runFeatureAgent`) is exposed to extensions as a host-mediated capability. The
host owns provider/model/apiKey; extensions never see credentials.

### Permission declaration

```json
"permissions": {
  "ai": { "chat": true, "agents": ["study"], "edit": true }
}
```

- `chat` (boolean) — required for `ctx.ai.chat` (trusted) or `ai:chat` RPC
  (sandbox).
- `agents` (string[]) — whitelist of feature names the extension may drive via
  `ctx.ai.agent`. Empty/absent = no agent calls. **Trusted tier only.**
- `edit` (boolean) — required for `ctx.ai.editFile` / `ctx.ai.createFile`
  (trusted only). The host applies the resulting file changes through the
  shared editor/vault chokepoint; the extension never writes the filesystem
  directly.

### Trusted tier — `ExtensionContext.ai`

```ts
ctx.ai.chat({
  sessionId: "my-extension-session", // extension-owned; rig persists history by id
  prompt: "Summarize the active doc",
  onEvent: (e) => {
    /* e.type ∈ 'text'|'thinking'|'error'|'done' */
  },
  useSharedSession: true, // optional: also surface in aiPanel
});

ctx.ai.agent({
  feature: "study", // must be in permissions.ai.agents
  instruction: "Review my notes",
  onEvent: (e) => {
    /* 'done' | 'error' */
  },
});

// AI-driven file edits (trusted only — requires permissions.ai.edit). The
// host reads/writes the file through the vault manager; the extension only
// states intent + receives streaming progress.
await ctx.ai.editFile({
  path: "notes/summary.md", // vault-relative
  instruction: "Summarize as 3 bullets",
  onEvent: (e) => {
    /* 'text' | 'error' | 'done' */
  },
});
await ctx.ai.createFile({
  path: "notes/new-note.md",
  instruction: "Draft a meeting notes skeleton",
  onEvent: (e) => {},
});
```

`onEvent` mirrors `CliStreamEvent` but filters out `tool_*` / `file_change`
events — extensions see only text / thinking / error / done. Provider/model
come from the host's `useAiConfigStore`; apiKey never appears in `ctx` or
RPC params.

### Sandbox tier — `ai:chat` RPC

```js
const id = crypto.randomUUID();
window.addEventListener("message", (ev) => {
  const m = ev.data;
  if (m.id !== id) return;
  if (m.type === "ai-stream") {
    // m.event: { type: 'text'|'thinking'|'error'|'done', content? }
  } else if (m.type === "response") {
    // stream terminates — check m.error
  }
});
window.parent.postMessage(
  {
    type: "request",
    id,
    method: "ai:chat",
    params: { sessionId: "s", prompt: "hello" },
  },
  "*",
);
```

Sandbox extensions cannot call feature agents (canonical agent files live
under the vault's `__<feature>__/` directory; sandbox isolation makes
exposing them safely out-of-scope). Use the trusted tier if you need
`ai.agent`.

**Tool windows** (fetch transport, no postMessage): `ai:chat` returns
`{ jobId }` immediately and the chat streams via polling:

```js
const { jobId } = await rpc("ai:chat", { sessionId: "s", prompt: "hello" });
for (;;) {
  await sleep(150);
  const p = await rpc("ai:chat-poll", { jobId });
  // p: { done: boolean, error?: string, text: string, thinking: string }
  // text/thinking are NEW deltas since the last poll — append, don't replace.
  appendToBubble(p.text, p.thinking);
  if (p.error) throw new Error(p.error);
  if (p.done) break;
}
```

The poll that observes `done` deletes the job server-side; a lost final poll
response resolves as `{ done: true }` on the next call, so the loop always
terminates.

### Examples

- `examples/extensions/ai-chat-demo/` — trusted, demonstrates `ctx.ai.chat` +
  `ctx.ai.agent` (study).
- `examples/extensions/ai-chat-sandbox-demo/` — sandbox, demonstrates `ai:chat`
  RPC + `ai-stream` event consumption.

---

## Host environment (theme + locale)

Extensions that render UI need to track the host's resolved theme (bright/dark)
and the user's locale, and react when the user switches either mid-session.
The host signals the current values and pushes change events; **extensions bring
their own i18n bundles** — the host's `t()` is NOT exposed. Only the locale
identifier string (e.g. `'zh'`, `'en'`) is delivered.

### Trusted tier — `ExtensionContext.env`

```ts
import type { ExtensionContext } from "folyn-extension-sdk";

export function activate(ctx: ExtensionContext) {
  console.log("theme:", ctx.env?.theme, "locale:", ctx.env?.locale);

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
  host before delivery, extensions never see `'system'`.
- `env.locale`: current locale string.
- `env.onThemeChange(cb)` / `env.onLocaleChange(cb)`: subscribe to mid-session
  changes; return a `Disposable` for cleanup (push into `ctx.addDisposable`).

### Sandbox tier — `env:get` RPC + `env-event` push

Sandbox extensions call `env:get` on activate to seed, then listen for
`env-event` messages to update in place:

```js
// In the sandbox iframe
window.parent.postMessage(
  {
    type: "request",
    id: "env-seed",
    method: "env:get",
    params: {},
  },
  "*",
);

window.addEventListener("message", (e) => {
  const msg = e.data;
  if (msg.type === "response" && msg.id === "env-seed") {
    applyEnv(msg.result.theme, msg.result.locale);
  }
  if (msg.type === "env-event") {
    if (msg.event === "theme") applyTheme(msg.value);
    if (msg.event === "locale") applyLocale(msg.value);
  }
});
```

No permission declaration is required — env is non-sensitive (no file system,
no network, no credentials; just the current theme + locale string).

---

## Lifecycle: activate / deactivate / dispose

The host calls your extension's optional `activate(ctx)` / `deactivate(ctx)`
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
- **uninstall** → deactivate (if active) + remove from `extensions.json` +
  delete the extension folder.

A failed activate/deactivate sets the state to `failed` with the error
surfaced in the Settings → Extensions UI.

---

## TOFU approval flow

Sandbox extensions auto-activate on install (their boundary is the iframe, no
approval needed). Trusted extensions require explicit approval:

1. Install the trusted extension (Settings → Extensions → 从文件夹安装…). It
   appears in the list with state "已安装" and a **批准并授权** button.
2. Click **批准并授权**. A consent modal opens listing the declared
   permissions + contributions, with a warning that trusted extensions have
   full host power.
3. Confirm → `approve_extension(id)` sets `trusted: true` in `extensions.json`
   and emits `extension://approved`. The host's listener activates the extension.
4. Cancel → the extension stays installed but unapproved. You can still
   uninstall it.

Once approved, the extension activates immediately and on every subsequent app
launch (the hydrate loop in `App.tsx` sees `trusted: true` and activates).

---

## Integrity model

Per-file SHA-256 integrity (computed at install, verified on load by the
trusted loader) is the **sole tamper gate**: it proves the bytes on disk
match the bytes that were approved. There is **no signature verification** —
ed25519 scaffolding was speculative (no extension shipped a signature) and
has been removed (YAGNI). Publisher identity is out of scope until a real
marketplace exists with a concrete need.

---

## Local development

### Drop a folder in ~/.folyn/extensions/

The simplest dev loop: copy your extension folder to
`~/.folyn/extensions/<extension-id>/`. On next app launch, the hydrate loop in
`App.tsx` reads `extensions.json` + each manifest and installs/activates. For
sandbox extensions, changes to the HTML/JS are picked up by reloading the app
(the iframe re-fetches from `folyn-extension://`). For trusted extensions, bump
the blob URL (the loader creates a fresh one per activation, so deactivate →
activate picks up new code).

### Install-from-folder UI

Use Settings → Extensions → 从文件夹安装… and pick your dev folder. The folder
name must be the extension's kebab-case id. This copies the folder into
`~/.folyn/extensions/<id>/` and installs it.

### Dev server (sandbox tier)

Because `html` is loaded from `folyn-extension://localhost/<id>/<html>`, you
can't point it at `http://localhost:5173` directly (cross-origin). For hot
reload, either:

- re-install after each change (fastest for small extensions), or
- run a dev server and proxy it through the `folyn-extension://` scheme (future
  enhancement — not in MVP).

### Trusted tier + Vite

A trusted extension that uses JSX/TSX needs a build step. Minimal `vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  extensions: [react()],
  build: { lib: { entry: "index.tsx", formats: ["es"], fileName: "index" } },
});
```

Output `dist/index.js` and set `main: "dist/index.js"` in the manifest. The
bundle must be self-contained (inline React or mark it external and rely on
the host realm — see "Trusted tier bundling" above).

---

## Packaging

**Two install paths today**:

1. **Folder install** (dev/debug): Settings → Extensions → 从文件夹安装… picks an
   unpacked folder containing `manifest.json` + assets; the install command
   copies it verbatim into `~/.folyn/extensions/<id>/`. No source/asset
   filtering — useful while iterating on a extension locally.

2. **Zip install** (distribution): Settings → Extensions → 从 .zip 安装… picks a
   `.zip` archive; the install command extracts it to a staging dir, filters
   forbidden files, validates the manifest, then atomically renames into
   `~/.folyn/extensions/<id>/`. This is the path end users use to install a
   extension someone else shipped.

### Distributing as a .zip

The zip MUST contain `manifest.json` at the root. Everything else must be
**compiled output** — the source/lockfiles/configs that built the extension do
not belong in the shipped package. The zip installer hard-rejects forbidden
files and silently drops files whose extension is outside the whitelist.

**Allowed file types** (copied to `~/.folyn/extensions/<id>/`):
- `manifest.json` (required at the root)
- Built `main` (e.g. `dist/index.js`, `dist/index.mjs`) and `html` for sandbox
- Static assets: `html`/`htm`/`css`/`svg`/`png`/`jpg`/`jpeg`/`gif`/`ico`/
  `woff`/`woff2`/`ttf`/`wasm`/`json`/`md`
- `LICENSE` and `README.md` (matched by basename, extension-agnostic)

**Forbidden — install hard-fails and lists every offender** (so the package
author can fix it once):

| Pattern | Reason |
|---------|--------|
| `src/**`, `node_modules/**`, `.git/**`, `.vscode/**`, `.idea/**` | Source / dev tooling |
| `*.ts`, `*.tsx`, `*.jsx` | TypeScript / JSX sources |
| `*.map` | Sourcemaps (re-derived at dev time; not shipped) |
| `*.env` (incl. `.env.local`, `.env.production`, ...) | Secrets |
| `package.json`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml` | npm metadata |
| `tsconfig.json` | TS build config |
| `vite.config.*`, `webpack.config.*`, `rollup.config.*` | Bundler configs |
| `.DS_Store`, `Thumbs.db` | OS cruft |

**Soft-skipped — not copied, install continues** (the zip might still ship
them; they just don't land in `~/.folyn/extensions/<id>/`): any file whose
extension is not in the whitelist above and is not `manifest.json` /
`LICENSE` / `README.md`. Common example: `.otf` fonts, `.txt` notes.

**Zip-bomb / size caps** (install hard-fails if exceeded):
- 50 MB per single uncompressed entry
- 100 MB total uncompressed size across all entries
- 1000 file entries max

**Zip-slip defense** (install hard-fails): any entry whose path is absolute
(`/etc/...`, `C:\...`), contains `..` segments, or is a symlink.

To build a distributable zip from a built extension folder:

```bash
cd dist-output/
zip -r ../my-extension-1.0.0.zip manifest.json dist/ assets/
```

Future: a `.folyn-extension` archive + marketplace download will land when a
real marketplace exists with a concrete publisher-identity need.

---

## Reference: sample extensions

- [`examples/extensions/hello-tool`](../examples/extensions/hello-tool) — sandbox
  tier. Contributes a command + a tool. The iframe script wraps
  `postMessage` in a Promise-based `rpc()` helper and demonstrates
  `clipboard:read` / `clipboard:write`.
- [`examples/extensions/markdown-todo`](../examples/extensions/markdown-todo) —
  trusted tier. Contributes a `:::todo` container directive (interactive
  checkbox list) + a **Todo: Insert Checklist** command. Pure ESM, no
  bundler step needed (lazy-imports React + the editor store inside
  functions so the blob-URL `import()` loads cleanly).
- [`examples/extensions/feature-panel-sample`](../examples/extensions/feature-panel-sample)
  — trusted tier. Contributes a `features` sidebar panel (`notes-panel`,
  left slot, inline-SVG icon, `order`, `badge`) + a **Notes: Open Panel**
  command. Demonstrates the data-driven activity bar / sidebar mounting
  path and the in-process editor-store access from a panel component.
- [`examples/extensions/extension-export-demo`](../examples/extensions/extension-export-demo)
  — trusted tier. Exercises the contribution points in one tiny extension: an
  `exporters` entry (active doc → `.txt` with a header), a
  `fileTemplates` entry (**New Meeting Notes** palette command), a
  `keybindings` entry (`Cmd/Ctrl+Alt+Shift+T` → a **Demo: Ping** command), a
  `containers` entry (`:::quote` blockquote via `window.React` + `createElement`),
  and an `exportEnhancers` entry (post-render DOM mutation during export).
  Pure ESM, no JSX, no bundler step.

Install any via Settings → Extensions → 从文件夹安装… to manually QA the full
pipeline.

## Vault sessions, the public web and host UI

These are general trusted-tier APIs; each needs its manifest declaration, which the consent dialog lists. Sandbox extensions cannot use them.

```json
"permissions": {
  "vault": { "write": true },
  "web": { "fetch": true, "render": true }
}
```

### `api.vault.session()` — a pinned vault

`session()` returns an `ExtensionVaultSession` for the active vault, pinned to its physical root, or `null` while none is open or one is loading. `onSessionChange(handler)` fires on a vault switch: first `null` during the transition, then the new session. Work already in flight keeps acting on the vault it started in, so a slow save never lands in the next vault. `open`, `chooseDirectory`, `chooseNotes`, `readNote` and `appendNote` reject once the session is stale.

Paths are vault-relative; traversal and symlinks are rejected. Reads (`readText`, `readBinary`, `exists`, `assetUrl`) need no grant. Writes (`writeText`, `writeBinary`, `createText`, `remove`) need `permissions.vault.write`. `createText` atomically publishes complete, synced content and never replaces an existing path, even under concurrent creates. `writeText` / `writeBinary` atomically replace.

`session.data` is the extension's private store for that vault, at `~/.folyn/extension-data/<extension>/vaults/<vault>/`: caches, indexes, downloaded images — anything that belongs to the extension rather than the user's notes. It needs no grant, and writes are atomic.

`api.vault.onFileChange(handler)` receives host move/delete operations and native watcher paired-rename/remove events as `{ vaultId, path, newPath?, deleted? }`. Some filesystem watchers emit unpaired rename events; these cannot reliably infer the new path.

### Learning-note handoff

`ExtensionNoteSnapshot` is `{ path, title, text }`. `chooseNotes()` opens a native picker for `.md` files within the session's vault (cancellation returns `[]`); `readNote(path)` prefers unsaved editor buffers, including intentionally empty notes.

`appendNote(path, text, expectedText)` opens the note in a native source editor and compares its current text with the reviewed `expectedText` before and after the editor mounts. It inserts one isolated, undoable transaction at the end, keeping existing unsaved text. A changed note, switched vault/tab, unavailable source mode or read-only editor rejects without an append. Success means the content reached the editor and follows the user's auto-save preference; it does **not** promise a disk save when auto-save is off.

### `api.web.fetch(url, { binary? })`

Requires `permissions.web.fetch`. A GET to any public HTTP(S) URL — unlike `api.network.fetch`, which is limited to declared origins. Returns `{ status, headers, body, url }`; `url` is the final redirect destination and binary bodies are base64. 30-second overall timeout, at most 8 redirects, 8 MiB text / 20 MiB binary. Each redirect is resolved and pinned to public IPs, with proxies disabled; credentials, private/local addresses and non-HTTP(S) URLs are rejected. Requests use browser-compatible headers, bounded gzip/brotli/deflate decoding (unknown encodings reject), BOM/header/XML/meta charset decoding, and gzip sniffing for `.xml.gz` sitemaps missing Content-Encoding.

### `api.web.render(url)`

Present only with `permissions.web.render`. Loads the page in an isolated, private browser and returns `{ status, headers, body, url }` with the serialized DOM, the final URL, a synthetic status 200 and `x-folyn-rendered` / `x-folyn-status-unavailable` headers (Tauri does not expose the main HTTP status). A separate temporary profile, no user cookies, no app IPC, no downloads or new windows. Executable scripts and event handlers are stripped; inert JSON/LD+JSON scripts and XML roots remain. It never clicks, logs in or solves verification.

One page renders at a time, within 28 seconds, 12 navigation retries and an 8 MiB snapshot. It waits for stable DOM/text/link dimensions for at least 1.5 seconds after hydration, scrolls at most four viewports, and accepts short pages after 12 seconds. Verification/password gates, timeouts, oversize, cancellation and unsupported webviews reject with explicit errors. Disposing the extension cancels outstanding renders and closes their windows.

The isolated browser follows the OS proxy settings and its engine owns DNS and subresource loading: the host validates public main-navigation destinations but cannot pin browser DNS. Proxies that answer with private/fake IPs are rejected by that validation.

### `api.ui`

`openExternal(url)` opens an http(s) URL in the system browser; `openSettings()` shows the model settings; `openVaults()` shows the vault list; `setBadge(n)` sets the count on the extension's page / panel button (0 clears; cleared on dispose).

### Independent AI jobs

`ExtensionAiChatParams.persistHistory?: boolean`: pass `false` for independent jobs (article translations, summaries) so the host neither loads nor saves global chat history. Omitted/true keeps the default. Supported by the trusted capability and sandbox RPC.
