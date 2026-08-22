# Trusted Plugin Fault Isolation

## Goal

A trusted plugin (`import()`-ed into the host webview realm) can crash the
entire main app to a white screen. Because `plugin-sdk` is public and
third-party authors can ship plugins, **isolation must be a host-side hard
contract**: no plugin render throw, lazy-factory throw, or activate failure
may take down the host, regardless of how the plugin is written.

This task closes the remaining fault-isolation gaps. It is a root-cause fix
at the plugin→host chokepoints, not a per-surface patch.

## What I already know (status check)

### Already isolated — no change needed

| Surface | Why safe |
|---|---|
| Sidebar feature panels | `PanelErrorBoundary` wraps each panel (`Sidebar.tsx:63`) |
| Markdown container directives `:::xxx` | `PanelErrorBoundary` per instance (`MarkdownPreview.tsx:95`) |
| Tool windows | Separate Tauri `WebviewWindow` — crash confined to that window |
| Exporters | `exporterAdapter.ts:82` try/catch around `handler(content, ctx)` |
| Trusted command dispatch | `commandRegistry.runCommand` swallows+logs errors (`commandRegistry.ts:98`) |
| Sandbox tier | Plugin runs in sandboxed iframe (`quill-plugin://` origin) — isolated by construction |

### Gaps (the white-screen risk)

**A. Render-time ErrorBoundary gaps** — plugin component throws during render → propagates up the host React tree → white screen.

1. file-type `Editor` — `WorkArea.tsx:210` `<handler.Editor>` (custom editor path)
2. file-type `Editor` (web) — `WorkArea.tsx:247` `<webHandler.Editor>`
3. file-type `Preview` — `PreviewPane.tsx:128` `<Preview>`
4. markdown fenced-block renderer — `MarkdownPreview.tsx:560` `PreWithCodeRenderer`

**B. Lifecycle rollback gap**

5. `PluginHost.activate` (`packages/plugin-host/src/PluginHost.ts:59-80`): the
   `trustedLoader` registers all contribution adapters (pushing disposables to
   `ctx`) **before** calling `module.activate()`. If `activate()` throws, the
   host sets `state='failed'` and rethrows — but never reaps the already-pushed
   disposables. The half-wired plugin stays registered; its components keep
   rendering and keep crashing.

### Edge / verify-during-impl

6. `exportEnhancer` handler is invoked inside `exportService.ts` during the
   export DOM walk — verify that call site is wrapped (export is a user action,
   not React render, so risk is "export fails" not "app crashes"; still wrap).
7. `editorLanguage` lazy factory is stored and later called by CodeMirror on
   demand — a factory throw lands in CM's load path. Wrap the stored factory
   in a safe fallback returning a no-op `LanguageSupport` on throw.

## Requirements

* R1 Every trusted plugin render surface (gaps A1–A4) is wrapped by the
  existing `PanelErrorBoundary` so a render throw renders an inline fallback
  and never propagates to the host tree.
* R2 Boundary isolation is per-instance (sibling directives/tabs keep working
  when one instance throws) — mirrors the existing container pattern.
* R3 `PluginHost.activate` reaps all disposables pushed during the failed
  activation before rethrowing, so no half-wired plugin remains registered.
* R4 A render throw is recorded to `pluginStore` (error log + "errored"
  indicator) so Settings → Plugins can surface it; the plugin keeps running
  (other contributions unaffected).
* R5 Edge gaps 6/7 are wrapped or verified-wrapped.
* R6 `docs/plugin-development.md` gains a one-section note that the host
  guarantees render isolation for trusted plugins (third-party authors need
  to know throws are contained, not fatal).

## Failure policy (decision)

**Isolate-to-surface + inline fallback + keep plugin running + record error.**
Auto-deactivate on threshold is **out of scope** (follow-up) — it does not
affect the "never crash" hard guarantee, which is delivered by R1/R2/R3 alone.

## Acceptance Criteria

* [ ] A trusted plugin whose `Editor`/`Preview`/fenced-block renderer throws
  during render shows an inline error card in that surface; the rest of the
  app (other tabs, sidebar, editor) stays fully usable. No white screen.
* [ ] A trusted plugin whose `activate()` throws is fully rolled back: no
  commands/file-types/containers/features remain registered; `state='failed'`
  with `error` populated; subsequent activate of a fixed plugin works.
* [ ] `registerErrorDemoPlugin` (existing) or an equivalent throw-on-render
  fixture covers each gap surface in a test.
* [ ] `PluginHost.test.ts` covers the activate-failure-rollback path.
* [ ] `pluginStore` exposes the last render error per plugin; Settings shows
  an "errored" indicator.
* [ ] All existing plugin-host tests stay green.

## Definition of Done

* Tests added for each gap (boundary catches render throw; activate rollback).
* Lint/typecheck green; no whole-project compile (per user workflow pref).
* `docs/plugin-development.md` isolation note added.
* No new SDK runtime API (isolation is host-side, plugin-agnostic) — the SDK
  stays type-only/publishable.

## Technical Approach

**Reuse, don't add.** The existing `PanelErrorBoundary`
(`components/sidebar/PanelErrorBoundary.tsx`) already implements
`getDerivedStateFromError` + `componentDidCatch` + an inline fallback. Wrap
each gap site with it (keyed per-instance for sibling isolation), passing a
`surface` label (e.g. `plugin:<id>:editor`) so the fallback names what broke.

**activate rollback** — one guard in `PluginHost.activate`'s catch:
```
catch (err) {
  await this.reapDisposables(record);   // ← the missing line
  record.state = 'failed';
  record.error = err;
  throw err;
}
```
`reapDisposables` already exists and is idempotent; each adapter's `dispose`
unregisters from its store and is safe against partial registration.

**Error visibility** — `PanelErrorBoundary.componentDidCatch` calls a small
`pluginHost.recordRenderError(pluginId, err)` (or pushes to `pluginStore`);
Settings → Plugins reads it for a badge. Minimal: a Map keyed by pluginId.

**Edge 7 (language factory)** — wrap the stored factory:
`() => { try { return orig() } catch (e) { log; return noOpLanguageSupport } }`.

## Decision (ADR-lite)

**Context**: Trusted plugins run in the host realm (TOFU = full power, by
design). The realm sharing is an accepted security trade-off, but it also
means a plugin render throw takes down the host tree — unacceptable now that
the SDK is public.

**Decision**: Add host-side fault isolation at every plugin→host render
chokepoint (reuse `PanelErrorBoundary`) + rollback disposables on failed
activate. Keep the failure policy isolate-and-keep-running; auto-deactivate
deferred.

**Consequences**: Third-party plugins can no longer white-screen the host.
Cost: a React boundary wrapper per surface (small, mechanical) + one
PluginHost line + a small error-log path. No SDK API change. Risk: a boundary
that catches too aggressively could mask real bugs — mitigated by recording
the error to `pluginStore` + Settings visibility (R4).

## Out of Scope

* Auto-deactivate / error-threshold policy (follow-up).
* Sandbox tier hardening (already iframe-isolated).
* New SDK API or contribution point.
* Plugin marketplace / signing enforcement (`signature` already best-effort).

## Technical Notes

* Core: `packages/plugin-host/src/PluginHost.ts:59-99`, `:137-148`
  (`reapDisposables`).
* Boundary: `apps/desktop/src/components/sidebar/PanelErrorBoundary.tsx`.
* Gap sites: `apps/desktop/src/components/work-area/WorkArea.tsx:210,247,260`;
  `components/work-area/PreviewPane.tsx:128`;
  `components/file-types/markdown/MarkdownPreview.tsx:560`.
* Adapters: `apps/desktop/src/services/plugin-host/*Adapter.ts`,
  `trustedLoader.ts:114-154`.
* Demo fixture: `apps/desktop/src/services/registerErrorDemoPlugin.tsx`
  (already throws to verify the panel boundary — extend to gap surfaces).
* `commandRegistry.ts:98` `runCommand` safe-dispatch (trusted commands safe).
* `exporterAdapter.ts:82` exporter try/catch (exporters safe).
* SDK is type-only at runtime; isolation adds no runtime dep to the SDK.

## Implementation Plan (small PRs)

* **PR1 — kernel rollback**: `PluginHost.activate` reap-on-failure + test
  (`PluginHost.test.ts`). Kernel-only, unit-testable in isolation.
* **PR2 — render boundaries**: wrap gaps A1–A4 with `PanelErrorBoundary`
  (per-instance keying) + tests per surface (extend error-demo fixture).
* **PR3 — visibility + edges + docs**: `pluginStore` render-error log +
  Settings "errored" indicator; verify/wrap edge 6 (`exportService`
  enhancer call) + edge 7 (language factory safe wrapper); add the
  `docs/plugin-development.md` isolation section.
