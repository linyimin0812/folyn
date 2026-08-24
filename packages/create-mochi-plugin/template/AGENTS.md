# Agent Context — Mochi Plugin

You are working on a **Mochi plugin**. This file is the self-contained reference for plugin development. Read it before editing `manifest.json` or `src/index.ts`.

## What this is

A Mochi plugin is a single-file ESM bundle loaded by the Mochi desktop app at runtime. It declares contributions (commands, file types, containers, exporters, feature panels, tool windows, markdown code renderers, editor languages, highlight grammars, …) in `manifest.json` and wires them up in `src/index.ts` via the `PluginModule` default export. React is provided by the host (`window.React`) — do not bundle it.

## Tiers

| Tier | Loader | Isolation | Capability surface |
|------|--------|-----------|---------------------|
| `sandbox` | Sandboxed iframe (`mochi-plugin://` origin) | Full isolation; postMessage RPC only | No raw Tauri APIs; `http`/`ai`/`env` via RPC bridge |
| `trusted` | Host-realm `import()` (TOFU-pinned) | Same realm as host; can contribute inline React/CodeMirror | Scoped Tauri capability grants; full `PluginContext` |

This template defaults to `tier: "trusted"` in `manifest.json`. Switch to `sandbox` only if the plugin is untrusted or needs full isolation — the SDK contract narrows (no `ai.agent` / `ai.edit`, no inline component contribution).

## Build / verify loop

```sh
pnpm install
pnpm build        # → dist/ (self-contained installable dir)
```

Then in Mochi: **Settings → Plugins → Install from folder…** → pick `dist/`. Reload Mochi (or restart) to pick up changes. Test by exercising the contribution you added.

To ship a zip: `cd dist && zip -r ../<name>-<version>.zip .`

## First files to read

- `manifest.json` — declares `id`, `name`, `version`, `mochi` compat, `tier`, `permissions`, `contributes.*`, `activation`. The contract between plugin and host. Start here when adding a feature.
- `src/index.ts` — plugin entry. Default export is a `PluginModule` whose maps mirror the entry-refs in `manifest.json`'s `contributes.*`.
- `build.mjs` — esbuild config. Bundles `src/index.ts` → `dist/index.js` (single-file ESM, all deps inlined), then writes `dist/manifest.json` with `main` rewritten to `index.js`. React stays external (resolved from `window.React` at runtime).
- `README.md` — install + structure overview (human-facing).

## manifest.json schema

```jsonc
{
  "id": "kebab-case-id",              // globally unique, kebab-case
  "name": "Display Name",
  "version": "0.1.0",
  "author": "Jane",
  "mochi": ">=0.1.0",                 // engine compat, semver constraint
  "tier": "trusted",                  // 'sandbox' | 'trusted'
  "main": "dist/index.js",            // entry path; build.mjs rewrites → "index.js" in dist/
  "html": "",                         // sandbox-tier HTML UI entry; required when tier === 'sandbox'
  "permissions": { /* see Permissions */ },
  "contributes": { /* see Contribution points */ },
  "activation": {                     // when the host activates this plugin
    "onCommand": "",                  // command id that triggers activation
    "onFileType": [],                 // file-type ids that trigger activation
    "onLanguage": []                  // language ids that trigger activation
  },
  "signature": "",                    // optional ed25519 sig over canonicalized manifest (base64)
  "publisherPublicKey": "",           // optional base64 ed25519 pubkey paired with signature
  "icon": "",                         // optional: inline <svg> | .svg path | emoji/short text
  "description": ""                   // optional one-liner shown in Settings → Plugins
}
```

### Permissions

Host-enforced, declarative. Undeclared capability calls throw at runtime.

```jsonc
"permissions": {
  "fs": { "scope": ["/path/or/glob"] },     // fs access scope
  "http": { "origins": ["https://..."] },   // allowed HTTP origins (reqwest, outside webview CSP)
  "clipboard": false,                       // clipboard read/write
  "dialog": false,                          // native dialogs
  "window": false,                           // window/tray APIs (main thread only — see Pitfalls)
  "vault": { "readActive": false, "insertContent": false },
  "ai": {
    "chat": false,                           // ctx.ai.chat (sandbox + trusted)
    "agents": [],                            // feature-name whitelist for ctx.ai.agent (trusted only)
    "edit": false                            // ctx.ai.editFile / createFile (trusted only)
  }
}
```

## Contribution points

Each contribution is a plain-data descriptor in `contributes.*[]`. The `handler`/`component`/`run`/`entry` field is a **string entry-ref** that the loader resolves to a function/component by matching against the `PluginModule` export map with the same key.

### commands

```jsonc
"commands": [{
  "id": "my-plugin.greet",
  "title": "Greet",
  "icon": "💡",                  // optional
  "keywords": ["hello"],          // optional, for command palette search
  "run": "greet"                  // entry-ref → PluginModule.commands["greet"]
}]
```

### fileTypes

```jsonc
"fileTypes": [{
  "id": "puml",
  "extensions": [".puml", ".plantuml"],
  "handler": "puml-handler",       // entry-ref → PluginModule.handlers["puml-handler"]
  "defaultViewMode": "split",      // optional
  "supportedViewModes": ["split","preview","source"]  // optional, incl. custom ids like "canvas"
}]
```

### containers (markdown `:::name` directives)

```jsonc
"containers": [{
  "name": "callout",               // directive name, used as :::callout ... :::
  "icon": "<svg>…</svg>",          // inline SVG | .svg path | emoji
  "label": "Callout",
  "category": "layout",            // 'layout' | 'media' | 'ai' | 'data' | 'custom'
  "component": "callout",          // entry-ref → PluginModule.containers["callout"]
  "template": ":::callout\n:::",
  "description": "Admonition block"
}]
```

### features (activity-bar panels — trusted only)

```jsonc
"features": [{
  "id": "my-panel",
  "panel": "left",                 // 'left' (MVP) | 'right' | 'bottom' (right/bottom reserved for follow-up)
  "component": "my-panel",         // entry-ref → PluginModule.features["my-panel"]
  "icon": "<svg>…</svg>",          // REQUIRED: inline SVG | ThemeIcon name
  "title": "My Panel",
  "order": 50,                     // sort key; built-ins: files=0, wiki=10, clips=20, analyze=30, calendar=40
  "badge": "3"                     // optional
}]
```

### tools (openable windows or inline panels)

```jsonc
"tools": [{
  "id": "my-tool",
  "title": "My Tool",
  "icon": "🔧",
  "window": true,                  // true: own window; false: inline panel
  "entry": "my-tool"               // entry-ref (HTML for sandbox, component for trusted)
}]
```

### exporters (custom export formats)

```jsonc
"exporters": [{
  "id": "pdf-export",
  "format": "pdf",
  "label": "Export as PDF",
  "fileExtension": "pdf",
  "run": "export-pdf",             // entry-ref → PluginModule.exporters["export-pdf"]
  "fileType": "puml"               // optional: restrict to a file-type id; absent = all types
}]
```

### fileTemplates (file-tree "新建" submenu)

```jsonc
"fileTemplates": [{
  "id": "new-dbml",
  "label": "New DBML diagram",
  "fileName": "untitled.dbml",
  "template": "entity ...",
  "icon": "📊"
}]
```

### keybindings

```jsonc
"keybindings": [{
  "command": "my-plugin.greet",     // command id (plugin-contributed or built-in)
  "key": "Cmd+Shift+K",            // Tauri accelerator
  "mac": "Cmd+Shift+K",            // optional mac override
  "when": ""                       // optional activation clause (opaque string, reserved)
}]
```

### exportEnhancers (post-render DOM mutation — trusted only)

```jsonc
"exportEnhancers": [{
  "name": "callout",                // ::: container name OR file extension (without dot)
  "run": "enhance-callout"          // entry-ref → PluginModule.exportEnhancers["enhance-callout"]
}]
```

### markdownCodeRenderers (```lang fenced blocks in markdown preview)

```jsonc
"markdownCodeRenderers": [{
  "language": "plantuml",
  "aliases": ["puml"],              // optional
  "component": "plantuml-renderer"  // entry-ref → PluginModule.markdownCodeRenderers["plantuml-renderer"]
}]
```

### editorLanguages (CodeMirror language support)

```jsonc
"editorLanguages": [{
  "id": "plantuml",
  "aliases": ["puml"],
  "entry": "plantuml-lang"          // entry-ref → PluginModule.editorLanguages["plantuml-lang"]
}]
```

### highlightGrammars (highlight.js grammars)

```jsonc
"highlightGrammars": [{
  "name": "plantuml",
  "aliases": ["puml"],
  "entry": "plantuml-grammar"       // entry-ref → PluginModule.highlightGrammars["plantuml-grammar"]
}]
```

## PluginModule export contract

The default export of `src/index.ts`. Every entry-ref in `manifest.json`'s `contributes.*[]` MUST have a matching key in the corresponding map here. Missing keys surface as runtime errors when the host tries to resolve the entry-ref.

```ts
import type { PluginModule } from 'mochi-plugin-sdk';

const module: PluginModule = {
  // entry-ref → file-type handler (matches contributes.fileTypes[].handler)
  handlers: {
    'puml-handler': {
      id: 'puml',
      extensions: ['.puml', '.plantuml'],
      supportedViewModes: ['split', 'preview', 'source'],
      defaultViewMode: 'split',
      needsFileContent: true,
      useCodeMirror: true,
      Editor: EditorComponent,   // React component, receives EditorProps
      Preview: PreviewComponent, // optional, receives PreviewProps
      serialize: (s) => s,       // optional
      deserialize: (s) => s,     // optional
    },
  },

  // entry-ref → React component (matches contributes.containers[].component)
  // Component receives ContainerProps { children, attributes, name }
  containers: { 'callout': CalloutComponent },

  // entry-ref → React component (matches contributes.features[].component) — trusted only
  features: { 'my-panel': MyPanelComponent },

  // entry-ref → command handler (matches contributes.commands[].run)
  commands: { 'greet': () => { /* ... */ } },

  // entry-ref → exporter fn (matches contributes.exporters[].run)
  // Returns Blob | string to write. ctx: { filePath, vaultRoot }
  exporters: { 'export-pdf': async (content, ctx) => Blob },

  // entry-ref → export enhancer (matches contributes.exportEnhancers[].run) — trusted only
  // Mutates the rendered HTMLElement in place. ctx: { filePath, vaultRoot }
  exportEnhancers: { 'enhance-callout': async (body, ctx) => { /* ... */ } },

  // entry-ref → fenced-block renderer (matches contributes.markdownCodeRenderers[].component)
  // Receives MarkdownCodeRendererProps { source, language, resolvedLanguage, filePath }
  markdownCodeRenderers: { 'plantuml-renderer': PlantUmlRenderer },

  // entry-ref → CodeMirror language factory (matches contributes.editorLanguages[].entry)
  // Returns a LanguageSupport at runtime; host narrows.
  editorLanguages: { 'plantuml-lang': () => /* LanguageSupport */ },

  // entry-ref → highlight.js grammar fn (matches contributes.highlightGrammars[].entry)
  // Receives the host's hljs instance, returns a Language definition.
  highlightGrammars: { 'plantuml-grammar': (hljs) => /* Language */ },

  // Optional lifecycle hooks (trusted loader calls these on activate/deactivate)
  activate: async (ctx) => { /* ctx: PluginContext */ },
  deactivate: async (ctx) => { /* ... */ },
};

export default module;
```

### FileTypeHandler (handlers[] values)

```ts
interface FileTypeHandler {
  id: string;
  extensions: string[];
  icon?: ReactNode;
  supportedViewModes: ViewMode[];      // 'split' | 'edit' | 'preview' | 'visual' | 'source' | custom string
  defaultViewMode?: ViewMode;
  needsFileContent: boolean;
  useCodeMirror?: boolean;
  Editor?: ComponentType<EditorProps>;  // EditorProps { content, tabId, filePath, onChange, onSave }
  Preview?: ComponentType<PreviewProps>; // PreviewProps { content, filePath, vaultRoot, onChange? }
  serialize?: (content: string) => string;
  deserialize?: (raw: string) => string;
}
```

## PluginContext (trusted tier)

Passed to `activate`/`deactivate`. Capabilities are `undefined` when the tier doesn't expose them.

```ts
interface PluginContext {
  pluginId: string;
  manifest: PluginManifest;
  addDisposable(d: Disposable): void;          // register for auto-cleanup on deactivate
  ai?: PluginAiCapability;                      // requires permissions.ai
  env?: PluginEnv;                              // theme + locale + change subscriptions
  http?: PluginHttpCapability;                   // requires permissions.http
}
```

### AI capability (`ctx.ai` — requires `permissions.ai`)

```ts
// chat: stream a multi-turn turn. sessionId owned by plugin. useSharedSession surfaces in aiPanel.
await ctx.ai.chat({ sessionId, prompt, onEvent, useSharedSession? });
// onEvent: { type: 'text'|'thinking'|'error'|'done', content? }

// agent (trusted only): drive a feature agent. feature must be in permissions.ai.agents.
await ctx.ai.agent({ feature, instruction, onEvent });

// editFile (trusted only): AI-driven edit to existing vault file.
await ctx.ai.editFile({ path, instruction, onEvent });

// createFile (trusted only): create new vault file from instruction.
await ctx.ai.createFile({ path, instruction, onEvent });
```

### HTTP capability (`ctx.http` — requires `permissions.http`)

```ts
// Routes through Rust plugin_http_fetch (reqwest, outside webview CSP).
// Rejects with 'origin not allowed' if URL origin not in manifest permissions.http.origins.
const res = await ctx.http.fetch(url, { method?, headers?, body? });
// res: { status, headers: Record<string,string>, body: string }  — body is string, no streaming/binary
```

### Env capability (`ctx.env`)

```ts
const { theme, locale } = ctx.env;          // theme: 'light' | 'dark' (never 'system')
ctx.env.onThemeChange(cb);                  // returns Disposable
ctx.env.onLocaleChange(cb);                 // returns Disposable
```

## Lifecycle

1. Host reads `manifest.json`, checks `tier` + signature/TOFU approval.
2. Host resolves `activation` — activates on first matching command/fileType/language, or eagerly if `activation` is empty.
3. Trusted loader: `import()` the bundle, take default export as `PluginModule`.
4. Host calls `module.activate?.(ctx)` if present. Errors here set state `failed`.
5. Host registers disposables added via `ctx.addDisposable()`.
6. On deactivate: host calls `module.deactivate?.(ctx)`, then disposes all registered disposables.

A plugin that needs no explicit lifecycle can omit `activate`/`deactivate` — the host guards with optional chaining.

## How to add a contribution (checklist)

1. Add an entry under the matching `contributes.*[]` array in `manifest.json`. Note the entry-ref string (`handler` / `component` / `run` / `entry`).
2. Wire the matching key in `src/index.ts`'s `PluginModule` export map. The key MUST equal the entry-ref.
3. Update `permissions` in `manifest.json` if the contribution touches fs / http / clipboard / dialog / window / vault / ai. Host enforces at the trust boundary — missing permission = runtime reject, not build error.
4. If the contribution needs lifecycle setup (register listeners, start a worker), put it in `module.activate(ctx)` and register disposables via `ctx.addDisposable()`.
5. `pnpm build` → reinstall `dist/` via Settings → Plugins → Install from folder… → reload Mochi → test by exercising the contribution.

## Pitfalls

- **Main-thread-only APIs.** Tray, window, and any Electron/Tauri-decorated API that touches the UI must run on the main thread. Calling them from a plugin render / worker context can crash the host on reload (see fix `e43aed4` for `tray_set_enabled`). If an API is documented as main-thread-only, route the call through the SDK's main-thread bridge — do not call it directly from a component effect.
- **`manifest.main` rewrite.** Root `manifest.json` says `"main": "dist/index.js"` so the host finds it during dev. `build.mjs` strips the `dist/` prefix when copying into `dist/manifest.json` (→ `"main": "index.js"`). Do not "fix" the prefix in one place without the other — install breaks silently.
- **React is external.** `build.mjs` sets `external: []` but React is resolved via `window.React` at runtime (host exposes it before any trusted plugin is `import()`-ed). Importing React as a normal dep will create a second copy and break hooks. Use the global.
- **Permissions are enforced at runtime, not build time.** A missing `permissions.fs.scope` / `permissions.http.origins` entry will cause the call to reject at runtime. Declare what you use, in the manifest, before writing the code that calls the capability.
- **`tier: "trusted"`** in the manifest means the host loads the plugin with elevated access (same realm, scoped Tauri grants, `ai.agent`/`ai.edit` available). Do not accept untrusted input into plugin code paths without validation. Untrusted or third-party plugins should use `tier: "sandbox"`.
- **Entry-ref keys must match exactly.** `manifest.json`'s `contributes.fileTypes[].handler` = `"puml-handler"` must equal `src/index.ts`'s `module.handlers["puml-handler"]`. Typos surface as runtime resolution errors, not type errors (the manifest is JSON, not typed).
- **Sandbox tier restrictions.** `tier: "sandbox"` cannot use `ai.agent`, `ai.edit`, or contribute inline React components / CodeMirror languages. It reaches `ai.chat` / `http` / `env` only via the postMessage RPC bridge. `html` field is required.

## Working style

- Make the smallest change that works end to end before adding capability. Do not scaffold for hypothetical contributions.
- Keep `manifest.json` and `src/index.ts` in lockstep — every `contributes.*` entry must have a matching handler/component, and vice versa.
- After any manifest or source change: `pnpm build` → reinstall `dist/` → reload Mochi → exercise the contribution. Type errors that pass at build time do not prove the plugin runs.
- Prefer the SDK's typed contracts (`FileTypeHandler`, `ContainerProps`, `MarkdownCodeRendererProps`, `ExporterHandler`, etc.) over `any` — the host narrows at runtime and type drift surfaces as runtime resolution failures.

## Reference

- **`packages/plugin-sdk/src/types.ts`** + **`contracts.ts`** in this monorepo — authoritative SDK source. When in doubt about a type, read it there.
- **`docs/plugin-development.md`** + **`docs/plugin-sdk-reference.md`** in this monorepo — full development guide (1257 + 445 lines): TOFU approval flow, sandbox RPC protocol, packaging, signing, examples. Not bundled into the generated plugin; read from the monorepo when you need depth.
- **`mochi-plugin-plantuml`** in the external `mochi-plugin-sdk` repo — canonical reference plugin covering fileTypes + containers + exporters + markdownCodeRenderers + editorLanguages end to end.
- Repo-root `AGENTS.md` — engineering principles for this monorepo (remove obsolete paths, simplest implementation, layers, prefer existing deps).
