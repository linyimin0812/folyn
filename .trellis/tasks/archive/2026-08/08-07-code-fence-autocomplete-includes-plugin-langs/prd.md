# Code-fence autocomplete includes plugin-contributed languages

## Goal

In the Markdown editor, typing ``` shows a language picker popup. Currently it only lists highlight.js languages plus the hardcoded `mermaid` and `html` extras. Plugin-contributed `markdownCodeRenderers` and `editorLanguages` (e.g. plantuml + aliases puml, pu) are missing. Fix it so they appear.

## What I already know

- `apps/desktop/src/editor/extensions/CodeBlockExtension.ts:12-23` `getAllLanguages()` builds the popup list from `hljs.listLanguages()` + two hardcoded extras; module-level cache `cachedLanguages` never invalidated.
- `apps/desktop/src/services/plugin-host/markdownCodeRendererAdapter.ts` has a `renderers` Map keyed by `language` + each alias — but no list enumerator.
- `apps/desktop/src/services/plugin-host/editorLanguageAdapter.ts` already exposes `listEditorLanguages()` returning `{ canonical, aliases, factory }[]`.
- PlantUML plugin manifest declares renderer `{language: "plantuml", aliases: ["puml","pu"]}` and editor language `{id: "plantuml", aliases: ["puml","pu"]}`.
- Builtin `registerBuiltinCodeContributions()` runs at module load; plugins load asynchronously via trusted loader afterward.

## Requirements

- `getAllLanguages()` in `CodeBlockExtension.ts` includes plugin-contributed renderer languages (canonical + aliases) and editor-language aliases.
- Filter still matches both name and label as before.
- No regressions for builtin entries (mermaid, html, all hljs langs).

## Acceptance Criteria

- [ ] After plugin load, typing ` ``` ` in markdown editor shows `plantuml`, `puml`, `pu` in the popup.
- [ ] Typing `mer` still shows `mermaid`.
- [ ] Typing `js` still shows `javascript`.
- [ ] No duplicate entries.
- [ ] Existing CodeBlockExtension tests still green.

## Definition of Done

- Tests added/updated (unit for the merge logic).
- Lint / typecheck / CI green.
- Docs not affected (no behavior change visible to plugin authors — they already declare contributions).

## Technical Approach

1. Add `listMarkdownCodeRendererLanguages()` to `markdownCodeRendererAdapter.ts` returning `{name, label}[]` from the `renderers` Map keys.
2. In `CodeBlockExtension.ts` `getAllLanguages()`, merge: hljs list + extras + renderer langs + editor langs (canonical + aliases). Dedup by name.
3. Drop the module-level `cachedLanguages` cache (or invalidate it when a plugin loads). Lazy rebuild per call is cheap enough (sub-ms, called only while popup visible).

## Out of Scope

- Live migration of already-open CodeMirror editors for `editorLanguages` (already documented limitation, MVP).
- Reordering / priority (alphabetical sort keeps current UX).
- Plugin-contributed completions beyond name (e.g. icons, descriptions in popup).

## Technical Notes

- Files to touch:
  - `apps/desktop/src/services/plugin-host/markdownCodeRendererAdapter.ts` (add enumerator)
  - `apps/desktop/src/editor/extensions/CodeBlockExtension.ts` (merge + drop cache)
- No new dependencies.
- `CodeBlockExtension.ts` is in the desktop editor bundle; both adapters are already imported elsewhere in the editor layer.
