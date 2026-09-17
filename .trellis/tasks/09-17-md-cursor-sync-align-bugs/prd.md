# Markdown cursor-sync highlight misaligns on line-break and short content

## Goal

Fix two reported misalignment bugs in Folyn's Markdown split-mode cursor-sync
(the `.cursor-sync-active` block highlight + the preview scroll that aligns the
cursor line to the same screen Y in editor and preview):

1. **换行输入内容，光标所在的行没有对齐高亮** — when entering content with a
   line break (pressing Enter), the line the cursor lands on is not
   alignment-highlighted.
2. **新建文件编写，内容较少时，容易出现光标对齐效果偏移** — in a newly
   created file with little content, the cursor alignment effect drifts/offsets.

## What I already know (from reading the code)

The cursor-sync lives in `apps/desktop/src/components/file-types/markdown/MarkdownPreview.tsx`
(a single `useEffect`). Per-keystroke cursor state is written by
`apps/desktop/src/editor/EditorView.tsx` `handleUpdate` into
`useEditorViewStateStore` (`cursorLine`, `cursorViewportY`, `editorViewportTop`,
`editorLineHeight`, `cursorLineFrac`). Pure align helpers live in
`blockAlignPoint.ts` (`blockAlignPoint`, `blockLastSrcLine`, `gapAlignPoint`)
and `codeBlockAlign.ts`. The previous alignment work shipped in commit
`00b01f3a fix(cursor-sync): correct editor↔preview alignment across gaps,
soft-wrap, and multi-line blocks`.

Key mechanics of the current effect:
- It selects the block whose `data-source-line` is the highest `<= cursorLine`.
- `inGap = cursorLine > lastSrcLine` (cursor on a blank line below the block).
- Highlight target = the NEXT block if in-gap with a next block exists, else
  the current block. So at EOF trailing blanks the highlight stays on the last
  block — the cursor's blank line gets no highlight.
- Align point is computed per block kind; scroll target = `alignPoint -
  (cursorScreenY - containerRect.top)` so the align point lands at the cursor's
  screen Y (editor + preview share one flex row).
- Effect deps are `[cursorLine, cursorViewportY, editorViewportTop,
  hasSelection, editorLineHeight, cursorLineFrac]` — **no content/DOM dep**,
  so the effect re-runs only on cursor-state change, not on content re-render.

## Hypotheses (to confirm with the user)

### Bug 1 (line-break → no highlight)
Two candidate root causes:
- **A. Gap-at-EOF highlight lag**: pressing Enter at end of a block (esp. EOF)
  puts the cursor on a blank line below the block; `inGap` is true and there is
  no next block, so the highlight stays on the block ABOVE the cursor's line.
  The cursor's own line has no block → no highlight → "光标所在的行没有对齐高亮".
- **B. Stale-DOM on content re-render**: the effect has no content/DOM dep, so
  right after an Enter that creates a NEW block, the effect may run with the
  cursor line but a DOM that has not yet committed the new block → highlight
  lands on the old block. (Needs verification — React may batch content +
  cursorLine into one render so the DOM is fresh by effect time.)

### Bug 2 (short content → drift)
- The alignment scroll target (`desired`) is clamped to `[0, maxScroll]`.
  When preview content is shorter than the viewport (new file, few lines),
  `maxScroll <= 0`, so the preview CANNOT scroll the block's align-point up to
  the cursor's screen Y → the highlighted block sits lower (or higher) than the
  cursor line → visible drift. This is partly inherent (can't scroll past 0),
  but the current math still attempts an unattainable alignment instead of
  degrading gracefully.

## Open Questions

1. **Reproduction detail for Bug 1** — exact scenario: Enter at end of a
   paragraph (cursor on new blank line)? Enter mid-paragraph (soft break,
   remarkBreaks keeps one block)? Typing into a new line that creates a new
   block? (Determines whether fix is gap-highlight, stale-DOM, or both.)
2. **Reproduction detail for Bug 2** — does "drift" mean the highlight is on
   the wrong block, or the scroll position is off (block lower/higher than
   cursor)? And does it self-correct after more content is added?
3. **Desired behavior when preview can't scroll (short content)** — accept
   no-scroll (just keep the right block highlighted) vs. some other fallback?

## Assumptions (temporary)

- Bugs are against split mode (editor + preview), `cursorSyncPreview` toggle ON.
- "对齐高亮" = the `.cursor-sync-active` block highlight + scroll alignment.

## Requirements (evolving)

- When the editor cursor sits on a trailing blank line at EOF (in a gap
  with NO next block), the preview must NOT keep the
  `.cursor-sync-active` highlight on the last block — that left the
  highlight stuck ABOVE the cursor (Bug 1 "段落末尾按回车" + Bug 2
  "高亮块在光标上方"). Clear the highlight instead: the cursor is past
  all content, no block corresponds to it.
- Gap scroll behaviour is unchanged: with a next block the preview
  advances to + highlights the next block; at EOF it scrolls so the last
  block's bottom aligns near the cursor (clamped to 0 for short content,
  which is inherent — can't scroll past 0).

## Root cause (confirmed)

Both bugs share one root cause. The cursor-sync effect selects the block
whose `data-source-line` is the highest `<= cursorLine`. When the cursor is
on a trailing blank line below that block (`inGap = cursorLine > lastSrcLine`)
and there is no next block (EOF), the highlight stayed on that last block —
visually ABOVE the cursor. For short content the scroll also can't bring the
block down to the cursor (`desired` goes negative → clamps to 0), so the
highlight-above drift was unavoidable while a block stayed highlighted.

## Fix

`apps/desktop/src/components/file-types/markdown/MarkdownPreview.tsx` — in
the cursor-sync `useEffect`, change the EOF-gap highlight target from the
last block to `null` (clear it):

```ts
// before: const highlightEl = nextBlock ? nextBlock.el : el;
const highlightEl = nextBlock ? nextBlock.el : null;
// …
activeBlockRef.current = highlightEl;          // null in EOF gap
highlightEl?.classList.add('cursor-sync-active'); // no-op in EOF gap
```

`activeBlockRef` is already `HTMLElement | null`; the unmount cleanup already
uses optional chaining. `gapAlignPoint` (the scroll align point) is unchanged
— it still returns the last block's bottom for the scroll target.

## Acceptance Criteria (evolving)

- [x] In split mode with `cursorSyncPreview` on, pressing Enter at the end
  of the last paragraph (cursor on a trailing blank line at EOF) clears the
  `.cursor-sync-active` highlight instead of leaving it on the paragraph
  above the cursor.
- [x] Typing text on the new line re-extends the paragraph (remarkBreaks
  soft-break) and the highlight returns on it.
- [x] Short-content drift (highlight block above cursor) no longer shows a
  misleading highlight when the cursor is in an EOF gap.
- [x] Existing markdown align tests pass; `tsc --noEmit` clean.

## Out of Scope (explicit)

- A non-block "cursor-line indicator" rendered inside the preview gap
  (would literally highlight the blank line the cursor is on). Not added —
  blank lines render no block, so a block highlight can't reach them; a
  separate indicator is a feature, not a bug fix. Revisit if the cleared
  highlight feels too sparse.
- Scroll-sync (preview scroll → editor). Still not implemented.

## Technical Notes

- Effect: `MarkdownPreview.tsx` ~line 560–660 (the `cursorLine` `useEffect`).
- Align helpers: `blockAlignPoint.ts`, `codeBlockAlign.ts` (+ tests).
- Cursor state writer: `EditorView.tsx` `handleUpdate` (~line 330–390).
- Store: `editorViewState.ts` (`setCursorViewportY`, `setCursorPosition`).
- CSS: `index.css:959` `.md-preview .cursor-sync-active` (6% accent bg).
