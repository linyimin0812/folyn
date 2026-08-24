# HTML Visual Editor Corrupts SVG `<defs><style>` and Duplicates `<pre>` Content

## Goal

Fix GrapesJS round-trip corruption that strikes when a user opens an `.html` file containing inline SVG with internal `<defs><style>` blocks (or `<pre><code>` blocks) and switches to the visual editor. Two independent serialization bugs cause (a) the canvas to render SVG shapes with default black fill, and (b) the source file content to be silently rewritten with lost CSS and duplicated `<pre>` content. The user's file is corrupted on disk after a single round-trip.

## What I already know

### Symptoms (observed in `~/folyn/default_vault/state-dataflow.html`)

1. **SVG renders black in visual editor** — every `<rect class="hook">` / `<rect class="fn">` loses its `fill:#eff6ff` / `fill:#faf5ff` rule and falls back to SVG's default black fill.
2. **Source file auto-changes** the moment the user switches to visual editor:
   - The SVG's `<defs><style>` block (defining `.hook`, `.fn`, `.file`, `.ok`, `.lbl`, `.sm`, `.mono` and their `T` variants) is **gone** after one round-trip.
   - The `<pre><code>{ session_id, ... }</code></pre>` block content is **duplicated ~10 times** in the file body.
   - The original `<style>` block in `<head>` is rewritten as GrapesJS's expanded `getCss()` output (e.g. `font: 14px/1.5 ...` becomes ~30 individual `font-*` longhands). This expansion is ugly but semantically faithful — not the corruption bug, just noise.

### Root cause (verified)

- `parseHtmlForGrapes` (`grapesContentPipeline.ts:56`) only extracts `<style>` blocks that are **direct children of `<head>`**. The SVG's `<defs><style>` is inside `<body>` (inside `<svg>`), so it's left in `bodyContent` as raw HTML.
- `editor.setComponents(parsed.bodyContent)` parses the body. GrapesJS's component model does **not** preserve `<style>` elements inside `<svg><defs>` — they're stripped during parsing.
- After 500ms debounce, `scheduleContentExtraction` calls `editor.getHtml()` + `editor.getCss()`, and `reconstructHtml` writes the result back via `onChange`. The serialized HTML **lacks** the SVG `<defs><style>`, and `<pre>` content is duplicated.
- `HtmlVisualEditor.tsx:22-25` propagates `onChange` up to the store, which writes the corrupted content to `activeTab.content`. On save, the corrupted content hits disk.
- `GrapesEditor` is mount-once (`useGrapesEditor` `useEffect(... [])`) — it does NOT re-read `content` after mount, so the in-memory editor keeps the original parse. But the file is already corrupted by the first debounce tick.

### Verified NOT the cause (for visual editor dark)

- **Visual editor dark is NOT a color-scheme issue.** Devtools confirmed the visual editor's iframe `html`/`body` computed bg is `rgb(255,255,255)`, `color-scheme: light`. The visual editor dark is SVG default black fill (SVG `<defs><style>` lost in GrapesJS round-trip).
- **Preview dark IS a color-scheme issue** (separate, fixed earlier via `HtmlPreview.tsx` onLoad style injection — kept). The preview iframe inherits color-scheme from the parent app (dark theme), making the canvas dark. Transparent-bg SVG areas render dark. The injection forces `color-scheme: light` on the iframe document.
- **Not GrapesJS injecting dark CSS.** Grepped `grapes.min.css` / `grapes.min.js` — no `color-scheme`, no dark canvas-bg injection.

### Relevant files

- `apps/desktop/src/components/file-types/html/grapesContentPipeline.ts` — `parseHtmlForGrapes`, `reconstructHtml`
- `apps/desktop/src/components/file-types/html/useGrapesEditor.ts` — `editor.setComponents` / `editor.setStyle` calls + `scheduleContentExtraction` debounce
- `apps/desktop/src/components/file-types/html/HtmlVisualEditor.tsx` — `handleChange` propagates to store
- `apps/desktop/src/components/file-types/html/grapesConfig.ts` — `injectExternalLinks`, `injectCanvasScrollbarHide`
- `apps/desktop/src/components/file-types/html/GrapesEditor.tsx` — React shell

## Open Questions

* `<pre>` duplication root cause — needs implementation-time repro (write a minimal `setComponents('<pre><code>x</code></pre>')` test, observe `getHtml()`). Not yet known whether GrapesJS duplicates at parse or serialize stage. Will be investigated in Phase 2 before settling the `<pre>` fix approach.

## Requirements

* Visual editor must render SVG with its original `<defs><style>` class rules (rects fill correctly).
* Round-trip through the visual editor must NOT modify the file when the user makes no edits (idempotent parse → serialize).
* Round-trip must NOT lose SVG-internal `<style>` rules (they may migrate to head `<style>` per Approach B, but the rules themselves must survive).
* Round-trip must NOT duplicate `<pre><code>` (or any) content.
* MVP fixes **both** bugs (user-confirmed).
* MVP covers edge cases: multiple SVGs in one file, multiple `<style>` blocks in one `<defs>`, `<style>` directly inside `<svg>` (not in `<defs>`), `<pre>` with nested `<span>`/`<code>`, empty `<pre>`.

## Acceptance Criteria

* [ ] Opening `state-dataflow.html` in visual editor renders the SVG diagram with light-blue/purple/orange fills matching the preview tab.
* [ ] Switching to visual editor then back to source shows no content loss (SVG classes survive, `<pre>` content not duplicated) when the user made no edits.
* [ ] `<pre><code>` content appears exactly once after round-trip.
* [ ] Pipeline test: HTML with 2 SVGs each with own `<defs><style>` round-trips with all class rules preserved in head `<style>`.
* [ ] Pipeline test: `<pre><code>...<span>x</span>...</code></pre>` round-trips without duplication.
* [ ] Pipeline test: empty `<pre></pre>` survives.
* [ ] Pipeline test: `<style>` directly inside `<svg>` (not in `<defs>`) is extracted to head.

## Acceptance Criteria (evolving)

* [ ] Opening `state-dataflow.html` in visual editor renders the SVG diagram with light-blue/purple/orange fills matching the preview tab.
* [ ] Switching to visual editor then back to source shows no diff (file content unchanged) when the user made no edits.
* [ ] `<pre><code>` content appears exactly once after round-trip.

## Definition of Done

* Tests added for `parseHtmlForGrapes` + `reconstructHtml` covering: SVG `<defs><style>` preservation, `<pre><code>` non-duplication, idempotent round-trip.
* Lint / typecheck / CI green.
* Manual test with `state-dataflow.html` confirms visual editor matches preview.

## Decision (ADR-lite)

### Bug 1: SVG `<defs><style>` extraction (Approach B)

**Context**: GrapesJS's component model drops `<style>` inside SVG `<defs>` during `editor.setComponents()`. The styles never reach CssComposer, so the canvas renders SVG rects with default black fill and the serialized output loses the rules entirely.

**Decision**: Approach B — extract SVG-internal `<style>` blocks in `parseHtmlForGrapes`, append them to `styleBlocks` (alongside the existing head `<style>` extraction). `editor.setStyle()` then injects them into the canvas; `editor.getCss()` serializes them back. SVG `<defs>` loses its `<style>` after round-trip, but the rules live in the head `<style>` block — semantically equivalent (SVG `<defs><style>` is global, not scoped to the SVG).

**Consequences**: 
- Pro: Minimal diff to `grapesContentPipeline.ts`. Reuses existing `styleBlocks` plumbing.
- Pro: Correct canvas render (SVG classes work).
- Con: File structure changes on first save — SVG `<defs><style>` migrates to head `<style>`. One-time churn for existing files.

### Bug 2: Body double-wrap strip

**Context**: `editor.getHtml()` returns `<body>...</body>`, but `reconstructHtml` wrapped it in another `<body>...</body>`, producing `<body><body>...</body></body>`. On re-parse, DOMParser hoisted the inner body out (bodies can't nest), splicing its contents into the outer body — duplicating every element on each round-trip.

**Decision**: Strip the grapesHtml `<body>` wrapper in `reconstructHtml` before re-wrapping with the document's `<body>` tag.

**Consequences**:
- Pro: One-line regex strip. Eliminates exponential content growth.
- Con: None observed.

### Bug 3: GrapesJS CssComposer drops `var()` from shorthand declarations

**Context**: Discovered after Bugs 1+2 were fixed and the user reported visual editor still mismatched preview. GrapesJS's CSS parser silently drops `var()` from shorthand declarations — e.g. `body { background: var(--bg); }` becomes a body rule with NO background declaration. Only longhand-with-var (like `color: var(--ink)`) survives. The browser's native CSS parser handles var() in shorthands correctly.

**Decision**: Bypass GrapesJS's CssComposer for both rendering and serialization:
- `injectInlineStyles` (new) — appends user's `styleBlocks` verbatim as a `<style data-folyn="inline-styles">` tag in the canvas iframe head, AFTER GrapesJS's CSS. Browser parses correctly.
- `reconstructHtml` serializes CSS from `parsed.styleBlocks` (original) instead of `editor.getCss()` (broken).

**Consequences**:
- Pro: Canvas rendering matches browser/preview.
- Pro: File save preserves original CSS verbatim (no var() loss).
- Con: Style Manager edits to existing class rules do NOT persist on save (CssComposer is bypassed for serialization). Inline-style edits via the canvas still round-trip normally. Documented as `ponytail:` known limitation; proper fix would merge `editor.getCss()` edits into `parsed.styleBlocks` — deferred.

## Technical Approach

### SVG `<defs><style>` — Approach B (extract & flatten to head)

In `parseHtmlForGrapes` (`grapesContentPipeline.ts`):
- After existing head `<style>` extraction, iterate `doc.querySelectorAll('svg style')`
- For each: append `textContent` to `styleBlocks`, remove the element from its parent
- This means `bodyContent` (passed to `editor.setComponents`) no longer contains SVG-internal `<style>` — GrapesJS can't drop what it never sees
- `editor.setStyle(parsed.styleBlocks.join('\n'))` already runs in `useGrapesEditor` — no change needed there
- `reconstructHtml` already merges `styleBlocks` into the head `<style>` via the existing AT_RULE_RE / mergedCss logic — verify regular class rules survive the round-trip (they should via `grapesCss`)

Edge cases handled by `querySelectorAll('svg style')`:
- Multiple SVGs, multiple `<defs><style>` per SVG, `<style>` directly in `<svg>` (not in `<defs>`) — all matched and extracted

### `<pre>` duplication — investigate first, then fix

Phase 2 step 1: write a minimal integration test in `grapesIntegration.test.ts`:
```ts
editor.setComponents('<pre><code>line1\nline2</code></pre>');
const html = editor.getHtml();
// expect html to contain '<pre>' exactly once
```

Three possible fix shapes depending on root cause:
- **If GrapesJS duplicates at parse** (component tree has duplicate text nodes): pre-process — replace `<pre>` content with a placeholder before `setComponents`, restore in `getHtml()` output
- **If GrapesJS duplicates at serialize** (component tree is clean, serializer emits twice): post-process `editor.getHtml()` output to dedupe
- **If GrapesJS treats `<pre>` as a known-void or text-only**: register a custom component type via `editor.DomComponents.addType('pre', ...)`

Will pick the smallest fix that passes the test.

## Implementation Plan

* **PR1**: SVG `<defs><style>` extraction in `parseHtmlForGrapes` + pipeline tests for all edge cases. Independent of `<pre>` fix.
* **PR2**: `<pre>` duplication investigation test + fix. Depends on root cause found in Phase 2.

## Out of Scope (explicit)

* Fixing the `font: 14px/1.5` → `font-*` longhand expansion (cosmetic, semantically faithful).
* Reworking GrapesJS's component model to natively handle SVG `<style>` (out of our control).
* The earlier color-scheme fix to `HtmlPreview.tsx` (already kept — preview is fixed separately).

## Technical Notes

### Why the SVG `<style>` is lost

`editor.setComponents()` walks the body HTML and builds a GrapesJS component tree. SVG `<style>` elements inside `<defs>` are not modeled as style-bearing components — they're treated as unknown SVG children and dropped on serialize.

### Why `<pre>` gets duplicated

Hypothesis (to verify): GrapesJS parses `<pre><code>...</code></pre>` and during serialization re-emits the inner content at multiple nesting levels. Could be a whitespace-handling issue in `getHtml()`. Need to test minimal repro.

### Candidate fix shape (to discuss)

- **Option A**: Extract SVG-internal `<style>` in `parseHtmlForGrapes`, append to `styleBlocks`, re-inject on `reconstructHtml` into the SVG's `<defs>` (or as a head `<style>`).
- **Option B**: Bypass GrapesJS parsing for SVG-heavy files entirely — treat them as source-only.
- **Option C**: Pre/post-process around `editor.getHtml()` to stitch SVG `<defs><style>` back from the original parse.

## Research References

(none yet)
