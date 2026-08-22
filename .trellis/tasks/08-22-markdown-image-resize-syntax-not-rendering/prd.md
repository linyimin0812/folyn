# markdown image resize syntax not rendering

## Goal

Fix markdown image rendering breaking after the resize-writeback syntax `=WxH` is appended to the URL. Currently `![alt](./assets/foo.png =525x)` fails to render because CommonMark image destinations cannot contain unquoted whitespace, so remark-parse doesn't recognize the image construct and emits the whole `![alt](...)` as literal text.

## What I already know

- Resize writeback lives at `apps/desktop/src/components/file-types/markdown/MarkdownPreview.tsx:237-252` (`IMG_SIZE_RE`, `applyImageSize`). On drag-commit, it writes ` =Wx` to the source line.
- `readSourceWidth` (`MarkdownPreview.tsx:279-289`) reads width back from `contentRef.current` (full source incl. frontmatter) using `IMG_LINE_SIZE_RE`. Still works — it reads the raw source, not the unified-pipeline output.
- The unified pipeline at `MarkdownPreview.tsx:831-854` runs `body` through `unwrapInlineMath(transformMathBrackets(body))` before remark-parse. No equivalent pass strips the image-size suffix.
- Same preprocessor pattern is reused in `apps/desktop/src/services/markdown/renderMarkdown.ts:108-169` (`transformMathBrackets`, `unwrapInlineMath`) — used by chat/export markdown.
- `renderMarkdownToReact` / `renderMarkdownToHtml` call `unwrapInlineMath(transformMathBrackets(md))` at `renderMarkdown.ts:247, 254`. Same bug surface if a user pastes `=WxH` syntax into chat/export.

## Root cause

`![alt](url =525x)` is not a valid CommonMark image. The destination can't contain unquoted whitespace. remark-parse fails to match the image and emits the raw text.

## Approach (Recommended)

**Approach A — string-level preprocessor (lazy, matches existing pattern)**

Add `stripImageSizeSuffix(md)` alongside `transformMathBrackets` / `unwrapInlineMath` in `renderMarkdown.ts`. Apply it in both `MarkdownPreview.tsx:854` and `renderMarkdown.ts:247`. The width still persists in the source line (unchanged), `readSourceWidth` still finds it via `contentRef.current` — only remark-parse is spared the broken syntax.

```ts
// ponytail: strip ` =WxH` suffix from image URLs before remark-parse.
// CommonMark image destinations cannot contain unquoted whitespace.
// Width is still read from the raw source line via readSourceWidth.
// Ceiling: only matches single-line image syntax; multi-line image URLs (rare) untouched.
const IMG_STRIP_SIZE_RE = /(!\[[^\]]*\]\([^)\s]+)\s+=\d*x\d*(\))/g;
export function stripImageSizeSuffix(md: string): string {
  return md.replace(IMG_STRIP_SIZE_RE, '$1$2');
}
```

Call sites:
- `MarkdownPreview.tsx:854`: `.processSync(stripImageSizeSuffix(unwrapInlineMath(transformMathBrackets(body))))`
- `renderMarkdown.ts:247`: `p.processSync(stripImageSizeSuffix(unwrapInlineMath(transformMathBrackets(md)))).result`

**Approach B — remark plugin (heavier)**

Write a remark plugin that parses `![alt](url =WxH)` at AST level and emits width as directive/hdata attribute. More correct in principle, but more code, and the existing `readSourceWidth` already handles width extraction from source — the only problem is remark-parse choking on the URL. Overkill.

## Requirements

- `![alt](./assets/foo.png =525x)` renders the image (not the raw text).
- `![alt](./assets/foo.png =525x300)` also renders.
- Width from the suffix still applies to the rendered `<img>` (via existing `ResizableMedia` / `readSourceWidth` path).
- Resizing via drag-handle still writes `=Wx` back to source (unchanged behavior).
- Chat/export markdown (`renderMarkdown.ts`) also tolerates the `=WxH` suffix.

## Acceptance Criteria

- [ ] Paste `![screenshot](./assets/images/screenshot-2026-08-22-154043.png =525x)` into a markdown note — image renders at 525px width.
- [ ] Drag-resize the image → width writes back to source → image still renders on next render (no regression).
- [ ] Clear width (double-click handle) → source loses `=525x` → image renders at natural size.
- [ ] Image without `=WxH` suffix still renders as before.
- [ ] Inline image with `=525x300` (both width and height) renders.

## Definition of Done

- One runnable self-check or small unit test for `stripImageSizeSuffix` (no framework — `node` + `assert` is fine).
- Lint / typecheck green.
- No regression in existing markdown rendering.

## Out of Scope

- Multi-line image URLs with `=WxH` suffix (rare).
- Changing the writeback syntax (keep `=WxH`, not `{width=W}`).
- New remark plugin / AST-level refactor.

## Technical Notes

- Files to touch:
  - `apps/desktop/src/services/markdown/renderMarkdown.ts` — add `stripImageSizeSuffix` + apply at line 247.
  - `apps/desktop/src/components/file-types/markdown/MarkdownPreview.tsx` — apply at line 854.
- No new deps.
- Self-check: add a `__main__` or a small `test_*.ts`/`*.test.ts` near `renderMarkdown.ts` that asserts `stripImageSizeSuffix('![a](./x.png =525x)')` === `'![a](./x.png)'`.

## Decision (ADR-lite)

**Context**: Resize writeback writes `=WxH` to the source line, but CommonMark image URLs can't contain whitespace, so remark-parse fails.

**Decision**: Approach A — strip ` =WxH` from image URLs in a string-level preprocessor before remark-parse. Reuses existing `transformMathBrackets` pattern. Width still read from source via `readSourceWidth`.

**Consequences**: Shortest diff, covers both preview + chat/export. Future multi-line image URLs would need a remark plugin (out of scope).
