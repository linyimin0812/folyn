# Markdown Rendering Pipeline

> Unified pipeline that turns Markdown source into React nodes or HTML string. Covers math (MathJax), code, directives, and the contract between editor-side highlighting and renderer-side parsing.

---

## Scope

Applies to every site that renders Markdown in the desktop app:

- `components/file-types/markdown/MarkdownPreview.tsx` — primary preview pane
- `components/chat/MessageContent.tsx` — chat message bodies
- `services/exportService.ts` — HTML/PDF export
- `components/file-types/mmap/topicMarkdown.ts` — mind-map node text

All four call sites MUST go through the dual API in `services/markdown/renderMarkdown.ts`. No site hand-rolls its own `unified()` chain.

---

## Signatures

```typescript
// services/markdown/renderMarkdown.ts

interface MathRenderOptions {
  // future opts (image resolver, etc.) — currently empty
}

function renderMarkdownToReact(md: string, opts?: MathRenderOptions): ReactNode;
function renderMarkdownToHtml(md: string, opts?: MathRenderOptions): string;
function transformMathBrackets(md: string): string;     // \[..\] / \(..\) → $$..$$ / $..$
function unwrapInlineMath(md: string): string;          // collapse \n adjacent to inline math → space
function stripImageSizeSuffix(md: string): string;      // legacy compat: strip ` =WxH` from image URLs before remark-parse
function findMathSegments(md: string): MathSegment[];    // shared code-segment scanner
const MATHJAX_CONTAINER_CSS: string;                    // pinned font for SVG ex-unit
```

`renderMarkdownToHtml` is `renderToStaticMarkup(renderMarkdownToReact(md, opts))` — they share one pipeline, not two.

---

## Pipeline

```
md source
  → transformMathBrackets (string preprocessor)
  → unwrapInlineMath (collapse single \n adjacent to inline math → space)
  → stripImageSizeSuffix (legacy compat: strip ` =WxH` from image URLs)
  → unified()
      .use(remarkParse)
      .use(remarkMath)              // $..$ / $$..$$ → math nodes
      .use(remarkGfm, remarkBreaks, remarkDirective, remarkDirectiveRehype)
      .use(remarkRehype)
      .use(rehypeMathjax)            // math nodes → inline SVG (SYNC, self-contained)
      .use(rehypeStringify | rehypeReact)
  → ReactNode | HTML string
```

### Image resize writeback (MarkdownPreview-only)

Image resize via the drag handle writes width back to the source line as an HTML comment placed immediately after the image: `![alt](url)<!-- width=N -->`. The comment is valid CommonMark raw HTML, so other markdown compilers (GitHub, VSCode preview, …) ignore the comment and still render the image at natural size. `readSourceWidth` reads the comment first; for legacy notes that used the non-portable `![alt](url =WxH)` URL-suffix form, it falls back to that regex so old notes still apply their width until the user re-resizes (which migrates them to the comment form). `stripImageSizeSuffix` (above) strips ` =WxH` from the URL before remark-parse so legacy notes still render at all.

`processSync` is used. MathJax SVG output is generated at parse time, not via async `typesetPromise`.

---

## Contracts

### Math syntax recognized

| Syntax | Meaning | Handled by |
|--------|---------|-----------|
| `$...$` | inline math | remark-math |
| `$$...$$` | display math | remark-math |
| `\[...\]` | display math (LaTeX) | `transformMathBrackets` → `$$...$$` |
| `\(...\)` | inline math (LaTeX) | `transformMathBrackets` → `$...$` |
| `\$` | literal dollar | remark-parse backslash-escape |
| `\begin{env}...\end{env}` | AMS environments | MathJax (only inside `$...$` / `$$...$$`) |

Bare AMS environments outside `$$..$$` are NOT recognized as math. YAGNI — writers wrap in `$$`.

### Code-segment agreement (cross-layer contract)

`transformMathBrackets` (renderer) and `findMathSegments` (editor) MUST share the same scanner for "what counts as code" — both call `listSegments(md)` which marks fenced blocks and inline code spans as `code` and skips them verbatim. If a third caller needs math awareness, it MUST also use `listSegments`. Diverging scanners means editor highlight and preview render disagree on the same source.

### Export self-containment

Export HTML MUST inline MathJax output (SVG + scoped `<style>`). No CDN URLs, no `<link stylesheet>`, no font URLs. rehype-mathjax's SVG output is naturally self-contained — preserve this. Tests in `renderMarkdown.test.ts` assert absence of `cdn.jsdelivr`, font-URL patterns, and `<link stylesheet>` in exported HTML.

### Export math crispness (font pin)

MathJax v3 SVG emits `width="Xex"` / `height="Yex"` in CSS `ex` units. `1ex` is the surrounding font's x-height, so the SVG's display pixel size is font-dependent. The in-app preview loads 'Sora' from Google Fonts via `@import`; the standalone export only loads 'Sora' when opened online (the `@import` is captured by `collectAppCss`). Offline or blocked loads fall back to a system font with a different x-height → SVG renders at a different pixel size → subpixel anti-aliasing looks blurry.

`MATHJAX_CONTAINER_CSS` (exported from `services/markdown/renderMarkdown.ts`) pins `mjx-container` to a system-font stack + explicit `font-size` so `1ex` resolves consistently regardless of whether 'Sora' loads. `HTML_STYLES` in `services/exportService.ts` MUST embed `MATHJAX_CONTAINER_CSS`. Math content is vector path data — `font-family` only affects the SVG's display dimensions, not glyph shapes.

The same rule also fixes the 1x-DPI (non-Retina) blur (option B, landed 2026-08-13). With the font pin alone, the SVG viewBox (~814×1058 internal units) is rasterized to ~13×17 device pixels on a 1x screen — a 60x downsample that reads as blurry subpixel anti-aliasing. The fix is two CSS declarations: `font-size: 28px` on `mjx-container` (renders the SVG at ~26×34 CSS px → ~26×34 device px on a 1x screen, 4x the pixel count) and `zoom: 0.5` on `mjx-container svg` (collapses layout and paint back to the original ~13×17 visual size in one pass, so the SVG rasterizes at the pre-zoom 28px resolution and stays crisp). `shape-rendering: geometricPrecision` + `text-rendering: geometricPrecision` are retained as cheap rasterizer hints. `zoom` is Chromium-only — Tauri's webview and Chrome (the two export-HTML targets) are both Chromium, so this covers the real surfaces; Firefox/Safari ignore `zoom` and fall back to the 28px font-size rendering (larger but still crisp, no downsample). The non-Chromium upgrade path (transform: scale + inline-block wrapper with negative-margin compensation) is deliberately not built — reopens vertical-align and line-height compensation for zero current gain. Tests in `renderMarkdown.test.ts` assert the SVG uses `ex` units (documents the root cause), that `MATHJAX_CONTAINER_CSS` sets `font-family` + `font-size`, that the rule sets `shape-rendering` + `text-rendering` to `geometricPrecision`, and that the rule sets `font-size: 28px` + `zoom: 0.5` (the option-B fix).

### Streaming (chat)

Chat does NOT call `useEffect` to re-typeset math on content append. rehype-mathjax renders SVG at parse time, so the existing per-segment `useMemo([value])` cache in `MessageContent` re-parses the trailing (growing) text segment naturally. Do not add `typesetPromise`-based re-render — it's the wrong mental model for SVG output.

---

## Patterns

### Pattern: String-level preprocessing over micromark extension

**Problem**: remark-math doesn't recognize `\[..\]` / `\(..\)`. The "proper" fix is a custom micromark extension.

**Solution**: A ~30-line string-level preprocessor (`transformMathBrackets`) walks the doc, skips code regions verbatim (via shared `listSegments`), and replaces `\[..\]` → `$$..$$` / `\(..\)` → `$..$` on text segments only.

**Why**: micromark extensions are 200+ lines of state-machine definition for a syntax transformation that is a 6-line regex on text segments. The preprocessor is the smallest viable diff. Tradeoffs documented in a `ponytail:` comment.

### Pattern: Collapse `\n` adjacent to inline math (`unwrapInlineMath`)

**Problem**: `MarkdownPreview` uses `remark-breaks`, which converts soft `\n` to `<br>`. When the user writes inline math on its own line for source readability (`text\n$x^2$\ntext`), remark-breaks inserts `<br>` before and after the math, pushing it onto its own visual line. The user reports this as "inline math shouldn't directly line-break".

**Solution**: A ~30-line string-level preprocessor (`unwrapInlineMath`) runs after `transformMathBrackets`. It reuses `findMathSegments` (already code-aware, distinguishes inline vs display) to locate inline math segments, then collapses a single `\n` (with optional surrounding whitespace) immediately adjacent to an inline math segment into a single space. `\n\n` (paragraph break) is preserved; display math (`$$..$$` / `\[..\]`) is untouched.

**Why**: the user's source convention — writing inline math on its own line for editing clarity — is reasonable; the rendering should not punish it. A custom remark plugin walking mdast would be larger; the segment-based pass reuses the existing scanner and is ~30 lines. `renderMarkdownToReact` calls it internally; `MarkdownPreview.tsx` (which has its own pipeline) calls it explicitly. The fix is a no-op for callers that don't use `remark-breaks` — a `\n` that would collapse to a space anyway now collapses one step earlier.

### Pattern: Reuse MarkdownPreview for export via hidden DOM

**Problem**: `exportService` needs HTML with the same rendering as preview (math, code, directives, image resolution).

**Solution**: `renderMarkdownToHtmlViaDom` mounts `MarkdownPreview` in a hidden DOM container, lets React render, then captures `container.innerHTML` + `collectAppCss()`. The export path inherits all preview behavior (math, scoped CSS, image resolution) for free.

**Why**: Two HTML renderers (one for preview, one for export) would drift. The hidden-DOM approach makes them structurally identical.

---

## Gotchas

> **Warning**: `text \\[x\\] end` (markdown `\\` = literal backslash, writer meant `\` + `[x\]` text) is misread as `\[x\]` math by `transformMathBrackets`. Rare in prose. Accept the tradeoff; do not add a full LaTeX parser for this edge case.

> **Warning**: Editor and renderer can disagree on `\\$x$` — editor's `(?<!\\)` lookbehind in `findMathSegments` treats `\\$` as escaped (no highlight on following `$x$`), while remark-parse treats `\\` as literal `\` and renders `$x$` as math. Rare. Documented ceiling.

> **Warning**: MarkdownPreview's `<style>` filter uses `text.includes('mjx-')` heuristic to let MathJax's scoped CSS through. A user-authored raw `<style>` containing the substring `mjx-` would leak past. Threat model is local-first user markdown, not untrusted remote content; Tauri CSP already allows `unsafe-inline`. Accept.

---

## Don't

### Don't: Add a second `unified()` chain for math in chat/export

```typescript
// WRONG — chat hand-rolls its own math pipeline
useMemo(() => {
  return unified()
    .use(remarkParse)
    .use(remarkMath)
    .use(...)  // drift from MarkdownPreview's chain
    .processSync(value);
}, [value]);
```

**Why it's bad**: Two chains drift; math renders differently in chat vs preview; bugs reproduce in only one site.

**Instead**: Call `renderMarkdownToReact(value, opts)` from `services/markdown/renderMarkdown.ts`. The chain lives in one place.

### Don't: Use MathJax async `typesetPromise` for streaming re-render

```typescript
// WRONG — adding useEffect to re-typeset chat on append
useEffect(() => {
  MathJax.typesetPromise([ref.current]).then(...);
}, [value]);
```

**Why it's bad**: rehype-mathjax renders SVG at parse time (sync). `typesetPromise` is for runtime CHTML output, not the build-time SVG path used here. Adding it creates double-render flicker.

**Instead**: Trust `useMemo([value])` re-parse — the SVG comes out of the pipeline already rendered.

---

## Tests Required

- `services/markdown/renderMarkdown.test.ts` — pipeline behavior: inline/display math, `\[..\]`/`\(..\)`, AMS env, code-skip, `\$` escape, export self-containment (asserts no `cdn.jsdelivr` / font URL / `<link stylesheet>`)
- `editor/extensions/MarkdownMathExtension.test.ts` — token classes for `$..$` / `$$..$$` / `\[..\]` / `\(..\)`, code-skip (fenced + inline), `\$` not treated as math open, decoration updates on doc change

Assertion points:
- `transformMathBrackets` skips fenced code blocks (line starts with `` ``` ``)
- `transformMathBrackets` skips inline code spans (between backticks)
- `transformMathBrackets` does NOT touch `\$` (remark-parse handles)
- `unwrapInlineMath` collapses single `\n` adjacent to inline math into a space, preserves `\n\n` paragraph breaks, leaves display math alone, skips code regions
- With `remark-breaks` in the pipeline, inline math on its own line (`text\n$x$\ntext`) produces no `<br>` adjacent to `<mjx-container>`
- Exported HTML has zero `cdn.jsdelivr`, zero `https://fonts.gstatic`, zero `<link rel="stylesheet"`
- `findMathSegments` and `transformMathBrackets` agree on code-vs-text boundaries for the same source

---

## Wrong vs Correct

### Wrong

```typescript
// chat/MessageContent.tsx — hand-rolled unified chain
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';
// ... 6 more imports

const render = (value: string) =>
  unified()
    .use(remarkParse)
    .use(remarkMath)
    .use(remarkRehype)
    .use(rehypeMathjax)
    .use(rehypeStringify)
    .processSync(value).result;
```

### Correct

```typescript
// chat/MessageContent.tsx — uses shared pipeline
import { renderMarkdownToReact } from '@/services/markdown/renderMarkdown';

// ponytail: renderMarkdownToReact is sync (processSync) and MathJax SVG
// output is self-contained — no useEffect re-typeset needed for streaming.
const render = (value: string) => renderMarkdownToReact(value, { ... });
```

---

## Related

- `desktop/frontend/file-type-editors.md` — how file types register editors
- `desktop/frontend/component-guidelines.md` — component composition patterns
