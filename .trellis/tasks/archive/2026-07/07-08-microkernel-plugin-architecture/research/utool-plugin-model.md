# Research: uTool Plugin / Extension Architecture

- **Query**: uTool's plugin/extension architecture in depth — manifest, packaging, runtime loading, UI contribution model, permissions, DX. Map onto quill (Tauri 2 + React, runtime install without repackage).
- **Scope**: external (uTool docs/conventions) + mixed (quill codebase mapping)
- **Date**: 2026-07-08
- **Source caveat**: This agent had no live network access in this run (curl denied; no exa MCP wired into tool list). Findings below are synthesized from documented uTool conventions widely cited in the u.tools developer community and the official "uTools 插件开发文档" (u.tools/docs/). **Field names and exact API surface should be re-verified against u.tools/docs/ before any spec is written from this file.** Where I am unsure, I mark it explicitly.

---

## TL;DR — uTool's model in one paragraph

uTool is an Electron-based launcher. A plugin = a folder containing a `plugin.json` manifest + an HTML `main` page + a `preload.js` script. The manifest declares one or more **features**; each feature is a *full-window tool* that is triggered by one or more **cmds** (keyword, regex on input/clipboard, selected files, image, current window, etc.). At activation uTool opens a dedicated `BrowserWindow`, loads the plugin's HTML, and runs `preload.js` in a privileged context that bridges a curated `utools.*` API namespace (db, fs, shell, clipboard, screen, dialogs, lifecycle hooks) into the renderer. Distribution is a `.upx` archive (zipped plugin folder) installed locally or from the uTools plugin marketplace. There is **no per-capability permission prompt** — trust is binary and gated by marketplace curation; once installed, a plugin's preload has full Node access. The renderer (plugin UI) runs sandboxed (nodeIntegration off) and reaches the host only through `window.utools`.

---

## 1. Plugin Manifest (`plugin.json`)

uTool's manifest is a flat JSON file at the plugin root. Concrete fields (recalled — verify field names against docs):

| Field | Type | Purpose | Notes |
|---|---|---|---|
| `name` | string | Plugin display name | |
| `code` | string | Plugin-unique id (snake_case) | Used in `onPluginEnter` payload `code` to identify which feature fired |
| `description` | string | Long description | |
| `version` | string | Semver-ish version | Used for update detection |
| `author` | string / object | Author info | |
| `logo` | string | Path to icon image (relative) | Shown in launcher/marketplace |
| `main` | string | Entry HTML file (relative path) | e.g. `"index.html"`. Loaded into the feature's BrowserWindow |
| `preload` | string | Preload script path (relative) | Runs in privileged context with Node access; bridges `utools` API into renderer |
| `platform` | string[] | OS filter `["win32","darwin","linux"]` | |
| `features` | Feature[] | The tools/commands this plugin contributes | Core of the manifest |
| `homepage` | string | Optional | |
| `pluginName` / `id` | string | Sometimes seen as stable plugin id | verify |

### Feature object

| Field | Type | Purpose |
|---|---|---|
| `code` | string | Feature-unique id; delivered to `onPluginEnter({code, type, payload})` so the plugin can branch |
| `name` | string | Feature display name |
| `desc` | string | Description shown in launcher |
| `icon` | string | Path to feature icon (optional; falls back to `logo`) |
| `platform` | string[] | OS filter |
| `cmds` | Cmd[] | **Trigger conditions** — how the feature is activated |
| `preload` | string | Optional per-feature preload override |

### Cmd object (trigger condition)

| `type` | Meaning |
|---|---|
| `text` | Plain keyword the user types in the launcher |
| `regex` | Regex matched against current input / clipboard text |
| `img` | Triggered when an image is in the clipboard/selection |
| `files` | Triggered by drag-dropped or selected files (with file-type filter) |
| `over` | "超级面板" — right-click overlay menu on selected text/files |
| `window` | Triggered with the current OS foreground window info (title + app) |
| `none` | No trigger; runs as a persistent/background feature |

Cmd fields: `label`, `type`, `value`/`regex`/`keyword`, `length` (min input length), `filter` (file ext filter for `files`). Exact field set varies by `type` — verify.

**Why this design exists:** The manifest is the *only* contract between plugin and host. uTool's launcher UI parses `features[].cmds` to decide when/where to surface the plugin in the global search box, "超级面板", and drag-drop — so the host can index a plugin without executing it. The `preload` split exists because Electron needs a privileged bridge (Node-capable) separate from the untrusted renderer HTML.

---

## 2. Packaging & Distribution

- **Folder layout**: `plugin.json` + `main` HTML + `preload.js` + assets (JS/CSS/img). Conventionally built to a `dist/` or flat root.
- **`.upx` archive**: A `.upx` file is just a **zipped plugin folder** (not a custom format). uTool unpacks it on install into a per-plugin directory under the uTool data dir.
- **Install at runtime**:
  - **Local**: double-click a `.upx` (handled by the uTool app) or drag into uTool → uTool reads `plugin.json`, copies folder into its plugins dir, registers features. No app republish needed.
  - **Marketplace**: uTools hosts a plugin marketplace; "install" downloads the `.upx` and unpacks the same way.
- **Versioning**: `version` field in `plugin.json`. Marketplace compares against installed version for update prompts. No automatic semver constraint resolution (single plugin, not a dependency graph).
- **No dependency graph**: plugins are self-contained (bundle their own JS, no `npm install` at runtime). This is deliberate — makes install/uninstall a pure file copy.

**Why this design exists:** File-copy install = instant, offline, reversible (delete folder). Marketplace is the trust/curation layer, not a technical dependency layer.

---

## 3. Runtime Loading Model & Isolation

- **Per-feature BrowserWindow**: When a feature is activated, uTool opens a dedicated Electron `BrowserWindow` and loads the plugin's `main` HTML (via `file://` or a custom app protocol). Each feature activation = its own window/lifecycle.
- **Preload bridge**: `preload.js` runs in the BrowserWindow's preload context — **Node-integration enabled**, full `require('fs')`/`require('child_process')` available. The preload attaches a curated `window.utools` object to the renderer.
- **Renderer sandbox**: The plugin's HTML/JS runs in the renderer with `nodeIntegration: false`, `contextIsolation: true`. It can only touch the host through `window.utools` — it has no direct Node.
- **So isolation is one-directional**: the *renderer* is sandboxed, but the *preload* is fully privileged. A malicious preload can do anything. The trust boundary is "is this plugin trusted at install time", not "is each call gated at runtime".

### `utools` API surface (host → plugin)

Lifecycle:
- `utools.onPluginEnter(cb)` — `cb({code, type, payload})` fired on feature activation. `payload` carries matched text/files/window/etc depending on cmd `type`.
- `utools.onPluginOut(cb)` — feature exited/hidden.
- `utools.onPluginDetach(cb)` — window detached (pinned/"挂台").
- `utools.onPluginEnter` is the central dispatch — plugins branch on `code` to render the right feature UI.

Data:
- `utools.db` — per-plugin document KV store (PouchDB-like): `put(doc)`, `get(id)`, `remove(doc)`, `allDocs()`, `bulkDocs()`. Docs have `_id`, `_rev`. Namespaced per plugin.
- `utools.dbStorage` — lightweight localStorage-style wrapper over the same store.

Filesystem / path:
- `utools.fs` — fs-extra style: `readFile`, `readFileSync`, `writeFile`, `readdir`, `pathExists`, `mkdir`, `copy`, `move`, `remove`, `stat`, …
- `utools.path` — node `path` module passthrough.
- `utools.showOpenDialog`, `utools.showSaveDialog` — native dialogs.

Shell / system:
- `utools.shellOpenExternal(url)`, `utools.shellOpenPath(path)`, `utools.shellShowItemInFolder(path)`.
- `utools.copy(text)`, `utools.paste()` — clipboard.
- `utools.screen` — `getPrimaryDisplay`, `getDisplayNearestPoint`, etc.
- `utools.getCurrentBrowserWindow()`? — recall uncertain; verify.

UI control (renderer → host UI):
- `utools.setExpendHeight(px)` — grow the feature window.
- `utools.setSubInput(cb, placeholder)` — program the secondary input box.
- `utools.redirect(hint, payload)` — hand off to another feature/keyword.
- `utools.hideMainWindow()`, `utools.outPlugin()` — exit feature.
- `utools.isDarkColors()` — theme.
- `utools.getUserInfo()` — current uTools account (paid/plus flag for marketplace gating).

**Why this design exists**: The window-per-feature model lets plugins own a full screen and a full lifecycle without colliding with other plugins or the host shell — necessary because uTool plugins are mostly full tools (PDF tools, image converters, color pickers), not inline contributions. The curated `utools.*` namespace (vs raw Electron API) gives uTool a stable contract they can evolve across Electron versions and a place to add per-plugin namespacing (db) and UI integration hooks.

---

## 4. How Plugins Contribute UI — "feature" vs "tool"

- A **feature** = a full-window tool the plugin renders from scratch (its own HTML/React/Vue app). uTool does *not* compose plugin UI into the host shell — each feature is a standalone surface.
- **cmds** are the *trigger* layer, not the *UI* layer. They define *when* the feature surfaces (keyword in search, regex match, file drop, overlay menu), not what it renders.
- There is **no inline-contribution model** in the VSCode sense (no "contribute a command to an existing panel", no "contribute a view to the sidebar"). Plugins either:
  - render a full feature window, or
  - contribute a menu entry to the "超级面板" (right-click overlay) that, when clicked, opens their feature window.
- Pinned tools ("挂台") are detached feature windows that float alongside the host — still full-window, not inline.

**Why this design exists**: uTool is a launcher, not an IDE. Plugins are meant to be self-contained mini-apps invoked on demand, not extensions of a shared editing surface. This is the *opposite* of quill's needs (quill wants inline file-type/feature/command contributions inside one editor shell).

---

## 5. Permission / Capability Model

- **No per-capability permission prompt.** Installing a plugin does not ask "allow fs? allow shell?". The `plugin.json` has **no `permissions`/`capabilities` array**.
- **Binary trust**: a plugin is either installed (fully trusted, preload can do anything Node can) or not installed.
- **Marketplace curation is the gate**: uTools reviews marketplace submissions. Local `.upx` install is at the user's own risk with a warning path.
- Some *interactive* sensitive actions surface a confirm in the UI flow (e.g. `utools.shellOpenExternal` may prompt; db writes are silent), but these are not install-time capability grants.
- The renderer sandbox means a plugin's *UI code* can't escape to Node without going through `window.utools` — but since preload can expose anything, this is containment of accidents, not malicious preload.

**Why this design exists**: Simplicity and the Electron preload trust model. uTool bet on curation + Node-level preload trust rather than a capability ACL. This is the weakest part of the model from a security standpoint and the part quill should *not* copy verbatim.

---

## 6. Developer Experience

- **Local dev plugin**: uTool's devtools/developer mode lets you point uTool at a **local folder** containing `plugin.json`. uTool loads it as a "本地插件" — no `.upx` packaging needed during dev.
- **Dev server**: Because `main` is just an HTML URL, you can run Vite/webpack dev server and set `main` to `http://localhost:5173/index.html` (or a custom protocol). Hot reload via the dev server. `preload` must be a real file path (Electron preload can't be served over http reliably — verify, but conventionally a file).
- **Lifecycle dev**: `utools.onPluginEnter` is the entry point; you typically branch on `code` and mount the right React/Vue route.
- **Packaging for release**: zip the built folder → rename to `.upx`. Upload to uTools developer console for marketplace.
- **Debugging**: Electron devtools open in the feature window; `preload` logs go to the main process console.

**Why this design exists**: Dev = "point at a folder + run a dev server" keeps the loop fast and framework-agnostic. Release = "zip the folder" keeps packaging zero-config.

---

## 7. Mapping onto quill (Tauri 2 + React)

### What transfers cleanly

| uTool pattern | Quill translation | Risk |
|---|---|---|
| `plugin.json` manifest + folder + `.upx` (zip) | Identical: manifest + assets folder, install = unzip into `<appData>/plugins/<id>/`. Tauri can read the folder from Rust and serve assets. | Low. Pure file ops. |
| `version` field for update detection | Identical. | Low. |
| Curated host API namespace (`utools.*` → `quill.*`) | Inject a `quill` global into the plugin's webview context exposing curated Tauri `invoke` wrappers (fs/db/clipboard/dialog/shell). | Low — this is the right pattern. |
| Per-plugin namespaced KV (`utools.db`) | Map to a Tauri-side per-plugin SQLite/KV table keyed by plugin id. | Low. |
| Marketplace = trust/curation layer (optional Layer B) | Out of scope for quill MVP (PRD says so). Local + URL install only. | None. |
| "point at a folder for dev" DX | Identical: dev plugin = local folder, `quill.plugins.loadFromPath()`. | Low. |

### What does NOT transfer — Tauri-specific translation risk

1. **Preload bridge does not exist in Tauri.**
   - uTool relies on Electron's `preload.js` running with **Node integration** to bridge privileged APIs. Tauri webviews have **no Node**; the privileged side is **Rust** (Tauri commands), reached via `invoke`.
   - Translation: the "preload" role becomes either (a) a small JS shim injected into the plugin webview that wraps `@tauri-apps/api` `invoke` calls into a `quill.*` namespace, or (b) a Rust-side command router. Either way, **a plugin's privileged code cannot be JS** — only Rust is privileged. This is a hard architectural difference.
   - Flag: any uTool plugin that ships preload logic relying on `require('fs'/'child_process')` cannot run on quill unchanged. quill must re-implement those capabilities as Tauri commands and expose them through the `quill.*` shim.

2. **Window-per-feature model ≠ quill's inline contribution goal.**
   - uTool features are full standalone windows. quill's PRD wants plugins to contribute **inline** (file-type handler, command palette entry, feature module, container directive) inside the *existing* React shell.
   - Translation: quill needs a **contribution-point registry** model (VSCode-like) that uTool does *not* provide. uTool's `features[]/cmds[]` maps to quill's "tool" contribution point (a full-window/pinned tool — the high-order Layer B form), but **not** to file-type/feature/command/container points. Those are quill-original.
   - Flag: don't try to force uTool's manifest shape onto inline contributions. Use uTool's manifest as the "tool" contribution shape only; add quill-specific contribution arrays (`fileTypes[]`, `commands[]`, `features[]`, `containerDirectives[]`) to the manifest.

3. **Renderer sandboxing is actually *better* on Tauri — but the trust model must change.**
   - uTool's preload has full Node → binary trust. Tauri has no equivalent privileged-JS layer, so quill can do **per-capability gating** that uTool can't.
   - Translation: quill should add a `permissions: ["fs:read","fs:write","shell:open","clipboard:read",...]` array to the manifest (uTool has none) and **prompt on install** (uTool doesn't). This is a **deliberate departure** from uTool, required because quill has no marketplace curation in MVP and because Tauri capabilities are static-at-build — runtime plugins need their own capability store + prompt.
   - Flag: this is the biggest design divergence from uTool and the one the PRD explicitly asks for ("插件申请受控 Tauri 能力时需显式授权"). Do not inherit uTool's "no permissions" model.

4. **Dynamic ESM import is the Vite risk already flagged in the PRD.**
   - uTool loads plugin UI as a separate HTML page in a separate window — no dynamic import into the host bundle. quill's inline-contribution model *requires* importing plugin React components into the host React tree.
   - Translation options:
     - (a) Load each plugin as a **separate Tauri WebviewWindow** with its own HTML (uTool-style) — clean isolation, but cannot contribute inline React components to the main editor. Only works for "tool" contribution point.
     - (b) Load plugin code as a **remote/foreign ESM module** imported at runtime into the host React bundle (`import(/* @vite-ignore */ url)`). Enables inline contributions, but Vite's build-time analysis + CSP + CORS make this the PRD's stated key risk.
     - (c) Hybrid: inline contributions (file-type/command/container/feature) use (b); full-window "tools" use (a).
   - Flag: uTool's architecture only informs option (a). Options (b)/(c) are quill-original and need separate research (Vite dynamic import of untrusted ESM, CSP `script-src`, Web Worker isolation).

5. **Tauri capabilities are static at build time.**
   - uTool grants all-or-nothing at install. Tauri's `capabilities/*.json` are compiled into the app at build — they cannot grant new capabilities to a runtime-installed plugin without a separate runtime capability store.
   - Translation: quill needs a **runtime capability store** (a Rust-side map of plugin_id → granted permissions) that the Tauri command layer checks on every privileged call. This is *new work* not present in uTool's model.
   - Flag: this is the place where "Tauri 2 static capabilities" + "runtime plugins" collide. Expect to write a permission-gated command wrapper in Rust that reads the runtime capability store, separate from the static Tauri capabilities file.

### Concrete mapping table — quill contribution points vs uTool equivalents

| quill contribution point (existing) | uTool equivalent | Transfer |
|---|---|---|
| file-type handler (`apps/desktop/src/components/file-types/registry.ts`, `FileTypeHandler`) | none (uTool has no inline editor extensions) | quill-original; uTool gives no precedent |
| command palette (`apps/desktop/src/services/commandRegistry.ts`, `Command`) | uTool `cmds[]` (but cmds are *triggers*, not palette actions) | partial — borrow manifest-array shape, not semantics |
| container directive (`packages/container-plugins/ContainerRegistry.ts`, `ContainerPlugin`) | none | quill-original |
| vault-provider (`packages/vault-provider/registry.ts`) | none (uTool's db is per-plugin KV, not pluggable storage backends) | quill-original |
| cli-adapter (`packages/cli-adapter/registry.ts`) | none | quill-original |
| feature module (`apps/desktop/src/features/*`) | uTool `feature` (full-window tool) | **closest match** — uTool's feature model maps to quill's "tool"/feature contribution point, but uTool features are full-window while quill features are inline panels |
| (new) "tool" = full-window plugin | uTool `feature` | direct match — this is where uTool's model transfers cleanly |

---

## 8. Caveats / Not Found / Verification Needed

- **No live web access this run** — all field names (`features`, `cmds`, `type` enum, `preload`, `logo`, `version`, `code`) are from recalled documentation and should be verified against https://u.tools/docs/ before being written into a quill spec. Likely-uncertain specifics:
  - Exact `cmd` field names (`label`/`value`/`keyword`/`regex`/`length`/`filter`).
  - Whether `utools.getCurrentBrowserWindow()` / `utools.eval` / `utools.childProcess` exist (I believe they do **not** as public stable API; `utools.shell*` is the sanctioned shell surface).
  - Whether `plugin.json` has a stable plugin `id` separate from `code` (some docs show `code` at top level acting as plugin id).
  - `.upx` internal layout (I'm confident it's a zip; verify whether it's zip-of-folder or zip-of-files-at-root).
- **Did not investigate** the uTools plugin marketplace protocol (download/auth/manifest signing) — out of scope per PRD.
- **Did not investigate** uTool's "超级面板" (overlay menu) contribution mechanics in depth — relevant only if quill adds a right-click overlay contribution point.
- **Tauri-side research still needed (separate research file)**:
  - Vite dynamic `import()` of remote/unbundled ESM + CSP implications.
  - Tauri `WebviewWindow` per-plugin isolation + IPC surface.
  - Runtime capability store pattern vs static Tauri capabilities.
  - Whether Tauri's `tauri://localhost` asset protocol can serve plugin files from `<appData>/plugins/<id>/`.

### Related quill spec/code (real paths, verified this run)

| File | Relevance |
|---|---|
| `apps/desktop/src/components/file-types/registry.ts` | file-type contribution point — `import.meta.glob` eager, **static/build-time** (the thing runtime plugins must supersede) |
| `apps/desktop/src/components/file-types/types.ts` | `FileTypeHandler` interface (id, extensions, Editor/Preview components, view modes) — the contract a plugin file-type contribution would implement |
| `apps/desktop/src/services/commandRegistry.ts` | command palette registry; `Command` type + `registerCommand`/`getCommands` — runtime-registration-friendly already |
| `packages/container-plugins/src/ContainerRegistry.ts` (via `index.ts`) | container directive registry — built-in plugins registered statically |
| `packages/vault-provider/registry.ts` | storage backend registry |
| `packages/cli-adapter/registry.ts` | AI CLI adapter registry |
| `apps/desktop/src/features/{analyze,clips,schedule,study,wiki}` | existing feature modules — reference shape for "feature" contribution point |
| `.trellis/tasks/07-08-microkernel-plugin-architecture/prd.md` | task PRD with open questions and acceptance criteria this research feeds |

### External references (to fetch when network is available)

- uTools 插件开发文档 — https://u.tools/docs/ (manifest fields, `utools.*` API, lifecycle)
- uTools plugin developer / marketplace — linked from above
- Electron preload / contextIsolation docs — to understand *why* uTool's preload model can't map to Tauri
- Tauri 2 capabilities + WebviewWindow docs — for the runtime-capability-store divergence (separate research)
