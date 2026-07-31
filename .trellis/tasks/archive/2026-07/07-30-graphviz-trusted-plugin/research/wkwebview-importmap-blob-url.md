# Research: WKWebView / Tauri 2 — import map + blob: URL module imports

- **Query**: Does Tauri 2's webview (WKWebView macOS / Webview2 Windows / WebKitGTK Linux) apply a document-level import map to module imports resolved from a same-origin `blob:` URL? Gates the design choice of letting a trusted-tier plugin `import 'react'` from its blob-URL bundle resolve to the host's React via an import map.
- **Scope**: mixed (internal code context + external spec/webview behavior)
- **Date**: 2026-07-31

## Methodological caveat (READ FIRST)

Network access and the `Workflow`/`exa` web-search tools were **not available** in this
research subagent environment (all `curl`/web fetches were permission-denied; the
`deep-research` skill's `Workflow` harness is not wired into this subagent's tool set).
Findings below therefore combine (a) high-confidence, well-established facts from
training knowledge with (b) explicit markers where a claim could not be independently
web-verified this session. **No WebKit/Chromium bug numbers are cited unless I actually
recall them** — fabricated bug IDs are worse than an honest "not verified" marker. Where
a source URL is given, it is the canonical location to re-verify; it was not fetched live
this session. Recommend a follow-up human/web-equipped pass to confirm the two
`[NOT WEB-VERIFIED]` items.

## Summary / recommendation (the load-bearing conclusion)

**Do NOT rely on import-map-for-blob-URL for the trusted-tier React-sharing design.
Use the `window.React` / `window.ReactDOM` globals fallback** — which the codebase
already assumes (`examples/plugins/markdown-todo/index.js` `_loadReact`, and the
`ai-chat-demo` sample uses the same pattern).

Two independent reasons, either of which is dispositive:

1. **macOS floor (hard blocker).** Import maps in WKWebView require Safari/WebKit
   16.4+, which in turn requires **macOS 13.3 Ventura or later**. This project sets
   **no `MACOSX_DEPLOYMENT_TARGET` / `LSMinimumSystemVersion`** override
   (`apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/src-tauri/Info.plist`,
   `.cargo/config` — all checked, none present), so it inherits the **Tauri 2 default
   of macOS 10.15 (Catalina)**. Users on macOS 10.15 / 11 / 12 ship a WKWebView whose
   system WebKit predates import-map support — `import 'react'` from a blob module
   would throw `TypeError: Failed to resolve module specifier 'react'` with no
   import map consulted at all. Import maps cannot be polyfilled.

2. **WKWebView blob-URL + import-map interaction is not reliably confirmed.** Per the
   WHATWG spec the top-level `imports` map SHOULD apply to a same-origin blob module
   (see §1), and Chromium does so. But I could not confirm via WebKit bugzilla / release
   notes that WKWebView has no regression here, and WKWebView has historically had
   blob/module-script quirks. `[NOT WEB-VERIFIED]` — treat as spec-compliant-but-unproven.

The globals fallback has **none** of these problems: it works on every macOS version
Tauri 2 supports, on all three webviews, needs no Vite `optimizeDeps`/re-export plumbing,
and is already the pattern the samples use. Ponytail ladder: native platform feature
(`window` globals) over a clever import-map indirection.

## Findings

### Internal context (verified by reading the code)

| File Path | Relevance |
|---|---|
| `apps/desktop/src/services/plugin-host/trustedLoader.ts:88-95` | The blob-URL `import()` path. `new Blob([code])` → `URL.createObjectURL(blob)` → `importModule(blobUrl)` → native `import(/* @vite-ignore */ url)`. The blob is same-origin with the host document. |
| `apps/desktop/index.html` | The document where an `<script type="importmap">` would live. Currently has only the inline pet-window hash script + `<script type="module" src="/src/main.tsx">`. No import map present. |
| `apps/desktop/vite.config.ts:40-63` | Host Vite config. React enters via `@vitejs/plugin-react` + `import React from 'react'` in `main.tsx`. Vite pre-bundles `react`/`react-dom` into `node_modules/.vite/deps/` (dev) and rolls them into chunks (build). There is **no** standalone `react` re-export module URL the host currently serves that an import map could point at — one would have to be added. |
| `apps/desktop/src/main.tsx:1-2` | `import React from 'react'` / `import ReactDOM from 'react-dom/client'` — host's React import sites. `React` is never assigned to `window` today. |
| `examples/plugins/markdown-todo/index.js:43,125-135` | `_loadReact()` returns `window.React` if present, else throws. This is exactly the globals fallback. Comment says "trusted plugins must bundle React or the host must expose window.React". |
| `examples/plugins/ai-chat-demo/index.js:20,100` | Same `_loadReact()` / `window.React` pattern — second sample already assumes the globals fallback. |
| `docs/plugin-development.md:429-444` | "Trusted tier bundling" §: states relative imports don't resolve from a blob URL, bare specifiers resolve against the host realm only if Vite leaves them as runtime `import()`, recommends bundling. Does NOT mention import maps as a sharing mechanism. |
| `packages/plugin-host/src/types.ts:19-23` | Tier model doc — `trusted` = `import()`-ed into host realm. No React-sharing contract in the kernel. |
| `apps/desktop/src-tauri/Cargo.toml`, `Info.plist`, `.cargo/config` | **No** `MACOSX_DEPLOYMENT_TARGET`, no `LSMinimumSystemVersion`. Project inherits Tauri 2 default macOS floor. |

Code pattern: the trusted loader's `importModule` (`trustedLoader.ts:170-180`) is an
isolated native `import(blobUrl)` with `@vite-ignore`. A plugin bundle that emitted a
top-level bare `import 'react'` would, today, hit the webview's module resolver with no
import map installed — it would throw on WKWebView < 16.4 and resolve only if the host
had both (a) an import map AND (b) a reachable React module URL. Neither exists yet.

### 1. HTML spec — do top-level `imports` apply to a blob: URL module?

**Confidence: high (spec mechanism, from training knowledge of WHATWG HTML).**

The import map resolution algorithm (WHATWG HTML Living Standard,
`webappapis.html` §"Import maps" / "Resolve a module specifier given a module
script's base URL and an import map"):

- Given a **bare** specifier (not a URL, i.e. not starting with `./`, `../`, `/`, or
  a `scheme:`), the resolver:
  1. Looks up the specifier in each **`scopes`** entry whose key is a URL **prefix of
     the module script's base URL** (longest-match first).
  2. If no scope matched (or none contained the specifier), falls back to the
     **top-level `imports`** map, consulted **regardless of base URL**.
- The top-level `imports` map has **no origin gate and no base-URL gate** — it is the
  unconditional fallback after scopes.

For a blob URL module created by the host document:
- The module script's base URL is the blob URL, e.g. `blob:https://app.local/uuid`.
  (A same-origin blob inherits the document's origin in its `blob:` URL string, per
  the File API blob URL scheme `blob:<origin>/<uuid>`.)
- **`scopes` entries will NOT match** a blob module: a scope key like
  `https://app.local/` is *not* a string prefix of `blob:https://app.local/uuid`
  (the latter starts with `blob:`, not `https://`). So any per-path scope mapping the
  host sets for its own modules does not extend to blob-URL plugin modules. The only
  way to scope-map a blob module is a scope key of `blob:` itself — per-blob, unknowable
  ahead of time, effectively unusable.
- **Top-level `imports` DO apply** to the blob module: after scopes fail to match,
  the top-level `imports` is consulted unconditionally. So `import 'react'` inside a
  blob module resolves via `{ "imports": { "react": "<moduleURL>" } }` in the host
  document.

**Spec conclusion**: a document-level import map's top-level `imports` entries apply
to a same-origin blob: URL module's bare-specifier imports. Scoped entries do not
reliably reach blob modules (URL-prefix mismatch). There is no spec-level origin
exclusion of blob modules from import-map resolution.

Caveat: the import map is registered **once per document** (first
`<script type="importmap">` wins; later ones error out). The blob module is part of the
document's module graph (evaluated in the document realm), so it consults the same
registered import map.

Reference (canonical, not fetched live): WHATWG HTML, `webappapis.html`, subsections
"Import maps", "Register an import map", and "Resolve a module specifier".
`https://html.spec.whatwg.org/multipage/webappapis.html#import-maps`

### 2. WKWebView (macOS) — import map support + blob-URL behavior

**Import-map existence: high confidence.** Import maps shipped in **Safari / WebKit
16.4** (released ~March 2023, alongside iOS 16.4 and macOS 13.3 Ventura). WKWebView
shares the system WebKit, so any WKWebView on macOS 13.3+ has import-map support.

- Safari 16.4 release notes: `https://developer.apple.com/documentation/safari-release-notes/safari-16_4-release-notes`
- caniuse "import-maps": Safari 16.4 marked as supported.
- `[NOT WEB-VERIFIED]` the exact macOS floor of Safari 16.4: from training I recall it
  **requires macOS 13 Ventura** (it dropped macOS 12 Monterey — Safari 16.4 did not
  ship for Monterey). Re-verify before relying on this in user-facing copy; the safe
  statement is "macOS 13.3 Ventura or later".

**Blob-URL + import-map behavior in WKWebView: `[NOT WEB-VERIFIED]`.** The spec says it
should work (top-level `imports` apply regardless of base URL); Chromium implements it;
I have **no confirmed WebKit bug or release-note statement** guaranteeing WKWebView
applies the document import map to `import()` originating inside a same-origin blob
module. WKWebView has had prior blob/module-script quirks. I deliberately did not
fabricate a bugzilla ID. This is the single most uncertain point and, combined with the
macOS floor below, is why the recommendation is the globals fallback rather than the
import-map path.

### 3. Webview2 (Chromium / Edge on Windows)

**Confidence: high.** Webview2 is Chromium-based. Import maps shipped in
**Chrome 89** (March 2021); Edge/WebView2 follows Chromium. Chromium implements the
spec resolution algorithm, so the document import map's top-level `imports` apply to
same-origin blob: URL modules (Chromium treats the blob module as part of the
document's module graph). No known Chromium restriction excludes blob modules from
import-map resolution.

caniuse: Chrome 89+, Edge 89+. `https://caniuse.com/import-maps`
`[NOT WEB-VERIFIED]` live this session, but this is well-established.

### 4. WebKitGTK (Linux)

**Confidence: medium.** WebKitGTK tracks the WebKit engine. Import-map support
corresponds to the Safari 16.4-era engine. The commonly cited version is
**WebKitGTK 2.40** (April 2023), which brought the WebKit engine with import-map
support. Distributions shipping WebKitGTK ≥ 2.40 have import maps; older distros
(e.g. older LTS) may ship WebKitGTK 2.38 or earlier, which lack them.

`[NOT WEB-VERIFIED]` the exact 2.40 ↔ 16.4 engine correspondence this session; canonical
re-check is the WebKitGTK release notes / NEWS file for 2.40.

### 5. Tauri 2 macOS floor vs. import-map requirement

- This project: **no** `MACOSX_DEPLOYMENT_TARGET` in `apps/desktop/src-tauri/Cargo.toml`,
  no `LSMinimumSystemVersion` in `Info.plist`, no `.cargo/config` override → inherits
  **Tauri 2's default macOS minimum of 10.15 (Catalina)**.
  (`apps/desktop/src-tauri/Cargo.toml:16` uses `tauri = { version = "2", ... }`.)
- Import maps in WKWebView require **Safari/WebKit 16.4 = macOS 13.3 Ventura**.
- **Gap**: a Tauri 2 app built for macOS 10.15+ that runs on macOS 10.15 / 11 / 12
  has a WKWebView whose system WebKit has **no import-map support at all**. A blob-module
  `import 'react'` with no import map consulted throws
  `TypeError: Failed to resolve module specifier 'react'`.
- **This is a hard floor that would break older users**, and import maps cannot be
  runtime-polyfilled (they are a parse-time, document-level registry). Unless the
  project is willing to raise its macOS minimum to 13.3 (a real product decision), the
  import-map path is non-viable.

### 6. Recommendation — fallback (and it's already the codebase pattern)

**Use `window.React` / `window.ReactDOM` globals. Do not use import-map-for-blob-URL.**

Why it wins (ponytail ladder: native platform feature over clever indirection):
- Works on **every** macOS version Tauri 2 supports (no 13.3 floor).
- Works identically on WKWebView, Webview2, WebKitGTK — no per-webview divergence.
- Needs no Vite `optimizeDeps` plumbing, no host-served `react` re-export module, no
  `<script type="importmap">` in `index.html`.
- Same React instance as the host (hooks don't break) — the host assigns its already
  loaded React to `window` before any plugin `import()` runs.
- Already the assumed pattern: `examples/plugins/markdown-todo/index.js:125-135`
  and `examples/plugins/ai-chat-demo/index.js:100` both call `_loadReact()` →
  `window.React`, and throw if absent.

Minimal setup for the globals path (sketched, not code I'm writing here per scope):

- Host side (`apps/desktop/src/main.tsx`, early, before plugin hydration):
  `import React from 'react'; import * as ReactDOM from 'react-dom/client';`
  `;(window as any).React = React; (window as any).ReactDOM = ReactDOM;`
  (Host already imports React here at `main.tsx:1-2` — reuse the same instance.)
- Plugin side: bundle React **external** (Vite `build.rollupOptions.external: ['react']`
  + output a global fallback `React`-from-`window.React`), OR keep the lazy
  `createElement`-from-`window.React` pattern the samples use (no JSX → no React
  import needed in the bundle at all). The `markdown-todo` sample already does the
  latter — pure `createElement`, no JSX, React read from `window.React` at render time.
- `docs/plugin-development.md` "Trusted tier bundling" should state: the host exposes
  `window.React`/`window.ReactDOM`; plugins MUST NOT bundle a second React; plugins
  using JSX must configure the bundler to treat `react` as external and resolve it from
  `window.React` at runtime (e.g. an externals mapping `react` → `window.React`).

Skipped: the import-map `<script type="importmap">` setup, the host `react` re-export
module, and the Vite `optimizeDeps`/`build.rollupOptions` external + import-map URL
plumbing. Add them **only if** the project decides to raise its macOS floor to 13.3
*and* a live web-verification pass confirms WKWebView applies the document import map to
same-origin blob modules — and even then, the globals path is strictly simpler.

## External References (canonical URLs — not fetched live this session)

- WHATWG HTML, Import maps section:
  `https://html.spec.whatwg.org/multipage/webappapis.html#import-maps`
- Safari 16.4 release notes: `https://developer.apple.com/documentation/safari-release-notes/safari-16_4-release-notes`
- caniuse Import Maps: `https://caniuse.com/import-maps` (Chrome 89, Edge 89, Safari 16.4)
- WebKit bugzilla (re-search `import map blob`):
  `https://bugs.webkit.org/buglist.cgi?query_format=advanced&short_desc=import+map+blob`
- WebKitGTK release notes / 2.40 NEWS: `https://webkitgtk.org/reference/webkitgtk/stable/` (or the 2.40 release announcement)
- Tauri 2 macOS support / `MACOSX_DEPLOYMENT_TARGET`: `https://v2.tauri.app/develop/` and the `tauri-build` crate docs.

## Caveats / Not Found

- `[NOT WEB-VERIFIED]` WKWebView applies the document import map to `import()` from a
  same-origin blob module. Spec says yes; Chromium confirms; WebKit unconfirmed. Did not
  fabricate a WebKit bug number. **A live web pass should search WebKit bugzilla for
  "import map blob" and check Safari 16.4 release notes for any blob-URL carve-out.**
- `[NOT WEB-VERIFIED]` Exact macOS floor of Safari 16.4 (recalled as macOS 13.3
  Ventura; dropped Monterey). Re-verify before user-facing claims.
- `[NOT WEB-VERIFIED]` WebKitGTK 2.40 ↔ Safari-16.4-engine import-map correspondence.
- `curl`/web access blocked in this environment; the `deep-research` `Workflow` harness
  was not wired to this subagent. If the main agent has web tools, a 10-minute follow-up
  on the three `[NOT WEB-VERIFIED]` items above fully closes this out. The
  recommendation (globals fallback) does **not** depend on those items — the macOS-13.3
  floor alone kills the import-map path on its own.
