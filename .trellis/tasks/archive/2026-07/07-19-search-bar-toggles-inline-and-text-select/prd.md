# Search bar: inline toggles + select-all in input

## Goal

Move the Aa / ab / .* toggle buttons from outside the find input (currently siblings in the row) to inside the input's right edge (VS Code style), and ensure Cmd+A (select all) works inside the find input — selecting only the input's text, not the editor's.

## What I already know

- File: `apps/desktop/src/components/editor/EditorSearchBar.tsx`
- CSS: `apps/desktop/src/index.css` `.ed-search-*` block
- Current layout: `[input] [Aa][ab][.*] [count] [↑][↓][X]`
- Target layout (VS Code): `[input........Aa ab .*] [count] [↑][↓][X]`
- Native HTML `<input>` supports Cmd+A select-all by default; CM's keymap (which maps `Mod-a` to its own `selectAll`) is bound to `.cm-editor`'s DOM, so it should NOT intercept events from the SearchBar input (which is a sibling of `.cm-editor`, both inside `.cm-wrapper`). Will verify in implementation.

## Assumptions (temporary)

- "全选" = Cmd+A inside the find input selects all text in the input (native browser behavior)
- Toggles overlay the input's right edge; input gets right padding to keep typed text clear of the buttons

## Requirements

- [ ] Aa / ab / .* toggle buttons positioned absolutely inside the find input's right edge
- [ ] Find input has right padding so text doesn't slide under the toggles
- [ ] Cmd+A inside the find input selects all the input's text (native default — must not be intercepted by CM keymap or React handler)
- [ ] Replace input: keep its current toggle-less layout (no toggles to inline there)
- [ ] Toggles remain keyboard-accessible (focusable, click works)
- [ ] Visual: matches VS Code (buttons flush with input's right inner edge, no extra border between input and buttons)

## Acceptance Criteria

- [ ] Cmd+A in find input → only input text is selected (not editor text)
- [ ] Click Aa / ab / .* → toggle activates; input text not affected
- [ ] Long typed query doesn't underflow the toggle buttons (right padding holds)
- [ ] Light/dark themes look correct

## Definition of Done

- Typecheck passes
- No regression to existing search/replace behavior

## Out of Scope

- Replace-row inline toggles (replace row has no toggles to inline)
- Multi-line input (textarea) — find input stays single-line
- Custom selection styling (use native browser selection highlight)

## Technical Approach

JSX: wrap the find `<input>` and `.ed-search-toggles` in a `position: relative` container `.ed-search-input-wrap`. The toggles become `position: absolute; right: 4px; top: 50%; transform: translateY(-50%)`. The input gets `padding-right: 72px` (3 buttons × 20px + 2 gaps × 2px + 8px margin) so typed text never underlaps the toggles. No JS changes — toggle handlers and input onChange stay the same. Native Cmd+A select-all works because CM's `Mod-a` keymap is bound to `.cm-editor`'s DOM (a sibling of the SearchBar input), so it doesn't intercept events outside the editor.

## Technical Notes

- Files: `EditorSearchBar.tsx` (JSX restructure) + `index.css` (`.ed-search-input-wrap`, padding-right on input)
- VS Code reference: toggles sit at right inner edge of the input, slightly inset, no separator border
