# Rich Text Slash Command Trigger Button

## Goal

Add a slash command trigger button + slash command menu to the Tiptap rich-text editor (the CodeMirror side already has one). The trigger button sits in the rich-text toolbar; clicking it inserts a `/` at the cursor, which opens a categorized menu of Tiptap-native block commands. Keyboard shortcut Cmd/Ctrl+/ also triggers it.

## What I already know

- Tiptap editor at `apps/desktop/src/components/file-types/rich-text/RichTextEditor.tsx` uses `StarterKit`, `TaskList`, `TaskItem`, `TableKit`, `RichTextImage`. No `@tiptap/suggestion` installed.
- Toolbar at `RichTextToolbar.tsx` is icon-only raw `<button>` + Tailwind, uses `lucide-react`. `Plus` already imported there. `ToolButton` interface defined locally.
- Existing CodeMirror `SlashMenu.tsx` (`apps/desktop/src/components/editor/SlashMenu.tsx`) is a plain React component with `onSelect(plugin: ContainerPlugin)` — NOT reusable as-is, since `ContainerPlugin` is for markdown directives (`:::callout`), not Tiptap node commands.
- `ContainerPlugin` (`packages/container-plugins/src/ContainerPlugin.ts`) defines `name/icon/label/category/component/template` for markdown directives. Template is markdown text. The Tiptap editor stores JSON, not markdown, so ContainerPlugin templates cannot render as Tiptap nodes — callouts/cards/etc. are out of MVP scope.
- CodeMirror trigger (`SlashCommandExtension.ts`) is a ViewPlugin that watches for typed `/` at line-start or after whitespace (and not before `>`), tracks filter text, shows/hides menu via a StateField. Pattern is replicable for Tiptap as a ProseMirror plugin.
- Tiptap v3 supports `addKeyboardShortcuts` natively — register Cmd/Ctrl+/ via the extension itself. No need for `react-hotkeys-hook` (the doc's suggested dep).
- No primitive `Button`/`Badge` components; toolbar uses raw `<button>`. Trigger button matches the existing `ToolButton` pattern.
- Icons: `lucide-react` has `Plus`, `Heading1/2/3`, `List`, `ListOrdered`, `ListChecks`, `Quote`, `Code2`, `Minus`, `Image`, `Table`.

## Requirements

- Tiptap editor gains a `/`-triggered slash menu showing categorized Tiptap-native block commands.
- Menu command set (9 items): Heading 1, Heading 2, Heading 3, Bullet list, Ordered list, Task list, Blockquote, Code block, Horizontal rule. (Image/Table stay in the toolbar; slash menu shows block types only.)
- Menu UX matches CodeMirror side: filter by typed text, grouped by category, arrow-up/down nav, Enter selects, Esc closes, viewport-flip on overflow.
- Toolbar `Plus` button inserts `/` at cursor → triggers the menu. Disabled when editor not editable.
- `Cmd/Ctrl+/` keyboard shortcut triggers the same insertion.
- Selecting a menu item runs the corresponding `editor.chain().focus().<cmd>().run()` and removes the `/` + filter text from the document.
- No new third-party deps in `apps/desktop/package.json`.

## Acceptance Criteria

- [ ] Typing `/` at line start (or after whitespace) in the rich-text editor opens the slash menu.
- [ ] Typing filter text after `/` filters the menu by command label (case-insensitive); filter text is included in the doc until selection.
- [ ] Arrow-up/down moves highlight; Enter selects and executes the command; the `/` + filter text is removed from the doc.
- [ ] Esc closes the menu without inserting anything.
- [ ] Menu flips above the cursor when viewport-bottom space is insufficient.
- [ ] Toolbar `Plus` button inserts `/` at cursor → menu opens. Disabled when editor not editable.
- [ ] `Cmd/Ctrl+/` shortcut triggers the same insertion behavior.
- [ ] No new third-party deps added to `apps/desktop/package.json` (use existing Tiptap + lucide + Tailwind).
- [ ] Unit tests for the suggestion plugin's trigger conditions (line-start, after whitespace, not before `>`, closes on space after `/`).
- [ ] Lint + typecheck + existing tests green.

## Definition of Done

- Tests added for the suggestion plugin's trigger conditions.
- Lint / typecheck / CI green.
- PRs land in small slices (see Implementation Plan).
- Rollout: rich-text editor gets the feature on next load; no migration needed.

## Technical Approach

- **No `@tiptap/suggestion` install.** Write a minimal Tiptap extension (`RichTextSlashExtension.ts`) that exposes a ProseMirror plugin. The plugin watches transactions, detects `/` at line-start or after whitespace (and not before `>`), tracks filter text, and stores `{visible, pos, filter}` in `editor.storage.slashCommand`. Mirrors the existing CodeMirror `SlashCommandExtension.ts` pattern.
- **Menu state binding.** `RichTextEditor.tsx` subscribes to editor `transaction` events; when `editor.storage.slashCommand` changes, sets local React state; renders `<RichTextSlashMenu>` with the current filter + cursor coords (via `editor.view.coordsAt(pos)`).
- **Menu UI.** New `RichTextSlashMenu.tsx`. Reuses the visual style of CodeMirror `SlashMenu.tsx` (grouped list, arrow nav, viewport flip) but with a Tiptap-command-shaped `MenuItem` interface (`{id, label, icon, category, run: () => void}`). 9 hard-coded items mapping to `editor.chain()` calls.
- **Trigger button.** Adds a `ToolButton` (Plus icon) to `RichTextToolbar.tsx`; onClick inserts `/` at cursor via `editor.chain().focus().insertContent('/').run()`. The inserted `/` is detected by the extension, opening the menu.
- **Keyboard shortcut.** `addKeyboardShortcuts` in the extension returns `{ 'Mod-/': () => editor.chain().focus().insertContent('/').run() }`.

## Decision (ADR-lite)

**Context**: Tiptap's official suggestion-based slash menu uses `@tiptap/suggestion` + `tippy.js`. The codebase already has a hand-rolled slash menu for CodeMirror (no tippy).

**Decision**: Write a minimal Tiptap extension + hand-rolled menu. Do NOT install `@tiptap/suggestion` or `tippy.js`.

**Consequences**:
- Pro: Zero new deps; consistent with existing CodeMirror slash menu pattern; smaller bundle.
- Con: We reimplement some positioning logic that tippy would give us for free.
- Risk: Future Tiptap updates may make `@tiptap/suggestion` easier; revisit if maintenance burden grows.

## Out of Scope (explicit)

- Floating "+" on empty lines (Notion-style) — separate feature.
- Custom user-defined slash commands.
- Rich blocks (callout/card/grid/steps/timeline/mermaid/etc.) — these are markdown directives; making them render in Tiptap requires a custom Tiptap Node extension per block type. Each is a separate task.
- AI/plugin-driven slash items (reusing ContainerRegistry for Tiptap).
- Slash menu theming beyond existing Tailwind tokens.

## Technical Notes

- Editor file: `apps/desktop/src/components/file-types/rich-text/RichTextEditor.tsx` — add extension to `useEditor({ extensions: [...] })`; subscribe to slash-menu state.
- Toolbar file: `apps/desktop/src/components/file-types/rich-text/RichTextToolbar.tsx` — add `ToolButton` for the trigger.
- New files:
  - `apps/desktop/src/components/file-types/rich-text/RichTextSlashExtension.ts` — Tiptap extension (ProseMirror plugin) detecting `/`, tracking filter, exposing state via `editor.storage.slashCommand`. Includes `addKeyboardShortcuts` for `Mod-/`.
  - `apps/desktop/src/components/file-types/rich-text/RichTextSlashMenu.tsx` — menu UI for Tiptap command list (9 items, grouped, keyboard nav, viewport flip).
  - `apps/desktop/src/components/file-types/rich-text/RichTextSlashExtension.test.ts` — unit tests for trigger conditions.
- Reference for trigger conditions: `apps/desktop/src/editor/extensions/SlashCommandExtension.ts` (CodeMirror).
- Reference for menu visual style: `apps/desktop/src/components/editor/SlashMenu.tsx`.

## Implementation Plan (small PRs)

- **PR1**: `RichTextSlashExtension.ts` + unit tests (trigger conditions, filter tracking, state storage). No UI.
- **PR2**: `RichTextSlashMenu.tsx` + wire into `RichTextEditor.tsx` (subscribe to storage, render menu, run command on select). End-to-end `/` typing works.
- **PR3**: Toolbar `Plus` button + `Mod-/` shortcut. Final manual test in dev server.
