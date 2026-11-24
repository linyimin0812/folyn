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

EXCEPTION (as old as the pipeline itself): `MarkdownPreview.tsx` runs a RICHER chain — it needs the preview-only concerns (`rehypeBlankGap` cursor-sync gaps, `rehypeHighlight` code coloring, the directive/raw-HTML component map, `rehypeSourceLine` stamps, frontmatter). That chain now lives in `components/file-types/markdown/markdownPipeline.ts` (`buildMarkdownPipeline(opts)` / `renderMarkdownBody(md, opts)`) and is the single source for BOTH the full-document render and the per-chunk windowed render (see the chunked/full parity contract). Do not add a third chain; do not inline the chain back into the component.

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

```typescript
// components/file-types/markdown/markdownPipeline.ts — MarkdownPreview's richer chain

interface MarkdownPipelineOptions {
  componentMap: Record<string, React.ComponentType<any>>;
  sourceLineOffset: number;                             // frontmatter line count → doc-absolute data-source-line
  blankGap?: { offset: number; totalLines?: number };    // per-chunk gap config; omitted → no gaps
}

function buildMarkdownPipeline(opts: MarkdownPipelineOptions): Processor; // the shared chain
function renderMarkdownBody(md: string, opts: MarkdownPipelineOptions): React.ReactElement;
```

```typescript
// components/file-types/markdown/chunkMarkdown.ts

interface MarkdownChunk { startLine: number; lineCount: number; blankLinesAfter: number }
interface ChunkedMarkdown { chunks: MarkdownChunk[]; hasReferenceDefinitions: boolean }

function chunkMarkdown(body: string): ChunkedMarkdown;  // O(lines); boundaries only on real blank runs

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

### Chunked/full render parity (large docs)

`MarkdownPreview` splits large bodies into blank-line chunks (`chunkMarkdown.ts`) and renders each chunk through the SAME pipeline (`markdownPipeline.ts`), padding each chunk with `\n` × (startLine − 1) so parser positions are body-absolute, then passing `sourceLineOffset: frontmatterLineCount` so `data-source-line` stamps are doc-absolute. The contract:

- The top-level child sequence of a chunked render and a full render must carry the SAME tagged blocks with the SAME doc-absolute `data-source-line` values, in order, with no content dropped or duplicated. This is what cursor-sync block queries, gap compensation, word selection and writeback walk — they must not be able to tell the modes apart.
- Chunk children are hoisted as DIRECT children of `.md-preview` (no wrapper DOM). Unmounted chunks render as inert `div.md-chunk-spacer[data-md-chunk]` (no `data-source-line`, `aria-hidden`, height = last measured or line-arithmetic estimate). Spacers are invisible to every consumer that queries blocks or gaps.
- Static `.md-blank-gap` heights may DIVERGE between modes exactly where the full render's arithmetic cannot see unpositioned nodes (mjx-containers, invisible link reference definitions, raw-tag fallback splices with an empty component map): the full render overcounts those lines as blanks; the per-chunk arithmetic counts the real blanks (the chunker knows the spanning regions). No consumer reads static gap heights — runtime gap compensation (`planGapHeights`) pins every following block to the editor's line grid in both modes. A doc whose last chunk renders only unpositioned content (trailing display math) has no trailing EOF gap in chunked mode; the cursor-past-EOF extension then works on the last present gap after the last stamped block.
- Link reference definitions resolve document-wide in CommonMark — per-chunk parses cannot see them — so any doc with a reference definition NEVER chunks (`chunkDoc.hasReferenceDefinitions` opt-out; conservative Phase A call).
- Chunking activates only above BOTH thresholds (> 200 chunks AND body > 100 KB) — below them the render path is byte-identical to the historical single pass.

`fullRender?: boolean` (default false) forces the full single-pass render above the thresholds. `exportService.renderMarkdownToHtmlViaDom` and `PresentationOverlay` MUST pass `fullRender: true` — export extracts innerHTML after settle (spacers would export as empty divs) and presentation mounts the whole doc for its own scrolling. Live preview panes stay windowed.

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

**Why**: Two HTML renderers (one for preview, one for export) would drift. The hidden-DOM approach makes them structurally identical. It renders with `fullRender: true` (see the chunked/full parity contract — windowed spacers must never reach exported HTML).

### Pattern: Chunked windowed rendering for large markdown docs

**Problem**: Opening a 500 KB markdown doc parsed + reconciled the whole document at once — a multi-hundred-ms parse and a full DOM mount of ~15k elements dominated first-open latency (the markdown-large-file-open-lag report).

**Solution**: Four pieces, all under `components/file-types/markdown/`:

- `chunkMarkdown.ts` — O(lines) line scanner producing chunks that tile the body exactly (`startLine`, `lineCount`, `blankLinesAfter`, `hasReferenceDefinitions`). Chunk boundaries only ever sit on a real blank-line run, never inside a construct that spans blanks (fenced code, display math, HTML block runs, lists with loose items, tables, link reference definitions). An HTML block run is opened by a bare tag line (`^<tag` alone, attributes on the following lines) exactly like a complete `<tag …>` line — a multi-line raw-HTML tag is never split across chunks.
- `markdownPipeline.ts` — the exact plugin chain MarkdownPreview used to inline, extracted into `buildMarkdownPipeline(opts)` / `renderMarkdownBody(md, opts)` so full and chunked renders share ONE chain and can never diverge. This is NOT `services/markdown/renderMarkdown.ts` (the simpler shared chat/export chain without rehypeBlankGap/highlight/componentMap) — two chains remain, as they always were, but each is single-sourced.
- `useWindowedChunks.ts` — mounts chunks near the viewport (binary-search chunk-for-line, OVERSCAN 2 chunks/600px, one rAF recompute per mount change for convergence, scroll events coalesced to one recompute per frame). ALWAYS mounts the last chunk (EOF gap + scroll height). Zero-measured containers (jsdom, hidden) degrade to mounting all. `ensureChunkMountedForLine(docLine)` is the cursor-sync bridge and returns `true` when it staged a mount: a cursor line in an inter-chunk blank gap (a line that belongs to no chunk — `findChunkForLine` misses) mounts BOTH neighbor chunks via `chunksToMountForLine` (exported pure function) so the sync's target scan always finds a block at or around the cursor. `mountVersion` re-triggers the sync effect after the mount commits. Measured chunk heights live in a map keyed by chunk IDENTITY (`startLine` + text — the same key the per-chunk element cache uses) and are pruned during render when the chunk array changes: an in-place edit drops only the edited chunk's measurement (its spacer falls back to the line-arithmetic estimate on that render) and keeps every unchanged chunk's measured height. The old design — index-keyed map cleared in a `useEffect([chunks])` AFTER the render — kept the edited chunk's stale height through the render (wrong spacer) and reset ALL unmounted spacer geometry on every debounced parse flush while typing.
- Per-chunk output cache in `MarkdownPreview` keyed by render-affecting inputs (component-map key, frontmatter, sync mode, gap offset/totalLines, startLine) with the chunk text stored for verification — typing re-parses only the chunks whose text or position changed.
- `usePreviewCursorSync.ts` request gate — the sync effect re-runs on EVERY `mountVersion` bump (the window changes constantly while the READER scrolls). A completed request whose inputs (cursor line + viewport metrics, editor lineHeight, selection, parsed content, sync-target) are unchanged is a NO-OP: the reader's scroll position survives window churn. (Before the gate, every mount-only re-run re-asserted the alignment — with the cursor's chunks unmounted the target scan found nothing and jumped the preview to the top.) A request whose mount is still pending (staged by `ensureChunkMountedForLine`) writes NO scroll/highlight and retries on the next `mountVersion` against committed DOM — no alignment against stale DOM. The `restoringScroll`/hidden guards run BEFORE the mount bridge: during PreviewPane's scroll-restore hold a cursor move mounts nothing (otherwise mount → rAF unmount → mount… ran as a frame-rate loop).
- `usePreviewCursorSync.ts` drift correction — a mountVersion-only re-run of a COMPLETED request corrects by the aligned block's CONTENT-SPACE drift (`rect.top − container.top + scrollTop`, a scroll-invariant: reader scrolling never changes it, spacer→chunk swaps above do). `scrollTop += drift` restores the aligned screen position without re-running the alignment — the reader who scrolled away is NOT snapped back (their drift measures 0; a reader far past the target has it unmounted → skipped), and off-screen mounts no longer make their content jump (the correction doubles as scroll anchoring). The anchor re-bases to the post-correction offset (the drift moved the block's content position permanently; keeping the old anchor over-corrects cumulatively). `requestRef` records the aligned element + its content offset + its post-write screen top; the correction skips when the element is disconnected/hidden, and — the SCREEN gate — when the screen position is already steady (content-space drift with a steady screen top means the browser's NATIVE CSS scroll anchoring compensated the same shift in the same layout pass; correcting on top of it double-compensates, one visible jump per mounted chunk). The pre-mount band makes this correction a rarely-firing SAFETY NET (coverage gaps: tall viewports over the cap, wrap under-estimates) rather than the primary mechanism — the user-visible flicker (闪动) of a correction chain was the report that motivated the pre-mount.
- `useWindowedChunks.ts` pre-mount band, JUMP-gated — `ensureChunkMountedForLine(docLine)` stages the cursor's chunks, and — only when the anchor chunk (the one at/after the cursor line, where the sync's alignment target lives) is NOT yet mounted, i.e. a real jump — the whole post-alignment band around them: ±(min(viewport,1200) + 600)×1.5 ESTIMATE-space px. The alignment writes scrollTop and lands the viewport on a region whose chunks are still never-measured estimate spacers; the window walk mounts them a frame later and every estimate→real swap shifts everything below — the just-written alignment breaks and corrections hard-jump scrollTop to restore it, visibly (闪动). Pre-mounting the band first means the swaps happen BEFORE the alignment reads geometry: it lands on final geometry, nothing moves after, and the scroll arrives at real content instead of spacer blankness popping in. The walk trims the band's excess on its next run (measured heights are identity-cached — the trim's swaps are height-neutral). The jump gate exists because the sync effect re-runs on every input change (every keystroke, every editor-scroll frame) while the walk's trim keeps removing the band's excess between runs — unconditional staging re-mounts ~70 chunks at keystroke rate (the reported 变卡). With a mounted anchor (typing, small scrolls) the targets alone suffice: geometry above is measured or height-cached, and residual swaps fall to the drift correction / native scroll anchoring. Estimate-space coverage under-covers when real heights run SHORTER than estimates (extreme soft-wrap compression) — those residuals fall to the drift correction.
- `useWindowedChunks.ts` pinning — the chunks `ensureChunkMountedForLine` last resolved (the cursor's chunk + its gap successor, ≤2) are PINNED and survive every window rotation, like the last chunk. A window walk that read pre-correction rects (or pre-scroll rects) must not unmount the sync's drift-anchor block: once unmounted, the anchor element is dead — the remounted block is a different node and the correction goes permanently blind (observed in the windowed suite as alignment drifting to +200 px and sticking). Costs ≤2 chunks of memory; the pin re-resolves by LINE on every recompute so re-chunking can't strand stale indices.

**Why**: no wrapper DOM (direct children keep every DOM walker's contract), no post-hoc stamping pass (padding + offset make stamps come out doc-absolute), shared pipeline (parity by construction). Measured on a 500 KB synthetic doc: chunking 2.1 ms; first-window (40 chunks) render 146 ms vs 517 ms for the full single pass — plus the DOM-mount savings jsdom cannot measure.

---

## Gotchas

### Preview block margins are coupled to `.md-blank-gap`

Top-level flow blocks (`p`, `ul`/`ol`, `table`, `pre`/`.code-block-wrapper`,
`blockquote`, callout) all use `margin: 0 0 1em`. In split mode
`rehypeBlankGap` inserts `.md-blank-gap` between blocks, and its
`margin: -1em 0 0` cancels the preceding block's bottom margin so the gap
alone defines the inter-block space (the editor's descent rate). Changing a
block's bottom margin without changing the gap's negative margin (or vice
versa) shifts every synced block. `:first-child` gap keeps `margin-top: 0`
(nothing above to cancel). Headings keep their own top margin — runtime gap
compensation (`gapCompensation.ts`) measures and absorbs it.

Chunked spacers join this contract: `.md-preview > .md-chunk-spacer` uses the
same `margin: -1em 0 0` (and `:first-child { margin-top: 0 }`) so a
spacer↔chunk mount/unmount swap at the same position does not shift the
content below it by 1em.

Code blocks with a fence language render a `.code-block-header` (label +
actions) above `.code-block-inner`. Cursor sync is unaffected: both the
wrapper and its inner `<pre>` carry the same `data-source-line`, the selection
loop picks the later (`<pre>`) element, and `codeBlockAlignPoint` measures the
`<pre>` rect — so the header sits outside the measured block. The 420px cap
lives on `.code-block-inner` only, so the header is never clipped.

Reading-surface tokens `--doc-bg` / `--doc-fill` / `--doc-line` exist only for
the reading surface. `.doc-surface` is applied by every editor host: the
EditorPane body (ALL file types, incl. VersionHistoryContentView), the markdown
PreviewPane `.prev-body`, the knowledge `TopicReader` root `.kb-reader` (reading
and edit views share it), and the extension file view (`fileViewCapability.tsx`
editor wrapper + markdown `.prev-body`; non-markdown previews stay unstyled);
`exportService.ts` `LIGHT_THEME_VARS` / `DARK_THEME_VARS` must define them too.

### Preview double-click word selection

`MarkdownPreview` installs `installPreviewWordSelection(root)` from
`previewWordSelection.ts`; the returned cleanup removes all listeners and the
pending animation frame. Only left-button mousedown with `detail === 2` on
preview text is intercepted; ordinary drag selection, triple clicks, and
interactive controls retain native behavior.

Do not use `Range.expand('word')` here: captured WKWebView selections expanded
to a bare newline, painted as a full-width highlight. Resolve the glyph under
the pointer using `caretRangeFromPoint` and the preceding glyph's rectangles,
then use `Intl.Segmenter` word boundaries. A caret on a glyph's right half sits
after that glyph; segmenting its offset directly can choose the next word or
whitespace. Inline formatting shares word boundaries; nested blocks and `br`
separate them. Ranges must stay inside the owning preview.

Hold the word through `selectionchange` until the animation frame after
mouseup/dblclick: native selection changes can run after event dispatch.
Release on the next mousedown, blur, and unmount. Regression coverage lives in
`MarkdownPreview.selection.test.tsx` (logged newline expansion and lifecycle)
and the task's `selection-browser.mjs` (actual WebKit/Chromium glyph hit testing
and double clicks). jsdom cannot verify browser layout or physical input.

> **Warning**: `text \\[x\\] end` (markdown `\\` = literal backslash, writer meant `\` + `[x\]` text) is misread as `\[x\]` math by `transformMathBrackets`. Rare in prose. Accept the tradeoff; do not add a full LaTeX parser for this edge case.

> **Warning**: Editor and renderer can disagree on `\\$x$` — editor's `(?<!\\)` lookbehind in `findMathSegments` treats `\\$` as escaped (no highlight on following `$x$`), while remark-parse treats `\\` as literal `\` and renders `$x$` as math. Rare. Documented ceiling.

> **Warning**: The editor's math highlight and fold service scan a bounded WINDOW, not the whole doc (per-keystroke whole-doc materialization was the large-file keystroke-lag root cause). The highlighter scans the view's visible ranges (viewport-scoped decorations — off-viewport math is unhighlighted until scrolled in); the fold service scans the run (maximal block of non-blank lines) around the queried line and gates on the cursor's line before any string materialization. The SAME `findMathSegments` scanner runs on the window slice — the code-segment agreement contract holds per window. Ceilings: display math containing a blank line is not matched across the gap (the renderer splits it into two blocks anyway — micromark math flow ends at a blank line, so the editor agrees with the preview MORE than the old whole-doc scan did); a window starting inside a long fenced code block with internal blank lines can't see the fence's opening marker — math-looking text there may highlight (cosmetic) and folds are refused via a fence-marker-in-run guard; runs >1000 lines never fold. Regression coverage in `MarkdownMathExtension.test.ts` (fold ranges, viewport-restricted decorations, no-whole-doc-materialization spies).

> **Warning**: MarkdownPreview's `<style>` filter uses `text.includes('mjx-')` heuristic to let MathJax's scoped CSS through. A user-authored raw `<style>` containing the substring `mjx-` would leak past. Threat model is local-first user markdown, not untrusted remote content; Tauri CSP already allows `unsafe-inline`. Accept.

> **Warning**: A call site that extracts preview DOM (`innerHTML`, PDF print, presentation) or drives its own scrolling over the whole document MUST pass `fullRender: true` to MarkdownPreview — windowed spacers are empty divs by design. Live preview panes must NOT pass it (that is the entire point of windowing).

> **Warning**: Scroll-restore / deep-link into a chunked doc lands on spacer estimates until the scroll event's rAF recompute mounts the real chunks (PreviewPane restore runs per-frame rAF for its own settle window). Under-estimated spacer heights can flash once when restoring deep into an unvisited region — accepted Phase A risk; measured heights persist per chunk thereafter (identity-keyed — an in-place edit resets only the edited chunk's measurement, so typing mid-doc while scrolled elsewhere does not shift the reading position).

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
- `editor/extensions/MarkdownMathExtension.test.ts` — token classes for `$..$` / `$$..$$` / `\[..\]` / `\(..\)`, code-skip (fenced + inline), `\$` not treated as math open, decoration updates on doc change, fold ranges (single/multi-line `$$..$$` / `\[..\]`, inline-only and cursor-outside → null), viewport-restricted decorations, no-whole-doc-materialization (toString/sliceString spies)
- `components/file-types/markdown/chunkMarkdown.test.ts` — chunk tiling (exact source text, no overlap, blank gaps really blank), boundary placement for every construct that spans blank lines (fences, math, HTML runs, loose lists, tables), reference-definition detection
- `components/file-types/markdown/markdownPipeline.test.tsx` — chunk/full render parity: strict child-sequence equality for docs without unpositioned nodes; stamped-entry (tag + doc-absolute line + text) equality for docs with them (math, directive fallback, reference defs — see the parity contract for why static gaps legitimately diverge there)
- `components/file-types/markdown/MarkdownPreview.chunked.test.tsx` — component level: jsdom zero-measured degrade-to-all, chunked-vs-full stamp equality, `fullRender` bypass, below-threshold identical render, per-chunk cache (one pipeline invocation for an in-place edit). The doc must exceed BOTH thresholds — a ~37k doc silently runs the full path (add a length assertion so the suite fails if the fixture shrinks below the chunked gate).
- `components/file-types/markdown/useWindowedChunks.test.ts` — unit level: `chunksToMountForLine` bridges inter-chunk blank gaps (both neighbors), pre-frontmatter and past-EOF lines.
- `components/file-types/markdown/MarkdownPreview.windowed.test.tsx` — component level with a stubbed mini layout engine (per-block rects + a measured scroller): real windows, reader-scroll survival (request gate), restore-hold mounts nothing (guard order), gap cursor line mounts both neighbors and aligns into the neighborhood, in-place edit preserves measured spacers of unchanged chunks and drops the edited one's, the jump-gated pre-mount band (boosted never-measured heights above the target; the alignment converges AND scrollTop is stable after the alignment write — no correction chain, the 闪动 regression; and a NEARBY cursor move does not re-stage the band — the 变卡 regression; mutation-checked: disabling the band's loops OR its jump gate goes red), and the residual drift correction (SHRUNK heights — real ≪ estimate, so the estimate-space band under-covers and chunks still mount after the alignment; converges via the correction; mutation-checked: disabling correctAlignmentDrift goes red). Assertions wait for convergence, not a fixed time, because the rAF walks are load-dependent. Slow (jsdom layout walk is O(children²) per recompute) — per-test timeouts are tens of seconds by design.

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
