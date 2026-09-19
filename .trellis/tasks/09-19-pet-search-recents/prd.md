# pet panel search: 最近使用 recents row (recently used EXTENSIONS)

## Goal

When the caret is in the pet panel's search box, show a row of recently used
EXTENSIONS (plugins / builtin tool popups) below it — each chip an icon +
display name. Clicking a chip re-opens that tool's popup (same path as a
picked search row; the panel hides restoring focus). When the caret is in the
chat input (or anywhere outside the search area), the row is hidden.

## History / interpretation fixes

1. First read: "只显示图标和扩展名" → file extensions; user confirmed
   file-type chips with click-to-filter in a question round.
2. Follow-up "只显示最近使用扩展，不要文件" → misread again (dotted labels).
3. "为什么还是显示的markdown图标和.md" + question round → 扩展 means
   EXTENSIONS (plugins/tools — same sense as the search placeholder
   "文件 / 命令 / 扩展"), not file extensions. File-type chips fully removed.
4. "最近使用怎么还是显示md" → stale persisted data: the old build had
   written FILE extensions into pet.json under the key `recentExtensions`;
   the rework changed semantics but kept the key, so old 'md' hydrated as a
   bogus "extension". Fix: renamed the persisted key to
   `recentExtensionIds` — hydrate only picks PERSIST_KEYS_PET keys (old key
   ignored), and the next persist drops it from pet.json. Regression test
   added.

## Decisions (user-confirmed)

* Chips = recently used EXTENSIONS (icon + display name), NOT files / file
  types.
* Click = re-open that extension's tool popup (open-extension-tool path);
  panel hides with restoreFocus.
* "使用" = opening an extension tool window / builtin popup, from ANY entry
  (panel search, chips, ⌘P, settings).

## Requirements

* `/` prefix in the pet-panel search = extension browse mode for the
  EXTENSIONS group only (user convention): bare `/` lists EVERY extension;
  `/xyz` filters extensions by `xyz`. Files / commands keep their NORMAL
  whole-query substring matching — a bare `/` still matches every file in a
  directory (path contains `/`), so the scrollable mixed extensions+files
  list stays (user-confirmed: "之前是可以滚动的，会显示扩展还有文件"; the
  first cut suppressed the files group and was rolled back). Rationale for
  the extension fix: `/` as a plain substring matched only extensions whose
  text happened to contain a slash (the "只显示了部分" bug).
* petStore `recentExtensions` stores EXTENSION IDS (MRU, deduped, capped 8,
  persisted + synced to the panel realm via the settings broadcast).
* Recording at the open sites (all main-window realm):
  - `toolWindowStore.open` (success-only) — every third-party tool
    (`extension.openTool.*` commands route here);
  - `petHostRouter` open-extension-tool builtin:translation branch;
  - `commandRegistry` `action.open-inbox` run() (sole owner of that open —
    petHostRouter's builtin:inbox branch routes back to the command).
* `editorIoService.openFile` no longer records anything (hook removed).
* New `PetSearchRecents` component: chips resolve icon + name from
  `extensionStore` rows (same realm, refreshed on mount);
  `builtin:inbox` has no row → static fallback (lucide Inbox icon +
  `pet:search.recentsInbox`). Click → exported `emitOpenExtensionTool`.
* PetPanelApp renders it focus-gated (area-scoped focusin/focusout +
  relatedTarget containment; unchanged from the first version).
* Panel settings listener emits `pet://settings-request` on mount (kept —
  recentExtensions must reach a late-mounting panel).

## Acceptance Criteria

* [x] Row hidden when the search input is not focused (chat caret).
* [x] Row appears with icon+name chips when the search input gains focus;
      no row when the list is empty.
* [x] Focus onto a chip keeps the row; focus out of the area hides it.
* [x] Chip click emits open-extension-tool for that extension and hides the
      panel with restoreFocus.
* [x] No file-type chips anywhere (FileIcon/toggle-filter removed).
* [x] recordRecentExtension: id MRU front-insert, dedupe, trim, empty no-op,
      cap 8, no persist churn when already at front; hydrate coerces.
* [x] Open sites record (toolWindowStore, builtin:translation, inbox
      command); openFile records nothing.
* [x] Tests: PetPanelApp 38/38, petStore 31/31, editorIoService 7/7,
      commandRegistry 21/21, petHostRouter 21/21; tsc clean on my files
      (project has unrelated errors in the user's in-flight MarkdownPreview
      edits).

## Out of Scope

* No chip keyboard navigation beyond natural Tab order (Arrow/Enter keep
  driving the results list).
* "使用" does NOT include extension commands / file-viewer usage — only tool
  window / popup opens.
* Main palette (⌘P) unchanged.

## Technical Notes

* Files: `store/petStore.ts`, `store/toolWindowStore.ts`,
  `services/editorIoService.ts`, `services/commandRegistry.ts`,
  `services/petHostRouter.ts`, `components/pet/PetSearchRecents.tsx` (new),
  `components/pet/PetPanelApp.tsx`, `components/pet/PetPanelSearchResults.tsx`
  (export emitOpenExtensionTool), `pet.css`, 6× pet.json
  (`search.recentsChip` → Reopen {{name}}; new `search.recentsInbox`).
* Chip icon/name resolution mirrors the search results' extension rows
  (ExtensionIcon + nameKey/entry.name).
