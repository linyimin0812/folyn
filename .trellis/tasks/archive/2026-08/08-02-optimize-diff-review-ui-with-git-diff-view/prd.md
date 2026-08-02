# Optimize diff review UI with git-diff-view

## Goal

Replace the current CodeMirror-decoration-based diff review UI with `@git-diff-view/react`. Existing styling is visually poor and operations are unclear (only Accept All / Reject All visible, per-hunk widgets cramped). The new UI gives a proper split/unified code diff with syntax highlighting, theme support, and clearer per-hunk actions.

## Requirements

* Install `@git-diff-view/react` (+ `@git-diff-view/lowlight` for syntax highlighting).
* While `diffReviewMode === true`, render `<DiffView>` in the editor slot (replace CodeMirror editor area). CodeMirror stays mounted per-tab but hidden during review.
* Use file-comparison mode via `generateDiffFile(oldName, oldContent, newName, newContent, lang, lang)` from `@git-diff-view/file`.
* Theme (`diffViewTheme`) follows app theme (`light` / `dark`).
* Syntax language derived from file extension (`.ts`/`.tsx`→typescript, `.js`/`.jsx`→javascript, `.json`→json, `.md`→markdown, `.css`→css, `.html`→html; fallback no-highlight).
* Default `Split` mode; toolbar exposes a Split/Unified toggle.
* Per-hunk Accept/Reject buttons rendered via `diffViewAddWidget` + `renderWidgetLine`. Clicking ✓ accepts that hunk into the new content; ✕ reverts it. Accepting/rejecting all hunks exits review.
* Toolbar: Split/Unified toggle + Accept All + Reject All + pending hunk count.
* Exit review on Accept All / Reject All and on last-hunk action; write final content to the active tab via `editorStore.updateTabContent`.
* `diffReviewStore` API unchanged (still `enterDiffReview` / `exitDiffReview`) — both callers (AI file-change review + disk-sync conflict) keep working.

## Acceptance Criteria

* [ ] Entering AI file-change review shows `<DiffView>` in the editor slot; CodeMirror hidden.
* [ ] Entering disk-sync conflict review shows the same UI.
* [ ] Split view renders side-by-side with syntax highlighting for `.ts` / `.json` / `.md`.
* [ ] Split/Unified toggle switches view live without losing hunk state.
* [ ] Per-hunk ✓ button accepts only that hunk's lines into the new content; pending count decreases.
* [ ] Per-hunk ✕ button reverts that hunk to old content.
* [ ] Accept All writes `diffNewContent` to tab, exits review, CodeMirror re-renders with new content.
* [ ] Reject All restores `diffOldContent`, exits review, CodeMirror re-renders with old content.
* [ ] Accepting/rejecting the last hunk auto-exits review (parity with current `setOnHunksChange(count === 0 → exit)` behavior).
* [ ] Theme (light/dark) follows app theme at render time and on theme switch.
* [ ] JSON viewer's Diff tab renders `<DiffView>` (file-comparison mode) instead of inline-highlight CodeMirror.
* [ ] `排序后再比较` checkbox still toggles baseline (sorted left) and re-renders the diff.
* [ ] `pnpm -F @quill/desktop lint` and `typecheck` green.

## Definition of Done

* Lint / typecheck green.
* Manual smoke: AI file-change flow accept-all, reject-all, per-hunk accept, per-hunk reject; disk-sync conflict flow accept-all, reject-all.
* Old `InlineDiffExtension` removed if no other consumer (grep first). `computeDiffHunks` / `setDiffHunks` / `acceptAllHunks` / `rejectAllHunks` / `setOnHunksChange` deletions verified.
* `DiffToolbar` rewritten for new actions.
* i18n keys added for Split/Unified toggle labels.
* `@git-diff-view/react/styles/diff-view.css` imported once at desktop app entry.

## Technical Approach

**Approach A: DiffView replaces editor slot during review (chosen)**

* `EditorPane` (or whichever wrapper renders `<EditorView>`) checks `diffReviewMode && activeTab.path === diffFilePath`. When true, renders `<DiffReviewPanel>` instead of `<EditorView>`. CodeMirror instance stays mounted-but-hidden per tab so undo history / state isn't lost — actually simpler to unmount and re-mount on exit since we're committing full content. Decide during implementation; keep `externalContentVersion` bump on exit.
* New component `apps/desktop/src/components/editor/DiffReviewPanel.tsx` owns the `<DiffView>` + toolbar, derives `DiffFile` instance from `diffOldContent` / `diffNewContent` via `generateDiffFile`, manages per-hunk state locally (a Set of accepted/rejected hunk ids) and produces final merged content on exit.
* Toolbar stays a separate component (`DiffToolbar.tsx` rewritten) so layout doesn't leak.
* `diffReviewStore` untouched.

## Decision (ADR-lite)

**Context**: Current diff UX uses CodeMirror StateField decorations; per-hunk widgets exist but cramped, no split view, no syntax highlighting, only Accept/Reject All visible. User wants `@git-diff-view/react` for proper styling.

**Decision**: Approach A — replace editor area with `<DiffView>` while `diffReviewMode === true`. Per-hunk ✓/✕ via widget renderer. Split default + Unified toggle.

**Consequences**:
* + Cleaner visual diff, real syntax highlighting, GitHub-like UX.
* + Smaller surface — no CodeMirror decoration maintenance for diff.
* − CodeMirror hidden during review; user cannot edit code while reviewing (acceptable — review is a transient modal-like step).
* − `InlineDiffExtension` likely deletable; need to grep for non-diff consumers of `computeDiffHunks` etc. before removing.
* − New dep `@git-diff-view/react` + `@git-diff-view/lowlight` adds bundle size (~tens of KB).

## Out of Scope

* Multi-file diff review queue — single file at a time as today.
* Persisting per-hunk accept/reject state across sessions.
* `@codemirror/merge` alternative — rejected, doesn't fit "use git-diff-view" goal.
* Theme customization UI beyond light/dark follow.

## Scope Expansion (added 2026-08-02)

**JSON DiffPane** (`apps/desktop/src/components/file-types/json/components/DiffPane.tsx`) — also swap to `@git-diff-view/react`.

* Current: inline CodeMirror editor with "added"-line highlights only (no removed-side shown), toolbar has only `排序后再比较` checkbox.
* Target: render `<DiffView>` in file-comparison mode with `old=baselineText` (sorted left) / `new=rightInput` (raw user text). Use `json` lang for syntax highlighting.
* Toolbar: keep `排序后再比较` checkbox; consider adding Split/Unified toggle to match the new AI-review toolbar.
* Caveat: git-diff-view is read-only. The current DiffPane is editable (user types into rightInput). Switching means user loses inline editing on the Diff tab — they must edit on the Raw tab. Acceptable since the Diff tab's purpose is review, not editing.
* Tests: `DiffPane.test.tsx` will need rewrite — the inline-edit assertions no longer apply; replace with diff-render assertions (DiffView mounted, sortBoth toggles baseline, etc.).

## Technical Notes

* `@git-diff-view/react` props: `diffFile`, `diffViewMode`, `diffViewTheme`, `diffViewHighlight`, `diffViewAddWidget`, `renderWidgetLine`.
* `generateDiffFile(oldName, oldContent, newName, newContent, oldLang, newLang)` from `@git-diff-view/file` — produces `DiffFile` instance; call `.initTheme(theme)` / `.init()` / `.buildSplitDiffLines()` / `.buildUnifiedDiffLines()`.
* Per-hunk widget: `renderWidgetLine({ diffLine, diffFile }) => ReactNode`. Use `diffLine.lineNumber` to identify hunk; render ✓/✕ buttons.
* CSS: `import "@git-diff-view/react/styles/diff-view.css"` — plain CSS, no Tailwind needed inside the diff view; wrapper uses Tailwind for layout.
* Files to touch:
  * NEW `apps/desktop/src/components/editor/DiffReviewPanel.tsx`
  * REWRITE `apps/desktop/src/components/editor/DiffToolbar.tsx`
  * REWRITE `apps/desktop/src/components/work-area/DiffReviewBar.tsx` (or fold into DiffReviewPanel)
  * DELETE `apps/desktop/src/editor/extensions/InlineDiffExtension.ts` (after grep confirms no other consumer)
  * UPDATE `apps/desktop/src/components/work-area/EditorPane.tsx` (or equivalent) to swap editor vs DiffView slot
  * UPDATE `apps/desktop/package.json` (deps)
  * UPDATE i18n locale files for Split/Unified strings
