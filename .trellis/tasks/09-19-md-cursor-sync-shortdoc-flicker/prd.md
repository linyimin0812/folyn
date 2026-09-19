# Markdown cursor-sync flicker + top blank band when typing in a short (new) file

## Goal

Fix the reported cursor-sync (光标对齐) bugs in Markdown split mode:

1. **新建 Markdown 文件，输入内容，预览页面会闪动** — in a newly created
   file, typing makes the preview visibly flicker while the content is
   shorter than one viewport.
2. **内容超过页面后，输入内容就不会有闪动了** — once the content exceeds
   the viewport, typing no longer flickers (the boundary that identifies the
   failing regime).
3. **预览页面头部存在大片空白** — a large blank band sits at the top of the
   preview page.
4. (Round 2) **新文档刚输入时，预览页为了对齐，会不断下移，造成预览页头部
   有大片空白** — while typing into a new doc, the preview keeps sliding
   DOWN to align, leaving a growing blank band at the top.
5. (Round 3) **这么修改的话，就对不齐了，只有超过一页的时候才会对齐了** —
   after removing the transform, short docs no longer align at all; only
   docs longer than one viewport align. Alignment and no-blank-band are
   BOTH required at any doc length.

## Root cause (confirmed by red → green regression tests)

Two stacked causes, both funneling into one fallback: the negative-`desired`
**transform push-down** on `.md-preview` (translateY + 120ms CSS transition).

**(a) Trailing EOF blank lines had no preview representation.** Every Enter
puts the cursor on a blank line at EOF (the new line is blank until its first
char). `rehypeBlankGap` only rendered gap divs BETWEEN blocks; the gap path
clamped the align point to the last block's bottom while the cursor kept
descending → `desiredRaw` negative by K × editorLineHeight → the transform
pushed the whole preview down (blank band), and the band appeared on Enter /
collapsed on the first typed char — a per-line-cycle 120ms-animated bounce
(the flicker, symptom 1+3). Once content exceeds the viewport the block
bottom is below the cursor, `desiredRaw ≥ 0`, the scroll path takes over —
exactly the reported boundary where the flicker stopped (symptom 2).

**(b) Structural re-wrap drift (round 2).** Long CJK paragraphs occupy 3
editor rows but re-wrap to 2 preview rows (the preview pane is wider, and the
editor font differs) — each paragraph renders shorter than the editor, and
the shortfall ACCUMULATES down the doc. This cannot be fixed by geometry
(the preview must render its own wrap), so `desiredRaw` goes progressively
more negative while the doc is short → the transform band grew by the drift
per paragraph — the preview “不断下移” with a growing 头部大片空白
(symptom 4). This is the same failure shape the blank-gap plugin was built to
eliminate for blank lines; the transform was kept as the "fallback for any
residual negative-desired edge case" — and that fallback is itself the bug.

## Fix

1. `MarkdownPreview.tsx` (cursor-sync effect, `inGap` branch): when the cursor
   is in the EOF gap (no next block), extend the align point by the
   blank-line distance at the **editor's line rate** —
   `eofSteps = cursorLine - lastSrcLine - 1` blank lines × `editorLineHeight`
   (the same rate `.md-blank-gap` renders between blocks). The base is the
   block's **editor-rate bottom**: rendered bottom + max(0, span ×
   editorLineHeight − rendered height), so the virtual trailing region
   starts where the editor's block ends.
2. `rehypeBlankGap.ts`: new `totalLines` option; the plugin appends a trailing
   `.md-blank-gap` div sized to the doc's trailing blank count, giving the
   extended scroll target actual scroll height. `MarkdownPreview` passes
   `totalLines: content.split('\n').length`.
3. **The transform push-down is REMOVED entirely** (state, ref, the three
   measurement compensations, the style transform, the 120ms CSS transition
   on `.md-preview`). When `desiredRaw < 0` the scroll clamps to 0.
   Alignment-by-blank-band is rejected as a trade.
4. **Runtime blank-gap compensation** (round 3 — what makes short docs
   align): a `useLayoutEffect` after each parse measures every top-level
   `[data-source-line]` block and re-sizes the `.md-blank-gap` before the
   next block so it lands exactly on the editor's line grid (first block's
   measured top + (line − 1) × editorLineHeight). The static rehype sizing
   cannot know rendered heights (re-wrapped CJK paragraphs render fewer
   rows; capped code blocks; bigger editor font) and the accumulated
   shortfall is exactly why short docs sat unaligned once the transform was
   gone. With compensation, `desiredRaw ≈ 0` at ANY doc length: scrollTop
   stays 0, every block sits where its editor line sits — aligned with no
   band. Pre-paint (useLayoutEffect) so per-keystroke re-parses never flash
   the static gap; one rect pass + cumulative in-memory adjustment + one
   write pass (single reflow); gaps floor at 8px so blocks rendering taller
   than their editor span keep natural separation (their positive drift is
   handled by the scroll path).

## Acceptance criteria

- [x] Regression test (new):
  `MarkdownPreview.cursorsync.shortdoc.test.tsx` — a typing sequence on a
  short doc (paragraphs → Enter×3 → type next paragraph) never engages the
  sync transform (was red: `translateY(48px)` — the band + the bounce), and
  the block containing the cursor stays aligned to the cursor's screen Y.
- [x] The trailing gap div is rendered and sized to the trailing blank count.
- [x] Tall doc + EOF blanks: the extension scrolls, landing the content end
  K−1 blank lines above the cursor.
- [x] Re-wrap drift test (round 2+3): with the live-walk geometry stub,
  every typed paragraph lands EXACTLY on the editor line grid
  (`top = 16 + (line−1)×LH`; was red: 24px short per predecessor — only
  >1-page docs aligned), the gaps absorb the drift (24 → 48px), scrollTop
  stays 0, and no transform exists.
- [x] End-to-end scratch (typing → Enter×2 → type, re-wrap drift + EOF
  blanks): eofBase + steps land the cursor's blank line exactly on the
  grid; desiredRaw = 0 throughout.
- [x] Existing markdown suite green (90/90 incl. PreviewPane), existing
  tabs/container cursor-sync tests unchanged.

## Out of scope

- Matching the preview content width to the editor's (would make CJK wrap
  row counts equal and remove most drift at the source) — a layout change,
  not a bug fix; the compensation absorbs it at the gaps instead.
- Leading blank lines before the first block (no gap div exists there;
  the grid anchors to the first block's measured top).
- Scroll-sync (preview scroll → editor) — still not implemented.

## Files

- `apps/desktop/src/components/file-types/markdown/MarkdownPreview.tsx`
- `apps/desktop/src/components/file-types/markdown/rehypeBlankGap.ts`
- `apps/desktop/src/components/file-types/markdown/MarkdownPreview.cursorsync.shortdoc.test.tsx` (new)
