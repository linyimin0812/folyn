# Research: Input-format parsers for JSON preview pane

- **Query**: Best JS/TS libs to parse JSON5 / JSON-escape / Base64-JSON / YAML / XML / CSV into a canonical JS object for a Tauri + Vite + React 18 + TS app
- **Scope**: mixed (external library survey + repo context)
- **Date**: 2026-07-03

## Repo context (already in place)

- No parsing libraries are direct deps of `apps/desktop` today. `grep` over `apps/desktop/package.json` and root `package.json` for `json5|js-yaml|yaml|fast-xml-parser|xml2js|papaparse|csv-parse|js-base64|sheetjs|xlsx` returned only `@file-viewer/preset-office` / `@file-viewer/react` / `@file-viewer/vite-plugin` (all `^2.1.17`).
- SheetJS is therefore only transitive via `@file-viewer/preset-office` — not directly importable without adding it as a real dep. Treating it as "already in repo" is misleading; it lives behind the preset's bundle.
- CSV handler `apps/desktop/src/components/file-types/csv/CsvFileViewerPreview.tsx` delegates to `@file-viewer/react` + `preset-office`; it does NOT parse CSV itself. It also uses a BOM-prefix trick (`\uFEFF` prepended) to force SheetJS's UTF-8 path — relevant if we reuse SheetJS for CSV.
- Established repo pattern for heavy parsers (`.trellis/spec/desktop/frontend/file-type-editors.md` lines 294–303, `@dbml/core`): **lazy-load via dynamic `await import()`** on first use, because the bundle is multi-MB and would otherwise hurt first-paint. The same pattern should apply to any new heavy parser chosen here.
- CodeMirror JSON (`@codemirror/lang-json`) is already wired for edit mode — relevant only for the editor surface, not for parsing pasted input.

## Findings — per library

### 1. JSON5 — `json5`

- **Status**: De-facto standard. Published by Jordan Tucker (`json5.org`). Long-stable `2.2.x` line; a `3.0.x` line has been published (2024) with first-class ESM + built-in TS types. Both lines are actively maintained (no security advisories I'm aware of).
- **Browser-safe**: Yes. Pure JS, no `fs`/`path`/`Buffer`. Works in Vite without polyfills.
- **ESM/CJS**: Ships both. Vite handles ESM import natively.
- **TS types**: `2.x` needs `@types/json5`; `3.x` ships its own types. Pin `3.x` to skip the `@types/*` dep.
- **Bundle**: ~40 KB min / ~15 KB gzip (approx, 2.x). 3.x is similar order.
- **Round-trip**: `JSON5.parse` + `JSON5.stringify` both exist. `stringify` accepts replacer/reviver. Comments are NOT preserved in the parsed value — parse returns a plain object; comments are dropped (which is what the task wants).
- **Lighter alternatives**:
  - For "relaxed JSON" (comments + trailing commas + unquoted keys only), a ~15-line preprocessor (`stripComments` + `JSON.parse`) avoids the dep entirely. Cheapest option; fine if the only JSON5 features used are comments/trailing commas/unquoted keys.
  - `jsonc-parser` (Microsoft, from Monaco) — bigger (~100 KB), ships CST with comment ranges and error-recovery; overkill if you only need a value.
- **Recommendation**: **`json5` (pin `^3.0.0`)**. It is the de-facto standard, small enough, round-trips, and matches the "paste any JSON5" requirement precisely. If bundle budget gets tight, drop to a hand-rolled strip-comments + `JSON.parse` preprocessor.

### 2. YAML — `yaml` (eemeli) vs `js-yaml`

| Lib | Maintainer | TS types | Browser-safe | Bundle (approx) | Round-trip | Activity |
|---|---|---|---|---|---|---|
| `yaml` | Eemeli Aro | built-in (ships `.d.ts`) | yes | ~60 KB min / ~20 KB gzip | yes (`parse`/`stringify`) | active, regular releases |
| `js-yaml` | Vitaly Puzrin | `@types/js-yaml` | yes (v4 `load`/`dump`; avoid deprecated `safeLoad`) | ~70 KB / ~25 KB gzip | yes (`dump`) | stable but slower-moving |

- **`yaml` (eemeli)** is the better choice: modern API, built-in TS types (no `@types/*`), smaller bundle, ESM+CJS, active maintenance. v2.x has good error reporting and an optional CST/AST if later needed. No Node built-ins in the browser build.
- **`js-yaml`** v4 works in browser but skews CJS-first; needs `@types/js-yaml`. The `safeLoad`/`safeDump` aliases are deprecated in v4 — use `load`/`dump`.
- **Recommendation**: **`yaml` (pin `^2.x`)**.

### 3. XML — `fast-xml-parser` vs `xml2js` vs `@xml-tools/parser`

| Lib | Output shape | TS types | Browser-safe | Bundle (approx) | Round-trip | Activity |
|---|---|---|---|---|---|---|
| `fast-xml-parser` v4 | config-driven: attributes prefixed `@_` by default, text as `#text`, arrays gated by `isArray` callback | built-in v4+ | yes | ~45 KB / ~15 KB gzip | yes (`XMLBuilder`) | active (Amit Gupta) |
| `xml2js` | nested objects with `$` for attrs, `_` for text | `@types/xml2js` only | yes | ~70 KB / ~25 KB | yes (`Builder`) | low-activity, legacy |
| `@xml-tools/parser` | CST (token stream), not a plain JSON tree | built-in | yes | larger; designed for language tooling | no built-in JSON tree | niche |

- **`fast-xml-parser`** gives the cleanest JSON tree for a tree-view use case: attributes and text nodes are distinguishable via configurable prefixes, and `parse`/`build` round-trip. Pure JS, no `Buffer`/`fs`. Vite-friendly (ESM+CJS).
- **`xml2js`** is callback/legacy-Promise style, no native types, less active — skip.
- **`@xml-tools/parser`** produces a CST, useful for linting/language services; not the right shape for "XML → JS object → tree view". Skip.
- **Recommendation**: **`fast-xml-parser` (pin `^4.x`)**. Configure `attributesGroupName: null`, `prefix: '@'` (or `@_`), and `ignoreAttributes: false`; set `isArray` per-tag if needed so repeated children become arrays.

### 4. CSV — `papaparse` vs `csv-parse` vs `sheetjs`

| Lib | Browser-native | TS types | Bundle (approx) | BOM/delimiter/quotes | Round-trip | Activity |
|---|---|---|---|---|---|---|
| `papaparse` v5 | yes (built for browser) | `@types/papaparse` | ~45 KB / ~15 KB gzip | auto-detect delimiter, BOM-strip, quoted fields, streaming | yes (`Papa.unparse`) | stable, widely used |
| `csv-parse` (csv.js) v5 | sync build yes; stream build uses Node streams → avoid in browser | built-in | ~50 KB / ~18 KB | good, but config-heavy | yes (`stringify` companion pkg) | active |
| `sheetjs` (`xlsx`) | yes (CDN build) | ships types | ~600 KB min | strong on Excel binary (xlsx/xlsb), overkill for plain CSV | yes | the npm `xlsx` package is stale; SheetJS self-hosts current builds on their CDN |

- **`papaparse`** is the right fit for "paste from Excel": TSV and CSV with quoted fields and BOM are handled by its auto-detection, and `Papa.unparse` round-trips. Browser-native, no Node streams.
- **`csv-parse`** is excellent but its streaming flavor depends on Node `stream`, which would force polyfills in Vite. The `csv-parse/sync` build is browser-safe; still, `papaparse` is simpler for this UX.
- **`sheetjs`**: the npm `xlsx` package is no longer the current line (SheetJS moved to self-hosted distribution); pulling it in just for CSV paste would inflate the bundle ~600 KB. Reuse it only if the task also needs to read `.xlsx`/`.xlsb` binary — for paste-from-Excel text, `papaparse` wins.
- **Note**: The existing CSV preview already uses SheetJS (via `@file-viewer/preset-office`) for *rendering* — but that is a separate code path from a paste-and-parse feature in the JSON preview pane.
- **Recommendation**: **`papaparse` (pin `^5.x`) + `@types/papaparse`**. Output as `Record<string, string>[]` via `header: true`, then wrap in an outer object if the canonical shape must be an object (e.g. `{ rows: [...] }`).

### 5. Base64 — native `atob`/`btoa` vs `js-base64`

- **Native `atob`/`btoa`**: available in Tauri's Chromium runtime and any modern browser. **Gotcha**: they operate on byte strings, not Unicode — `btoa('中文')` throws `InvalidCharacterError`. The correct pattern is to go through UTF-8 bytes with `TextEncoder`/`TextDecoder`:
  - Decode (input → object): `const json = new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0))); JSON.parse(json);`
  - Encode (object → output): `const bytes = new TextEncoder().encode(JSON.stringify(obj)); const b64 = btoa(String.fromCharCode(...bytes));`
  - For large strings, spread-into-`fromCharCode` can hit call-stack limits; chunk the conversion in that case.
- **`js-base64`** (dankogai): ~5 KB, ships TS types v3+, handles UTF-8 internally (`Base64.encode('中文')` works out of the box). Convenience-only — no capability the native pattern lacks.
- **Recommendation**: **native `atob`/`btoa` + `TextEncoder`/`TextDecoder`**. Zero dependency, zero polyfill, sufficient for the round-trip requirement. Only reach for `js-base64` if you find the chunked-byte handling fiddly.

## Node built-in / polyfill risk

| Lib | Node built-ins? | Vite risk |
|---|---|---|
| `json5` | none | safe |
| `yaml` (eemeli) | none in browser build | safe |
| `js-yaml` v4 | none if you use `load`/`dump` (deprecated `safeLoad` aliases are fine too, but avoid) | safe |
| `fast-xml-parser` | none | safe |
| `xml2js` | none, but heavier | safe |
| `papaparse` | none | safe |
| `csv-parse` (sync build) | none; the stream build needs Node `stream` — do not import `csv-parse` (bare) in browser | import `csv-parse/sync` only if you choose this lib |
| `sheetjs` (`xlsx`) | none in browser build, but very heavy | safe but bloated |
| native `atob`/`btoa` | none | safe |

No library in the recommended set requires `fs`/`path`/`Buffer` polyfills.

## Summary table (recommended pick per category)

| Category | Recommended | Bundle (approx, min/gzip) | Browser-safe | TS types | Round-trip |
|---|---|---|---|---|---|
| JSON5 | `json5` ^3.0.0 | ~40 KB / ~15 KB | yes | built-in (3.x) | yes |
| YAML | `yaml` ^2.x | ~60 KB / ~20 KB | yes | built-in | yes |
| XML | `fast-xml-parser` ^4.x | ~45 KB / ~15 KB | yes | built-in (v4+) | yes (`XMLBuilder`) |
| CSV | `papaparse` ^5.x (+ `@types/papaparse`) | ~45 KB / ~15 KB | yes | via `@types` | yes (`unparse`) |
| Base64 | native `atob`/`btoa` + `TextEncoder`/`TextDecoder` | 0 | yes | built-in DOM lib | yes |
| JSON-escape string | native `JSON.parse` + `JSON.stringify` (unwrap outer quotes manually) | 0 | yes | built-in | yes |

Aggregate added bundle (min, approx): ~190 KB min / ~65 KB gzip across JSON5 + YAML + XML + CSV. None individually warrants code-splitting, but the spec's lazy-load pattern (`.trellis/spec/desktop/frontend/file-type-editors.md` §`@dbml/core`) is a sensible template if a parser is only touched when the user picks a specific input mode — i.e. dynamic-`import()` each format parser on first use.

## Caveats / not found

- **Bundle-size numbers are approximate** — they come from my training knowledge of these libraries, not a live Bundlephobia query, because the exa web-search MCP tools named in the task prompt (`mcp__exa__web_search_exa`, `mcp__exa__get_code_context_exa`) are not actually exposed in this environment. Confirm exact numbers via Bundlephobia / `pnpm why` / `vite-bundle-visualizer` before locking the spec.
- **`json5` 3.x exact publish date / security advisory status** — verify against the npm registry before pinning. If 3.x has any open advisory, fall back to `2.2.x` + `@types/json5`.
- **SheetJS current distribution** — the npm `xlsx` package is widely reported as stale; SheetJS self-hosts the current line on `cdn.sheetjs.com`. Confirm the project's stance on using it as a direct dep before choosing it for anything beyond the existing transitive use.
- **`fast-xml-parser` default prefix** — verify the exact default (`@_` for attributes, `#text` for text) for the version pinned, since these defaults have shifted between major versions.
- **CSV → canonical object shape** — the task says "all formats yield a plain JS object"; CSV naturally yields an *array* of records. Decide whether the canonical shape is `{ rows: Record<string,string>[] }` (object-wrapped) or whether the tree-view accepts arrays at the root. This is a design decision, not a library question.
