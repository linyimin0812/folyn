# PlantUML plugin: fetch SVG via host-mediated http, drop direct `<img src=remote>`

## Goal

Remove the Quill main-window CSP workaround (`https://www.plantuml.com` in `img-src`)
by making the plantuml plugin fetch its SVG through the host-mediated `http.fetch`
RPC (which already enforces `permissions.http.origins`). Architecture rule: plugins
declare the origins they need; the host enforces; Quill source stays untouched.

## What I already know

- `apps/desktop/src-tauri/tauri.conf.json:160` main-window CSP currently whitelists
  `https://www.plantuml.com` in `img-src` (committed in `af777da` as a stopgap).
- `apps/desktop/src/services/plugin-host/rpcBridge.ts:533` already implements
  `http:fetch` — JS-side `isOriginAllowed` check + Rust `plugin_http_fetch` command
  (no CSP applies because reqwest runs outside the webview). Defense-in-depth: Rust
  re-checks `permissions.http.origins` from the on-disk manifest.
- Plantuml plugin manifest already declares
  `permissions.http.origins: ["https://www.plantuml.com"]`.
- Plantuml plugin (`/Users/yiminlin/project/quill-plugin-sdk/plantuml-plugin/src/index.ts`)
  currently uses direct remote URLs in 4 places:
  1. `<img src={url}>` in `PlantUmlPreview` (line 95) — main-window CSP-blocked.
  2. `<img src={url}>` in `PlantUmlDiagram` (line 176) — same.
  3. `fetch(PLANTUML_SERVER + encoded)` in `exportPlantUmlSvg` (line 44) — same.
  4. `fetch(src)` in `enhancePlantUml` (line 217) — same (but inside an enhancer
     that already inlines the SVG; if fetch is CSP-blocked, enhancer silently
     no-ops and the `<img>` stays broken).
- Trusted loader (`trustedLoader.ts:144-150`) calls `module.activate({ ...ctx, ai, env })`
  only if the plugin defines `activate()`. Plantuml currently doesn't.
- PluginContext (`packages/plugin-sdk/src/types.ts:35-56`) exposes `ai` and `env`
  but no `http`. The rpcBridge `http:fetch` is currently reachable only from
  sandbox tier (via postMessage RPC).

## Assumptions (temporary)

- Trusted plugins should reach the host-mediated `http.fetch` the same way they
  reach `ai` — through `PluginContext`. Exposing it on `ctx` is consistent with
  `ai`/`env` and keeps the contract symmetric.
- The plugin's React components can reach `ctx.http` via a module-local singleton
  saved in `activate()` (mirrors the existing `resolveReact()` pattern in
  `src/react.ts`). This avoids extending every `PreviewProps`/`ExporterContext`
  with `http`.
- `data:image/svg+xml;base64,...` URL is sufficient for `<img src>`. No blob-URL
  lifecycle, no `URL.revokeObjectURL` cleanup. SVG size well under browser URL
  length limits.

## Decisions (locked)

- **Render format**: `data:image/svg+xml;base64,...` URL. Smallest diff, CSP
  already allows `img-src data:`, no blob-URL lifecycle.
- **AbortSignal**: not in MVP. Debounce 300ms is enough; a stale fetch result
  simply overwrites state. Add `signal` later if a plugin needs it.

## Open Questions

(none)

## Requirements

- Expose `http: { fetch(url, init?) }` on `PluginContext` for trusted plugins.
  Returns `{ status, headers, body }` (same shape as rpcBridge `http:fetch`).
- Wire it in `trustedLoader.ts` activate: build via the same
  `http:fetch` route the rpcBridge uses (call `invoke('plugin_http_fetch', ...)`
  with the plugin's own id), gated by `isOriginAllowed` against the manifest.
- Plantuml plugin:
  - Add `activate(ctx)` that stashes `ctx.http` in a module-local.
  - `PlantUmlPreview` / `PlantUmlDiagram` fetch the SVG via `http.fetch`, build
    a `data:image/svg+xml;base64,...` URL, render `<img src={dataUrl}>`.
    Debounce stays at 300ms; no AbortSignal (stale result overwrites state).
  - `exportPlantUmlSvg` switches to `ctx.http.fetch` (same return shape, so the
    Blob construction is unchanged).
  - `enhancePlantUml` switches to `ctx.http.fetch`. No other behavior change.
- Revert `tauri.conf.json:160` — remove `https://www.plantuml.com` from `img-src`.
- Docs: `docs/plugin-development.md` + `docs/plugin-development.zh.md` add a
  "Fetching remote resources" section: declare `permissions.http.origins`,
  call `ctx.http.fetch(url)`, never use `<img src=remote>` or direct `fetch()`.

## Acceptance Criteria

- [ ] Plantuml plugin renders `.puml` preview in packaged build with NO
      `https://www.plantuml.com` in main-window CSP.
- [ ] Markdown ` ```plantuml ` block + `:::plantuml` container both render in
      packaged build.
- [ ] "Export as SVG" works in packaged build (no CSP error in console).
- [ ] Typing fast in the editor doesn't race-renders stale SVGs (debounce
      300ms verified by unit test; AbortSignal explicitly out of scope).
- [ ] Network failure shows the existing "rendering failed" fallback, not a
      broken-img icon.
- [ ] Manifest without `permissions.http.origins` entry → `ctx.http.fetch`
      throws `origin not allowed` (unit test).
- [ ] `docs/plugin-development.md` + zh version document the pattern with a
      copy-pasteable example.

## Definition of Done

- Unit tests for: plugin activate stashes http; preview fetches via ctx;
  debounce drops intermediate fetches on rapid source change; permission
  denial throws `origin not allowed`.
- Lint / typecheck / CI green.
- Docs updated (EN + ZH).
- Manual smoke in packaged build (the original bug context).

## Technical Approach

### Surface

```ts
// packages/plugin-sdk/src/types.ts (PluginContext)
readonly http?: PluginHttpCapability;

export interface PluginHttpCapability {
  fetch(url: string, init?: { method?: string; headers?: HeadersInit; body?: string }): Promise<{ status: number; headers: Record<string, string>; body: string }>;
}
```

Same return shape as rpcBridge `http:fetch` so the implementation is one line.

### Trusted loader wiring

```ts
// trustedLoader.ts activate()
const http = buildPluginHttp(manifest);  // wraps invoke('plugin_http_fetch', { pluginId, url, ... })
// pass to activate: module.activate({ ...ctx, ai, env, http })
```

`buildPluginHttp` lives in a new `httpCapability.ts` next to `aiCapability.ts`/
`envCapability.ts`. Calls `isOriginAllowed` JS-side first (fast-fail) then
`invoke('plugin_http_fetch', ...)`.

### Plantuml plugin shape

```ts
let hostHttp: PluginHttpCapability | undefined;

export async function activate(ctx: PluginContext) { hostHttp = ctx.http; }
function http() {
  if (!hostHttp) throw new Error('plantuml: activate() not called');
  return hostHttp;
}

// in PlantUmlPreview effect (after debounce):
const { body: svg } = await http().fetch(url);
const dataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
setSrc(dataUrl);
```

`btoa(unescape(encodeURIComponent(svg)))` handles UTF-8 in SVG text.

### CSP revert

`tauri.conf.json:160` — drop `https://www.plantuml.com` from `img-src`. Keep
`data:` and `blob:` (already present).

## Decision (ADR-lite)

**Context**: Stopgap CSP whitelist (`af777da`) leaks plugin-declared origins
into Quill's main-window CSP, which is build-time and shared across all plugins.
Each new remote-fetching plugin would require a Quill source edit. The plugin
manifest already declares `permissions.http.origins`; the host already has a
manifest-enforcing `plugin_http_fetch` command. The leak exists only because
the plugin renders via `<img src=remote>` instead of going through that command.

**Decision**: Add `http` to `PluginContext` (parallel to `ai`, `env`). Plugins
fetch through `ctx.http.fetch`, render as `data:` URL. Main-window CSP reverts;
Quill source never needs to know which remote origins a plugin uses.

**Consequences**: One new SDK type (`PluginHttpCapability`) + one new host
builder (`httpCapability.ts`) + a small plantuml plugin refactor. Future
remote-fetching plugins copy the pattern. CSP becomes simpler over time, not
more complex.

## Out of Scope

- Sandboxed (iframe) plugins — they already reach `http:fetch` via rpcBridge
  postMessage. Not touched here.
- Streaming HTTP / non-text bodies (e.g. binary downloads). MVP is text-only
  (`body: string`); add a `fetchBlob` later if a plugin needs it.
- Other remote-fetching plugins — there's only plantuml today. When the next
  one shows up, follow the documented pattern.

## Technical Notes

- `plugin_http_fetch` Rust command lives in `apps/desktop/src-tauri/src/` (used
  by rpcBridge already). The JS `isOriginAllowed` and Rust re-check are the
  two enforcement layers.
- `data:image/svg+xml;base64,...` is CSP-allowed under `img-src data:` (already
  in the main-window CSP). No blob-URL lifecycle.
- Module-local singleton pattern (`resolveReact()` in `src/react.ts` of the
  plugin) is already used for React — same shape for `http()`.

## Research Notes

### Render format options

**Approach A: `data:image/svg+xml;base64,...` URL** (Recommended)

- How: fetch SVG text → `btoa(unescape(encodeURIComponent(svg)))` → set as
  `<img src>`. Existing `<img>` + zoom + onError unchanged.
- Pros: Smallest diff. CSP-friendly (`img-src data:` already allowed). No
  lifecycle. Works for export (enhancer already inlines SVG via DOMParser,
  unaffected).
- Cons: Big SVGs inflate the DOM attribute. Chrome caps data URL at ~2MB;
  plantuml SVGs are typically tens of KB. Memory: the SVG is held both as
  a string (in state) and as the data URL attribute.

**Approach B: `blob:` URL**

- How: `URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))` →
  set as `<img src>`. Revoke on unmount/source change.
- Pros: Shorter DOM attribute. Same CSP allowance (`img-src blob:` already
  present).
- Cons: Must revokeObjectURL on every source change + on unmount. More
  moving parts; one more place to leak.

**Approach C: Inline `<svg>` via `dangerouslySetInnerHTML`**

- How: Parse SVG text → inject as innerHTML of a `<div>`. Skip `<img>` entirely.
- Pros: CSS inheritance (theme colors could reach the SVG). Zoom via CSS
  transform on the wrapper, same as today.
- Cons: SVG can carry `<script>` (CSP `script-src` blocks it, but still risky
  if the SVG source is ever attacker-controlled). PlantUML server output is
  not user-controlled, so acceptable, but the surface is larger than `<img>`.
  Also: SVG `<img>` won't execute scripts anyway — staying with `<img>` is
  the safer default.

Ponytail: **A**. Smallest diff, no lifecycle, CSP already allows it.
