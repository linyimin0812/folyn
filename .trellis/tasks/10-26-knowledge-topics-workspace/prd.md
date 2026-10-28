# Configurable topics and a redesigned knowledge workspace

## User request

The current UI remains difficult and unattractive. Support configuring multiple topics and provide a refined, fluid experience. Earlier row-level styling changes did not resolve the overall information architecture.

## Known constraints

- Current `KbManifest.goal/scope` are vault-wide; `topics` means model-generated knowledge pages, not user-configured scopes. These concepts must be separated before modifying storage.
- Confirmed by user: each configured theme owns its independent goal, source range and generated results. Ask, reviews, citations and deletion intents must follow this boundary.
- Preserve all existing dirty code, including ongoing Rust/provider fixes. No full project build/compile.

## Design requirements already clear

- Topic switching/creation/configuration should be first-class, not buried among generated pages.
- Separate user-configured topic from generated knowledge page in visible terminology and domain model.
- Show one clear next action for each state: no topic, configured but no sources, ready to organize, organizing, ready to read, failures/review.
- Routine source intake must not require opening broad settings or repeatedly saving unrelated configuration.
- Keep navigation/context stable; avoid full content remounts and lost draft/scroll positions on routine actions.
- Replace the stack of equal-looking sections/buttons with a coherent workspace header, topic navigation, content surface, and contextual inspectors/dialogs.
- Use existing Folyn shell/theme tokens and purposeful Lucide icons; precise typography, restrained surfaces, native focus/keyboard behavior, responsive layouts.
- Use short interruptible transitions for meaningful state changes; honor reduced motion. Smoothness must also come from preserved state and responsive controls.
- All final production actions must connect to real store/services. Prototypes must be visibly distinguished from implementation and use no real data writes.

## Confirmed scope and acceptance

- A Vault contains multiple user-configured themes. Each theme has a stable id, name, goal, source selection and independently generated knowledge pages.
- Create, select and configure themes through a coherent polished workspace. Distinguish themes from generated knowledge pages in copy.
- Persist theme selection/configuration; isolate generated files, indices, navigation, review, citation, deletion-intent and retrieval cache by theme.
- Switching themes must never redirect ongoing writes or display another theme's delayed results. Preserve useful view/question state within the session.
- Existing sources may be selected by multiple themes; source files remain Vault-relative.
- No automatic legacy data migration, compatibility paths or deletion of old data.
- Preserve existing stream detail diagnostics and model/provider changes.
- Targeted tests for persistence/isolation/races, and visual interaction verification of actual components. No whole-project builds.

## 2026-10-28 regression: provider/model selection

User reports model service provider can no longer be selected. Reproduce actual selection path (not a stubbed PairSelector), restore accessible provider/model choice in knowledge workflow and a working settings entry when none enabled. Check clipping and save persistence; preserve existing dirty code. No full builds.

## 2026-10-28 density and file-list consistency

User requests knowledge file selection list match left file sidebar styling and exact file icons; increase overall knowledge UI information density. Reuse FileIcon and sidebar row metrics/tokens, compact header/tabs/forms/list paddings and reading whitespace while preserving readable typography, functional checkboxes/inheritance/search and model picker visibility. Verify against actual sidebar implementation, no full builds.

## Input focus styling

Use Folyn form focus treatment for knowledge inputs, keep keyboard focus visible and remove textarea resize handles across knowledge flows.

## Folder interaction

In the scope picker, folder names expand/collapse; only their checkbox selects a folder. File selection, nested inheritance, search and keyboard interaction remain functional.

## Theme switcher visual refinement

Refine the left knowledge theme switcher with compact Folyn styling, clear current selection and separate create action; preserve native select keyboard access, loading/empty states and persisted switching.

## Theme menu

Use a custom Folyn-styled theme dropdown (not the platform select menu). Support pointer and keyboard selection, Escape, outside dismissal, active indication, and empty/loading states.
