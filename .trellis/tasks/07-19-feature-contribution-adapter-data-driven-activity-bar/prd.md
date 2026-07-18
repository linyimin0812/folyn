# Feature Contribution Adapter + Data-Driven Activity Bar

## Goal

Wire the already-declared `contributes.features[]` contribution point into the
host so plugins can mount panels (left/right/bottom) into the activity bar and
sidebar — mirroring how `contributes.tools[]` already works for tool windows.
Make `ActivityBar` + `Sidebar` data-driven instead of hardcoded to a fixed
`ActivityPanel` union.

## What I already know

* `FeatureContribution` type already exists in `packages/plugin-host/src/types.ts`:
  `{ id, panel: 'left'|'right'|'bottom', component }` (component is an entry-ref
  string resolved by the loader).
* `ContributionPoints.features?: FeatureContribution[]` is declared but **no
  adapter registers it** — `toolAdapter` handles tools, `contributionAdapters`
  handles commands/fileTypes/containers; features are the gap.
* `ActivityBar.tsx` is hardcoded: `ActivityPanel = 'files'|'wiki'|'clips'|'analyze'|'calendar'`,
  icons gated by `appearanceStore.enable*Panel` flags.
* `Sidebar.tsx` switches on `activePanel` to render `WikiFileTree`/`ClipsPanel`/
  `AnalysisPanel`/`CalendarPanel`/files — also hardcoded switch.
* Trusted tier resolves entry-refs to real React components (`PluginModule.containers`
  pattern in `contributionAdapters.ts`); sandbox tier uses a cross-origin iframe
  with NO same-origin — React component mounting is not directly possible.
* `ContainerRegistry` (singleton, register/unregister) is the existing pattern
  for a contribution registry — feature adapter should mirror it.
* `toolAdapter.ts` is the closest analog: tier-agnostic manifest → registry.

## Assumptions (temporary, to validate)

* Built-in 5 panels (files/wiki/clips/analyze/calendar) stay hardcoded-as-data
  in the registry rather than being refactored into "system plugins" — smallest
  diff that makes the bar data-driven.
* Plugin panels append after built-in panels in the activity bar order.
* No persisted ordering/pinning for plugin panels in MVP (later).

## Open Questions

* (none pending — see Decisions)

## Decisions (ADR-lite)

* **Q1 → Trusted-tier only** for feature panels. Sandbox uses tool windows.
* **Q2 → Left position only** for MVP. `panel: 'right'|'bottom'` declarations are
  warned + skipped; right/bottom shell slots are a separate future task.
* **Registry reactivity**: `FeaturePanelStore` is a Zustand store (mirrors
  `toolWindowStore`), NOT a `ContainerRegistry`-style plain singleton — panels
  register/unregister at runtime (plugin activate/deactivate), so ActivityBar
  must re-render. (Derived: `ContainerRegistry.getAll()` is non-reactive.)
* **Q3 → Full data-driven (option 2, refined)**:
  * The **5 real sidebar panels** (files, wiki, clips, analyze, calendar) move
    into `FeaturePanelStore`. calendar is NOT dead code — it's reachable via
    the `gotoPanel('calendar')` command (keywords today/journal/calendar in
    `commandRegistry.ts:165,251`) — just had no ActivityBar icon before.
  * **Every panel gets an ActivityBar icon** (icon becomes required on
    `FeatureContribution` and on built-in entries). calendar gets a new icon.
  * **daily / study / settings stay hardcoded** — they are page-nav
    (`setCurrentPage('schedule'|'study'|'settings')`), not sidebar panels.
    Data-driving them is a separate "page contribution" concept, out of scope.
  * `enableWikiPanel`/`enableClipsPanel`/`enableAnalyzePanel`/`enableDailyPanel`
    become the `visible` source for the matching built-in panel entry (calendar
    binds to `enableDailyPanel`, preserving current coupling). files always
    visible. Toggle = entry hidden from ActivityBar + Sidebar falls back to
    files (existing App.tsx:384-387 fallback logic preserved).

## Requirements (evolving)

* `registerPluginFeatures(manifest, module)` adapter that resolves
  `contributes.features[].component` entry-refs to React components and
  registers them in a `FeaturePanelStore` (Zustand, reactive).
* **Trusted-tier only** for MVP. Sandbox plugins use `contributes.tools`
  (tool windows) for their UI. (Decision Q1.)
* **Left position only** for MVP. `panel: 'right'|'bottom'` declarations are
  warned + skipped. (Decision Q2.)
* **Full data-driven ActivityBar/Sidebar** (Decision Q3): the 5 built-in
  sidebar panels (files, wiki, clips, analyze, calendar) + plugin panels all
  live in `FeaturePanelStore`. `ActivityBar` renders a button per visible
  panel; `Sidebar` renders the active panel's component by id.
* `FeatureContribution.icon` promoted from absent to **required** (string):
  either a raw inline SVG string (`<svg ...>...</svg>`) or a `ThemeIcon` name
  (resolved against host `assets/icons/*.svg`). The adapter renders raw SVG
  via a small `IconFromSvg` helper; built-in entries pass inline SVG.
* **Ordering** (Q4): every panel entry carries `order: number`. Built-ins get
  fixed values (files=0, wiki=10, clips=20, analyze=30, calendar=40). Plugin
  panels declare `order?` in manifest; absent → assigned next-after-builtin
  slot by registration order. Store exposes panels sorted by (order, reg seq).
* **Badge field reserved** (Q4): `PanelEntry.badge?: string | number` and
  `FeatureContribution.badge?: string | number`. MVP renders it as a small
  text dot if present (cheap), so the field is exercised, not just schema-only.
* Plugin deactivate reaps the registration (mirrors toolAdapter dispose).
* If a plugin panel is active when the plugin deactivates, fall back to 'files'
  (mirror App.tsx:384-387 fallback logic).
* **id collision guard**: registering a panel id that already exists logs a
  warning and refuses the second registration (built-in ids reserved:
  files/wiki/clips/analyze/calendar).
* **Error Boundary** wraps each panel component in `Sidebar` so a throwing
  plugin panel doesn't white-screen the whole sidebar.
* `gotoPanel(id)` command path (commandRegistry ⌘P) works for any store panel
  id, including plugin panels — `setCurrentPage`/`setActive` by id.
* activePanel persistence (editorStore) survives restart; if the persisted
  activePanelId no longer exists, fall back to 'files'.

## Acceptance Criteria (evolving)

* [ ] A sample trusted plugin with `contributes.features[]` shows an icon in the
      activity bar; clicking shows its panel in the sidebar.
* [ ] Built-in 5 panels (files/wiki/clips/analyze/calendar) all appear with
      icons in the activity bar, behave identically to before, including
      calendar now having an icon entry (still also reachable via ⌘P
      today/journal/calendar command).
* [ ] `enableWikiPanel`/`enableClipsPanel`/`enableAnalyzePanel`/`enableDailyPanel`
      toggles still hide/show the matching panel (calendar ↔ enableDailyPanel).
* [ ] Mobile sidebar (`isMobile`/`mobileSidebarOpen`) still works.
* [ ] Plugin panel with `order` declared renders in the correct position vs
      built-ins and unordered plugin panels.
* [ ] Deactivating a plugin removes its icon + panel; if it was active, sidebar
      falls back to files.
* [ ] Two plugins declaring the same panel id → second logs a warning and is
      refused; first still works.
* [ ] A plugin panel that throws on render is caught by the Error Boundary;
      sidebar stays usable, other panels unaffected.
* [ ] Persisted activePanel pointing at an uninstalled plugin's panel falls
      back to files on next launch.

## Definition of Done

* Tests added: `featureAdapter.test.ts` + `featurePanelStore.test.ts`
  (mirror `contributionAdapters.test.ts` / `toolWindowStore` tests).
* Lint / typecheck / CI green.
* Docs (`plugin-development*.md`) updated with `features` contribution point,
  including `icon` / `order` / `badge` fields and the left-only MVP constraint.
* Sample plugin extended (or new sample) with a feature panel.

## Out of Scope (explicit)

* Lazy activation via `activation` events (eager activation stays).
* Sandbox-tier feature panels (iframe-in-sidebar) — deferred; sandbox uses
  tool windows instead. (Decision Q1.)
* `window: false` inline tool panels (still deferred from toolAdapter).
* Right/bottom shell slots. (Decision Q2.)
* User-facing drag-to-reorder UI for panels (order is manifest-declared only).
* Page-nav data-driving (daily/study/settings) — separate "page contribution"
  concept.

## Technical Approach

**New files:**
* `apps/desktop/src/store/featurePanelStore.ts` — Zustand store:
  `{ panels: PanelEntry[], activePanelId, register(entry), unregister(id), setActive(id) }`.
  `PanelEntry = { id, title, icon: ReactNode, component: ComponentType, order, badge?, visible?: boolean, builtin?: boolean }`.
  Selectors: `useVisiblePanels()` (sorted, filtered), `useActivePanelId()`.
* `apps/desktop/src/services/plugin-host/featureAdapter.ts` —
  `registerPluginFeatures(manifest, module)`: resolve
  `contributes.features[].component` → `module.containers[ref]` (reuse the
  trusted `PluginModule.containers` map? or a new `features` map — see impl
  note), render manifest `icon` string via `IconFromSvg`/`ThemeIcon`, register
  in store, return Disposable that unregisters + falls back active panel.
* `apps/desktop/src/components/icons/IconFromSvg.tsx` — renders a raw inline
  SVG string safely (size-normalized, mirrors `ThemeIcon.normalizeSvg`).
* `apps/desktop/src/components/sidebar/PanelErrorBoundary.tsx` — Error Boundary
  wrapping each panel component.

**Modified files:**
* `packages/plugin-host/src/types.ts` — `FeatureContribution`:
  `icon: string` (required), `order?: number`, `badge?: string|number`,
  keep `panel` but document left-only (warn+skip right/bottom).
* `apps/desktop/src/components/shell/ActivityBar.tsx` — drop hardcoded
  built-in buttons; read `useVisiblePanels()` and render a generic button per
  entry; keep daily/study/settings hardcoded page-nav buttons + pinned settings.
* `apps/desktop/src/components/sidebar/Sidebar.tsx` — replace `sidebarTab`
  switch with: look up `activePanelId` in store, render its `component` inside
  `PanelErrorBoundary`; remove the union-based switch.
* `apps/desktop/src/services/plugin-host/trustedLoader.ts` — wire
  `registerPluginFeatures` into activate (alongside containers/tools).
* `apps/desktop/src/services/plugin-host/contributionAdapters.ts` —
  `PluginModule` gains a `features?: Record<string, ComponentType>` map (entry
  refs for `contributes.features[].component` resolve here). Keep it in
  contributionAdapters since it's the trusted-module shape.
* `apps/desktop/src/App.tsx` — init: register the 5 built-in panels into
  `featurePanelStore` at startup (before plugins load); the enable-flag fallback
  (App.tsx:384-387) moves into a store subscription or stays as effect reading
  store + appearanceStore.
* `apps/desktop/src/services/commandRegistry.ts` — `gotoPanel(id)` already
  exists; ensure it routes through `featurePanelStore.setActive(id)` for any id.

## Implementation Plan (small PRs)

* **PR1 — store + adapter + types (no UI change yet):**
  `featurePanelStore`, `featureAdapter`, `IconFromSvg`, `PanelErrorBoundary`,
  `FeatureContribution` type changes, `PluginModule.features` map, unit tests.
  Built-ins NOT yet migrated — store exists empty, ActivityBar/Sidebar untouched.
* **PR2 — migrate built-ins + data-driven ActivityBar/Sidebar:**
  register 5 built-ins at startup, rewrite ActivityBar to read store, rewrite
  Sidebar's panel switch to store lookup, move enable-flag fallback. Built-in
  behavior parity verified.
* **PR3 — plugin panel end-to-end + edges:**
  wire `registerPluginFeatures` into trustedLoader, sample plugin feature
  panel, collision guard, deactivate fallback, persisted-active fallback,
  badge render, docs + sample.

## Decision (ADR-lite)

**Context**: `contributes.features[]` was declared in the manifest schema but
never wired — ActivityBar/Sidebar were hardcoded to a fixed `ActivityPanel`
union, so plugins had no way to contribute sidebar panels (only tool windows).

**Decision**: Trusted-tier only, left-only, full data-driven (built-in 5 panels
move into a reactive `FeaturePanelStore`); daily/study/settings stay hardcoded
as page-nav; icon/order/badge fields added to `FeatureContribution`; collision
guard + error boundary + fallbacks for robustness.

**Consequences**: Plugins can now mount sidebar panels; sandbox plugins are
asymmetric (tools only) — documented; future right/bottom slots and
page-contribution data-driving are cleanly separable follow-ups. Risk: built-in
panel migration touches a hot path (ActivityBar/Sidebar render) — PR2 isolates
this and must pass parity tests before PR3.
