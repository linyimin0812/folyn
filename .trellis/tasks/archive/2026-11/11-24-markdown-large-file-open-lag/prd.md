# Fix large markdown file open lag

## Goal

Large markdown files (several hundred KB, thousands of lines) open and stay smooth in every mode:
open-within-1s visible content, keystroke with no perceptible delay, scroll without frame drops,
tab switch instant. The dominant cost today is the markdown preview pipeline (measured ~4.5s per
1MB on the main thread, re-run in full while typing) plus editor extensions doing full-document
work on every keystroke.

## Request

User report: "打开大的markdown文件太卡了" — confirmed in interview to mean ALL of: open-time
freeze, typing lag, scroll lag, tab/mode switch lag; worst in split mode; files are several hundred
KB; the problem has always existed (not a regression).

## Bug

- **Symptom**: opening a several-hundred-KB markdown file freezes the UI for seconds; typing is
  laggy; scrolling drops frames; switching back to the tab re-freezes. Worst in split (default).
- **Expected behavior (accepted)**: for ~500KB / ~5k-line files — open (content + preview)
  visible within 1s; no perceptible per-keystroke delay; scrolling without frame drops; tab
  switch back instant.
- **Reproduction**: open any ~300KB+ markdown file in split mode; type; scroll; switch tabs.
  Measured on this machine: full preview pipeline ~4.5s/1MB (rehypeReact JSX tree ~3.7s/1MB,
  rehypeRaw ~460ms, rehypeHighlight ~770ms, remarkParse ~266ms); ~60 full-doc `toString()` per
  keystroke via foldGutter×mathFoldService (43ms/keystroke on 5MB); preview re-parses the whole
  document at least every 500ms while typing (debounce caps frequency, not cost). Details:
  `research/perf-recon.md`.
- **Classification**: Silent — no spec covers large-file performance. This prd records the
  accepted intended behavior; after landing, add a large-doc performance section to
  `.trellis/spec/desktop/frontend/markdown-rendering.md` (Trellis 3.3).
- **Root causes** (ranked, from research):
  1. `MarkdownPreview.tsx` renders the entire document synchronously through the unified
     pipeline (`processSync`) — no windowing, no per-block caching; re-runs in full while typing.
  2. `MarkdownMathExtension.ts:59` `mathFoldService` materializes `state.doc.toString()` before
     its range early-return → `foldGutter()` rebuilds markers per viewport line per
     doc/viewport change → ~60 full-doc materializations per keystroke/scroll step.
  3. `EditorView.tsx:544-546` word count does full-doc `toString()` + regex split per keystroke.
  4. `usePreviewCursorSync` per burst: `querySelectorAll` over all blocks + rect reads +
     full-doc `split('\n')`.

## Product decisions (user-confirmed)

1. **Acceptance target**: ~500KB/5k-line file — open visible ≤1s (any mode), typing no
   perceptible delay, scrolling no frame drops, tab switch instant.
2. **Typing updates the preview incrementally**: only the block(s) containing the cursor
   re-render; unchanged blocks reuse their cached render. (Chosen over "freeze preview while
   typing, refresh 0.5s after pause".)

## Design

**A. Chunked preview with per-chunk cache and windowed mounting (MarkdownPreview rewrite core).**

- Split the document source into top-level chunks at blank-line boundaries that are OUTSIDE
  fenced code, display math, loose lists, frontmatter, and unknown-raw-HTML runs (a
  conservative line-level scanner — when in doubt, merge; larger chunks are always correct,
  only less granular). The scanner reuses the raw-tag run-detection logic (same rules as
  `remarkCollapseUnknownTagRuns` stage 1) so an unknown-tag run spanning blank lines stays one
  chunk.
- Each chunk renders through the SAME shared pipeline (`renderMarkdownToReact` — the
  markdown-rendering.md contract is preserved; chunking happens at MarkdownPreview level, no
  second `unified()` chain). Prepend `'\n'.repeat(startLine-1)` to the chunk slice so parser
  positions (and therefore `data-source-line` stamps, blank-gap placement, cursor sync) carry
  DOCUMENT line numbers.
- Each chunk is a memoized React component keyed by its text; typing re-renders only chunks
  whose text changed (user decision #2).
- Windowed mounting: only chunks intersecting the viewport (± overscan) are mounted; unmounted
  chunks render a spacer with the last measured height. This cuts open-time cost (render only
  visible chunks), memory, and tab-switch cost (`KEPT_PREVIEWS=8` becomes cheap). Scroll mounts
  incrementally. No new dependency — manual windowing keeps the DOM structure that
  cursor-sync/gap contracts depend on.
- Inter-chunk blank lines: the chunker emits `.md-blank-gap` spacers between chunks carrying
  the blank-line span, preserving the descent-rate sync contract.
- **Export must keep working**: `exportService` renders via hidden DOM mount of
  MarkdownPreview — windowing would render nothing in a hidden container. MarkdownPreview gets
  a `fullRender` prop (export path sets it) that mounts all chunks.
- Cursor sync continues to work per mounted block; `usePreviewCursorSync` scans mounted blocks
  only (few, because windowed).

**B. Editor keystroke hot paths (independent of A, lands first).**

- `mathFoldService`: compute from the foldable line RANGE (slice lines), never `doc.toString()`;
  early-return before any string materialization.
- `mathHighlight` decoration source scan: scan only the viewport range (CodeMirror buildDecorations
  already receives view ranges — restrict `findMathSegments` input to those spans).
- Word count: debounce to idle (e.g. ≥500ms after last change / on pause) — not per keystroke.
- `headingFold` already walks forward from headings; keep, it's line-range based.

**C. Verification.**

- Unit tests: chunker (boundary rules: fenced code, math, loose list, frontmatter, raw-HTML
  runs, blank-line gaps); MarkdownPreview windowed rendering (visible chunks mounted, spacers
  present, `data-source-line` correct); export full-render mode renders whole doc; existing
  cursor-sync tests stay green (regression guard for the gap/line contracts).
- Perf smoke (research-script level, not CI): synthetic 500KB doc — chunk+first-window render
  ≤1s; per-keystroke editor work ≤16ms typical (no full-doc toString in hot loop).
- Manual check in the running app on the user's real laggy file.

**Manual-check finding (2025-11-25)**: 用户报告 光标对齐后,预览渲染出其他内容后又不对齐 —
root cause: windowed spacer→chunk swaps above the aligned block shift it (estimate→measured),
and the request gate correctly ignored mount-only re-runs. Fixed by content-space drift
correction (scroll-invariant anchor, re-based after each correction) + pinning the cursor-sync's
chunks against window rotation so the anchor element never dies. Regression: windowed suite FIX 4;
spec contracts updated in `markdown-rendering.md`.

**Manual-check finding 2 (2025-11-25)**: 用户报告 闪动比较明显 — the drift corrections themselves
flickered: each `scrollTop += drift` is a visible hard jump (a chain of them after every
alignment), plus the alignment scroll landed on spacer blankness that popped in a frame later.
Fixed by PRE-MOUNTING the post-alignment band before the alignment writes scrollTop (it lands on
measured geometry; swaps happen before, nothing moves after) with the correction demoted to a
rare safety net that gains a screen-error gate (skip when the browser's native scroll anchoring
already compensated — no double compensation). Regressions: windowed suite FIX 4 (stability
assertion, mutation-checked) + FIX 5 (correction path, mutation-checked).

**Manual-check finding 3 (2025-11-25)**: 用户报告 体验变卡了 — the band staged
UNCONDITIONALLY: the sync effect re-runs on every keystroke / editor-scroll frame,
and the walk's trim removes the band's excess between runs, so ~70 chunks
re-mounted at keystroke rate (mount/unmount churn). Fixed by the JUMP gate: the
band stages only when the anchor chunk is unmounted (far scroll / click); with a
mounted anchor (typing, small scrolls) the targets alone suffice — geometry above
is measured or height-cached (the identity cache survives unmounts), and residual
swaps fall to the drift correction / native scroll anchoring. Regression: windowed
FIX 4's nearby-move tail (mutation-checked: unconditional staging goes red).

**Manual-check finding 4 (2025-11-25)**: 用户报告 大文件下光标对齐效果不好、容易闪动 —
the sync effect ran as a PASSIVE useEffect (post-paint). WKWebView has no native
CSS scroll anchoring, so every first-visit chunk swap painted one VISIBLE drifted
frame (estimate→real swap shifts everything below), with the correction landing a
paint later; jumps painted spacers/old position first, then band + alignment across
several paints. Fixed by two placements: (1) the sync effect is now a useLayoutEffect
— swap + correction/alignment land in the same paint, the pending-mount bridge
re-renders synchronously pre-paint, and the follow-along scroll no longer lags a
frame behind the editor; (2) the usePreviewCursorSync CALL moved after the
gap-compensation layout effect — layout effects run in hook order within a
component, and called before it the sync measured PRE-compensation gap heights
(frontmatter leading gap) and wrote a wrong scrollTop (40 = the SkillMetaCard
height; the shortdoc "frontmatter" test is the ordering regression, red at the old
position). jsdom cannot observe paint order (act flushes both effect types) — the
timing itself is device-verified; the ordering is suite-pinned.

**Phasing (each phase leaves the product working):**
1. Phase B — editor hot-path fixes (small, safe, typing/scroll win immediately).
2. Phase A — chunked + windowed MarkdownPreview (open-time, typing-in-split, tab switch).
3. C — verification + spec update.

## Assumptions (unconfirmed)

- None material. (File-size target taken from user's "几百 KB"; design also scales to MB docs.)

## Out of scope / deferrals

- Web-worker/off-thread parsing of the pipeline (bigger contract break, not needed to hit the
  1s target at 500KB).
- Virtualizing the CodeMirror editor itself (CM6 is already viewport-based; our extensions were
  the problem).
- `restoreOpenTabs` startup behavior (re-reading persisted tabs) — separate concern.
- Chat `MessageContent`, export, mind-map rendering paths already have their own caching; they
  get the shared-pipeline fixes only if Phase B touches shared code.
