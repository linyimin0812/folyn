# brainstorm: inbox tab → command + extension-tool popup

## Goal

Remove the Inbox tab from the pet panel (`pet-panel` window). The inbox becomes
a command ("Open Inbox" / 打开收件箱) that opens the existing notification list
in the **extension-tool popup** window (`extension-tool-panel`, the same
machinery as the built-in translation popup). Panel keeps only Chat (plus the
unified search).

## Decisions (user-confirmed 2026-09-19)

* Panel header: the whole tab row is removed — search + Chat body only.
* Popup behavior: floats over the user's current app WITHOUT switching to
  Folyn (translation-popup parity: no focusMain on the panel-search path,
  hide the panel with `restoreFocus: true`).

## Requirements

* Pet panel: no Inbox tab (no tab row at all); body = search results (query
  non-empty) else Chat.
* Registered command `action.open-inbox` ("Open Inbox", zh keywords 收件箱/
  通知) opens the inbox in the extension-tool popup (`builtin:inbox`, React
  host, no iframe). Available in the main palette AND the pet-panel search
  Commands group.
* Popup realm wiring mirrors TranslationToolHost (subset): theme, locale,
  `pet://settings-updated` hydrate + `pet://settings-request`, then
  markSettingsHydrated so clear/remove persist directly to
  ~/.folyn/storage/pet.json + broadcast (fs grant already in
  capabilities/extension-tool.json).
* Panel-search activation of the inbox command hides the panel with
  restoreFocus and skips focusMain in petHostRouter (float, no app-switch,
  no blur race).

## Acceptance Criteria

* [x] Pet panel renders no tab row; search + chat only; tab i18n keys/CSS
      removed from all 6 locales.
* [x] "Open Inbox" command appears in main palette + panel search; running
      it opens the popup listing persisted inbox items.
* [x] Popup clear/dismiss persists (pet.json) and syncs to other realms;
      new notifications update the open popup (via pet://settings-updated).
* [x] Opening from panel search does not switch apps (popup floats).
* [x] Updated tests green (PetPanelApp 26, ExtensionToolApp 8,
      commandRegistry 16; tsc clean).

## Technical Approach

* `PetPanelApp.tsx` — removed `PetPanelTab`, tab state/nav, `PetInbox`
  import; body renders search results or `AiPanel`.
* `commandRegistry.ts` — `action.open-inbox` (registered after
  action.toggle-focus-mode) whose `run()` invokes
  `open_extension_tool_window { builtin:inbox }` (same payload shape
  petHostRouter uses for builtin:translation).
* `petHostRouter.ts` — `run-command` skips `focusMain()` for
  `action.open-inbox`.
* `PetPanelSearchResults.tsx` — command branch hides the panel with
  `{ restoreFocus: true }` for `action.open-inbox`.
* `ExtensionToolApp.tsx` — `BUILTIN_TOOL_IDS` set; `builtin:inbox` renders
  `InboxToolHost`; iframe only for non-builtin ids.
* `InboxToolHost.tsx` (new) — realm wiring (theme/locale/settings hydrate +
  request, disposed-flag unmount race guard) + renders `PetInbox`.
* `pet.css` — removed dead tab styles; `.pet-inbox-*` kept (unscoped, apply
  in the popup window); comment updated.
* i18n — `tabs.{chat,inbox}` removed from en/zh/ja/de/fr/es.

## Decision (ADR-lite)

**Context**: The inbox needed a new entry point after tab removal, and the
user asked for "open as a command" + "use the extension popup".
**Decision**: Register a real command-registry command whose run() opens the
extension-tool-panel with a builtin:inbox React host; hardcode the id in the
two routing special cases (router focusMain skip, search restoreFocus hide),
mirroring the existing builtin:translation special cases.
**Consequences**: Single open path (the command's run); two small id
special cases (same pattern the codebase already uses for
builtin:translation); if a second popup-command appears later, promote the
special cases to a Command flag.

## Out of Scope

* No changes to notification capture/dispatch (petNotifyDispatcher).
* No per-tool popup sizing; reuse the static 800×600 window.
* No relative-time formatting / inbox features beyond current list.

## Technical Notes

* Files: `apps/desktop/src/components/pet/PetPanelApp.tsx`,
  `components/pet/InboxToolHost.tsx` (new), `components/pet/ExtensionToolApp.tsx`,
  `components/pet/PetPanelSearchResults.tsx`, `components/pet/PetInbox.tsx`
  (comment), `components/pet/pet.css`, `services/commandRegistry.ts`,
  `services/petHostRouter.ts`, `store/petStore.ts` + `store/settingsPersistence.ts`
  (comments), 6× `i18n/locales/*/pet.json`, tests: PetPanelApp /
  ExtensionToolApp / commandRegistry.
* Precedent: PRD 09-18-translation-popup-refactor (builtin React tool host).
* `registerBuiltinCommands()` is App.tsx-init only — tests seed stand-in
  commands (pet-test ids / invoke mock) instead.
* Verification: `npx vitest run --project desktop` on the touched files
  (50+8+20+30 pass; petPosition/PetLauncher failures pre-exist on clean
  master — verified via git stash) + `tsc --noEmit` exit 0.
