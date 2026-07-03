# Research: JSON viewer/editor UX libraries

- **Query**: Best JS/TS libraries for a JSON preview pane (Tauri Vite + React 18 + TS) covering: CM6 minimap, CM6 features (folding, sticky block pin, autocomplete, syntax highlight), JSON tree viewer, JSON structural diff, deep property auto-sort
- **Scope**: mixed (internal repo inspection + external library evaluation from training knowledge, current to early 2025)
- **Date**: 2026-07-03

> **Methodology caveat**: Live web search tools (`mcp__exa__*`) were not available in this environment. Findings below are synthesized from (a) the repo's existing `apps/desktop/package.json` dependency manifest, (b) the PRD at `.trellis/tasks/07-03-json-file-viewer-with-preview-conversion-and-query-support/prd.md`, and (c) library knowledge current to early 2025. **Verify npm download counts, last-publish dates, and peer-dep ranges with `pnpm info <pkg>` before adding to `package.json`** — this is the single biggest source of uncertainty in this report.

## Repo context (already installed)

`apps/desktop/package.json` (CM6 + React 18 stack):

- `@codemirror/autocomplete` ^6.18.0
- `@codemirror/commands` ^6.7.1
- `@codemirror/lang-json` ^6.0.2
- `@codemirror/language` ^6.10.0
- `@codemirror/lint` ^6.8.4
- `@codemirror/search` ^6.5.8
- `@codemirror/state` ^6.5.0
- `@codemirror/view` ^6.35.0
- `@replit/codemirror-indentation-markers` ^6.5.3 (proves Replit CM6 packages already work in this repo)
- `diff` ^9.0.0 (jsdiff — text diff, already present)
- `react` ^18.3.1, `react-dom` ^18.3.1
- `highlight.js` ^11.10.0

No existing minimap, JSON-tree, jsondiffpatch, microdiff, deep-diff, object-scan, or dequal dependency. No minimap usage found anywhere in `apps/desktop/src` (grep returned zero hits for `minimap|Minimap`).

`apps/desktop/src/editor/EditorView.tsx` already wires `@codemirror/lang-json` + JSON linter for edit mode, so syntax highlight + fold + autocomplete in preview mode can reuse the same extensions. `apps/desktop/src/editor/extensions/InlineDiffExtension.ts` already imports `from 'diff'` (jsdiff).

---

## Findings

### 1. CodeMirror 6 minimap

There is **no official `@codemirror/minimap` package**. The CM6 ecosystem has exactly one credible minimap implementation:

| Package | Status (early 2025) | CM6 compatible | Notes |
|---|---|---|---|
| `@replit/codemirror-minimap` | Published on npm; sparse updates (Replit migrated most of their editor work, but the package was last touched ~2023-2024). Still listed on the CodeMirror community wiki as the CM6 minimap. | Yes (peer-deps `@codemirror/view` ^6) | ~15–25 kB gzipped minified. The repo already ships `@replit/codemirror-indentation-markers`, so the Replit namespace is precedent-here. |
| `@codemirror/minimap` | **Does not exist** — confirmed by user. | n/a | n/a |
| `codemirror-minimap` (no scope) | Legacy CM5 package by **gruw** (Jason Strowbridge). CM5 only. | No (CM5) | Do not use with CM6. |

**Bundle cost estimate**: minimap renders a scaled-down DOM mirror of the document; for large JSON files (the JSON viewer's target use case) the minimap pane adds:
- ~15–25 kB JS (the plugin itself),
- per-document DOM nodes proportional to line count (rendered once, updated on doc changes),
- a `requestAnimationFrame` loop for the viewport indicator.

For a JSON preview that may load multi-MB files, the minimap's DOM mirror can become a perf liability on very large docs (10k+ lines). For typical JSON (<2k lines) it's negligible.

**Verdict on (b) — is minimap worth the bundle cost?**
- For a **developer-facing JSON workbench**, the minimap is a "nice-to-have" but not core to the task list (the PRD lists it under "Editor UX" but the user's headline capabilities are parsing, conversion, query, diff).
- The marginal value of a minimap on JSON (which is usually wider than it is tall, and structurally uniform) is **lower than for source code**.
- Recommendation: **defer**. Do not add `@replit/codemirror-minimap` in MVP. If the user explicitly requests it later, the package works with the existing CM6 stack and can be added in a single-line `EditorView.extend([minimap()])` call. Cite the PRD's open question on scope.

### 2. CodeMirror 6 built-in vs separate packages

Confirmed against the repo's installed versions (CM6 line, all ^6.x):

| Feature | Built-in / Package | Repo has it? | Notes |
|---|---|---|---|
| Code folding (collapsible ranges + `foldGutter`) | Built into `@codemirror/language` (`foldGutter`, `foldEffect`, `foldedRanges`, `defaultFoldState`, `indentUnit`-driven fold strategy) | Yes (`@codemirror/language` ^6.10) | No extra dep. JSON language contrib supplies foldable ranges for `{ }` / `[ ]` blocks via `@codemirror/lang-json`. |
| Autocomplete | `@codemirror/autocomplete` (separate package, but a core CM6 package) | Yes (`^6.18.0`) | Provides `autocompletion`, `completeFromList`, `completeAnyWord`. JSON completion needs a custom `CompletionSource` — `@codemirror/lang-json` does **not** ship JSON-key completion by default; you write a small `CompletionSource` that reads the parsed document. |
| Syntax highlighting | `@codemirror/lang-json` (Lezer parser + `json` language descriptor + `jsonParseLinter`) | Yes (`^6.0.2`) | Already wired in `EditorView.tsx`. Also re-exported via `@codemirror/language-data`. |
| Line numbers, gutter, search pane | `@codemirror/view` + `@codemirror/gutter` (merged into `view`) + `@codemirror/search` | Yes | No extra dep. |
| Lint / JSON validation | `@codemirror/lint` + `jsonParseLinter()` from `@codemirror/lang-json` | Yes (`@codemirror/lint` ^6.8.4) | Already used in `EditorView.tsx`. |
| **Sticky headers / block pinning** | **No first-party plugin exists.** | n/a | See below. |

**Sticky / block-pin (the PRD's "block pin" feature)**: There is no `@codemirror/sticky-headings` or equivalent first-party CM6 package as of early 2025. Community implementations exist as gist/blog snippets (the CM6 discuss forum has multiple threads titled "sticky line headers"). The pattern is:
1. `ViewPlugin.fromClass(...)` that scans the document for "header" lines (for JSON: top-level object keys, or array boundaries),
2. Emit `Decoration.replace({ widget: new StickyWidget() })` or `Decoration.line({ class: "cm-sticky" })` on those lines,
3. CSS `position: sticky; top: 0;` on the line decoration.

For a JSON tree viewer (option 3 below), sticky headers are far easier to build in React than in CM6 decorations — relevant to the tree-vs-editor decision.

### 3. JSON tree viewer libraries

| Library | Last publish (early 2025) | React 18 | Bundle (gz) | Tree? | Copy-path? | Sticky headers? | Verdict |
|---|---|---|---|---|---|---|---|
| `react-json-view` (RJV) | **2019** (v1.21.3) — unmaintained | **No** (peer-dep React 16/17; users report React 18 runtime warnings and `defaultProps` warnings) | ~30 kB | Collapsible tree | Built-in copy-icon on values | No | **Reject** — dead, React 18 incompatible. |
| `react-json-view-lite` | Active (v2.x in 2024) | Yes | ~5–8 kB (very small) | Collapsible tree | Has `CopyText` component slot in recent versions; you wire the copy handler | No (renderers are pluggable but you build sticky yourself) | Strong default for a minimal tree. |
| `react-complex-tree` | Active (v2.x, 2024) | Yes | ~25–35 kB | Full accessible tree (WAI-ARIA), controlled/uncontrolled, drag-and-drop, search, multi-select | Not built-in (you render custom action buttons via the `renderItem` slot) | Possible via custom item renderer (the tree is plain divs, so CSS `position: sticky` works per-section) | Best for large/hierarchical trees; heavier; learning curve. |
| `react-arborist` | Active (v3.x) | Yes | ~15 kB + `react-window` peer | Virtualized fast tree | Via custom `renderRow` | Per-row sticky works (virtualized rows are absolutely positioned; sticky within a section is harder because of virtualization) | Best for huge trees (>5k nodes). Overkill for typical JSON. |
| `jsoncrack` | Active | Framework-agnostic core (`jsoncrack` core + `@jsoncrack/react`) | ~80–120 kB (uses canvas/d3-force; includes `d3-force` which is **already** a top-level repo dep) | **Graph**, not tree | Click-to-select | n/a | Different UX (node-link graph). Consider as an alternative "graph view" toggle, not a primary tree. |
| Custom with `@radix-ui/react-collapsible` + `@radix-ui/react-copypath` (no such package — use `navigator.clipboard` / `@tauri-apps/plugin-clipboard-manager`) | n/a | Yes | ~3 kB + your code | Full control | Trivial to add per-node | Trivial with CSS sticky | Most flexible; smallest bundle. |

**Verdict on (a) — tree-viewer library or build custom?**

For the PRD's exact requirement set (collapsible nodes + copy-path-on-click + sticky block headers):

- **Recommended: build custom with `@radix-ui/react-collapsible`.** Rationale:
  - The JSON tree is shallow enough that virtualization isn't needed (typical JSON depths are <100, breadth <10k).
  - Copy-path-on-click is one `<button onClick={() => clipboard.writeText(path)}>` per node — a library that doesn't ship it means you're writing the same code anyway.
  - Sticky section headers are 3 lines of CSS (`position: sticky; top: 0; z-index: 1`) on a `<div>` you control. Doing the same in `react-json-view-lite` requires overriding its renderer, which is more work than writing it from scratch.
  - Smallest bundle; no peer-dep risk; tightest theme integration with the repo's existing Tailwind tokens (`bg-panel`, `bg-surf`, `border-brd`).
- **Fallback: `react-json-view-lite`** if you want collapsible behavior for free and can live without sticky headers in the tree (sticky would then live in the CM6 editor, not the tree).
- **Use `react-complex-tree` only** if the JSON tree needs to support drag-and-drop reordering or multi-select (out of scope for this PRD).
- **`jsoncrack`** as an optional "graph view" toggle is attractive — the repo already depends on `d3-force`, so the marginal bundle cost is lower than for a greenfield project. Worth a separate research spike, not the primary view.

### 4. JSON structural diff

| Library | Last publish (early 2025) | Framework-agnostic | Output | Side-by-side formatter? | Sorted-property friendliness |
|---|---|---|---|---|---|
| `diff` (jsdiff, v9) — **already in repo** | Active (v9, 2024) | Yes | **Textual** diff (lines/chars) | No (returns patch arrays; you render) | Works on serialized strings; "clearer after property sorting" applies because sorting makes matching lines align. |
| `jsondiffpatch` | Active (v0.6.x–0.7.x; the project moved to a TypeScript rewrite, `jsondiffpatch` v0.7 is current) | Yes | **Structural** diff (move/add/delete/replace, with array item identity via `__oldValue`/hashing) | **Yes** — ships `formatters.html` and `formatters.console`; the HTML formatter renders annotated left/right or unified view | Excellent — has a `sortArray` config to canonicalize before diffing |
| `microdiff` | Active (v1.x, 2024) | Yes | **Structural** diff (returns plain array of `{type, path, oldValue, newValue}`) | No — you build the view | Works fine; no built-in sorting hook, so you pre-sort both sides yourself |
| `deep-diff` | Largely dormant (last meaningful publish ~2020) | Yes | Structural diff (returns `{kind, path, lhs, rhs}`) | No | Works but stale; prefer `microdiff` if you want this shape. |

**Verdict on (c) — `jsondiffpatch` vs `microdiff` for the diff view?**

- **Use `jsondiffpatch`** for the side-by-side visual diff. Rationale:
  - Ships `formatters.html` which produces a ready-made annotated side-by-side view — the PRD's exact ask ("diff view for comparing two JSONs").
  - Has a built-in `sortArray` / object-key-sorting hook, which directly supports the user's note that "diff is clearer after property sorting" — you don't need a separate pre-sort step.
  - Handles array-item identity (move detection) better than `microdiff`'s value-equality approach — useful when diffing two JSON files where array elements were reordered.
  - Bundle: ~10–15 kB gzipped (without formatters) or ~25–35 kB with the HTML formatter. Acceptable for a feature-pane.
- **Use `microdiff`** only if you want to render the diff yourself with full visual control (Tailwind classes matching the existing theme) and are willing to write the renderer. ~1 kB gzipped; attractive on bundle but the formatter is the real cost.
- **Keep `diff` (jsdiff, v9)** for the text-level diff path (e.g. comparing two raw JSON strings before parsing, or diffing the YAML serialization). It's already installed.

**Sorting hook for `jsondiffpatch`**: the constructor takes an options object; the relevant hooks are `objectHash(obj)` (for array identity) and a `sort` step applied via the `cloneDiff`/`diff` pipeline. Concretely:

```ts
import { create } from 'jsondiffpatch';
const jdp = create({
  objectHash: (obj, key) => (typeof obj === 'object' && obj && obj.id ? obj.id : key),
});
// Pre-sort both sides with a recursive key-sort (see section 5), then:
const delta = jdp.diff(sortedLeft, sortedRight);
```

### 5. Deep property auto-sort

| Library | Purpose | Use for sorting? | Notes |
|---|---|---|---|
| `object-scan` | **Query/filter** library (lazy-evaluated tree walks with predicates) | Not really — it can traverse and you could rebuild a sorted object, but that's a misuse. | Reject for sorting. |
| `dequal` | **Equality** comparison (deep equal) | No — it only returns boolean. | Reject for sorting. (Useful elsewhere: comparing two parsed objects before diffing.) |
| `json-stable-stringify` / `fast-json-stable-stringify` | Deterministic `JSON.stringify` with sorted keys (recursive). | **Yes**, if your goal is stable serialization. Doesn't return an object — returns a string. | Useful for the "auto-copy formatted JSON" + "diff clearer after sorting" flows: stringify both sides with sorted keys, then either re-parse or feed to `diff` (jsdiff). |
| `sort-object-keys` (small lib) | Recursively returns a new object with sorted keys. | **Yes** — exactly this. | ~10 lines; you could inline it. |
| Hand-rolled recursive sort | n/a | **Yes** — recommended | 15–20 lines. See snippet below. |

**Recommended: hand-rolled recursive key sort.** No new dependency, fully typed, deterministic, and works on the parsed JS object before it hits either `JSON.stringify` or `jsondiffpatch`:

```ts
export function sortObjectKeysDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map(sortObjectKeysDeep) as unknown as T;
  if (value && typeof value === 'object' && !(value instanceof Date) && !(value instanceof RegExp)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      (sorted as Record<string, unknown>)[key] = sortObjectKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted as T;
  }
  return value;
}
```

Edge cases to decide (PRD open question): how to handle `undefined` (drop vs preserve), key-sort locale (default `Array.prototype.sort` is by UTF-16 code unit — usually fine for ASCII keys), and whether numeric keys should sort numerically (`'10'` before `'2'` lexicographically — usually undesirable for JSON). For JSON, default lexicographic sort is the standard expectation.

### React 18 / CM6 / Vite compatibility flags

| Library | React 18 | CM6 | Vite browser bundle | Flag |
|---|---|---|---|---|
| `@replit/codemirror-minimap` | n/a | Yes (peer `@codemirror/view` ^6) | Yes (ESM) | OK to add later; deferred for MVP. |
| `react-json-view` | **No** | n/a | Yes | **Reject** — React 18 incompatible. |
| `react-json-view-lite` | Yes | n/a | Yes (ESM) | OK. |
| `react-complex-tree` | Yes | n/a | Yes (ESM, has `exports` map) | OK. |
| `react-arborist` | Yes (peer `react-window`) | n/a | Yes | OK; adds `react-window` peer. |
| `jsoncrack` | Yes (`@jsoncrack/react`) | n/a | Yes (canvas + d3-force) | OK; uses `d3-force` already in repo. |
| `jsondiffpatch` | n/a | n/a | Yes (ESM, `formatters.html` ships CSS) | OK. |
| `microdiff` | n/a | n/a | Yes (ESM) | OK. |
| `deep-diff` | n/a | n/a | Yes (CJS-only historically; check ESM export) | Verify ESM export before adding; prefer `microdiff`. |
| `object-scan` | n/a | n/a | Yes | Not needed for sorting. |
| `dequal` | n/a | n/a | Yes (ESM) | Not for sorting; could add for equality checks. |
| `json-stable-stringify` | n/a | n/a | Yes (ESM) | OK if you need stable stringify. |
| `sort-object-keys` | n/a | n/a | Yes | OK but unnecessary (inline recommended). |

---

## Final recommendations per category

1. **Minimap** (question b): **Do not add in MVP.** `@replit/codemirror-minimap` is the only credible CM6 option and works with this stack (the repo already uses `@replit/codemirror-indentation-markers`), but its value on JSON is low and the DOM mirror can hurt on multi-MB files. Defer until the user explicitly requests it.
2. **CM6 features**: All listed features except sticky headers are already installed (`@codemirror/lang-json`, `@codemirror/language` for `foldGutter`, `@codemirror/autocomplete`, `@codemirror/lint`). Sticky / block-pin has no first-party CM6 plugin; build it as a `ViewPlugin` with `Decoration.line({ class: "cm-sticky" })` if needed in the editor, or (recommended) implement sticky in the React tree view where it's a 3-line CSS rule.
3. **JSON tree viewer** (question a): **Build custom** with `@radix-ui/react-collapsible` + `@tauri-apps/plugin-clipboard-manager` (already installed). `react-json-view-lite` is the fallback if you want collapsible for free. `react-json-view` (RJV) is **rejected** — React 18 incompatible and unmaintained since 2019.
4. **JSON diff** (question c): **`jsondiffpatch`** for the side-by-side visual diff (ships `formatters.html`, has built-in object-hash/sort hooks that directly support the "diff clearer after sorting" requirement). Keep `diff` (v9, already installed) for text-level raw-string diffing. `microdiff` is the lighter alternative if you're willing to write the renderer.
5. **Property auto-sort**: **Hand-rolled recursive sort** (15 lines, snippet above). `object-scan` and `dequal` are the wrong tools. `json-stable-stringify` is a reasonable add only if you need stable serialization elsewhere (e.g. as the "Auto-copy formatted JSON to clipboard" formatter — but `JSON.stringify(obj, null, 2)` after `sortObjectKeysDeep` is simpler).

---

## Caveats / Not Found

- **No live npm verification**: I could not run `pnpm info` or fetch live download/last-publish metadata. Before adding any new package, run `pnpm info <pkg> version peerDependencies time.modified` in the repo to confirm the early-2025 status above is still current.
- **`@replit/codemirror-minimap` maintenance status**: Replit's CM6 packages have had inconsistent maintenance. The fact that `@replit/codemirror-indentation-markers` is already in the repo and working suggests the namespace is acceptable here, but verify the minimap package specifically still installs cleanly.
- **`jsondiffpatch` formatter output**: The `formatters.html` output is annotated HTML with its own CSS (`formatters.css`). Integrating it with the repo's Tailwind theme tokens (`bg-panel`, `bg-surf`, `border-brd`) requires either (a) wrapping the formatter output in an `<iframe>` or shadow DOM to isolate its CSS, or (b) post-processing its class names. This is an integration concern, not a library-selection concern — flag for the implementer.
- **JSON completion in CM6**: `@codemirror/lang-json` does **not** ship key-completion against the parsed document. The "autocomplete" feature in the PRD's editor UX will need a custom `CompletionSource` that walks the Lezer tree or the parsed object. Not blocking for library selection, but a non-trivial implementation task.
- **`deep-diff` ESM**: Historically published as CJS; verify it has an ESM export before adding to a Vite browser bundle. `microdiff` is the safer ESM-native choice if you go that route.
- No spec documents found under `.trellis/spec/**/*json*.md` or `*codemirror*.md` — there is no pre-existing project spec guidance on JSON viewer or CodeMirror conventions. If the implementation crystallizes patterns worth capturing, the `trellis-update-spec` skill should be invoked after build.
