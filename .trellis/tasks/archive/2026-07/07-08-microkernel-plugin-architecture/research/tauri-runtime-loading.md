# Research: Tauri 2 Runtime Plugin Loading for quill

- **Query**: How to load third-party plugins at runtime in a Tauri 2 + React 18 + Vite 6 desktop app when plugins are NOT known at build time. Target: uTool-style "install and it works, no repackage" behavior.
- **Scope**: mixed (internal codebase inspection + external/Tauri 2.11.2 source verification)
- **Date**: 2026-07-08
- **Verified against**: vendored Tauri `2.11.2` at `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-2.11.2/` and quill's own `apps/desktop/src-tauri/`.

---

## TL;DR — Realistic MVP path

**Simplest way to get a third-party JS plugin running in quill today with a sane security boundary:**

1. Plugin = a folder under `~/.quill/plugins/<id>/` containing `manifest.json` + `index.js` (UMD/IIFE bundle exposing a global or a `default export`-shaped factory) + optional `index.html`.
2. Rust side serves the plugin folder over a **custom URI scheme** registered via `tauri::Builder::register_uri_scheme_protocol("quill-plugin", ...)` (verified: `tauri-2.11.2/src/app.rs:2122`). The handler reads from disk and returns bytes with correct `Content-Type`.
3. Plugin UI runs inside a **sandboxed `<iframe>`** (`sandbox="allow-scripts"`, NO `allow-same-origin`) loaded from `quill-plugin://localhost/<id>/index.html`. Host communicates via `postMessage`. This gives origin isolation by default.
4. Privileged operations (fs/http/shell) are **NOT given to the plugin directly**. Instead the host (Rust + React) exposes a vetted RPC API: plugin calls `postMessage({type:"fs:read", path})`, host validates against the manifest's declared capability allowlist, then invokes the real Tauri command on the plugin's behalf.
5. Capability granting for raw Tauri APIs (if ever needed for trusted first-party plugins) IS possible at runtime via `Manager::add_capability` + `CapabilityBuilder` (verified — see §4). But for untrusted third-party plugins, **host-mediation is the recommended boundary**, not dynamic capability grants.

**Hard blockers / flags:**
- `import(/* @vite-ignore */ arbitraryUrl)` works for same-origin / CORS-enabled URLs but is **origin-locked** under Tauri's `tauri://localhost` origin; you cannot `import()` a `file://` URL or a cross-origin remote ESM module without CORS headers. See §1.
- ES module cache **cannot be invalidated** at runtime — hot unload requires iframe-destroy or webview-destroy, not module eviction. See §6.
- `asset://` protocol (the default `convertFileSrc` scheme) is scoped to `$HOME/**` + `$APPDATA/**` in quill today (`tauri.conf.json:79-82`). A plugin under `~/.quill/plugins/` is reachable via `convertFileSrc` already — but the asset protocol's `Content-Type` may not be `text/javascript`, so `import()`-ing it can fail on strict MIME checks. A custom scheme handler (§2) is the robust path because you control the headers.
- quill currently sets `app.security.csp = null` (`tauri.conf.json:76`). Any plugin-loading design should add a CSP that forbids remote script sources; otherwise a loaded plugin can pull arbitrary remote code.

---

## Findings

### 1. Dynamic `import()` of remote/local ESM at runtime (Vite + Tauri)

**Mechanism.** Vite (v6) honors the native `import()` spec. With the `/* @vite-ignore */` hint, Vite leaves the call as a runtime `import()` in the built bundle instead of trying to resolve/inline it at build time. So `const mod = await import(/* @vite-ignore */ url)` will, at runtime, delegate to the webview's native dynamic import.

**Feasibility verdict: WORKS for same-origin / CORS-enabled URLs; BLOCKED for `file://` and cross-origin-without-CORS; HACKY for arbitrary remote ESM.**

Constraints:

- **Origin.** quill's production webview origin is `tauri://localhost` on macOS/Linux, `http://tauri.localhost` on Windows (Tauri docs + `tauri-2.11.2/src/app.rs:2118-2119`). A dynamic `import()` of a URL whose origin differs from the webview origin is subject to the browser's same-origin/CORS rules for module scripts. Module scripts are fetched with `Sec-Fetch-Mode: cors` and require CORS headers on the response. So:
  - `import("https://cdn.example.com/plugin.js")` works ONLY if the CDN sends `Access-Control-Allow-Origin: <tauri origin> or *` AND a valid MIME type (`text/javascript`, `application/javascript`). Most CDNs (esm.sh, jsdelivr, unpkg) send `Access-Control-Allow-Origin: *`, so this generally works for public CDNs.
  - `import("file:///...")` is **blocked** by the webview — WKWebView/WebView2 refuse `file://` module imports from a non-`file://` page (and Tauri's page is not served over `file://`).
  - `import("tauri://localhost/...")` for a bundled asset — works if the asset is reachable and served with JS MIME (Tauri's static asset server does serve JS correctly for files in `frontendDist`). So **a plugin pre-bundled into the frontend dist CAN be dynamic-imported by relative URL** — but that's "known at build time", defeating the runtime-install goal.

- **CSP.** quill sets `csp: null` today (`tauri.conf.json:76`), meaning no CSP header is injected — so `script-src` is unrestricted and dynamic import is not blocked by CSP. If a CSP is later added (recommended), the `script-src` directive must include the plugin's source URL or `'unsafe-inline'`/nonces as appropriate. Note: dynamic `import()` is governed by `script-src`, not `connect-src`. Tauri's `on_web_resource_request` hook (`tauri-2.11.2/src/webview/webview_window.rs:235`) lets you rewrite CSP headers per response at the Rust layer.

- **Workarounds for arbitrary/no-CORS URLs:**
  1. **fetch + Blob URL + import().** `fetch(url)` is governed by `connect-src` (not `script-src`) and is CORS-gated, BUT you can fetch with `mode: "no-cors"` only for opaque responses (which you can't read). For text you need CORS. If the host Rust side fetches the bytes (no CORS in Rust) and serves them via a custom scheme (§2) or hands them to the webview via `invoke`, you can then `const blob = new Blob([code], {type:"text/javascript"}); const url = URL.createObjectURL(blob); await import(url)`. Blob URL imports are same-origin (the page's origin) so no CORS. **This is the realistic workaround for "fetch plugin code from anywhere and execute as ESM".** Caveat: the module's import statements inside the blob must themselves be resolvable (relative URLs won't resolve from a blob URL; the plugin must be a self-contained bundle).
  2. **Service Worker.** You can register a SW under the Tauri origin that intercepts `import()` requests for a synthetic URL namespace and responds with fetched bytes. Powerful but heavy; SW support in WKWebView is limited (only available since macOS 14.x with `sw_` feature and unstable). Not recommended for MVP.
  3. **`eval`/`new Function` of fetched text.** Works for non-ESM (IIFE/UMD) plugins. Loses ESM `import`/`export` semantics; the plugin must attach to a global. This is what uTool/VS Code's web extension host effectively do for non-ESM code.

**Recommendation for quill MVP:** require plugins to be **self-contained ESM bundles** (no further `import` of remote URLs) and load them via the **custom-scheme handler** in §2 (same-origin, no CORS, correct MIME). Reserve `import()` of remote CDN URLs for the "trusted first-party" tier only.

---

### 2. Loading a bundled plugin folder from disk into the running webview

**Mechanism.** Two Tauri-supplied mechanisms can serve plugin files from disk to the webview at runtime:

#### 2a. `asset://` protocol (built-in, already enabled in quill)

- Quill's `tauri.conf.json:77-83` enables `assetProtocol` with scope `$HOME/**`, `$APPDATA/**`.
- JS API: `convertFileSrc(filePath, protocol?)` from `@tauri-apps/api/core` (`apps/desktop/node_modules/@tauri-apps/api/core.d.ts:158`). Returns `asset://localhost/<encoded path>` (macOS/Linux) or `http://asset.localhost/<path>` (Windows).
- The handler is registered in `tauri-2.11.2/src/manager/webview.rs:344` and gated by the `asset_protocol` fs::Scope.
- A plugin folder at `~/.quill/plugins/<id>/index.js` IS under `$HOME/**`, so `convertFileSrc("/Users/.../.quill/plugins/<id>/index.js")` returns a URL the webview can `fetch()`.
- **Caveat for execution:** whether you can `import()` that URL depends on the `Content-Type` the asset protocol returns. Tauri's asset handler sniffs MIME from extension; `.js` is typically served as `text/javascript` or `application/javascript`. Verify empirically; if MIME is wrong, fall back to 2b.
- **Caveat for origin/isolation:** the asset URL shares the page's origin (`tauri://localhost`), so code fetched via `asset://` and executed via `import()` runs in the **same realm** as the host — no isolation. Suitable for trusted plugins only.

#### 2b. Custom URI scheme (recommended for plugins)

- `tauri::Builder::register_uri_scheme_protocol(name, handler)` — verified at `tauri-2.11.2/src/app.rs:2122` (sync) and `:2190` (async, `register_asynchronous_uri_scheme_protocol`).
- The handler receives an `http::Request<Vec<u8>>` and returns `http::Response<T>`. You control status, headers (incl. `Content-Type`, `Content-Security-Policy`), and body. So you can:
  - Serve `~/.quill/plugins/<id>/index.js` with `Content-Type: text/javascript`.
  - Inject a **per-plugin CSP** header (`script-src 'self' 'unsafe-inline'; default-src 'none'`) into the served HTML.
  - Restrict which plugin IDs are allowed.
- Origin behavior (verified `tauri-2.11.2/src/app.rs:2113-2120`): a page loaded from a custom scheme has origin `<scheme>://localhost` on macOS/Linux, `http://<scheme>.localhost` on Windows. So a plugin page served from `quill-plugin://localhost/<id>/index.html` has a **different origin** from the main app's `tauri://localhost` — giving you origin-level isolation for free. The host can still talk to the plugin via `postMessage` (cross-origin) or via a `window.postMessage` bridge.
- This is the **same pattern** quill already uses for embedded webviews (`apps/desktop/src-tauri/src/commands.rs:91` `create_webview`), except those load external URLs. Loading from a custom scheme is strictly simpler.

**Feasibility verdict: WORKS, and is the recommended MVP mechanism.** No repackage needed; you add one Rust `register_uri_scheme_protocol` call and serve files from `~/.quill/plugins/`.

---

### 3. Sandboxing options in Tauri 2

Tauri 2 does NOT expose a native "sandbox this webview" boolean (no `sandbox()` builder method — verified by scanning `tauri-2.11.2/src/webview/webview_window.rs`). Isolation must come from one of:

| Option | Isolation strength | API richness | Perf | Notes |
|---|---|---|---|---|
| **`<iframe sandbox="allow-scripts">` (no `allow-same-origin`)** | High — unique opaque origin, no DOM/cookie/localStorage access to host | Low — only `postMessage`; no React context, no Tauri APIs | Native iframe perf | **Realistic MVP.** Plugin UI is a self-contained HTML/JS/CSS bundle. Host bridges via `postMessage`. CSP on the iframe `src` enforces script sources. `allow-scripts` without `allow-same-origin` gives a unique origin and blocks parent DOM access. |
| Separate `WebviewWindow` per plugin (`WebviewWindowBuilder::new`) | High — separate OS webview, separate session (`data_directory`), separate origin if loaded from custom scheme | Medium — full DOM, but no shared React state unless bridged via events | Heavier — each webview is a full WKWebView/WebView2 instance (~tens of MB) | Quill already does this for embedded browser views (`commands.rs:91` `create_webview`). Good for "uTool-style tool window" plugins. Overkill for inline UI contributions. |
| WASM (wasm-bindgen / QuickJS / wasmtime) | Very high — capability-based, no DOM by default | Low-Medium — must re-implement DOM access via host RPC; QuickJS-in-WASM can run JS but no direct DOM | Medium | Heaviest to build. Realistic only if you want math/data plugins with no UI. Not MVP. |
| Dynamic `import()` into main realm (no sandbox) | None — same realm, full host access | Highest — full React/CodeMirror/etc. | Best | Only for **trusted first-party** or signed plugins. Unsafe for third-party. |

**Recommendation:** MVP = **sandboxed iframe** for inline UI plugins + **separate WebviewWindow** for "tool window" plugins (the uTool window pattern). Both load from the custom `quill-plugin://` scheme so they get cross-origin isolation from the host automatically.

---

### 4. Tauri 2 capability/permission model at runtime

**Key finding (verified in source):** Tauri 2 **does** support runtime capability grants, gated by the `dynamic-acl` cargo feature, which is **enabled by default** (`tauri-2.11.2/Cargo.toml` `default = [..., "dynamic-acl", ...]`; `src/lib.rs:40` doc comment).

API surface (verified):

- `tauri::Manager::add_capability(&self, capability: impl RuntimeCapability) -> Result<()>` — `tauri-2.11.2/src/lib.rs:812-820`, `#[cfg(feature = "dynamic-acl")]`. Accessible on `AppHandle` / any `Manager` implementor.
- `tauri::ipc::CapabilityBuilder` — `tauri-2.11.2/src/ipc/capability_builder.rs:27-170`. Builder methods:
  - `CapabilityBuilder::new(identifier)` — `:32`
  - `.window(label)` / `.windows(...)` — link capability to window labels (`:62-71`)
  - `.webview(label)` / `.webviews(...)` — link to webview labels (`:74-86`)
  - `.permission(id)` — add a permission ref like `"fs:allow-read-file"` (`:89-98`)
  - `.permission_scoped(id, allow, deny)` — add a scoped permission (e.g. fs scope) (`:101-139`)
  - `.remote(url)` — allow capability use from a remote URL (`:45-53`)
  - `.local(bool)` — whether to apply on local app URLs (default true) (`:56-59`)
  - `.platform(target)` / `.platforms(...)` — restrict to platforms (`:143-163`)
- The runtime authority resolves the inserted capability and updates `allowed_commands`, `denied_commands`, `command_scope`, and `global_scope` live — `tauri-2.11.2/src/ipc/authority.rs:150-219`. So a newly-installed plugin's capabilities take effect **immediately, without restart**.
- `RuntimeCapability` is also implemented for `&str`/`String` (`:20-24`) — you can pass a JSON capability file content as a string and it will parse it.

**Quill currently** declares capabilities statically in `apps/desktop/src-tauri/capabilities/{default,pet,pet-panel}.json`. The `default.json` grants broad `fs:default`, `fs:allow-read/write/...`, `fs:scope-home-recursive`, etc. to the `main` window. The JS side (`@tauri-apps/api`) does NOT expose `add_capability` — it is Rust-only. So plugins cannot self-grant; **the Rust host must call `add_capability` on the plugin's behalf after install verification**.

**Feasibility verdict: WORKS for granting scoped Tauri APIs to a plugin's webview at runtime.** Concretely: when the user installs plugin `<id>` with manifest declaring `permissions: ["fs:allow-read-text-file"]` scoped to `~/.quill/plugins/<id>/data/**`, the Rust install handler does:

```rust
let cap = CapabilityBuilder::new(format!("plugin-{id}"))
    .webview(format!("plugin-{id}"))           // link to the plugin's webview label
    .permission_scoped(
        "fs:allow-read-text-file",
        vec![ScopeValue::Path(PathBuf::from(format!("~/.quill/plugins/{id}/data")))],
        vec![],
    );
app_handle.add_capability(cap)?;
```

**However, for untrusted third-party plugins the recommended boundary is host-mediation, not raw capability grants.** Reason: giving a plugin `fs:allow-read-text-file` lets it read any file matching the scope via the standard `@tauri-apps/plugin-fs` JS API — there is no per-call approval prompt. The safer model is: plugins get NO Tauri capabilities; the host exposes a vetted RPC API (`plugin:invoke` command) that checks each call against the manifest's declared intent and the user's grant, then performs the privileged action on the plugin's behalf and returns the result. This is the VS Code extension host model.

**Recommended split for quill:**
- **Trusted tier** (signed first-party or user-pinned): `add_capability` with scoped permissions → plugin uses `@tauri-apps/api` directly. Simpler, richer.
- **Untrusted tier**: iframe + `postMessage` → host RPC bridge. No `add_capability`. Safer.

---

### 5. Code signing / integrity

No Tauri-specific plugin-signing mechanism exists in the vendored 2.11.2 source (no signing helpers in `tauri::ipc` or `tauri::plugin`). You must implement verification yourself.

**Realistic approach:**

- Plugin bundle = a zip with: `manifest.json` (declares `id`, `version`, `permissions`, `entrypoint`, `publisher`), `dist/` (JS/CSS/HTML), and a `manifest.sig` (or `signature` field) over the manifest + a hash of every file.
- Signing: **ed25519** over the SHA-256 of the canonicalized manifest + file list. Crates:
  - `ed25519-dalek` (pure Rust, widely used) — sign with publisher private key, verify with public key pinned in quill's config.
  - `sha2` for hashing.
  - `serde_json` canonicalization (sort keys) or `sha256` of the raw bytes.
- Verification before load: Rust install handler reads the zip, recomputes hashes, verifies signature against a pinned set of publisher public keys (or a trust-on-first-use model). Reject on mismatch.
- For a simpler MVP: just ship a `manifest.sha256` and verify against a known-good list (no asymmetric crypto). Suitable for "I trust the source, I want integrity" but not for "prove publisher identity". Upgrade to ed25519 before opening to a marketplace.
- Alternative: `minisign` (Rust crate `minisign-verify`) — well-established for signed binaries/configs; could sign the manifest and verify with a pinned public key.

**Feasibility verdict: WORKS, DIY.** No Tauri primitive; straightforward to build with `ed25519-dalek` + `sha2`. MVP can start with SHA-256 integrity only and add signatures before marketplace launch.

---

### 6. Hot reload / unload

**Hard constraint: ES modules cannot be evicted from a webview's module cache once imported.** The browser spec provides no `import.unload()`. A second `import()` of the same URL returns the cached module. Workarounds:

- **Cache-busting URL:** `import(/* @vite-ignore */ `${url}?v=${Date.now()}`)` — a different URL is treated as a different module and re-evaluated. BUT the old module's side effects (registered listeners, globals, React state) persist. Also breaks relative imports inside the module (they resolve against the new URL with query string — usually fine for absolute-bundled plugins, breaks for relative-pathed ones).
- **Iframe destroy/recreate (recommended for sandboxed plugins):** to "unload" a sandboxed-iframe plugin, remove the iframe element from the DOM. The iframe's realm is destroyed (listeners, timers, state all GC'd). Reload by creating a new iframe with the same `src`. This is the **clean unload** path and a major reason to prefer the iframe model for hot-reloadable plugins.
- **Webview destroy/recreate (for tool-window plugins):** `WebviewWindow::destroy()` then rebuild. Clean. Quill already has `close_webview` / `hide_webview` commands (`commands.rs` invoke_handler list in `lib.rs:289-295`).
- **Disposing contributed UI (same-realm plugins):** if you used `import()` into the main realm (trusted tier), unload requires the plugin to expose a `dispose()` that: removes its slash-menu entries from `ContainerRegistry`, unregisters its commands from `commandRegistry`, removes its file-type handler, detaches React roots, removes event listeners. `ContainerRegistry` is a singleton (`packages/container-plugins/src/ContainerRegistry.ts`) — it would need an `unregister(name)` method (does not exist today; only `register`). The plugin SDK contract must require a `dispose()` returning a Promise; the host awaits it before evicting.
- **Module-cache invalidation for true hot reload of trusted plugins:** use the blob-URL trick (§1) — generate a fresh blob URL per reload, `import()` it, and on unload call `dispose()` + `URL.revokeObjectURL(oldUrl)`. The old module becomes collectable once no references remain. This works but requires the plugin to be strictly side-effect-disposable.

**Feasibility verdict:**
- Sandbox-iframe plugins: **WORKS cleanly** — destroy iframe, recreate. Best DX.
- Tool-window plugins: **WORKS cleanly** — destroy webview, recreate.
- Same-realm `import()`-ed plugins: **HACKY** — requires `dispose()` discipline + cache-busting; old code lingers if dispose is incomplete. Avoid for untrusted/hot-reload scenarios.

---

## Concrete MVP recipe (end-to-end)

1. **Plugin shape.** `~/.quill/plugins/<id>/{manifest.json, index.html, index.js, style.css}`. `manifest.json` declares `id`, `version`, `publisher`, `permissions` (host-mediated, NOT raw Tauri perms in MVP), `contributionPoints` (e.g. `{ "command": { "id": "...", "title": "..." } }`).
2. **Rust: custom scheme.** In `apps/desktop/src-tauri/src/lib.rs` `run()`, before `.build()`:
   ```rust
   .register_uri_scheme_protocol("quill-plugin", |ctx, request| {
       // parse plugin id + path from request.uri()
       // read file from ~/.quill/plugins/<id>/<path>
       // return bytes with correct Content-Type + a per-plugin CSP header
   })
   ```
3. **Rust: install command.** A new `#[tauri::command] install_plugin(id, source_path)` that: copies/extracts the bundle to `~/.quill/plugins/<id>/`, verifies signature (§5), writes a record to a `plugins.json` registry, and emits a `plugin://installed` event to the main window.
4. **React host.** `PluginHost` service that, on `plugin://installed`, creates a hidden `<iframe sandbox="allow-scripts" src="quill-plugin://localhost/<id>/index.html">`, wires `postMessage` to a vetted RPC bridge (fs read limited to plugin's data dir, http fetch with allowlist, etc.). The plugin's contributed commands appear in the command palette via `commandRegistry.register`.
5. **Capability grant (optional, trusted tier only).** For first-party signed plugins that need raw Tauri APIs, call `app_handle.add_capability(CapabilityBuilder::new(...).webview(...).permission_scoped(...))` from the install command.
6. **Unload.** For iframe plugins: remove iframe element + `commandRegistry.unregister(pluginId)`. For tool-window plugins: `close_webview(label)`.

---

## Caveats / Not found

- **Not verified empirically:** whether Tauri's built-in `asset://` handler serves `.js` with a JS MIME type under WKWebView. Recommend a 1-hour spike: `convertFileSrc()` a local `.js` and try `import()`-ing it. If MIME is wrong, the custom-scheme path (§2b) is the fallback and is the recommended path anyway.
- **Not verified:** whether `register_uri_scheme_protocol` can be called after `App::build()` (i.e., at runtime post-startup). The signature is on `tauri::Builder` (consumes self), suggesting it must be registered at build time. To add schemes at runtime you may need to register a single "plugin" scheme at startup whose handler dispatches to dynamically-installed plugins by reading the plugin registry from disk at request time. This is the recommended design regardless — one scheme, many plugins routed by path.
- **Service Worker approach (§1 workaround 2)** was not pursued — WKWebView SW support is gated behind the `service-worker` feature on macOS 14+ and is flaky; not recommended for MVP.
- **`@tauri-apps/api` JS side** has no `add_capability` binding (verified in `core.d.ts`). Runtime capability grants are **Rust-only**; the plugin (in JS) cannot self-elevate. This is by design and is a security feature.
- **Existing `ContainerRegistry`** (`packages/container-plugins/src/ContainerRegistry.ts`) has `register` but no `unregister`/`get`/`list` methods were confirmed in this research — hot-unload of same-realm plugins will require adding `unregister`. Not inspected in detail; flag for the implementer.

---

## Related Specs / Code

| Path | Relevance |
|---|---|
| `.trellis/tasks/07-08-microkernel-plugin-architecture/prd.md` | The PRD this research supports; states assumptions this file validates/refutes |
| `packages/container-plugins/src/ContainerPlugin.ts` | Existing build-time plugin interface — contribution-point model to extend |
| `packages/container-plugins/src/ContainerRegistry.ts` | Singleton registry; needs `unregister` for hot unload |
| `apps/desktop/src-tauri/tauri.conf.json:75-84` | `csp: null` + `assetProtocol` scope — current security posture |
| `apps/desktop/src-tauri/capabilities/default.json` | Static capability grants to `main` window — model for what `CapabilityBuilder` would replicate at runtime |
| `apps/desktop/src-tauri/src/commands.rs:91` (`create_webview`) | Quill already creates embedded webviews with `initialization_script` — proof the per-plugin-webview path works |
| `apps/desktop/src-tauri/src/lib.rs:166` (`run()`) | Where `register_uri_scheme_protocol` and `install_plugin` command would be added |
| `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-2.11.2/src/app.rs:2122` | `register_uri_scheme_protocol` (verified) |
| `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-2.11.2/src/lib.rs:812` | `Manager::add_capability` (verified, `dynamic-acl` feature = default) |
| `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-2.11.2/src/ipc/capability_builder.rs:27` | `CapabilityBuilder` (verified) |
| `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/tauri-2.11.2/src/manager/webview.rs:344` | Built-in `asset` protocol handler (verified) |
| `apps/desktop/node_modules/@tauri-apps/api/core.d.ts:158` | `convertFileSrc` JS API |
