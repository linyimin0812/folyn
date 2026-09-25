# Contribution-Points Decision Matrix

A quick chooser: "I want to do X → use tier Y, contribution point Z, module map
key W." For full field tables and examples, read the scaffolded project's
`AGENTS.md` and `node_modules/folyn-extension-sdk/docs/extension-sdk-reference.md`.

## Pick the tier

| If you need to… | Tier |
| --- | --- |
| Render inline React in the editor (file type editor/preview, `:::container`, markdown code renderer, sidebar panel) | **trusted** |
| Add a CodeMirror language / highlight grammar | **trusted** |
| Drive a feature AI agent (`ctx.ai.agent`) or AI file edits (`ctx.ai.editFile/createFile`) | **trusted** |
| Add a storage provider (Settings → Storage & Sharing) | **trusted** |
| Build an activity collector (采集器) feeding the activity timeline | **trusted** |
| Run an isolated tool/launcher window with no host-React access (safest for untrusted code) | **sandbox** |

Default to **trusted**. Use **sandbox** only when you specifically want the
isolated-iframe boundary (and accept its limits: `commands` + `tools` only).

## Contribution × tier × module map

| I want to add… | Contribution point (manifest) | module map key (`src/index.ts`) | trusted | sandbox | entry-ref field |
| --- | --- | --- | :-: | :-: | --- |
| Palette command (⌘P) | `contributes.commands[]` | `module.commands` | ✓ | ✓ | `run` |
| Own window / inline tool | `contributes.tools[]` | sandbox HTML / trusted component | ✓ | ✓ | `entry` |
| File extension → handler | `contributes.fileTypes[]` | `module.handlers` | ✓ | ✗ | `handler` |
| `:::name` Markdown directive | `contributes.containers[]` | `module.containers` | ✓ | ✗ | `component` |
| Sidebar panel (activity bar) | `contributes.features[]` | `module.features` | ✓ | ✗ | `component` |
| Custom export format | `contributes.exporters[]` | `module.exporters` | ✓ | ✗ | `run` |
| New-file template | `contributes.fileTemplates[]` | _(declarative — no map)_ | ✓ | ✗ | — |
| Keyboard shortcut | `contributes.keybindings[]` | _(declarative — no map)_ | ✓ | ✗ | — |
| Post-render DOM mutation during export | `contributes.exportEnhancers[]` | `module.exportEnhancers` | ✓ | ✗ | `run` |
| ` ```lang ` fenced block → React | `contributes.markdownCodeRenderers[]` | `module.markdownCodeRenderers` | ✓ | ✗ | `component` |
| CodeMirror language support | `contributes.editorLanguages[]` | `module.editorLanguages` | ✓ | ✗ | `entry` |
| Cloud storage provider | `contributes.storageProviders[]` | `module.storageProviders` | ✓ | ✗ | `configForm` / `isConfigured` / `uploadImage` / `uploadHtml` |
| Activity collector (poll / webhook) | `contributes.collectors[]` | `module.collectors` | ✓ | ✗ | _(collector id, not an entry-ref)_ |
| Event-type display (icon / color / detail fields / metric card) | `contributes.activityDisplay[]` | _(declarative — no map)_ | ✓ | ✗ | — |
| Custom entity type (entity graph) | `contributes.entityTypes[]` | _(declarative — no map)_ | ✓ | ✗ | — |

## Collector quick facts

- **Trusted only.** A collector is `contributes.collectors[]` + a
  `module.collectors['<id>']` entry — the map is keyed by the collector **id**
  (the only contribution whose key is not an entry-ref string).
- **Modes**: `poll` (host scheduler calls `collect(ctx)`; `pollIntervalMs`
  floored at **60 s**, user-adjustable / per-collector off / manual 立即采集)
  or `webhook` (local 127.0.0.1 server routes payloads to `onWebhook`).
- **Cursor rule**: `collect()` returns `{ events, nextCursor }`; the cursor
  persists **only after a successful push** — a failed cycle re-reads the same
  window. No events → return the old cursor unchanged.
- **Privacy** (host-side, before every push): `raw` stripped unless the user's
  keepRaw switch; redact regexes hit `title`/`summary` — never put secrets
  there.
- **hostAllowlist**: `ctx.http` throws unless the URL's origin **exactly
  matches** an entry in the collector's manifest `hostAllowlist` (confirmed
  once at install/enable).
- **Event types are validated**: each event's `type` must be in the declared
  `activityTypes`; the Rust ingest rejects the rest and stamps `source` from
  the collector id.
- **authSchema** renders the collector's config form in the 采集器 settings
  (string/boolean); values arrive as `ctx.config`.
- Full contract: `extension-sdk-reference.md` → "collectors / activityDisplay
  / entityTypes" section; guide: `extension-development.md` → "Collectors
  (activity collection)"; example: `extensions/file-collector`.

## The lockstep rule

The manifest's `contributes.*[].run` / `.handler` / `.component` / `.entry`
**string** is an **entry-ref**. The loader resolves it to a function/component by
matching it against the `ExtensionModule` export map with the **same key**. They
must match exactly (the manifest is JSON, not typed — typos surface at runtime).

```jsonc
// manifest.json
"contributes": {
  "commands": [{ "id": "greet", "title": "Greet", "run": "greet" }]
}
```

```ts
// src/index.ts
export default {
  commands: { greet: () => { /* ... */ } },   // ← key "greet" must equal run: "greet"
} satisfies ExtensionModule;
```

## Permissions to declare alongside

| Capability | `permissions` field | Tier |
| --- | --- | --- |
| Read/write/list files (relative to extension data dir) | `fs.scope: string[]` | sandbox (enforced per RPC call); trusted informational |
| Remote HTTP (routed through Rust, outside webview CSP) | `http.origins: string[]` | both |
| Clipboard read/write | `clipboard: true` | both |
| File open/save dialogs | `dialog: true` | both |
| Open a tool window | `window: true` | both |
| Read active doc / insert content | `vault.readActive` / `vault.insertContent` | both |
| AI chat | `ai.chat: true` | both (`ai:chat` RPC for sandbox, `ctx.ai.chat` for trusted) |
| AI feature agent | `ai.agents: ["<feature>"]` | trusted only |
| AI file edits | `ai.edit: true` | trusted only |

> **Trusted tier**: `permissions` is informational — a TOFU-approved trusted
> extension has full host capability. For a hard, per-call-enforced boundary,
> use the **sandbox** tier. See `extension-development.md` "Permissions model".

## Trusted bundling (the sharp edges)

- **No relative imports at eval time** — the trusted loader wraps `main` in a blob
  URL and `import()`-s it; blob URLs have no path. Bundle everything with the
  scaffolded `build.mjs` (esbuild).
- **No bundling React** — use `window.React` via the shims (`build.mjs` aliases
  `react` + `react/jsx-runtime` to them). A second React copy breaks hooks.
- **CodeMirror**: trusted blob `import('@codemirror/language')` gives a second
  module instance the host won't apply — resolve the host's copy lazily via
  `window.codemirrorLanguage` (host sets it before any trusted extension loads).
- **Remote fetch**: declare `http.origins`, use `ctx.http.fetch` — never a direct
  `fetch()` in the bundle (main-webview CSP blocks it in packaged builds; dev
  mode does not enforce CSP, masking the bug).

## Sandbox tier (the limits)

- Origin `null` (opaque); no parent DOM, no Tauri, no `localStorage`, no host React.
- Every host capability goes through `postMessage` RPC, gated by
  `manifest.permissions`. `src/index.ts` (scaffolded) wires the bridge — copy the
  `rpc()` helper pattern. Methods: `fs:*`, `http:fetch`, `clipboard:*`,
  `dialog:*`, `vault:read-active-doc`, `vault:insert-content`, `window:open`,
  `ai:chat` (+ `ai:chat-poll` on the tool-window fetch transport, which has no
  stream channel — `ai:chat` returns `{ jobId }`, poll it for text/thinking
  deltas), `storage:get`/`storage:set` (same `ext:<id>:` namespace as trusted
  `api.storage` — share one data set across surfaces), `env:get` + pushed
  `env-event` (theme/locale).
- `html` field is required (the iframe entry).
