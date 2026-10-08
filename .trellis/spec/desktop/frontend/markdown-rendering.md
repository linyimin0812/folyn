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

Image resize via the drag handle writes width back to the source line as an HTML comment placed immediately after the image: `![alt](url)<!-- width=N -->`. The comment is valid CommonMark raw HTML, so other markdown compilers (GitHub, VSCode preview, …) ignore the comment and still render the image at natural size. `readSourceWidth` reads the comment; `applyImageSize` strips any existing comment before writing the new value (or none, on clear). No legacy `=WxH` URL-suffix form is supported — that syntax was not portable CommonMark.

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

### Pattern: Show unknown raw-HTML tags as literal text (`rehypeShowRawTags`)

**Problem**: `rehypeRaw` (MarkdownPreview-only pipeline) parses raw HTML into real hast elements, so a machine-oriented marker like `<workflow-state>…</workflow-state>` renders as an invisible DOM custom element — the tag itself vanishes, only inner text shows.

**Solution**: `rehypeShowRawTags` (components/file-types/markdown/rehypeShowRawTags.ts) runs immediately AFTER `rehypeRaw` and BEFORE `rehypeHighlight`/`rehypeMathjax`. Any element whose tagName is neither a known HTML/SVG tag nor in `extraKnownTags` is spliced open: `[text("<tag attrs>"), ...children, text("</tag>")]` — tags become literal text, children keep normal rendering. Newlines render as `<br>` both inside the spliced content AND between sibling spliced tags (any level that spliced converts its direct text-child `\n`). Safe because after remark-breaks no markdown text node contains `\n` (every `\n` came from raw HTML) and code text is nested in `pre>code`, never a direct child.

**Contract**:

- `MarkdownPreview.tsx` passes `extraKnownTags: Object.keys(componentMap)` — container directives (`:::name` → `<name>`, remark-directive-rehype) are mapped to React components by tagName in `previewComponentMap`, so ALL componentMap keys MUST be in extraKnownTags or the directive structure is destroyed (regression: cursor-sync tabs tests fail on `[data-hides-inactive]` = null).
- `mjx-container` is emitted by `rehypeMathjax` AFTER this plugin — never whitelisted, never affected. Do not move this plugin after `rehypeMathjax`.
- `style`/`script` filtering stays at React level (previewComponentMap) — only known tags, unaffected.
- Unregistered directive names have no component → render as literal text (same rule as raw HTML).
- Content INSIDE an unknown tag renders as RAW SOURCE (inner markdown like `**bold**` stays literal): the transformer reads the vfile (`file.value` = the exact preprocessed string passed to `processSync` — positions and value index the same string) and splices `src.slice(firstChild.position.start.offset, lastChild.position.end.offset)`. Fallback (no vfile / missing offsets): recursive rendering. extraKnownTags elements never take this path.
- TWO-STAGE design: blank lines inside an unknown-tag region terminate CommonMark HTML blocks (inner markdown parses as separate root nodes), so a hast-only pass can't reach it. Stage 1 `remarkCollapseUnknownTagRuns` (right after remarkParse, same extraKnownTags) walks ROOT children: an html node that is a lone open tag (single-line OR first line of a multi-line node) triggers a forward scan for the same-name close — a lone close-tag `html` node, OR a PARAGRAPH whose trailing inline html child is that close tag (type-7 closes CANNOT interrupt a paragraph, so `tag close directly after a paragraph line` parses as INLINE html; missing this case left the element open to EOF and stage 2 synthesized a stray close at the doc end). The run becomes ONE paragraph of raw source (vfile slice; text + break children, blank lines preserved; position spanning open-start→close-end for the blank-gap contract). Stage 2 (hast) handles no-blank-line blocks, inline tags, unmatched tags. Self-contained single-node regions are scanned but find no close → stage 2.
- STYLING (uniform): root-level unknown-tag regions — from EITHER stage — render as `p.md-raw-tag-block` (stage 2 wraps the spliced run in a positioned `p`; stage 1's collapsed paragraph is a `p` too), so blank-line and no-blank-line regions look identical. Inline/nested tags use `span.md-raw-tag`. The classes are INERT hooks — visual styling was tried and removed (用户觉得不好看); plain text rendering. If styling returns, add CSS next to the `.md-preview` rules in `index.css` using theme vars (`--font-mono`, `--surf`, `--brd`, `--acc`) so dark mode works.
- CURSOR-SYNC LAYOUT: `.md-preview .md-raw-tag-block { line-height: var(--md-gap-line, 1.6em) }` (index.css, next to `.md-blank-gap`) — one source line per text line/br at the editor's measured line height, so the region's rendered height equals its editor line span. Same rate mechanism as the blank-line gaps.
- CURSOR-SYNC MAPPING (data-raw-line-span): the rehype plugin stamps `data-raw-line-span = end.line - start.line + 1` on root `p.md-raw-tag-block` (position-derived walk covers BOTH stages' output — do NOT stamp via stage-1 mdast `hProperties`: rehypeRaw's property round-trip renames `data-*` to camelCase `dataRawLineSpan` and the attr is lost). `usePreviewCursorSync.ts` reads it and, for such blocks ONLY: `lastSrcLine = blockSrcLine + span - 1` (the generic `blockLastSrcLine` blank-run scan terminates at the region's first INTERNAL blank → a mid-region cursor misdetected as "in gap" and the preview jumped past the whole region; same override in the container-promotion `tClose` check), and `alignPoint = blockOffset + clamp(cursorLine - blockSrcLine, 0, span-1) * (blockHeight / span)` — per-line exact, no editor metrics (the editor parser is directive- AND raw-tag-blind, so its block measurements mis-cover the region). Inline `span.md-raw-tag` is inside a normal paragraph — the enclosing paragraph's generic mapping covers it. Tests: `rehypeShowRawTags.test.ts` span assertions, `MarkdownPreview.cursorsync.test.tsx` mid-region cursor stays inside the block.
- The spliced open/close text nodes carry the source element's `position` — `rehypeBlankGap` advances `prevEndLine` for ANY positioned root node (not just `BLOCK_TAGS` elements), so raw-HTML blocks' source lines count as content, not blank lines (otherwise a tag block before a heading produced a large blank band in sync view).
- Known-tags whitelist (HTML + common SVG) lives in the plugin; parse5 ignores the self-closing slash on non-void tags, so `<foo/>` arrives as an OPEN tag absorbing trailing inline content — render what the parser saw, do not re-synthesize the slash.

**Why**: Smallest viable diff at tree level; no new dependency (hast-util-to-html), no source-regex preprocessing (code-block context makes that fragile). Tests: `rehypeShowRawTags.test.ts` (splice structure, br parity, attrs, nested, code-block untouched, extraKnownTags).

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
