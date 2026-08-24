# Unified Command Palette (Cmd+P)

## Goal

Add a unified command palette (⌘P) to Folyn — a single keyboard-driven overlay for
jumping to files, switching panels/modes, and triggering actions (export, theme
toggle, daily note, new file, …). Today every navigation is a mouse trip to the
ActivityBar/Topbar/AI tabs; a command palette collapses all of them into one
keystroke. Pattern is well-established (VS Code Cmd+P / Linear / Raycast).

## What I already know

- Global keydown handler lives in `apps/desktop/src/App.tsx` (~line 114):
  Cmd+S (save), Cmd+Shift+F (search), Cmd+D (daily note). Cmd+P will hook here.
- `searchStore` + `components/search/GlobalSearchPanel.tsx` is the closest analog
  (overlay + query + filtered results) — palette can mirror this structure.
- Existing dialog/overlay components use a `.dlg` class + Tailwind tokens
  (`IngestDialog`, `DeepResearchDialog`) — reuse for the palette chrome.
- Navigation targets already exist as store actions: `editorStore.openFile` /
  `openDailyNote`, `editorStore` view-mode + `settingsStore` active panel /
  `aiStore.chatMode`, `useExport`, `useTheme.toggleTheme`, etc.
- Tauri 2 + React 18 + Zustand 5 + Tailwind. No fuzzy-match lib in repo today.

## Assumptions (temporary)

(none — all resolved into Decisions below)

## Requirements

- ⌘P / Ctrl+P opens the palette; Esc, blur, or ⌘P again closes it.
- Arrow Up/Down moves selection; Enter runs the highlighted command; Tab is a no-op (MVP).
- A built-in subsequence fuzzy scorer filters items by title (no new dependency).
- Three command sources, all in one registry:
  - **Actions**: new file, new folder, daily note (⌘D parity), export MD/HTML/PDF, toggle theme, open global search (⌘Shift+F parity), open settings.
  - **Panels/Modes**: switch ActivityBar panel (files/clips/wiki/analyze/calendar/settings), switch view mode, switch AI chat mode.
  - **Files**: open any file in the vault (reuses `vaultStore` file tree — no separate index).
- Empty query shows a grouped default list: Actions → Panels/Modes → Recent Files → All Files.
- File list is capped in the rendered list (e.g. top 50 by score / recency) to bound DOM size for large vaults; no full virtualization in MVP.
- Palette reuses `.dlg` overlay styling; keyboard-first.

## Acceptance Criteria

- [ ] ⌘P / Ctrl+P toggles the palette open/closed; Esc and blur close it.
- [ ] Arrow Up/Down moves the selection; Enter executes the highlighted command and closes the palette.
- [ ] Typing filters items via a built-in fuzzy subsequence scorer (matched substring highlighted).
- [ ] Empty query renders the grouped default list (Actions / Panels-Modes / Recent Files / All Files).
- [ ] Selecting a file command opens the file via `editorStore.openFile`.
- [ ] Selecting a panel/mode command switches the relevant store (ActivityBar panel / view mode / AI chat mode).
- [ ] Selecting an action command triggers the underlying action (new file / export / theme / daily note / search / settings).
- [ ] No-match state shows an empty hint; large vault file list is capped.
- [ ] Palette reuses `.dlg` styling (consistent with IngestDialog/DeepResearchDialog).
- [ ] Unit tests for the command registry + fuzzy scorer; tsc + build + existing 465 tests green.

## Definition of Done

- Tests added/updated (unit for the command registry + fuzzy scorer).
- Lint / typecheck / build green.
- No new runtime dependency (built-in fuzzy scorer).

## Decision (ADR-lite)

**Context**: Folyn has many navigation surfaces (ActivityBar, Topbar, AI tabs, GlobalSearchPanel) each mouse-driven. A unified ⌘P collapses them. Command palette is an established pattern; the open questions are scope, fuzzy match, and default ordering.

**Decision**:
- Scope = all three sources (files + panels/modes + actions) in one registry.
- Fuzzy = built-in subsequence scorer with word-boundary/contiguity weighting (no new dep).
- File source = reuse `vaultStore` file tree (already loaded + watched); no separate index.
- Empty query = grouped default list (Actions → Panels/Modes → Recent Files → All Files).
- Single palette (no `>`/`#` prefix modes, no Cmd+Shift+P split); recency ranking is out of scope.

**Consequences**:
- + One keystroke for all navigation; registry is the future extension point for custom/prefix commands.
- − Built-in scorer is simpler than fuse.js (no typo tolerance); acceptable for the item count.
- − Reusing the file tree means file results reflect the watched tree (excludes `__*__` special dirs by default — consistent with the file panel).

## Out of Scope (explicit)

- Custom user-defined commands / plugin extension surface (registry is ready, but no UI to add).
- Prefix modes (`>` commands, `#` tags, `@` files).
- Cmd+Shift+P "all commands" split (single palette only).
- Recency-based ranking beyond "Recent Files" group (no persisted command history).
- Full list virtualization (cap instead).
- File-content search (that's GlobalSearchPanel / Cmd+Shift+F).

## Implementation Plan (small PRs)

- **PR1 — Registry + fuzzy scorer + store**: `commandRegistry.ts` (command type + built-in commands), `fuzzyMatch.ts` (subsequence scorer + highlight), `commandPaletteStore.ts` (open/close, query, filtered+grouped results, selection index). Unit tests for registry + scorer.
- **PR2 — Palette UI + ⌘P wiring**: `CommandPalette.tsx` (`.dlg` overlay, input, grouped list, keyboard nav, highlight), wire ⌘P/Ctrl+P into `App.tsx` keydown handler.
- **PR3 — Wire all commands + polish**: populate file commands from `vaultStore` tree, panel/mode commands, action commands; empty-state hint; render cap; final test/tsc/build pass.

## Technical Notes

- `apps/desktop/src/App.tsx:114` — global keydown handler (add ⌘P/Ctrl+P, toggle close on repeat).
- `apps/desktop/src/store/searchStore.ts` + `components/search/GlobalSearchPanel.tsx` — overlay + query + results pattern reference.
- `components/ai/IngestDialog.tsx`, `DeepResearchDialog.tsx` — `.dlg` dialog styling reference.
- Store actions to wire as commands: `editorStore.openFile/openDailyNote`, `settingsStore` (active panel, theme), `aiStore.chatMode`, `useExport`, `useTheme`, `vaultStore` file tree for file commands.
- `vaultStore` excludePatterns hides `__*__` special dirs from the tree — file commands inherit that.
