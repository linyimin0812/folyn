# wiki sidebar header add query button

## Goal

Add a button in the WIKI sidebar header (next to the existing "open graph" button) that opens the wiki-query tab. Uses `wiki_query.svg` as the icon.

## Requirements

- New button in `WikiFileTree.tsx` header next to the wiki-graph open button.
- Icon: `@/assets/icons/wiki_query.svg` (already exists, used elsewhere).
- Click opens the wiki-query tab via `editorIoService.openFile('wiki-query', 'Wiki Query')`.
- Title attribute uses an i18n key (add `sidebar:wikiTree.openQuery` to en/zh/ja).

## Acceptance Criteria

- [ ] Wiki sidebar header shows two icon buttons: graph + query.
- [ ] Clicking the query button opens the wiki-query tab.
- [ ] Hover tooltip is localized in en/zh/ja.

## Out of Scope

- Reordering other header buttons.
- Changes to wiki-query view internals.
