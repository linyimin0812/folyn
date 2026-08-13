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
function findMathSegments(md: string): MathSegment[];    // shared code-segment scanner
```

`renderMarkdownToHtml` is `renderToStaticMarkup(renderMarkdownToReact(md, opts))` — they share one pipeline, not two.

---

## Pipeline

```
md source
  → transformMathBrackets (string preprocessor)
  → unified()
      .use(remarkParse)
      .use(remarkMath)              // $..$ / $$..$$ → math nodes
      .use(remarkGfm, remarkBreaks, remarkDirective, remarkDirectiveRehype)
      .use(remarkRehype)
      .use(rehypeMathjax)            // math nodes → inline SVG (SYNC, self-contained)
      .use(rehypeStringify | rehypeReact)
  → ReactNode | HTML string
```

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

### Streaming (chat)

Chat does NOT call `useEffect` to re-typeset math on content append. rehype-mathjax renders SVG at parse time, so the existing per-segment `useMemo([value])` cache in `MessageContent` re-parses the trailing (growing) text segment naturally. Do not add `typesetPromise`-based re-render — it's the wrong mental model for SVG output.

---

## Patterns

### Pattern: String-level preprocessing over micromark extension

**Problem**: remark-math doesn't recognize `\[..\]` / `\(..\)`. The "proper" fix is a custom micromark extension.

**Solution**: A ~30-line string-level preprocessor (`transformMathBrackets`) walks the doc, skips code regions verbatim (via shared `listSegments`), and replaces `\[..\]` → `$$..$$` / `\(..\)` → `$..$` on text segments only.

**Why**: micromark extensions are 200+ lines of state-machine definition for a syntax transformation that is a 6-line regex on text segments. The preprocessor is the smallest viable diff. Tradeoffs documented in a `ponytail:` comment.

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
