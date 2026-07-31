# UX Optimizations: Markdown / Chat / FilePanel

## Goal

Six UX improvements bundled together: markdown preview source/preview toggle + justified text; remove calendar sidebar plugin; 1px file-panel divider; unified AI message header (provider icon + `provider|modelId`, left-aligned); file-panel multi-select batch delete/copy/move.

## What I already know (from repo exploration)

Tech stack: React 18 + TS + Tauri + Tailwind 3 + Zustand, single `index.css`, i18next. `dompurify` already a dependency.

### Per-item findings

1. **Markdown preview** — `apps/desktop/src/components/file-types/markdown/MarkdownPreview.tsx:345-526`. Unified pipeline (remark-parse → gfm → breaks → directive → remark-rehype `allowDangerousHtml:true` → rehypeRaw → rehypeHighlight → rehypeReact). No source/preview toggle today. Renders into `<div className="md-preview">` at line 520.
2. **Markdown text align** — `apps/desktop/src/index.css:305` `.md-preview` sets no `text-align` (browser default left).
3. **Calendar plugin** — registered at `apps/desktop/src/services/registerBuiltinPanels.tsx:126-134` (id `'calendar'`, `CalendarPanel`). Impl at `apps/desktop/src/components/sidebar/CalendarPanel.tsx`. Loosely coupled from the schedule workspace (route `'schedule'`, `ScheduleWorkbenchPage.tsx`, backed by `scheduleStore.ts`). Removal = delete registration block + `CalendarPanel.tsx` + `'calendar'` branch in appearance subscription (lines 146, 150-153). `enableDailyPanel` appearance flag becomes dead.
4. **File-panel divider** — `apps/desktop/src/components/sidebar/SidebarResizer.tsx:69` uses `w-0.5` (= 2px). Change to `w-px` (1px). Collapsed state uses `w-1.5` (leave).
5. **AI message header** — single shared renderer: `apps/desktop/src/components/chat/ChatMessageList.tsx:189-205` (`DefaultMessageRow`). Today: `{isAssistant ? <>AI <span ml-auto>{renderPairTag(msg)}</span> : '我'}`. Three pages share it:
   - Chat: `ChatMessageList.tsx`
   - AI Panel: `apps/desktop/src/components/ai/AiPanel.tsx:87-92` — `<span>{name} : {msg.model}</span>`
   - Pet Chat: `apps/desktop/src/components/pet/PetChat.tsx:195-200` — identical
   - Provider char icon exists: `services/providers/catalog.ts:68` `providerAvatarChar(e, t)` (first-char fallback). **No provider image/icon field exists today.**
6. **File-panel multi-select** — already exists! `apps/desktop/src/components/sidebar/FilesPanel.tsx:85` `selectedPaths: Set<string>`, meta-click toggle (line 149), shift-click range (line 165). Batch drag-move already works (`useDragDrop({ selectedPaths, moveFiles: vaultMoveFiles })`). Store primitive `vaultMoveFiles(paths: string[], target)` already array-based. **Gap**: `SidebarActions.tsx` `deleteItem`/`MoveDialog`/`onStartCopy` and `ContextMenu.tsx:181-188` operate on a single `menu.path`. Extend to accept `string[]` (fall back to `[path]` when `selectedPaths.size <= 1`), add batch entry in `ContextMenu` when `selectedPaths.size > 1`.

## Assumptions (temporary, to validate)

- Markdown "源码" = raw markdown text shown in a `<pre>`. "预览" = current rendered view. Default state = preview (preserve current behavior).
- Rendered preview should run DOMPurify before inject (current `allowDangerousHtml:true` + rehype-raw is unsanitized — security improvement).
- `{provider}` in header = provider **display name** (e.g. "OpenAI"), not raw engine id. Separator `|` (pipe) per user spec.
- Calendar sidebar plugin removal is full removal (delete files + registration + appearance flag), not feature-flag hide.
- Multi-select batch: when `selectedPaths.size > 1`, batch action operates on the whole set; when `size === 1` or zero, falls back to single-path behavior (no regression).

## Open Questions

- ~~Q1: provider icon scope~~ — answered: SVG for top providers + char fallback.

## Decisions

- **Provider icons**: inline SVG path registry (no new dep) for the 8 top providers: anthropic, openai, gemini, deepseek, xai, openrouter, ollama, groq. Source SVG paths from `simple-icons` (public domain / CC0) — inline only, no npm install. Char fallback (`providerAvatarChar`) for the rest (cohere, huggingface, moonshot, together, perplexity, azure-openai, compat escape-hatches, custom providers).
- **Header layout**: `[16x16 SVG or char badge] {providerDisplayName}|{modelId}`, left-aligned, drop `"AI"` literal, drop `ml-auto`.
- **Markdown source view**: raw markdown text in a `<pre>` (no syntax highlight — keep it minimal). Default state = preview. Toggle icons in a small toolbar above the rendered output.
- **DOMPurify**: applied to rendered HTML before React injection (security improvement on top of current `allowDangerousHtml:true` + rehype-raw).
- **Calendar removal**: full deletion (files + registration + appearance subscription branch + dead `enableDailyPanel` flag), not a feature flag.
- **Multi-select batch**: when `selectedPaths.size > 1`, all of delete/move/copy operate on the array; `size <= 1` falls back to single-path (no regression).

## Requirements (evolving)

1. Markdown preview: add a toggle with two icons (source / preview). Source shows raw markdown text. Preview shows rendered output. Rendered output runs DOMPurify. Default = preview.
2. Markdown preview: `text-align: justify` on `.md-preview` (preserve `th/td` left align override).
3. Remove calendar sidebar plugin: delete `CalendarPanel.tsx`, registration block in `registerBuiltinPanels.tsx`, appearance subscription branch, dead `enableDailyPanel` flag. Schedule workspace (`/schedule` route, `ScheduleWorkbenchPage`) remains intact.
4. File-panel divider: `w-0.5` → `w-px` in `SidebarResizer.tsx`.
5. AI message header (shared `DefaultMessageRow`): replace literal `"AI"` with `[provider-icon or char] {providerDisplayName}|{modelId}`, left-aligned (drop `ml-auto`).
6. File-panel multi-select batch actions: extend `SidebarActions` (`deleteItem`, `MoveDialog`, `onStartCopy`) and `ContextMenu` to accept `string[]`; show batch entry when `selectedPaths.size > 1`.

## Acceptance Criteria (evolving)

- [ ] Markdown preview: clicking source icon shows raw markdown; clicking preview icon renders; default is preview.
- [ ] Markdown preview: raw `<script>` in markdown source does not execute in preview (DOMPurify).
- [ ] `.md-preview` paragraph text is justified.
- [ ] Calendar plugin no longer appears in sidebar; schedule workspace route still works.
- [ ] File-panel divider is 1px wide.
- [ ] AI message header shows `[icon] OpenAI|gpt-4o` (example), left-aligned, no "AI" string, across Chat / AI Panel / Pet Chat.
- [ ] Multi-select 3 files → context menu shows batch delete/copy/move; single-select path unchanged.
- [ ] Batch delete confirmation dialog shows count; batch move/copy moves all paths to target dir.

## Definition of Done

- Lint / typecheck / build green.
- Manual smoke: each of 6 items verified in `pnpm dev`.
- No regressions in schedule workspace, file-panel single-select actions, or chat rendering.

## Out of Scope

- SVG icons beyond the 8 top providers (cohere / huggingface / moonshot / together / perplexity / azure-openai / compat / custom) — char fallback covers them.
- Syntax highlighting in markdown source view (plain `<pre>` only).
- Schedule workspace feature changes (only calendar sidebar plugin removed).
- File panel multi-select UX changes beyond batch actions (e.g., marquee select, keyboard modifiers beyond existing meta/shift).
- Markdown editor changes (preview-only).

## Technical Notes

- `dompurify` already in `apps/desktop/package.json`, imported in `components/pet/bubbleTemplate.ts:15`.
- Single edit point for AI header: `ChatMessageList.tsx:189-205`. AIPanel/PetChat pass `renderPairTag` — will need to align the format `provider|modelId`.
- Store primitive `vaultMoveFiles(paths: string[], target)` already array-based — no store change needed for batch move. `vaultDeleteFile` / `vaultDeleteDir` are single-path; either add `vaultDeletePaths(paths: string[])` or loop with classification.
