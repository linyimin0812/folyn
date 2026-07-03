# Research: JSON Query Libraries for Browser (Tauri Vite + React 18 + TS)

- **Query**: Best JS/TS library for querying JSON in a browser/Tauri Vite environment — jq (WASM) vs JSONPath vs JMESPath alternatives; bundle size, browser safety, full-language support, WASM/Vite loading, streaming.
- **Scope**: external (npm registry metadata + readmes) + minor internal (existing Vite config / deps)
- **Date**: 2026-07-03

## Findings

### Internal Context (relevant to choice)

`apps/desktop/vite.config.ts` currently:
- `build.target: 'esnext'` — top-level await is natively supported by the build output. No `vite-plugin-top-level-await` needed.
- No `vite-plugin-wasm` plugin configured. **Not a blocker**: Emscripten-style packages that load `.wasm` via `new URL('x.wasm', import.meta.url)` are handled natively by Vite (it emits the `.wasm` as a separate asset and rewrites the URL). `vite-plugin-wasm` is only required for `wasm-pack`-style Rust modules that use the synthetic `import wasm from './x.wasm'` syntax.
- Manual chunks already configured (`codemirror`, `rehype`, `grapesjs`). A `jq` dynamic-import chunk can be added the same way.
- Existing JSON-related deps already present: `@codemirror/lang-json`, `@codemirror/language`, `@codemirror/view` (no query lib is currently installed).

`apps/desktop/package.json` does NOT currently include `jq-wasm`, `jsonpath-plus`, `jmespath`, or any alternative. None of these are reused elsewhere in the monorepo — fresh addition.

### Candidate Libraries (npm registry, July 2026)

| Library | Type | Unpacked size (npm) | Runtime deps | TS types | Browser-safe | Full-lang support | RFC 9535 | Notes |
|---|---|---|---|---|---|---|---|---|
| **jq-wasm** `2.0.0-jq-1.8.2` | jq via WASM (Emscripten) | 4.0 MB (incl. `jq.wasm` ~1–2 MB) | none | yes (built-in `.d.mts`) | yes (browser export condition, default = browser) | full jq 1.8.2 | n/a | Best jq-in-browser option. `jq.raw(json, query, flags)` and `jq.json(json, query, flags)`. Loads `jq.wasm` via `new URL(..., import.meta.url)` — Vite handles natively. `/inline` subentry embeds wasm as base64 (larger, no separate asset). Published 6 days ago. |
| **jq-web** `0.6.2` | jq via WASM (Emscripten) | 3.3 MB | none | no | yes (with caveats) | full jq (older) | n/a | Webpack-oriented; readme documents `fs` polyfill + `copy-webpack-plugin` workarounds for `.wasm` 404s. Last published ~1 year ago. Less Vite-friendly than `jq-wasm`. Exports a Promise resolving to `{json, raw}`. |
| **node-jq** | jq via child process | n/a | requires `jq` binary on host | yes | NO | full jq | n/a | Spawns the native `jq` binary. Not browser-safe. Tauri sidecar could theoretically shell out, but that defeats the "preview pane" UX and adds a host dependency. Excluded. |
| **jsonpath-plus** `10.4.0` | JSONPath (pure JS) | 643.9 kB (minified browser ESM ~30–50 kB gz) | `jsep`, `@jsep-plugin/assignment`, `@jsep-plugin/regex` | yes (built-in `.d.ts`) | yes (dedicated `browser` export = `dist/index-browser-esm.js`) | extended JSONPath (superset of original spec) | partial (extends legacy spec, not strict 9535) | Most popular JSONPath lib. Readme explicitly says "not currently being actively maintained" but still receives updates (10.4.0 published Feb 2026). Adds `^` (parent), `~` (property names), type selectors (`@string()`, `@number()`, …), `@path`/`@root` etc. in filters. Returns array of matches; supports `resultType: 'pointer'|'path'|'parent'` etc. Has `callback` option for streaming-style iteration. |
| **jsonpath-rfc9535** `1.3.0` | JSONPath (pure JS, strict RFC) | 1.1 MB | none | yes (`dist/esm/index.d.ts`) | yes (ESM, ES2022) | RFC 9535 compliant | yes — 100% CTS pass | Zero runtime deps. Smallest real-world footprint after tree-shake. Exports `query`, `paths`, `stringify`, `normalize`. Stricter than `jsonpath-plus` (no `@string()` type selectors etc.). By same author as `nimma`. Published ~1 year ago. |
| **jsonpath** `1.3.0` (dchester) | JSONPath (pure JS) | 427.7 kB | `esprima@1.2.5`, `static-eval`, `underscore` | no (use `@types/jsonpath`) | theoretically yes, but pulls `underscore` + `esprima` | legacy JSONPath | no | Old `esprima` 1.2.5 dep is a red flag (security/maintenance). Node-focused. Not recommended. |
| **jsonpath-x** | — | — | — | — | — | — | — | **Not found on npm (404)**. The name does not correspond to a published package as of 2026-07-03. Likely a misremembering of `jsonpath-plus` / `jsonpath-rfc9535`. |
| **nimma** `0.7.2` | JSONPath (legacy spec, optimized) | 369.5 kB | `astring` | yes | yes | legacy JSONPath (not RFC 9535) | no | Same author as `jsonpath-rfc9535`; readme points users to `jsonpath-rfc9535` for RFC compliance. Useful only if you need a legacy spec. Skip. |
| **jmespath** `0.16.0` | JMESPath (pure JS) | 81.1 kB | none | no | yes | JMESPath spec (frozen) | n/a | Original `jmespath.js`. Spec site marked "frozen"/abandoned. No TS types. Smallest option but stale. |
| **@jmespath-community/jmespath** `1.3.0` | JMESPath (TS, community spec) | 1.6 MB | none | yes (native TS) | yes | JMESPath Community spec (superset) | n/a | Actively maintained (published ~11 months ago). MPL-2.0. Ships a `jp` CLI. Larger unpacked but tree-shakes well. Good option if JMESPath syntax is wanted. |
| **json-e** `4.8.2` | JSON parameterization (Mozilla) | 107.7 kB | `json-stable-stringify-without-jsonify` | yes (yes, built-in) | yes | not a query language | n/a | README describes it as "data-structure parameterization system", not a query/filter language. Wrong tool for this job — skip. |
| **jq-ast** | — | — | — | — | — | — | — | **Not found on npm (404)**. No such package. |

### jq-in-browser: Vite / WASM loading Notes

- `jq-wasm`'s default browser entry loads `jq.wasm` via `new URL('jq.wasm', import.meta.url)`. Vite 6 (current in repo) recognizes this pattern and emits `jq.wasm` as a separate asset in `dist/assets/`. **No `vite-plugin-wasm` needed.**
- **Top-level await**: jq-wasm's API is `async` (`jq.json(...)` returns a Promise), not TLA-dependent. Even so, `build.target: 'esnext'` (already set) supports TLA in case any deeper dep uses it. Tauri's webview (WKWebView on macOS, WebView2 on Windows) supports TLA and `WebAssembly.instantiateStreaming`. **`vite-plugin-top-level-await` not needed.**
- **Bundle impact**: `jq.wasm` is roughly **1–2 MB** (gzipped somewhat smaller; Emscripten jq full build is on the heavier end). Mitigation: dynamic-import the jq module only when the user actually engages the "jq query" mode:
  ```ts
  const jq = (await import('jq-wasm')).default;
  ```
  Combined with `manualChunks` (`apps/desktop/vite.config.ts` already has this pattern), the wasm + JS glue land in a separate chunk that loads on demand. The initial JSON viewer bundle stays small.
- **`/inline` subentry**: `import { json } from 'jq-wasm/inline'` embeds the wasm as base64 inside the JS — avoids the separate asset but **inflates** the JS chunk by ~33%. Only worth it if asset-emission breaks (it won't here).
- **Streaming results**: jq-wasm returns `stdout` as a complete string after jq finishes — **not streaming**. For a single-document preview pane this is fine; if the user runs `.[]` on a 100MB array they'll wait for the full result. JSONPath libs similarly return an array of all matches. None of these stream. Acceptable for the documented UX ("Conversion outputs are produced on-demand (button/toolbar), not live-streamed." — `prd.md` line 47).
- **Full-language support**: jq-wasm runs real jq 1.8.2 (latest jq as of July 2026) compiled to WASM — **full jq language**, including `reduce`, `foreach`, `@csv`, `@base64`, `tojson`/`fromjson`, regex (`test`, `match`, `sub`), `ascii_only`, etc. No subset caveats. `jq-web` is older jq and harder to wire in Vite.

### JSONPath: Vite / Pure-JS Notes

- `jsonpath-plus` ships a dedicated `browser` export condition (`dist/index-browser-esm.js`) — Vite picks it automatically. No polyfills needed. Tree-shakes to roughly 30–50 kB gzipped in practice (smaller than the 643.9 kB unpacked figure suggests).
- `jsonpath-rfc9535` is pure ESM with zero deps — Vite-friendly, tree-shakes cleanly. Slightly smaller in real-world bundles, stricter spec compliance.
- Both return arrays of matches synchronously. `jsonpath-plus` also offers `callback`/`resultType` options for path/pointer/parent metadata — useful if the JSON viewer wants to highlight matched locations in the tree.
- Both are pure JS — no WASM, no top-level await, no asset emission.

### JMESPath as a Third Option

- JMESPath is a simpler, more SQL-ish alternative to jq (`locations[?state == 'WA'].name | sort(@) | {WashingtonEmployees: join(', ', @)}`). It is genuinely useful and has a learning curve of its own.
- Original `jmespath` (0.16.0) is stale and untyped. `@jmespath-community/jmespath` (1.3.0) is the actively maintained, TS-native fork — but still ~1.6 MB unpacked and adds a *third* syntax for users to learn.
- **Verdict**: not worth offering as a third button in the MVP. Adds cognitive load without materially broadening what users can do beyond jq + JSONPath. Could be added later as a power-user toggle if demand surfaces.

### Related Specs

- `.trellis/tasks/07-03-json-file-viewer-with-preview-conversion-and-query-support/prd.md` — task PRD; capability #7 is "JSON Path or jq expression query on the JSON object"; open question (line 54) lists `jq-wasm` and `jsonpath-plus` as candidates to research-confirm. This file answers that question.
- No `.trellis/spec/` documents currently mention JSON querying (no `jq` / `jsonpath` matches in spec tree — would have surfaced in implementation later).

## Comparison / Recommendation Table

| Library | Type | Real bundle (gz, est.) | Browser-safe | Full-lang | RFC 9535 | Recommendation |
|---|---|---|---|---|---|---|
| jq-wasm | jq WASM | ~1.5–2 MB (lazy) | yes | full jq 1.8.2 | n/a | **Use for jq mode, lazy-loaded** |
| jq-web | jq WASM | ~1.5 MB | yes (webpack-flavored) | older jq | n/a | Skip — Vite-unfriendly, stale |
| node-jq | native jq | n/a | no | full | n/a | Skip — not browser-safe |
| jsonpath-plus | JSONPath | ~30–50 kB | yes | extended legacy | partial | **Use for JSONPath mode (primary)** — most popular, richest API, built-in TS |
| jsonpath-rfc9535 | JSONPath | ~20–40 kB | yes | strict RFC 9535 | yes | Alternative if strict RFC compliance is required |
| jsonpath (dchester) | JSONPath | ~30 kB + underscore + esprima | marginal | legacy | no | Skip — stale deps |
| nimma | JSONPath | ~40 kB | yes | legacy | no | Skip — superseded by `jsonpath-rfc9535` |
| @jmespath-community/jmespath | JMESPath | ~50–80 kB | yes | community spec | n/a | Defer — nice-to-have, not MVP |
| jmespath | JMESPath | ~20 kB | yes | frozen spec | n/a | Skip — stale, untyped |
| json-e | parameterization | ~20 kB | yes | not a query lang | n/a | Skip — wrong tool |
| jq-ast | (doesn't exist) | — | — | — | — | Does not exist on npm |

## Final Recommendation

**Offer both jq and JSONPath**, each as a selectable query-mode in the JSON preview toolbar:

1. **jq** via `jq-wasm` (lazy dynamic import → keeps the 1–2 MB wasm out of the initial bundle until the user clicks "jq" mode). Full jq 1.8.2, no subset surprises. Use the default browser entry (`new URL(...import.meta.url)`), **not** `/inline`.
2. **JSONPath** via `jsonpath-plus` (richer API: returns paths/pointers/parents in addition to values, has `callback` for incremental rendering, built-in TS types, ships a Vite-friendly `browser` export). It is the de-facto standard JSONPath library, so user-authored expressions from the wider ecosystem (Stack Overflow, blog posts) will mostly Just Work.
   - If strict RFC 9535 portability becomes a requirement later, swap to `jsonpath-rfc9535` behind the same UI — the call surface (`query(doc, expr) → array`) is compatible enough.

**Do not** offer JMESPath in the MVP. It is a perfectly fine query language but adding a third syntax button dilutes the UX without adding capability the other two don't already cover. Keep it as a documented future enhancement.

**Do not** use `node-jq` (host-binary dependency, not browser-safe), `jq-web` (stale, webpack-oriented), `jsonpath` (dchester — old `esprima` + `underscore` deps, no native types), or `json-e` (not a query language).

### Vite Integration Checklist (for implementation phase)

- [ ] Add `jq-wasm` and `jsonpath-plus` to `apps/desktop/package.json` `dependencies`.
- [ ] No new Vite plugins required. `vite-plugin-wasm` and `vite-plugin-top-level-await` are **not** needed (jq-wasm uses `new URL(..., import.meta.url)` + Promise API; `build.target: 'esnext'` already supports TLA).
- [ ] Dynamic-import `jq-wasm` inside the jq-mode handler so the wasm chunk loads only on demand:
  ```ts
  const { json: jqJson, raw: jqRaw } = await import('jq-wasm');
  ```
- [ ] Add a `manualChunks` entry for `jq` in `apps/desktop/vite.config.ts` if Vite doesn't auto-split it (it usually will via dynamic import).
- [ ] For `jsonpath-plus`, static-import `JSONPath` from `jsonpath-plus` in the JSONPath-mode handler — small enough that tree-shaking handles it.
- [ ] Both libraries are synchronous/Promise-returning and return **all matches at once** — design the UI around a single result render, not streaming.

## Caveats / Not Found

- Exact gzipped sizes are estimated from unpacked sizes and known characteristics (pure JS vs WASM). A `vite build` + `rollup-plugin-visualizer` run during implementation will give precise numbers; the relative ordering (jq ~1.5–2 MB wasm >> jsonpath-plus ~30–50 kB gz > jsonpath-rfc9535 ~20–40 kB gz) is reliable.
- `jsonpath-plus` self-describes as "not currently being actively maintained" in its README, but version 10.4.0 was published 2026-02-16 and the maintainer still accepts PRs. For a self-contained preview tool this is acceptable; if long-term maintenance becomes a concern, `jsonpath-rfc9535` (zero deps, strict spec, by an active JSONPath spec contributor) is the drop-in alternative.
- `jq-wasm` 2.0.0 was published 6 days ago (2026-06-27) — verify the changelog before pinning in case of fresh regressions; pinning to a known-good older version (1.x) is a safe fallback.
- No streaming query option exists among any of these libraries — they all return complete match sets. If a future requirement surfaces for streaming over very large JSON, none of these will suffice and a custom iterator (or jq's `--stream` mode via a different WASM build) would be needed. Out of scope for the MVP per PRD line 47.
