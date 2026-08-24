# Research: Trusted-Plugin WASM Loading (Graphviz / `@viz-js/viz`)

- **Query**: How does a trusted-tier Folyn plugin ship and load a `.wasm` binary at runtime? Specifically `@viz-js/viz`'s graphviz wasm.
- **Scope**: mixed (internal codebase + external npm package inspection)
- **Date**: 2026-07-30

## TL;DR (answers the PRD's blocking open question #3)

**Neither a `folyn-plugin://` wasm fetch nor a hand-inlined base64 blob is needed.** `@viz-js/viz` v3.28.0 **ships its wasm embedded inside the JS bundle** (`lib/backend.js` / `dist/viz.js`) as a `binaryDecode('…')` string literal. `findWasmBinary()` returns the decoded bytes; `WebAssembly.instantiate(bytes, imports)` runs on those bytes directly. There is **no separate `.wasm` file, no `fetch()`, no `locateFile`, no `wasmURL` option**. The plugin simply bundles `@viz-js/viz` into its self-contained ESM `main` and calls `instance()`. The ~1.17 MB JS (≈456 KB gzip) — wasm included — rides inside the blob-URL `import()` that `trustedLoader.ts` already performs. CSP allows it (`wasm-unsafe-eval`). Done.

This flattens the PRD's "Assumptions to validate" (plugin:// fetch vs base64 inline) — both paths are moot for this library.

## Findings

### 1. Main webview CSP — WebAssembly IS allowed

**File**: `apps/desktop/src-tauri/tauri.conf.json:144`

```
"csp": "default-src 'self';
  script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: folyn-plugin: https://cdn.jsdelivr.net https://esm.sh https://embed.diagrams.net;
  ...
  connect-src 'self' ipc: http://ipc.localhost folyn-plugin: https://cdn.jsdelivr.net https://esm.sh https://embed.diagrams.net;
  ..."
```

- `script-src` includes **`wasm-unsafe-eval`** → `WebAssembly.instantiate` / `compile` are permitted in the main webview realm (the trusted-tier runtime).
- `script-src` also includes `blob:` (the blob-URL `import()` of `main` is allowed) and `folyn-plugin:`.
- `connect-src` includes **`folyn-plugin:`** → a `fetch('folyn-plugin://localhost/<id>/<file>')` from the main webview is CSP-allowed.

### 2. `folyn-plugin://` URI scheme CAN serve a `.wasm` (if ever needed)

**File**: `apps/desktop/src-tauri/src/lib.rs:288-394` (the `register_asynchronous_uri_scheme_protocol("folyn-plugin", …)` handler).

- For `GET folyn-plugin://localhost/<id>/<path>`, the handler calls `std::fs::read(&canonical)` (`lib.rs:373`) — **raw bytes**, not `read_to_string` — and responds with `Content-Type` from `content_type_for(&file_path)` (`lib.rs:386`).
- `content_type_for` maps `"wasm" → "application/wasm"` (`plugin_commands.rs:59`).
- Each response also carries the `PLUGIN_CSP` header (`lib.rs:391`; `plugin_commands.rs:72-73`), but **CSP headers on subresource responses (a `.wasm` fetched via `fetch()`) are ignored by the browser** — only the document's CSP governs `connect-src`/`script-src`. So this header is harmless for a wasm fetch and does not block it.
- Path traversal is rejected (`parse_plugin_uri`, `plugin_commands.rs:30-41`) and canonicalization keeps the resolved path inside the plugin dir (`lib.rs:346-371`).

**Conclusion for Q1**: A plugin *could* fetch its own `.wasm` via `fetch('folyn-plugin://localhost/<id>/viz.wasm')` — the scheme serves binary with the right MIME and the main-webview CSP allows the origin. But see §4: `@viz-js/viz` doesn't need this.

### 3. `read_plugin_file` Tauri command CANNOT return binary (UTF-8 only)

**File**: `apps/desktop/src-tauri/src/plugin_commands.rs:605-625`

```rust
#[tauri::command]
pub async fn read_plugin_file(app, id, path) -> Result<String, AppError> {
    ...
    fs::read_to_string(&canonical).map_err(|e| AppError::from(e.to_string()))  // line 624
}
```

`fs::read_to_string` → returns UTF-8 `String`. A `.wasm` is not valid UTF-8, so this command **will error** on any binary asset. The JS wrapper in `trustedLoader.ts:197-200` also types the return as `string`. So the Rust-command path is **dead for wasm** unless a new binary-returning command is added (out of scope — and unnecessary, see §4).

This is the channel `trustedLoader.ts:73` uses to fetch `manifest.main` (the JS bundle, which is text) — correct for JS, wrong for binary.

### 4. How `@viz-js/viz` actually loads its wasm (the decisive finding)

Inspected the published tarball `@viz-js/viz@3.28.0` (`npm pack`).

**Files in the package**: `dist/viz.js`, `dist/viz.cjs`, `lib/backend.js`, `src/*.js`, `types/index.d.ts`, `README.md`. **No `.wasm` file anywhere.** (`find … -name "*.wasm"` → empty.)

**`src/index.js`** (the entry the plugin imports):
```js
import Module from "../lib/backend.js";
import Viz from "./viz.js";
export function instance() {
  return Module().then(m => new Viz(m));
}
```

**`lib/backend.js`** (Emscripten module factory, ~1.17 MB, single line). Key fragments (located via `re.finditer`):

- `var _scriptName=import.meta.url;` (offset 325) — used only to compute `scriptDirectory` for `readAsync` (supplementary file fetch, e.g. `image` attribute paths). **Not used for the wasm.**
- `readAsync = async url => { var response = await fetch(url, {credentials:"same-origin"}); … }` — only ever invoked for `image` attribute file loading, **never for the wasm**.
- `function findWasmBinary(){return binaryDecode(' asm   Ön`…')}` (offset ~1783) — the wasm is a **binary-encoded string literal baked into the JS**, decoded at runtime by `binaryDecode` (offset 867):
  ```js
  function binaryDecode(bin){for(var i=0,l=bin.length,o=new Uint8Array(l),c;i<l;++i){c=bin.charCodeAt(i);o[i]=~c>>8&c}return o}
  ```
- `instantiateArrayBuffer(binaryFile,imports){ … var instance=await WebAssembly.instantiate(binary,imports); return instance …}` (offset ~1024700) — `binary` is the `findWasmBinary()` result. So `WebAssembly.instantiate` runs on the inlined bytes directly.
- `createWasm()` wires `instantiateAsync` → `instantiateArrayBuffer` → `WebAssembly.instantiate(bytes, imports)`. **No `locateFile`, no `wasmBinaryFile` URL fetch, no `instantiateWasm` override hook, no `wasmURL` option.** (All grepped with 0 hits except `wasmBinaryFile` which is declared but assigned from `findWasmBinary()`.)

**Implications**:
1. No custom fetch function / `wasmURL` to point at a `folyn-plugin://` URL.
2. No `import.meta.url`-relative `.wasm` fetch that would break under a blob-URL `import()`.
3. The entire wasm ships inside the JS. Bundling `@viz-js/viz` into the plugin's `main` ESM bundle = wasm travels along automatically. No separate asset, no second network/IPC fetch.

**Bundle-size cost** (the unavoidable price):
- `lib/backend.js`: 1,174,660 bytes raw; **467,131 bytes gzip** (~456 KB).
- `dist/viz.js`: 1,185,576 bytes raw (similar gzip).
- This is the JS-with-inlined-wasm. Vite/Rollup will emit it as part of the plugin chunk; since the plugin `main` is dynamic-imported by `trustedLoader.ts` only after the user installs+trusts the plugin and opens a `.dot` file, **it never touches the host app's initial bundle**. Host app stays zero-cost when the plugin isn't installed — the PRD's core goal.

### 5. Does the blob-URL `import()` break `@viz-js/viz`?

`trustedLoader.ts:93-95`:
```ts
const blob = new Blob([code], { type: "text/javascript" });
const blobUrl = URL.createObjectURL(blob);
const mod = await importModule(blobUrl);
```

- The blob URL `import()` loads the JS. Since the wasm is a string inside the JS, `WebAssembly.instantiate` runs against in-memory bytes — no path resolution, no fetch. Works under a blob URL.
- `import.meta.url` inside the blob module = the blob URL (`blob:…`). `scriptDirectory = new URL(".", blobUrl).href` = the blob URL. This is only consumed by `readAsync` (image attribute fetches); DOT→SVG rendering never touches it, so it's a non-issue. If a user later uses Graphviz `image="..."` attributes pointing at local files, `readAsync` would 404 — out of scope for MVP (the PRD lists only DOT source → SVG, no image nodes).
- CSP `script-src` allows both `blob:` (the import) and `wasm-unsafe-eval` (the instantiate). No CSP error.

### 6. Recommended approach

**Approach**: Bundle `@viz-js/viz` into the trusted plugin's self-contained ESM `main` and call `instance()`.

```ts
// inside the plugin's GraphvizPreview component (bundled into main by Vite lib mode)
import { instance, type Viz } from '@viz-js/viz';

let viz: Viz | null = null;

async function renderDotToSvg(dot: string): Promise<string> {
  if (!viz) viz = await instance();
  // renderSVGElement returns an SVGSVGElement; use renderString for an SVG string
  return viz.renderString(dot, { format: 'svg', engine: 'dot' });
}
```

Pros/cons mapped onto Folyn's constraints:

| Constraint | How it holds |
|---|---|
| "plugin `main` must be self-contained ESM, no relative/remote imports" (`trustedLoader.ts:34-37`) | ✅ Vite library mode inlines `@viz-js/viz` (wasm included) into `main`. No runtime imports remain. |
| "remote imports blocked by `folyn-plugin://` CSP" | ✅ No remote/`folyn-plugin://` fetch needed at all. |
| "blob URL has no path, relative imports don't resolve" | ✅ No imports left after bundling; wasm is a string, not a fetch. |
| CSP `wasm-unsafe-eval` for `WebAssembly.instantiate` | ✅ Present (`tauri.conf.json:144`). |
| Host-app zero bundle growth when plugin absent | ✅ `@viz-js/viz` lives in the plugin chunk, dynamically `import()`-ed only when the user opens a `.dot` file after install+trust. |
| TOFU integrity gate | ✅ `install_plugin` hashes every file incl. `main` (`plugin_commands.rs:488` `compute_integrity`), and `trustedLoader.ts:75-86` recomputes the SHA of `main` before `import()`. The inlined-wasm bytes are inside `main`'s hash. Tampering is caught. |
| Bundle cost | ⚠ ~1.17 MB raw / ~456 KB gzip for the wasm-in-JS. Unavoidable — this is how `@viz-js/viz` ships; there is no separate-asset option in v3.28.0. Acceptable for an on-demand plugin chunk (only loaded when rendering DOT). |

**Why not the `folyn-plugin://` fetch path?** It works (§2) but `@viz-js/viz` gives no hook to redirect the wasm source (no `wasmURL`, no `locateFile`, no `instantiateWasm` override) — the wasm is a compile-time string. You'd have to fork/rebuild the Emscripten output to externalize the wasm, which is far more work than just letting the inlined bytes ride along.

**Why not hand-inlined base64?** Same reason — `@viz-js/viz` already inlines (with a custom `binaryDecode`, not base64, but same idea). Re-doing it buys nothing.

### Files Found

| File Path | Description |
|---|---|
| `apps/desktop/src/services/plugin-host/trustedLoader.ts` | Trusted loader: blob-URL `import()`, TOFU SHA-256 gate, `readPluginFile`/`grantCapabilities` wrappers |
| `apps/desktop/src-tauri/src/plugin_commands.rs` | `read_plugin_file` (UTF-8, line 624), `compute_integrity`, `content_type_for` (wasm→`application/wasm`, line 59), `PLUGIN_CSP` |
| `apps/desktop/src-tauri/src/lib.rs:288-394` | `folyn-plugin://` URI scheme handler: serves raw bytes via `std::fs::read`, adds `Content-Type` + `PLUGIN_CSP` header |
| `apps/desktop/src-tauri/tauri.conf.json:144` | Main webview CSP — `wasm-unsafe-eval`, `blob:`, `folyn-plugin:` in script-src; `folyn-plugin:` in connect-src |
| `@viz-js/viz@3.28.0` `lib/backend.js` | Emscripten module: wasm inlined via `binaryDecode('…')`, `WebAssembly.instantiate(bytes, imports)`, no fetch/locateFile |
| `@viz-js/viz@3.28.0` `src/index.js` | `instance()` = `Module().then(m => new Viz(m))` |
| `packages/container-plugins/src/plugins/MermaidPlugin.tsx` | Render precedent: `mermaid.render() → svg string → dangerouslySetInnerHTML` |

### Related Specs / Prior Research

- `.trellis/tasks/07-30-graphviz-trusted-plugin/prd.md` — this task's PRD; open question #3 (wasm shipping) is answered here (the "plugin:// fetch vs base64 inline" framing is moot: `@viz-js/viz` already inlines).
- `.trellis/tasks/archive/2026-07/07-08-microkernel-plugin-architecture/research/tauri-runtime-loading.md` — the blob-URL `import()` pattern, module-cache eviction caveats, and custom-scheme handler origin isolation (§2, §6).
- `.trellis/tasks/07-03-json-file-viewer-with-preview-conversion-and-query-support/research/query-libraries.md` — `jq-wasm` uses `new URL('jq.wasm', import.meta.url)` (separate asset, Vite-handled) and offers an `/inline` base64 subentry. **Contrast**: `@viz-js/viz` has only the inline-equivalent path; no separate-asset variant exists.

## Caveats / Not Found

- `@viz-js/viz` v3.28.0 is the current published version (inspected via `npm pack`). If a future major version externalizes the wasm to a separate `.wasm` with a `locateFile`/`wasmURL` hook, revisit: the `folyn-plugin://localhost/<id>/viz.wasm` fetch path (§2) would then become the right answer, and `read_plugin_file` (§3) would need a binary-returning sibling command.
- `WebAssembly.instantiate` under `wasm-unsafe-eval` was reasoned from CSP spec + the Emscripten code path; **not empirically verified by running the plugin**. Implementation should open the webview console during first DOT render to confirm no CSP violation fires.
- Bundle size numbers are from the published JS (raw 1.17 MB / gzip 456 KB). The final plugin `main` size after Vite lib-mode bundling will be ≥ this; a `rollup-plugin-visualizer` pass during implementation will give the exact emitted size.
- The `binaryDecode` string inside `backend.js` is not standard base64 (it's an Emscripten binary-encoding scheme: `o[i]=~c>>8&c`). Do not attempt to decode/transform it; just let `@viz-js/viz`'s code run as-is.
