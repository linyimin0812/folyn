# Verification

## Reproduction

Existing `/tmp/folyn-dbl-debug.log` records three double-clicks on list text
selecting a single newline (`len=1`). The newline paints as a large highlight.
The current implementation's nearest-word retry also calls Range.expand and
can therefore repeat the same failure.

The component regression replays that native expansion result while mounting
the real MarkdownPreview. Before the fix:

```
pnpm exec vitest run --project desktop apps/desktop/src/components/file-types/markdown/MarkdownPreview.selection.test.tsx
Expected: technical
Received: \n
Tests: 1 failed
```

Standalone native WebKit did not spontaneously reproduce the WKWebView-specific
newline expansion; the component test replays the captured behavior instead.
The exact live-app mechanism behind Range.expand's incorrect result is not
established. The production fix removes that API and the dependent retry.

## Fix

Use Intl.Segmenter on the clicked block's text and map boundaries back to DOM
text nodes. Use glyph geometry to distinguish a caret after a letter from a
pointer on whitespace. Preserve inline formatting while separating block/br
boundaries. Keep the word selection through native post-mouseup updates, then
release it on the next frame. Remove temporary global logging and file writes.

## Results

- WebKit: 32 character hit tests and actual double-click selections passed.
- Chromium: 32 character hit tests and actual double-click selections passed.
- Targeted Vitest: 21 tests across selection, cursor-sync, and short-doc sync passed.
- git diff --check passed.
- No whole-project compile or build performed, per the user's instructions.

Browser command (requires the existing /tmp/webkit-bisect Playwright install):

```
node .trellis/tasks/10-11-markdown-preview-word-selection/selection-browser.mjs webkit
node .trellis/tasks/10-11-markdown-preview-word-selection/selection-browser.mjs chromium
```
