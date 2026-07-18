# Remove Chat/Wiki/Clip Tabs from AI Panel

## Goal

Remove the Chat/Wiki/Clip tab bar from `AiPanel.tsx` and all sub-components/state that only exist to serve those wiki/clip tabs. The AI Panel becomes a single-mode chat panel; wiki/clip access remains in the sidebar (WikiFileTree, ClipsPanel, ContextMenu's "ingest" action).

## Requirements

- Delete the tab bar UI (the three `<button>` blocks for Chat/Wiki/Clip) in `AiPanel.tsx`.
- Remove `AiChatMode` type, `chatMode` state, `setChatMode` action from `aiStore.ts`.
- Remove `modeSessionRef` and `handleModeSwitch` from `AiPanel.tsx`.
- Remove `chatMode === 'wiki'` / `'clip'` conditional branches: WikiToolbar, ClipToolbar, WikiActivityLog, ReviewItemList, IngestDialog render, DeepResearchDialog render.
- Remove `handleSaveToWiki`, `handleIngest`, `handleLint`, `showIngestDialog`, `showDeepResearch` state + handlers (only used by wiki/clip tab branches).
- Remove the `/clip <url>` slash-command branch in `handleSend` (clip-only behavior).
- Delete the now-orphaned component files: `WikiToolbar.tsx`, `ClipToolbar.tsx`, `WikiActivityLog.tsx`, `ReviewItemList.tsx`, `IngestDialog.tsx`, `DeepResearchDialog.tsx`.
- Update `aiStore.test.ts` to drop `chatMode` assertions (line 54 setState, line 256 expect).
- Update `CommandPalette.tsx` comment that references `IngestDialog`/`DeepResearchDialog`.
- Keep `wikiIngestService`/`wikiLintService`/`wikiQueryService` — `runIngest` is still used by `ContextMenu.tsx`; services are broader infra, not tab-scoped.

## Acceptance Criteria

- [ ] `AiPanel.tsx` no longer renders a tab bar and no longer references `chatMode`.
- [ ] `aiStore.ts` no longer exports `AiChatMode` / `chatMode` / `setChatMode`.
- [ ] The 6 deleted component files no longer exist on disk.
- [ ] `tsc --noEmit` and lint pass.
- [ ] `aiStore.test.ts` passes after removing `chatMode` assertions.
- [ ] AI Panel still sends chat messages (rig mode + CLI adapter mode) end-to-end.

## Definition of Done

- Type-check / lint / affected tests green.
- Manual smoke: open AI panel, send a message, get a reply; close panel.

## Out of Scope

- Sidebar WikiFileTree / ClipsPanel / ContextMenu ingest — untouched.
- Services (`wikiIngestService`, `wikiLintService`, `wikiQueryService`) — kept.
- `DiffView.tsx` (already orphaned, misnamed) — untouched.
- `petChatStore` / `PetChat` — untouched.

## Technical Approach

Single PR: edit `AiPanel.tsx` + `aiStore.ts` + `aiStore.test.ts` + `CommandPalette.tsx` comment, then `rm` the 6 component files. No migration shims (chatMode is component-local state, not persisted).

## Technical Notes

- `chatMode` is referenced only in `AiPanel.tsx` + `aiStore.ts` + `aiStore.test.ts`. `chatModel` is a separate unrelated field (LLM model name) — do not touch.
- Sidebar paths into wiki/clip features (`WikiFileTree.tsx`, `ClipsPanel.tsx`, `ContextMenu.tsx`) stay intact.
