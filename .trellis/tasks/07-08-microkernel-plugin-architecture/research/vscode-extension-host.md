# Research: VSCode Extension Host Architecture (mapped to quill microkernel)

- **Query**: VSCode extension host architecture — manifest/contributes, activation events, host process model, `vscode` API surface, lifecycle/disposables, VSIX/marketplace/signature/trust.
- **Scope**: external (VSCode docs + canonical architecture knowledge) + mixed (mapped to quill's existing registries)
- **Date**: 2026-07-08

> **Caveat on sources**: This environment has no web access (curl denied, exa MCP tools unavailable). The VSCode extension API is stable and has been documented for years; the conventions below are well-established canonical knowledge. Version-specific details (e.g. exact signature scheme internals) are marked uncertain. Verify against https://code.visualstudio.com/api and https://code.visualstudio.com/api/references before relying on specifics for implementation.

---

## 0. Why VSCode is the reference model

VSCode is the most studied in-process-extensible desktop editor. Its design answers exactly the questions quill's PRD raises: declarative manifest, lazy activation, isolated host process, capability-scoped API, disposable-based cleanup, and a signed package format with runtime install. Quill does not need to replicate it wholesale, but every decision in VSCode exists for a reason that maps onto a real quill constraint.

---

## 1. Extension manifest (`package.json` `contributes`)

### Convention

A VSCode extension is an npm-shaped package whose `package.json` carries:
- `name`, `version`, `engines.vscode` (semver pin to the host API version),
- `main` (entry module, activated lazily — see §2),
- `activationEvents` (declarative, now mostly auto-generated from `contributes`),
- **`contributes`** — a declarative map of *contribution points*. The host reads these at load time *without* executing the extension's code, so it can wire UI/commands/menus before the extension activates.

`contributes` is an object whose keys are contribution-point names. The points relevant to quill:

| Contribution point | Shape (abridged) | Maps to quill |
|---|---|---|
| `commands` | `[{ command, title, category, icon, enablement }]` — registers a command id + palette entry. `command` is the stable id; the extension later registers a handler via `vscode.commands.registerCommand`. | quill `commandRegistry` (`Command` interface, `apps/desktop/src/services/commandRegistry.ts`) — `id/title/category/icon/keywords/enabled/run`. Quill already fuses the declaration and the handler into one object; VSCode splits them so the palette can render before activation. |
| `menus` | `{ "commandPalette": [{ command, when, group, alt }], "editor/title": [...], ... }` — declares *where* a command shows up, gated by a `when` clause (keybinding context expression). | quill has no menu-contribution layer; commands surface only via the ⌘P palette. Borrowing `menus` is **over-engineered for MVP** — quill's palette is the single surface. |
| `configuration` | `[{ title, properties: { "myExt.foo": { type, default, description, scope } } }]` — declares settings schema; host generates the Settings UI. | quill settings live in `settingsStore` (Zustand). A plugin contributing settings would need a schema + a React settings tab renderer. Worth borrowing the schema shape; the Settings UI generation is over-engineered for MVP (let plugins render their own settings React component instead). |
| `viewsContainers` / `views` | `viewsContainers`: `{ activitybar: [{ id, title, icon }] }`; `views`: `{ "myContainer": [{ id, name, type, when }] }` — declares a side-panel container and the views inside it. | quill `ActivityBar` panels are hardcoded (`files/clips/wiki/analyze/calendar/settings`). This is the model for a plugin contributing a *feature panel* — quill's `features/` modules (analyze/clips/schedule/study/wiki) are the existing analog. Borrow the `{ id, title, icon }` shape for a "panel" contribution point. |
| `languages` | `[{ id, aliases, extensions, configuration: ./grammar.json }]` — declares a language id + file-extension mapping + grammar path. | quill file-type handling (`FileTypeHandler.extensions`, `apps/desktop/src/components/file-types/registry.ts`) is the direct analog: extension list → handler. VSCode separates *language declaration* from *grammar* from *editor provider*; quill fuses them into one `FileTypeHandler`. For MVP, keep quill's fused shape and treat `languages`-style contribution as a sub-field of the file-type contribution. |
| `grammars` | `[{ language, path, scope }]` — TextMate grammar (.tmLanguage.json) for syntax highlighting. | quill uses CodeMirror 6 + `@codemirror/language-data`; TextMate grammars are **not directly usable**. Skip `grammars` entirely for MVP; plugins that want syntax highlighting must contribute a CodeMirror `LanguageDescription`. |
| `customEditors` / `webviewEditors` | `[{ viewType, displayName, selector: [{ filenamePattern }], retainContextWhenHidden }]` — declares a custom editor for a file pattern, backed by a webview. | quill `FileTypeHandler.Editor` / `Preview` (`apps/desktop/src/components/file-types/types.ts`) is the analog. VSCode's webview is an isolated iframe with a message bridge; quill already uses an iframe bridge for some file types and direct React components for others (see `file-type-editors.md`). For a plugin SDK, the `Editor`/`Preview` React component *is* the contribution — no need for VSCode's webview indirection unless sandboxing is required (see §3). |
| `iconThemes` / `productIconThemes` | declarative theme contribution. | Not relevant to quill MVP. |
| `keybindings` | `[{ command, key, mac, when }]` | Optional; quill could accept a `keybindings` contribution point cheaply. Low priority. |

### Why it exists
Decoupling **declaration** from **execution** is the core idea. The host can build the palette, settings UI, and file-type routing table from the manifest *before* the extension's `main` is ever imported. That is what makes lazy activation (§2) possible: the user sees "MyExt: Do Thing" in the palette, and only when they invoke it does the extension's code load.

### Mapping to quill
Quill's existing registries already fuse declaration and implementation (e.g. `Command.run` is on the same object as `Command.title`). For **built-in** contributions this is fine — they're always loaded. For **runtime-installed** plugins, quill should adopt VSCode's split: the manifest's `contributes` is parsed at install time (no code execution), the contribution points are wired into the UI, and the plugin's `main` is imported only when one of its activation events fires. This is the single most important pattern to borrow.

A plausible quill manifest shape (subset of VSCode's, adapted):
```jsonc
{
  "name": "quill-pdf-tools",
  "version": "1.0.0",
  "engines": { "quill": "^0.4" },
  "main": "./dist/index.js",
  "activationEvents": ["onFileType:pdf", "onCommand:pdf.export"],
  "contributes": {
    "fileTypes": [{ "id": "pdf", "extensions": ["pdf"], "icon": "pdf.svg" }],
    "commands": [{ "command": "pdf.export", "title": "Export PDF", "category": "PDF" }],
    "containers": [{ "name": "callout", "category": "block" }]
  }
}
```

---

## 2. Activation events (lazy activation)

### Convention
VSCode avoids loading extension code until needed. `activationEvents` is an array of triggers; the host activates the extension's `main` the first time any trigger fires. Once activated, the extension stays loaded for the session. Historic forms:

- `onLanguage:python` — activate when a document of that language is opened.
- `onCommand:myExt.doThing` — activate when that command is invoked (the palette entry can show *before* activation because the manifest declared it).
- `onView:myView` — activate when the contributed view becomes visible.
- `onUri` / `onFileSystem` / `onDebugResolve` / `onTaskType` — domain-specific triggers.
- `*` (star) — activate on startup. Deprecated/discouraged (performance).
- `onStartupFinished` — activate after startup completes (preferred over `*`).
- **Modern VSCode (≈1.74+) auto-generates** most activation events from `contributes` (e.g. contributing a command implies `onCommand:thatCommand`). Explicit `activationEvents` is now mostly needed for dynamic triggers.

### Why it exists
Performance. VSCode ships hundreds of extensions; loading all at startup would make the editor unusable. The host needs the *declarative* contribution (from `contributes`) to render UI affordances, but defers the *imperative* code (the handler registration in `main`) until the user actually touches that surface.

### Mapping to quill
Quill currently does the opposite: `import.meta.glob({ eager: true })` in `file-types/registry.ts` loads every file-type handler at startup. For built-ins this is acceptable (bounded set). For **installed plugins**, quill must adopt VSCode's split:
1. At install time, parse the manifest and register *declarative* contributions (palette entries, file-type routing table entries, panel slots) with placeholder handlers.
2. When a trigger fires (file opened, command invoked, panel shown), dynamically `import()` the plugin's `main` and let it register the *real* handlers, replacing the placeholders.

This maps directly onto quill's three MVP contribution points:
- `onFileType:<id>` → when a file with matching extension is opened (analog to VSCode `onLanguage`).
- `onCommand:<id>` → when the palette runs the command.
- `onContainer:<name>` → when a Markdown container directive of that name is rendered (no VSCode analog — quill-specific).

**Trade-off**: the placeholder-to-real-handler swap is invisible to the user but adds indirection. The existing `commandRegistry.runCommand` already wraps execution in try/catch; the activation indirection would live in the same path. Borrow this pattern — it is the enabler for "install at runtime, no repackaging".

---

## 3. Extension host process model

### Convention
VSCode runs extensions in a **separate Node.js process** called the *extension host* (EH), not in the renderer/UI thread. The UI (Electron renderer) communicates with the EH via an IPC channel that marshals the `vscode` API. Consequences:
- A crashing/hanging extension cannot freeze the UI thread.
- Extensions cannot directly touch the DOM; all UI goes through the `vscode` API (webviews are iframes with a message bridge).
- CPU-heavy extensions don't jank typing.
- The EH can be restarted independently (the "Reload Window" / "Restart Extension Host" command).

There is exactly one EH per window by default (a `--inspect-extensions` debug port is available). VSCode has experimented with a *web worker* EH for the web build and a *separate EH per extension* mode is not the default.

### Does this transfer to Tauri/React?
**Not directly for MVP.** A separate Node process is not a natural fit for a Tauri app (no bundled Node, no Electron-style main/renderer/EH split). Options for quill, ordered by isolation strength:

1. **In-process host (React main thread / module scope)** — plugin code runs in the same JS realm as the app. Simplest; what quill's existing registries already do. A misbehaving plugin can freeze the UI or read app state. **Acceptable for MVP if plugins are trusted/signed** (matches quill's stated assumption: "npm package + manifest, dynamic import, trusted").
2. **Web Worker host** — run plugin code in a Worker, expose the host API via `postMessage`. UI stays responsive; plugin crashes are contained. Cost: all API calls become async message-passing; React component contribution is hard (a Worker can't render React). Best suited to pure-logic plugins (parsers, adapters), not UI-contributing ones.
3. **iframe sandbox (webview model)** — plugin UI renders in a sandboxed iframe with a message bridge (VSCode `customEditors`/`webview` pattern). Strong isolation; Content-Security-Policy can block network. Cost: React state must be mirrored across the bridge; styling/theming is painful; the bridge adds latency to every interaction. quill's `HtmlVisualEditor`/iframe bridge experience (see `file-type-editors.md`) shows the friction.
4. **Separate OS process per plugin** — VSCode-style. Over-engineered for a Tauri MVP (would require bundling a runtime, or a Rust-side plugin host, or spawning a Node/deno sidecar).

### Trade-off flag
For quill's MVP, **in-process host is acceptable** but it bakes in a trust assumption: every installed plugin can read the Zustand stores, call any Tauri command, and touch the DOM. This is incompatible with the PRD's acceptance criterion *"插件申请受控 Tauri 能力时需显式授权，未授权不可调用"* unless the host API (§4) is the *only* path to Tauri capabilities and the host enforces permissions at the API boundary. I.e. quill must not give plugins the raw `@tauri-apps/api/core` `invoke` — it must give them a scoped `host.invoke(command, args)` that checks the manifest's declared capabilities before forwarding.

**Recommendation to capture in design (not a final answer)**: MVP = in-process host + capability-scoped API surface. Reserve the iframe/web-worker path as a future isolation tier for untrusted plugins. This is the key trade-off the PRD's "沙箱模型" open question must resolve.

---

## 4. The `vscode` API surface given to extensions

### Convention
The `vscode` module given to extensions is a *curated namespace*, not arbitrary host internals. It is organised into namespaces (each a frozen object of functions):

- `vscode.commands` — `registerCommand`, `executeCommand`, `getCommands`. Lets an extension register its handlers and invoke others'.
- `vscode.window` — UI: `showInformationMessage`/`showInputBox`/`showQuickPick`, `createOutputChannel`, `createStatusBarItem`, `createWebviewPanel`, `createTextEditorDecorationType`, `onDidChangeActiveTextEditor`.
- `vscode.workspace` — document/file system: `openTextDocument`, `fs.readFile`/`fs.writeFile`, `findFiles`, `workspaceFolders`, `onDidChangeTextDocument`, configuration access.
- `vscode.languages` — `registerCompletionItemProvider`, `registerDefinitionProvider`, `registerHoverProvider`, the various Language Provider APIs.
- `vscode.extensions` — `getExtension(id)`, `onDidChangeExtensions` — introspect installed extensions.
- `vscode.commands`, `vscode.debug`, `vscode.tasks`, `vscode.window`, `vscode.workspace`, `vscode.env`, `vscode.Uri`, `vscode.Disposable`, `vscode.Event`, `vscode.EventEmitter`, `vscode.CompletionItem`, ... (many value types).

Crucially the host **does not expose** its internal services directly; everything goes through these namespaced, typed, and versioned entry points. Proposed/unstable APIs are gated behind `enableProposedApi` and a publisher allowlist.

### Why it exists
- **Versioning**: `engines.vscode` pins the API version; the host can add APIs but never break old ones (deprecation only). This is the contract that lets extensions survive host upgrades.
- **Capability scoping**: because the host is the only path to filesystem/network/UI, it can enforce permissions, audit calls, and revoke capabilities — the foundation of the trust model (§6).
- **Isolation-enabling**: a remote/worker EH can marshal these calls over IPC; the API shape is IPC-friendly (mostly async, value-type arguments).

### Minimal host API quill should expose
For an MVP plugin SDK, the analog is a `quill` host object with a *small* surface. Mapping quill's existing primitives:

| VSCode namespace | quill analog | MVP need |
|---|---|---|
| `commands` | `commandRegistry` (`registerCommand`/`runCommand`) | **Yes** — plugins contribute commands. Expose `host.commands.register(cmd)`. |
| `window` (status/message/quickpick) | quill has a palette + toast-ish UI; no status bar | **Partial** — expose `host.ui.toast(msg)` and `host.ui.prompt(opts)`. Skip status bar. |
| `workspace` (fs/docs) | `vaultStore` + `vault-provider` registry (`packages/vault-provider/registry.ts`) | **Yes, capability-scoped** — `host.fs.readFile(path)` / `writeFile` checked against manifest `capabilities: ["fs:read", "fs:write"]`. |
| `languages` (CodeMirror providers) | CodeMirror extensions | **Defer** — autocomplete/hover providers are a big surface; not in MVP. |
| `extensions` | none yet | **Yes (small)** — `host.plugins.list()` / `host.plugins.get(id)` for inter-plugin discovery. |
| `env` / `Uri` | Tauri paths | **Small** — `host.env.vaultRoot`, `host.env.appVersion`. |
| Tauri invoke (no VSCode analog) | — | **Yes, scoped** — `host.invoke(cmd, args, { capability })` proxies to Tauri after capability check. This is quill-specific and central to the permission model. |
| React component contribution (no VSCode analog; VSCode uses webviews) | `FileTypeHandler.Editor/Preview`, `ContainerPlugin` render fn | **Yes** — quill plugins contribute React components directly. This *replaces* VSCode's webview bridge for UI-contributing plugins and is why in-process hosting is the pragmatic MVP choice (see §3). |

The minimal set: `commands`, `fs` (scoped), `ui.toast/prompt`, `plugins.list`, `invoke` (scoped), and the component-registration hooks (`registerFileType`, `registerContainer`, `registerCommand`). Everything else can grow later.

---

## 5. Activation / deactivation lifecycle (disposables)

### Convention
VSCode calls the extension's `activate(context: vscode.ExtensionContext)` function the first time an activation event fires. `context` provides:
- `subscriptions: Disposable[]` — the extension pushes its disposables here; the host disposes them on deactivate/uninstall.
- `globalState` / `workspaceState` — KV storage scoped to the extension.
- `extensionUri` / `extensionPath` — location of the extension.
- `asAbsolutePath(relativePath)` — resolve a path inside the extension dir.
- `secrets` — secure secret store.
- `environmentVariableCollection` — terminal env vars.

The extension registers everything via `context.subscriptions.push(...)`:
- `vscode.commands.registerCommand(id, handler)` → returns a `Disposable`.
- `vscode.languages.registerHoverProvider(...)` → `Disposable`.
- `vscode.window.createStatusBarItem(...)` → `Disposable`.
- event listeners (`onDidChangeActiveTextEditor`, ...) → `Disposable`.

**Deactivation**:
- `deactivate()` is called by the host on window close / extension uninstall / EH restart, *if the extension exported one*. It can return a Promise (thenable) for async cleanup.
- In practice, the *recommended* cleanup path is **disposables on `context.subscriptions`**: the host auto-disposes them, so most extensions don't need an explicit `deactivate()`. `deactivate()` is only for resources not captured by a Disposable (e.g. native sockets, child processes).

**Uninstall cleanup**:
- The host walks `context.subscriptions`, calling `.dispose()` on each.
- Registered commands/providers are disposed → removed from palette/language providers.
- Webviews created by the extension are disposed/reverted.
- `globalState`/`workspaceState` storage is optionally cleared.
- Contributions declared in `contributes` (static: commands/menus/views) are removed because the host owns them — the extension's code doesn't have to unregister the palette entry; the host drops it when the extension is removed.

### Why it exists
The Disposable pattern gives the host a **uniform cleanup contract** that doesn't depend on the extension being well-behaved. Even a crashing extension's `subscriptions` are known to the host, so it can tear them down. This is what makes uninstall-safe behavior possible.

### Mapping to quill
Quill's existing registries already have the right primitives but unevenly:
- `commandRegistry` has `registerCommand` but **no unregister** (only `clearCommands()` — nuclear). It does not return a Disposable. → Add `registerCommand` returning `{ dispose() }` or an `unregister(id)`.
- `ContainerRegistry` already has `unregister(name)` — good model.
- `file-types/registry.ts` is a frozen-at-startup map built from `import.meta.glob` — **no register/unregister API at all**. → Must be refactored to expose `registerFileType(handler)` / `unregisterFileType(id)` for runtime plugins (built-ins keep using `import.meta.glob` internally).
- `vault-provider/registry.ts` and `cli-adapter/registry.ts` — need the same register/unregister shape.

**Recommended lifecycle for quill plugins** (direct VSCode borrow):
```ts
export interface QuillPluginContext {
  subscriptions: Disposable[];
  pluginId: string;
  vaultRoot: string;
  // scoped host API:
  commands: { register(cmd: Command): Disposable };
  fs: { readFile(p: string): Promise<string>; writeFile(p: string, c: string): Promise<void> };
  ui: { toast(msg: string): void; prompt(opts: PromptOptions): Promise<string | undefined> };
  invoke(cmd: string, args: unknown, opts?: { capability?: string }): Promise<unknown>;
  registerFileType(handler: FileTypeHandler): Disposable;
  registerContainer(plugin: ContainerPlugin): Disposable;
}
export interface QuillPlugin {
  activate(ctx: QuillPluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
```
Install → `activate(ctx)`; the plugin pushes every registration into `ctx.subscriptions`. Uninstall → host iterates `ctx.subscriptions` calling `.dispose()`, then optionally calls `deactivate()`. Manifest-declared contribution points (file types, commands) are removed by the host itself, so a plugin that only contributes declarative things need not even implement `activate`.

This is worth borrowing wholesale; it is the cheapest correct cleanup model.

---

## 6. Marketplace + VSIX packaging + signature verification + trust

### Convention

#### VSIX package format
A `.vsix` is a **ZIP archive** (it's literally an OWP/OPC package, same family as Office `.docx`) containing:
- `extension/package.json` — the manifest.
- `extension/dist/...` — compiled JS.
- `extension/README.md`, `CHANGELOG.md`, `icon.png`, `LICENSE` — marketplace metadata.
- `extension/.vsixmanifest` — an XML manifest with the extension id, version, target platform, and a list of asset files with SHA-256 digests.
- optionally `[Content_Types].xml` (OPC content-types map).

Loading at runtime: the host unzips the VSIX into `~/.vscode/extensions/<publisher.name-version>/` (or an equivalent install dir), reads `package.json`, registers the `contributes` points, and wires activation events. The compiled JS is loaded via Node `require`/`import` from the unpacked dir. There is no special runtime loader — it's "unzip + register manifest + dynamic-import main".

#### Marketplace
The public Marketplace (https://marketplace.visualstudio.com) is the registry/discovery layer: search, ratings, download counts, publisher identity. VSCode queries it, downloads the VSIX, and verifies before installing. For a private/internal marketplace, VSCode supports custom gallery URLs via `extensionsGallery` product config. **Quill MVP explicitly scopes out a marketplace server** (per PRD "Out of Scope") — local install + optional URL is enough.

#### Signature / trust
- VSIX signing is **optional and rarely used on the public Marketplace**; the Marketplace itself is the trust root (publisher identity verification, malware scanning, Microsoft can delist). The `.vsixmanifest` carries per-file SHA-256 digests for integrity, and the package *can* be code-signed (RFC 5652 / PKCS#7 detached signature in a `.signature.p7s`), but in practice most extensions are unsigned and trust flows through the Marketplace + publisher reputation.
- **Proposed APIs & trusted extensions**: unstable APIs are gated by `enableProposedApi` in the product (a boolean) plus an allowlist of trusted publisher IDs. Extensions using proposed APIs must be signed by a trusted publisher or run against a dev build. This is the capability-escalation gate.
- **Capability/permission model (modern)**: VSCode is gradually moving toward a more explicit permission model (`permissions` in manifest, e.g. `permissions: ["workspace-fs"]`, proposed), but historically the model was *implicit*: an extension's API access was bounded by which `vscode.*` namespaces existed, and filesystem/network access outside the API was blocked by the EH's lack of Node APIs (the EH exposes `vscode`, not raw `require('fs')`). The EH-process isolation (§3) is what makes this implicit capability scoping enforceable.

### Why it exists
- **VSIX-as-zip** because it's trivially installable, inspectable, and versionable; the SHA-256 digests in `.vsixmanifest` give tamper detection after download.
- **Marketplace as trust root** because a desktop editor cannot do signature verification well end-to-end without a CA/PKI story most publishers won't bother with; centralising trust at the registry is pragmatic.
- **Proposed-API allowlist** because the host needs a way to ship unstable APIs to a vetted few without breaking the "API never breaks" promise for everyone else.
- **EH-based capability scoping** because if the plugin can't reach `require('fs')`, the host's `vscode.workspace.fs` is the *only* path to files — and the host can permission-check there. The isolation is what makes the scoping non-bypassable.

### Mapping to quill
Quill's PRD open questions on "分发形态 / 沙箱 / 签名" map as follows:

- **Distribution form**: borrow the **zip + manifest** shape (a "quill-plugin" archive = ZIP with `package.json` at root + compiled JS). It's simpler than a full VSIX/OPC package; skip the XML `.vsixmanifest` and put integrity digests in a `manifest.json` field or a `SHA256SUMS` file. An npm package form (per quill's assumption) is also viable and even simpler — `npm pack` already produces a tarball with a manifest; runtime install = untar + `import`. Either is fine for MVP; the zip shape is closer to VSCode and avoids npm-as-runtime-dependency.
- **Signature**: for MVP, a Marketplace-style **trust root** is out of scope (no server). Pragmatic MVP: (a) hash-verify the package against a manifest-pinned digest (tamper detection, not origin trust), and (b) gate install behind an **explicit user consent prompt** showing the declared capabilities ("This plugin requests fs:write, ai:stream — Allow?"). This mirrors VSCode's implicit model: the host's capability-scoped API is the enforcement layer; "trust" is the user saying yes at install time. Full PKCS#7 signing is over-engineered for quill's MVP.
- **Capability/permission model**: this is where quill **must** borrow, because the PRD explicitly requires "未授权不可调用". The enforceable design is:
  - The manifest declares `capabilities: ["fs:read", "fs:write", "ai:stream", "shell:exec", ...]`.
  - At install time, the user consents to that exact set (prompt).
  - At runtime, the host API (§4) checks every `host.fs.*` / `host.invoke(...)` call against the plugin's consented capability set. A plugin with no `fs:write` capability cannot call `host.fs.writeFile`.
  - **This is only enforceable if the host API is the *only* path to capabilities.** That breaks down in an in-process host (§3) because a plugin can `import('@tauri-apps/api/core')` and `invoke()` directly, bypassing the host. Quill must therefore either (a) accept that in-process plugins are *trusted* and rely on consent-at-install as a soft gate (MVP), or (b) isolate untrusted plugins in a Worker/iframe so the host API is genuinely the only path (future). Flag this as the central design decision the PRD's "沙箱模型" open question must settle.
  - Tauri 2's own capabilities are **static, build-time-generated** (per quill PRD Technical Notes and `.trellis/spec/desktop/frontend/tauri-window-patterns.md` ACL patterns). They cannot be the per-plugin runtime permission system. The host must run its own capability store on top.

---

## 7. Summary — what to borrow vs. what is over-engineered for quill

### Worth borrowing
1. **Declarative `contributes` manifest parsed at install, code loaded lazily.** The single most important pattern; it is what makes runtime install + lazy activation possible. Quill's existing fused declare+implement registries must be split for the plugin path.
2. **Activation events (`onFileType`, `onCommand`, `onContainer`).** Enables runtime-installed plugins without loading all code at startup. Maps cleanly onto quill's three MVP contribution points.
3. **`activate(ctx) / deactivate() / Disposable[]` lifecycle.** Cheapest correct cleanup model. Quill's `ContainerRegistry.unregister` is already the right shape; `commandRegistry` and `file-types/registry.ts` need `register/unregister` + Disposable return.
4. **Curated, namespaced, capability-scoped host API.** The host is the only path to fs/invoke/ui; permissions enforced at the API boundary. Essential for the PRD's "未授权不可调用" criterion — but only enforceable if combined with an isolation tier for truly untrusted plugins (see trade-off).
5. **VSIX = zip + manifest + per-file digests.** Cheap tamper-detection; pair with install-time consent prompt for the MVP trust model.

### Over-engineered for quill's MVP scope
1. **Separate extension-host process.** No bundled Node in Tauri; in-process host is acceptable for trusted/signed plugins. Reserve Worker/iframe isolation as a future tier.
2. **Full `menus` / `when` clause context system.** Quill has one surface (⌘P palette); skip menu contribution until there are multiple surfaces.
3. **TextMate `grammars`.** Quill uses CodeMirror; plugins must contribute CodeMirror `LanguageDescription` instead — different contribution point, not the VSCode one.
4. **Webview-based custom editors.** Quill's React `Editor`/`Preview` components are simpler and already work; reserve the webview-iframe bridge only when sandboxing is required.
5. **Marketplace server + PKI signing.** Explicitly out of scope per PRD; local install + URL + consent prompt is enough.
6. **Settings UI generation from `configuration` schema.** Let plugins render their own settings React component; generating UI from a schema is not worth the complexity at quill's size.
7. **Proposed-API allowlist / trusted-publisher gating.** Over-engineered for an MVP with no marketplace; a capability consent prompt at install time covers the same need at quill's scale.

---

## Findings — internal file references (quill's current state)

| File Path | Description |
|---|---|
| `apps/desktop/src/components/file-types/registry.ts` | File-type registry; uses `import.meta.glob({ eager: true })` — **no runtime register/unregister API**, must be refactored for plugin path. |
| `apps/desktop/src/components/file-types/types.ts` | `FileTypeHandler` interface (`id/extensions/icon/Editor/Preview/serialize/...`) — the file-type contribution-point shape. |
| `apps/desktop/src/services/commandRegistry.ts` | Command palette registry; `registerCommand`/`runCommand` exist, **no unregister/Disposable return**, only `clearCommands()`. |
| `packages/container-plugins/src/ContainerRegistry.ts` | Container directive registry; already has `register`/`unregister` — the closest-to-VSCode-shaped registry in quill. |
| `packages/vault-provider/registry.ts` | Storage-backend registry (tauri/webdav/s3/github). |
| `packages/cli-adapter/registry.ts` | AI CLI adapter registry (claude). |
| `apps/desktop/src/features/{analyze,clips,schedule,study,wiki}` | Existing "feature panel" modules — the analog of VSCode `viewsContainers`/`views` contributions. |
| `.trellis/spec/desktop/frontend/file-type-editors.md` | Documents the `EditorProps`/`PreviewProps` contract and iframe-bridge patterns — relevant to §3/§4 (component contribution vs. webview isolation). |
| `.trellis/spec/desktop/frontend/tauri-window-patterns.md` | Tauri ACL/capability patterns — confirms capabilities are static/build-time; runtime per-plugin permissions need a host-side store. |
| `.trellis/spec/container-plugins/frontend/index.md` | `ContainerPlugin` interface + `ContainerRegistry` singleton — plugin contribution-point reference. |

## Related Specs

- `.trellis/spec/container-plugins/frontend/index.md` — existing plugin registry pattern (register-once, consumed by slash menu + preview).
- `.trellis/spec/desktop/frontend/file-type-editors.md` — `FileTypeHandler` editor/preview contract (the component-contribution model a plugin SDK would expose).
- `.trellis/spec/desktop/frontend/tauri-window-patterns.md` — Tauri ACL contract; the constraint that capabilities are build-time, not runtime.

## External References

- https://code.visualstudio.com/api/references/contribution-points — `contributes` point reference (could not fetch; canonical source).
- https://code.visualstudio.com/api/references/activation-events — activation events reference.
- https://code.visualstudio.com/api/advanced-topics/extension-host — extension host process model.
- https://code.visualstudio.com/api/references/vscode-api — the `vscode` API namespace reference.
- https://code.visualstudio.com/api/extension-capabilities/overview — overview of extension capabilities.
- https://code.visualstudio.com/api/working-with-extensions/publishing-extension — VSIX packaging & marketplace publishing.
- https://code.visualstudio.com/api/extension-capabilities/proposed-api — proposed APIs and trusted-extension gating.

## Caveats / Not Found

- **No live web access in this environment** — curl was denied and the exa MCP tools (`mcp__exa__web_search_exa`, `mcp__exa__get_code_context_exa`) listed in the task prompt were not actually available in the tool set. All VSCode specifics above are from established canonical knowledge; they are stable (VSCode's extension API has been roughly this shape since ~2018) but **verify against the linked docs before implementing**, especially: exact `.vsixmanifest` field names, the modern auto-generated activation-events behaviour (VSCode ≥1.74), and the current state of the proposed `permissions` field which is still evolving.
- **Quill's `vault-provider/registry.ts` and `cli-adapter/registry.ts` were not read line-by-line** — only their existence and role are confirmed from the PRD. Their register/unregister API shape should be verified before designing the unified `PluginHost` adapter.
- **The exact signature/verification internals** (PKCS#7 detached signature format, `.signature.p7s`) are flagged uncertain — quill's MVP does not need them, but if a future trust tier is designed, fetch the live docs.
