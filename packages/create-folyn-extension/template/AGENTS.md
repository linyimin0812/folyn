# Agent Context — Folyn Extension

You are working on a **Folyn extension**. This file is the self-contained reference for extension development. Read it before editing `manifest.json` or `src/index.ts`.

## What this is

A Folyn extension is loaded by the Folyn desktop app at runtime. It declares contributions (commands, file types, containers, exporters, feature panels, tool windows, markdown code renderers, editor languages, highlight grammars, …) in `manifest.json`.

- **Trusted tier** — host-realm `import()` (TOFU-pinned). Wires contributions in `src/index.ts` via the `ExtensionModule` default export. React is provided by the host (`window.React`) via the shims in `src/` — do not bundle it.
- **Sandbox tier** — sandboxed iframe (`folyn-extension://` origin, opaque). `src/index.html` is the iframe entry; `src/index.ts` is the script. No `window.React` access — bundle your own UI deps or use plain DOM. Host capabilities reach the iframe only via `postMessage` RPC (see `src/index.ts`).

## Tiers

| Tier | Loader | Isolation | Capability surface |
|------|--------|-----------|---------------------|
| `sandbox` | Sandboxed iframe (`folyn-extension://` origin) | Full isolation; postMessage RPC only | No raw Tauri APIs; `http`/`ai`/`env` via RPC bridge |
| `trusted` | Host-realm `import()` (TOFU-pinned) | Same realm as host; can contribute inline React/CodeMirror | Scoped Tauri capability grants; full `ExtensionContext` |

The `tier` is chosen at scaffold time (`create-folyn-extension --tier trusted|sandbox`) and baked into `manifest.json`. To switch later, change `tier` + `main`/`html` in `manifest.json`, adopt the matching `build.mjs` + entry files, and rebuild. The SDK contract narrows for sandbox (no `ai.agent` / `ai.edit`, no inline component contribution).

## Build / verify loop

```sh
pnpm install
pnpm build        # → dist/ (self-contained installable dir)
```

Then in Folyn: **Settings → Extensions → Install from folder…** → pick `dist/`. Reload Folyn (or restart) to pick up changes. Test by exercising the contribution you added.

To ship a zip: `cd dist && zip -r ../<name>-<version>.zip .`

## First files to read

- `manifest.json` — declares `id`, `name`, `version`, `folyn` compat, `tier`, `permissions`, `contributes.*`, `activation`. The contract between extension and host. Start here when adding a feature.
- `src/index.ts` — extension entry. Default export is a `ExtensionModule` whose maps mirror the entry-refs in `manifest.json`'s `contributes.*`.
- `build.mjs` — esbuild config. **Trusted**: bundles `src/index.ts` → `dist/index.js` (single-file ESM, all deps inlined, `react`/`react/jsx-runtime` aliased to the `src/*-shim.js` files that read `window.React`), then writes `dist/manifest.json` with `main` rewritten to `index.js`. **Sandbox**: bundles `src/index.ts` → `dist/index.js` (IIFE), copies `src/index.html` → `dist/index.html`, writes `dist/manifest.json` as-is.
- `README.md` — install + structure overview (human-facing).

## manifest.json schema

```jsonc
{
  "id": "kebab-case-id",              // globally unique, kebab-case
  "name": "Display Name",
  "version": "0.1.0",
  "author": "Jane",
  "folyn": ">=0.1.0",                 // engine compat, semver constraint
  "tier": "trusted",                  // 'sandbox' | 'trusted'
  "main": "dist/index.js",            // entry path; build.mjs rewrites → "index.js" in dist/
  "html": "",                         // sandbox-tier HTML UI entry; required when tier === 'sandbox'
  "permissions": { /* see Permissions */ },
  "contributes": { /* see Contribution points */ },
  "icon": "",                         // optional: inline <svg> | .svg path | emoji/short text
  "description": ""                   // optional one-liner shown in Settings → Extensions
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

Each contribution is a plain-data descriptor in `contributes.*[]`. The `handler`/`component`/`run`/`entry` field is a **string entry-ref** that the loader resolves to a function/component by matching against the `ExtensionModule` export map with the same key.

### commands

```jsonc
"commands": [{
  "id": "my-extension.greet",
  "title": "Greet",
  "icon": "💡",                  // optional
  "keywords": ["hello"],          // optional, for command palette search
  "run": "greet"                  // entry-ref → ExtensionModule.commands["greet"]
}]
```

### fileTypes

```jsonc
"fileTypes": [{
  "id": "puml",
  "extensions": [".puml", ".plantuml"],
  "handler": "puml-handler",       // entry-ref → ExtensionModule.handlers["puml-handler"]
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
  "component": "callout",          // entry-ref → ExtensionModule.containers["callout"]
  "template": ":::callout\n:::",
  "description": "Admonition block"
}]
```

### features (activity-bar panels — trusted only)

```jsonc
"features": [{
  "id": "my-panel",
  "panel": "left",                 // 'left' (MVP) | 'right' | 'bottom' (right/bottom reserved for follow-up)
  "component": "my-panel",         // entry-ref → ExtensionModule.features["my-panel"]
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
  "run": "export-pdf",             // entry-ref → ExtensionModule.exporters["export-pdf"]
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
  "command": "my-extension.greet",     // command id (extension-contributed or built-in)
  "key": "Cmd+Shift+K",            // Tauri accelerator
  "mac": "Cmd+Shift+K",            // optional mac override
  "when": ""                       // optional activation clause (opaque string, reserved)
}]
```

### exportEnhancers (post-render DOM mutation — trusted only)

```jsonc
"exportEnhancers": [{
  "name": "callout",                // ::: container name OR file extension (without dot)
  "run": "enhance-callout"          // entry-ref → ExtensionModule.exportEnhancers["enhance-callout"]
}]
```

### markdownCodeRenderers (```lang fenced blocks in markdown preview)

```jsonc
"markdownCodeRenderers": [{
  "language": "plantuml",
  "aliases": ["puml"],              // optional
  "component": "plantuml-renderer"  // entry-ref → ExtensionModule.markdownCodeRenderers["plantuml-renderer"]
}]
```

### editorLanguages (CodeMirror language support)

```jsonc
"editorLanguages": [{
  "id": "plantuml",
  "aliases": ["puml"],
  "entry": "plantuml-lang"          // entry-ref → ExtensionModule.editorLanguages["plantuml-lang"]
}]
```

### highlightGrammars (highlight.js grammars)

```jsonc
"highlightGrammars": [{
  "name": "plantuml",
  "aliases": ["puml"],
  "entry": "plantuml-grammar"       // entry-ref → ExtensionModule.highlightGrammars["plantuml-grammar"]
}]
```

### collectors (activity collection — trusted only)

A collector converts one data source into standard activity events (activity timeline + entity graph). The host owns storage/dedup/entity resolution — the collector only pulls and converts. Unlike every other contribution, `module.collectors` is keyed by the **collector id**, not an entry-ref string.

```jsonc
"contributes": {
  "collectors": [{
    "id": "my-source",                    // module key + event `source` (host-stamped)
    "activityTypes": ["my_event"],        // ingest REJECTS events whose type isn't declared here
    "mode": "poll",                       // 'poll' | 'webhook'
    "pollIntervalMs": 300000,             // floored at 60s; user-adjustable / off / manual 立即采集
    "authSchema": {                       // optional: renders the collector's config form (string/boolean)
      "type": "object",
      "properties": { "token": { "type": "string", "title": "Token", "default": "" } }
    },
    "hostAllowlist": ["https://api.example.com"]  // ctx.http exact-origin gate (install-time confirm)
  }],
  "activityDisplay": [{ "type": "my_event", "icon": "star", "color": "blue", "detailFields": [{ "key": "path", "label": "Path", "format": "text" }] }],
  "entityTypes": [{ "id": "my_thing", "label": "Thing", "color": "green" }]
}
```

```ts
// src/index.ts — keyed by collector id
collectors: {
  'my-source': {
    id: 'my-source',
    // poll mode: cursor → collect → push → cursor persists ONLY after a successful
    // push (failed cycle re-reads the same window). No events → return old cursor.
    collect: async (ctx) => {
      const cursor = ctx.cursor ?? '';
      // ctx.exec (program-allowlisted: git only) / ctx.http (hostAllowlist exact origin)
      // / ctx.scanVault (.git skipped, vault-relative paths) / ctx.readVaultFile
      // (traversal-safe, binary/>1MB → null) — all absent in tests/embedded hosts,
      // feature-detect. Privacy: host strips `raw` unless keepRaw; redact regexes hit
      // title/summary — never put secrets there.
      return { events: [], nextCursor: cursor };
    },
    // webhook mode instead: onWebhook(payload, config) → events (no cursor)
  },
},
```

## ExtensionModule export contract

The default export of `src/index.ts`. Every entry-ref in `manifest.json`'s `contributes.*[]` MUST have a matching key in the corresponding map here. Missing keys surface as runtime errors when the host tries to resolve the entry-ref.

```ts
import type { ExtensionModule } from 'folyn-extension-sdk';

const module: ExtensionModule = {
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

  // collector id → collector impl (matches contributes.collectors[].id — NOT an
  // entry-ref; the only map keyed by id). See "collectors" section above.
  collectors: { 'my-source': { id: 'my-source', collect: async (ctx) => ({ events: [], nextCursor: ctx.cursor ?? '' }) } },

  // Optional lifecycle hooks (trusted loader calls these on activate/deactivate)
  activate: async (ctx) => { /* ctx: ExtensionContext */ },
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

## ExtensionContext (trusted tier)

Passed to `activate`/`deactivate`. Capabilities are `undefined` when the tier doesn't expose them.

```ts
interface ExtensionContext {
  extensionId: string;
  manifest: ExtensionManifest;
  addDisposable(d: Disposable): void;          // register for auto-cleanup on deactivate
  ai?: ExtensionAiCapability;                      // requires permissions.ai
  env?: ExtensionEnv;                              // theme + locale + change subscriptions
  http?: ExtensionHttpCapability;                   // requires permissions.http
}
```

### AI capability (`ctx.ai` — requires `permissions.ai`)

```ts
// chat: stream a multi-turn turn. sessionId owned by extension. useSharedSession surfaces in aiPanel.
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
// Routes through Rust extension_http_fetch (reqwest, outside webview CSP).
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

1. Host reads `manifest.json`, checks `tier` + TOFU approval.
2. Host resolves `activation` — activates on first matching command/fileType/language, or eagerly if `activation` is empty.
3. Trusted loader: `import()` the bundle, take default export as `ExtensionModule`.
4. Host calls `module.activate?.(ctx)` if present. Errors here set state `failed`.
5. Host registers disposables added via `ctx.addDisposable()`.
6. On deactivate: host calls `module.deactivate?.(ctx)`, then disposes all registered disposables.

A extension that needs no explicit lifecycle can omit `activate`/`deactivate` — the host guards with optional chaining.

## How to add a contribution (checklist)

1. Add an entry under the matching `contributes.*[]` array in `manifest.json`. Note the entry-ref string (`handler` / `component` / `run` / `entry`).
2. Wire the matching key in `src/index.ts`'s `ExtensionModule` export map. The key MUST equal the entry-ref.
3. Update `permissions` in `manifest.json` if the contribution touches fs / http / clipboard / dialog / window / vault / ai. Host enforces at the trust boundary — missing permission = runtime reject, not build error.
4. If the contribution needs lifecycle setup (register listeners, start a worker), put it in `module.activate(ctx)` and register disposables via `ctx.addDisposable()`.
5. `pnpm build` → reinstall `dist/` via Settings → Extensions → Install from folder… → reload Folyn → test by exercising the contribution.

## Pitfalls

- **Main-thread-only APIs.** Tray, window, and any Electron/Tauri-decorated API that touches the UI must run on the main thread. Calling them from a extension render / worker context can crash the host on reload (see fix `e43aed4` for `tray_set_enabled`). If an API is documented as main-thread-only, route the call through the SDK's main-thread bridge — do not call it directly from a component effect.
- **`manifest.main` rewrite.** Root `manifest.json` says `"main": "dist/index.js"` so the host finds it during dev. `build.mjs` strips the `dist/` prefix when copying into `dist/manifest.json` (→ `"main": "index.js"`). Do not "fix" the prefix in one place without the other — install breaks silently.
- **React is external (trusted only).** The shims in `src/` alias `react`/`react/jsx-runtime` to `window.React` (the host exposes it in `main.tsx` before any trusted extension is `import()`-ed). Importing React as a normal dep would create a second copy and break hooks. Use the global. **Sandbox has no host React** — bundle your own or use plain DOM.
- **Permissions are enforced at runtime, not build time.** A missing `permissions.fs.scope` / `permissions.http.origins` entry will cause the call to reject at runtime. Declare what you use, in the manifest, before writing the code that calls the capability.
- **`tier: "trusted"`** in the manifest means the host loads the extension with elevated access (same realm, scoped Tauri grants, `ai.agent`/`ai.edit` available). Do not accept untrusted input into extension code paths without validation. Untrusted or third-party extensions should use `tier: "sandbox"`.
- **Entry-ref keys must match exactly.** `manifest.json`'s `contributes.fileTypes[].handler` = `"puml-handler"` must equal `src/index.ts`'s `module.handlers["puml-handler"]`. Typos surface as runtime resolution errors, not type errors (the manifest is JSON, not typed).
- **Sandbox tier restrictions.** `tier: "sandbox"` cannot use `ai.agent`, `ai.edit`, or contribute inline React components / CodeMirror languages. It reaches `ai.chat` / `http` / `env` only via the postMessage RPC bridge. `html` field is required.

## Working style

- Make the smallest change that works end to end before adding capability. Do not scaffold for hypothetical contributions.
- Keep `manifest.json` and `src/index.ts` in lockstep — every `contributes.*` entry must have a matching handler/component, and vice versa.
- After any manifest or source change: `pnpm build` → reinstall `dist/` → reload Folyn → exercise the contribution. Type errors that pass at build time do not prove the extension runs.
- Prefer the SDK's typed contracts (`FileTypeHandler`, `ContainerProps`, `MarkdownCodeRendererProps`, `ExporterHandler`, etc.) over `any` — the host narrows at runtime and type drift surfaces as runtime resolution failures.

## Reference

- **`packages/extension-sdk/src/types.ts`** + **`contracts.ts`** in this monorepo — authoritative SDK source. When in doubt about a type, read it there.
- **`docs/extension-development.md`** + **`docs/extension-sdk-reference.md`** in this monorepo — full development guide (1257 + 445 lines): TOFU approval flow, sandbox RPC protocol, packaging, signing, examples. Not bundled into the generated extension; read from the monorepo when you need depth.
- **`folyn-extension-plantuml`** in the external `folyn-extension-sdk` repo — canonical reference extension covering fileTypes + containers + exporters + markdownCodeRenderers + editorLanguages end to end.
- Repo-root `AGENTS.md` — engineering principles for this monorepo (remove obsolete paths, simplest implementation, layers, prefer existing deps).
