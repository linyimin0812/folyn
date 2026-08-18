# Wiki Feature CLI Adapter Switch

## Goal

Add an independent CLI adapter (Claude Code / Pi / …) config for the Wiki feature agent, so that switching the global `aiConfig.cliAdapter` (chat panel selector) does NOT drag the Wiki query/ingest flow with it. The config item lives on the WIKI row of the Plugins settings page.

## What I already know

* Wiki query/ingest use `createAdapter(aiConfig.cliAdapter)` — see `apps/desktop/src/services/wikiQueryService.ts:60` and (likely) `wikiIngestService.ts`.
* Global adapter is set in chat panel via `AdapterSelector.tsx` → `useAiConfigStore.setCliAdapter`. Plugins settings page (`PluginsSettings.tsx`) only has a Toggle for `builtin:wiki` (binds `appearanceStore.enableWikiPanel`).
* Adapter registry (`packages/cli-adapter/src/registry.ts`) currently has two adapters: `claude`, `pi`. Each has its own `cliPaths[adapterId]` (per-adapter binary path stored in `aiConfigStore`).
* Wiki runs in feature-agent mode via `getFeatureAgentSendOptions('wiki')` → seeds canonical agent file under `<vault>/__wiki__/.claude/agents/wiki.md` (claude side) + pi context (see `featureAgentService.ts:269`). Switching adapter still works; seeding is idempotent.

## Assumptions (temporary)

* Only wiki needs this in MVP — clips / analyze / schedule / study keep following the global adapter.
* The per-adapter binary path (`cliPaths[adapterId]`) is reused; no separate path override per feature.
* Wiki adapter choice is persisted across sessions (storage.json).

## Resolved Decisions

* **UI**: inline AdapterSelector-style dropdown under each builtin feature row in Plugins settings. Hidden when only one adapter is registered.
* **Default**: fallback to global. Service reads `featureCliAdapter[feature] ?? cliAdapter`. Existing users see no behavior change until they explicitly pick.
* **Storage**: `featureCliAdapter: Record<string, string>` keyed by feature id. Empty `{}` by default.
* **Coverage**: all feature agents — wiki (query + ingest + lint), clips, analyze, schedule (planMyDay), study.
* **Builtin rows**: add `builtin:schedule` and `builtin:study` to `pluginStore.BUILTIN_PANELS`, with new `enableSchedulePanel` / `enableStudyPanel` flags in appearanceStore (default `true`, persisted). Toggle has no panel-side effect yet — user explicitly accepted this (default-on placeholder Toggle).

## Scope (MVP)

* New `featureCliAdapter` field + setter in `aiConfigStore`, persisted, hydrate-guarded.
* 5 service call sites switched over:
  - `apps/desktop/src/services/wikiQueryService.ts:60`
  - `apps/desktop/src/services/wikiIngestService.ts:109`
  - `apps/desktop/src/services/wikiLintService.ts:152`
  - `apps/desktop/src/services/clipService.ts:138`
  - `apps/desktop/src/services/planMyDayService.ts:357`
  - `apps/desktop/src/services/githubAnalysisService.ts:183`
* `apps/desktop/src/components/ai/adapterManager.ts:6` — `getAdapterForSession` takes `feature` id; reads `featureCliAdapter[feature] ?? cliAdapter`. Study caller passes `'study'`.
* `apps/desktop/src/store/appearanceStore.ts` — add `enableSchedulePanel` / `enableStudyPanel` flags (default `true`) + setters + persist keys.
* `apps/desktop/src/store/pluginStore.ts:90-92` — add `builtin:schedule`, `builtin:study` rows.
* `apps/desktop/src/components/settings/PluginsSettings.tsx` — render an adapter dropdown (mirror `AdapterSelector` visuals) inside each builtin row that supports a feature agent.
* i18n: add `settings:appearance.panels.schedule.label` / `.description`, `settings:appearance.panels.study.label` / `.description`, and a "CLI" tooltip label across zh/en/ja/fr/es/de.
* Tests: aiConfigStore field + hydrate; adapterManager feature-id fallback; one service smoke test verifying the new field is read.

## Acceptance Criteria

* [ ] Switching global `aiConfig.cliAdapter` in chat panel does NOT change any of the 5 feature agents once they have a `featureCliAdapter[feature]` set.
* [ ] Switching a feature's adapter in Plugins settings changes that feature's next run.
* [ ] Setting persists across app restarts.
* [ ] When only one adapter is registered, the dropdown is hidden.
* [ ] `builtin:schedule` and `builtin:study` rows appear in Plugins settings with Toggle on by default; toggling them off persists but has no other effect (placeholder).
* [ ] Study session picks up `featureCliAdapter.study` on first call after switch (new session).

## Out of Scope (explicit)

* Wiring `enableSchedulePanel` / `enableStudyPanel` flags to actual sidebar panels (separate task).
* Per-feature CLI binary path override (reuses `cliPaths[adapterId]`).
* Re-ordering builtin rows or restyling the Plugins settings page beyond the new dropdown.

## Technical Approach

* Store: `featureCliAdapter: Record<string, string> = {}` + `setFeatureCliAdapter(feature, adapterId)`. Persist key `'featureCliAdapter'`. Hydrate with `isRecord` guard (already in aiConfigStore).
* Helper: a tiny `resolveFeatureAdapterId(feature: string): string` in a shared module (or inline in aiConfigStore as exported `getFeatureAdapter`) — returns `state.featureCliAdapter[feature] ?? state.cliAdapter`. All 6 call sites import it.
* adapterManager: `getAdapterForSession(sessionId, feature)` — extra param, optional. When provided, used to resolve adapter id AND to cache by `(sessionId, feature)` so switching feature's adapter invalidates the cached adapter.
* UI: extract a small `FeatureAdapterDropdown({ featureId })` component (reuses `listAdapters()` + `ADAPTER_ICON` map). Render inside each builtin row's `PluginRowCard`.
* i18n: mirror existing keys; the new "CLI" / "feature agent adapter" labels go under `settings:plugins.cli.*` namespace.

## Implementation Plan (small PRs)

* **PR1 — store + services**: add `featureCliAdapter` field + `getFeatureAdapter` helper; switch 6 call sites + adapterManager. Tests for store + adapterManager fallback.
* **PR2 — UI**: add schedule/study builtin rows + appearance flags + PluginsSettings dropdown component + i18n keys. Tests for pluginStore rows + appearanceStore flags.

## Open Questions

(none — ready for implementation plan sign-off)

## Requirements (evolving)

* Wiki feature agent reads its own adapter id, not `aiConfig.cliAdapter`.
* Adapter is selectable from the Plugins settings page, WIKI row.
* Falls back gracefully when only one adapter is registered.

## Acceptance Criteria (evolving)

* [ ] Switching global `aiConfig.cliAdapter` in chat panel does NOT change Wiki's adapter.
* [ ] Switching Wiki adapter in Plugins settings changes Wiki's next query/ingest run.
* [ ] Setting persists across app restarts.
* [ ] When only one adapter is registered, the selector is hidden or disabled.

## Definition of Done

* Tests added for store field + wiki service reading the new field.
* Lint / typecheck green.
* i18n keys for the new UI (zh / en / ja at minimum, plus fr/es/de if existing wiki strings have them).
* No regression in feature-agent seeding when adapter is `pi`.

## Out of Scope (explicit)

* Per-feature CLI binary path override (reuses `cliPaths[adapterId]`).
* UI for clips / analyze / schedule / study adapter switch (unless user says so).
* A "test adapter" button on the Wiki row (already exists in CliSettings tab).

## Technical Notes

* Store field shape: `featureCliAdapter?: Record<string, string>` keyed by feature id (`'wiki'`) — extensible to other features without schema change. Alternative: a single `wikiCliAdapter: string`.
* Wiki service change: replace `aiConfig.cliAdapter` with `aiConfig.featureCliAdapter?.wiki ?? aiConfig.cliAdapter` (fallback to global keeps existing behavior).
* PluginsSettings `PluginRowCard` for `builtin:wiki` needs a new inline control below the existing Toggle. Reuse `listAdapters()` + `ADAPTER_ICON` map.
