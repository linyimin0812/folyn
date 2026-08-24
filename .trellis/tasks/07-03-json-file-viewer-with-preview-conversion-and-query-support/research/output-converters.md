# Research: Output Converters (JSON object → XLSX / YAML / XML / Base64 / Lang-specific serializers)

- **Query**: Best JS/TS libraries for converting a parsed JS object to multiple output formats in a Tauri Vite + React 18 + TS browser environment
- **Scope**: external (library selection) + internal (repo state check)
- **Date**: 2026-07-03
- **Environment constraint**: No web-search tool was available to this agent. Library facts below come from training knowledge (mid-2024). **Re-verify bundle sizes, current versions, and security advisories on npm before pinning.** Internal repo facts were verified directly.

## Internal Repo State (verified)

`/Users/yiminlin/project/mochi/apps/desktop/package.json` already pulls in:
- `@codemirror/lang-json`, `@codemirror/language`, `@codemirror/view`, `@codemirror/autocomplete`, `@codemirror/lint`, `@codemirror/search` — JSON editor already wired
- `@tauri-apps/plugin-clipboard-manager` — clipboard plugin present (relevant for Base64/escape auto-copy)
- `highlight.js`, `diff` (v9) — for diff view / syntax highlight
- `@file-viewer/preset-office`, `@file-viewer/react` — office viewer preset (XLSX preview side, not authoring)
- No XLSX / YAML / XML / quicktype / Base64 libraries are currently declared.

CSV handler pattern (template to mirror for JSON): `apps/desktop/src/components/file-types/csv/index.ts` + `CsvFileViewerPreview.tsx`.

---

## 1. Excel (.xlsx) — single-header + multi-header

### Comparison

| Library | Browser? | Real .xlsx? | Multi-row headers? | Bundle (min+gzip, approx) | Notes / risks |
|---|---|---|---|---|---|
| **`exceljs`** | Yes (with `ExcelJSBrowser`/`buffer` API) | Yes (OOXML) | Yes — native merged cells, `worksheet.getRow(1/2).values`, `cell.merge` | ~250–350 KB gzip; full lib ~1.2 MB | Heaviest. Most featureful. Ships Node + browser bundles; you must import from `exceljs` browser entry. No native ESM/types-first story until v4.x; works but verbose. |
| **`xlsx` (SheetJS community)** | Yes | Yes | Possible but manual (must call `sheet_to_json` with `header:1` then write `aoa_to_sheet` with header rows concatenated) | ~150–250 KB gzip, ~600 KB raw | SheetJS community edition (npm `xlsx`) is **outdated on npm** (0.18.5). Maintainer moved latest releases behind CDN `https://cdn.sheetjs.com/xlsx-0.20.x/`. npm version has known CVEs (prototype pollution via `sheetjs` < 0.20). Use the CDN distro or pick `exceljs`. |
| **`write-excel-file`** | Yes | Yes (writes OOXML directly) | Limited — supports simple schema, not full multi-row merged headers out of the box | ~30–60 KB gzip (very small) | Opinionated schema-driven API (`writeXlsx(items, schema)`). Great for flat single-header output. Awkward for arbitrary nested JSON with multi-row headers — you'd fight the schema. |
| **`exceljs-lite`** | Not a real package | — | — | — | No widely-trusted package named `exceljs-lite` exists on npm. **Do not assume; skip.** (Could be a typo for `exceljs` or a near-empty placeholder.) |

### Recommendation
- **For real multi-row merged headers from arbitrary nested JSON: `exceljs`** despite the bundle. It supports `worksheet.mergeCells`, `getRow(n).values = [...]`, column widths, styles, and `xlsx.writeBuffer()` returns a `Promise<Buffer>`/`ArrayBuffer` usable from Tauri `writeFile`.
- **For single-header-only fast path if bundle is a hard cap: `write-excel-file`** (~30 KB) — but only if you accept its schema-driven model and fall back to `exceljs` for multi-header cases. Carrying both is wasteful.
- **Avoid SheetJS npm `xlsx` 0.18.5** due to advisories and stale npm distribution; if SheetJS is desired, install from `https://cdn.sheetjs.com` per their docs (adds Vite config complexity).

### Multi-header pattern sketch (exceljs)
```ts
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Sheet1');
// Row 1: top-level group labels; Row 2: leaf keys
ws.getRow(1).values = ['id', 'name', ...]; // flat case: identical to row 2
ws.getRow(2).values = ['id', 'first', 'last', ...];
// Merge for grouped columns:
ws.mergeCells('B1:C1'); // 'name' spans first/last
const buf = await wb.xlsx.writeBuffer();
```

### Bundle sanity
`exceljs` raw is heavy. With Vite, tree-shaking does NOT cut much (Workbook pulls in most of the lib). Expect ~250–350 KB gzip added to the desktop chunk. Acceptable for a desktop Tauri app; would be painful for a public web bundle.

---

## 2. YAML output

### Comparison

| Library | Stringify quality | Streaming? | ESM | Bundle | Notes |
|---|---|---|---|---|---|
| **`yaml`** (eemegayam) | Excellent — `stringify(obj, opts)`, preserves comments when round-tripping with `doc`, supports anchors, tags, custom schemas | Yes (parse-stream) | Native ESM + CJS, full TS types | ~30–40 KB gzip | Best modern choice. Pairs with `YAML.parse` for the input side. |
| **`js-yaml`** | Good — `dump(obj, opts)`, but **drops comments** and doesn't preserve node identity | Yes | CJS-first; ESM via `*` import shim | ~25–35 KB gzip | Battle-tested, older API. No comment round-trip. |

### Recommendation
- Use **`yaml`** on both sides (parse input + stringify output) so a single dependency handles YAML round-trip. Confirm stringify quality: `YAML.stringify(obj, { lineWidth: 0, nullStr: 'null', flowLevel: -1 })` produces clean, deterministic output.
- If PRD picks `js-yaml` for parsing (e.g. to mirror an existing codebase), its `dump` is acceptable for output too — keep one lib.

---

## 3. XML output

### Comparison

| Library | Builder? | Attributes? | Browser? | Bundle | Quality from arbitrary JSON |
|---|---|---|---|---|---|
| **`fast-xml-parser`** | Yes — `XMLBuilder.build(obj)` | Yes — via `@_attr` prefix convention | Yes | ~25–35 KB gzip | Best. Same lib can parse XML input (pairs with PRD). Builder supports `attributeGroupName`, `format: true` for pretty-print, `suppressEmptyNode: false`. |
| **`xmlbuilder2`** | Yes — `create(obj).end({ format: 'object', prettyPrint })` | Yes — `$` prefix convention by default | Yes | ~40–60 KB gzip | Solid, more object-oriented API. Heavier. |
| **`json2xml`** | Yes | Limited | Yes | ~2–5 KB | Tiny but crude: no attribute convention control, brittle with arrays, no pretty-print in some forks. Not recommended for arbitrary nested JSON. |

### Recommendation
- Use **`fast-xml-parser`** — it already serves the XML *input* parse step, so reusing the `XMLBuilder` halves the dependency surface. Produces clean, configurable XML; attributes supported via `@_attr` (default) or a custom prefix.
- Caveat: arbitrary JSON → XML needs a convention decision (e.g. arrays produce repeated elements named after the parent's singular key). Document that convention in the spec; there is no "obviously correct" mapping.

---

## 4. Base64 output (Unicode-safe)

### Comparison

| Approach | Unicode-safe? | Bundle | Notes |
|---|---|---|---|
| **Native `btoa` + `TextEncoder`** | Yes, with the standard trick: `btoa(String.fromCharCode(...new TextEncoder().encode(str)))` | 0 | No dep, but the trick is easy to get wrong (`btoa(unescape(encodeURIComponent(str)))` is the legacy form; `TextEncoder`+`btoa` is preferred). Decoding mirror: `new TextDecoder().decode(Uint8Array.from(atob(s), c=>c.charCodeAt(0)))`. |
| **`js-base64`** | Yes — `Base64.encode(str)` is Unicode-safe by default | ~3–5 KB | Convenient, handles UTF-8 internally, has TS types. |

### Recommendation
- **Prefer a small helper around native `TextEncoder`/`TextDecoder` + `btoa`/`atob`** — zero bundle cost, already runs in Tauri WebView. Wrap in a `toBase64(str)`/`fromBase64(str)` util so the UTF-8 dance is centralized and tested.
- Pull in `js-base64` only if you want its URL-safe variant, streaming, or test ergonomics; for a single encode/decode call site it's not worth the dep.

### Unicode-safe helper (canonical pattern)
```ts
export function toBase64Utf8(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach(b => (bin += String.fromCharCode(b)));
  return btoa(bin);
}
export function fromBase64Utf8(b64: string): string {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
```

---

## 5. Language-specific JSON serializers (Python / Go / Rust / Java / PHP / C#)

### What's actually being asked
"Language-specific serialization from a JS object" means producing source code (or a string literal) in language X that, when evaluated in X, yields the equivalent object — e.g. Python `{'k': 'v'}` dict syntax, Go `map[string]any`, Rust `serde_json::json!({...})`, Java `Map.of(...)`, PHP associative array, C# `new Dictionary<string, object>` or `JsonSerializer.Deserialize<JsonElement>(...)`.

This is **not** a serialization library problem — there is no widely-used library that emits idiomatic Python/Go/Rust/Java literals from a JS object. It is a **templating / code-generation** problem.

### Candidates checked

| Tool | What it actually generates | Fit |
|---|---|---|
| **`quicktype`** (npm `quicktype`, CLI / programmatic `quicktype-core`) | **Type definitions + JSON (de)serialization code** in many languages (TS/Go/Rust/Swift/C#/Java/Python/Kotlin/...). Inputs: JSON sample or JSON Schema. Outputs: classes/structs with `fromJson`/`toJson` per language. | Wrong shape: you get **types + a parser/serializer for the language to consume at runtime**, not a literal of *the specific object* you fed in. The output is per-schema, not per-value. Useful if PRD wants "given this JSON, generate Go/Rust/Python struct definitions + a serializer" — that is a codegen feature, distinct from "emit this object as a Python dict literal". |
| **`json-to-python` / `json2go` / assorted GitHub gists** | Per-language one-off converters; inconsistent quality, maintenance, types. | Not recommended as deps. |

### Recommendation
- **Use template strings** for language-specific literal output. Each language gets a small recursive emitter (~30–80 lines) that walks the JS value and writes that language's literal syntax. This is the standard approach used by tools like `json2ts`, `quicktype`'s "literal mode" (which doesn't exist), and many online converters.
- **Consider `quicktype` separately** if and only if the PRD also wants **type definition generation** (e.g. "infer a Go struct / Rust struct from this JSON"). In that case, `quicktype` is the right tool — it's a codegen dependency (~hundreds of KB, ships its own compiler) and should live in a lazy-loaded worker chunk because it's heavy.
- **Decision rule for the PRD**:
  - If capability #8 means "show me what this JSON looks like as a Python dict / Go map / Rust `json!()` / Java `Map.of` literal" → **template strings**, no dep.
  - If capability #8 means "generate typed structs/classes in target language from this JSON sample" → **`quicktype` (lazy-loaded)**, and split into its own sub-task.

### Caveat
`quicktype`'s npm package is large and the API is stringly-typed; integrating it into a Tauri webview requires care (it's designed as a CLI). The `quicktype-core` subpackage exposes programmatic entry but the type surface is awkward. Recommend not committing to it without a spike.

---

## Consolidated Recommendations

| Output target | Pick | Bundle impact | Rationale |
|---|---|---|---|
| `.xlsx` (single + multi header) | `exceljs` | ~250–350 KB gzip | Only library that cleanly supports merged multi-row headers from arbitrary nested JSON. |
| `.yaml` | `yaml` (reuse parse lib) | ~30 KB gzip | Single lib for round-trip; modern ESM + TS. |
| `.xml` | `fast-xml-parser` (reuse parse lib) | ~25 KB gzip | Builder + parser in one; attribute support. |
| Base64 | Native `TextEncoder`+`btoa` helper | 0 | Unicode-safe, no dep. |
| Lang-specific JSON literals | Template-string emitters per language | ~0 | No dep; quicktype is overkill unless type-def codegen is explicitly in scope. |

## Flags / Risks

- **SheetJS `xlsx` on npm (0.18.5) has security advisories**; latest is shipped via the SheetJS CDN only. Do not blindly `npm i xlsx`.
- **`exceljs`** pulls a large chunk that Vite cannot tree-shake well; budget for it or lazy-load the converter module.
- **`write-excel-file`** is small but schema-driven; does not satisfy the multi-header requirement without awkward workarounds.
- **No `exceljs-lite` package** of any repute — ignore.
- **`quicktype`** is a codegen compiler, not a serializer; do not adopt it for per-value literal output. Only adopt for type-def generation (separate scope).
- **XML mapping from arbitrary JSON is convention-dependent** — fix the convention in the spec (array element naming, attribute prefix, null handling) before implementing.

## Caveats / Not Found

- Exact bundle sizes and current versions **not verified online** in this research pass (no web-search tool available to this agent). Re-confirm via `pnpm view <pkg> versions` / `bundlephobia` before pinning in `apps/desktop/package.json`.
- Security advisories: re-check via `pnpm audit` and the GitHub Advisory Database once dependencies are added; this research did not enumerate every CVE.
- No internal existing implementation of any converter was found (the JSON file-type handler does not exist yet — only CSV).
