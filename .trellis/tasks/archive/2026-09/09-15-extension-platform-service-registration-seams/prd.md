# Extension Platform Service Registration Seams

## Goal

The `extension-host` kernel is a thin, pure state machine — but the **assembly** of
platform services is hardcoded in the desktop app: `createExtensionApi.ts` builds
the entire `ExtensionApi` via one hardcoded object literal, and `trustedLoader.ts`
wires 13 contribution adapters via a hardcoded array, with `normalizeModule`
duplicating those keys in 12 hand-written `if` branches. Adding a 16th capability or
a 14th contribution point is a shotgun edit across 3 files.

Introduce two registration seams (mirroring the existing `registerLoader` pattern):
a **CapabilityProvider registry** and a **ContributionAdapter registry**, both in the
`extension-host` package. The desktop app self-registers providers/adapters at boot.
Assembly becomes data-driven folds. Zero behavior change for existing extensions.

This is the "mechanism in kernel, policy in swappable servers" split done at
registration time (appropriate for a single-process Tauri app) — not a speculative
package extraction.

## What I already know

- `createExtensionApi.ts` (~270 lines): each capability is **already** a separate
  factory function (`createVaultApi`, `createStorageApi`, `createEditorApi`,
  `createEventsApi`, `createTerminalApi`, `createFilesApi`, `createVaultConfigApi`)
  plus inline-built `ai`/`network`/`env`/`fileTypes`/`exporters`. All wired into one
  `ExtensionApi` object literal at line 248. `noopWorkspace`/`noopCommands` are
  placeholder slots. Returns `ExtensionApiHandle { api, dispose }` — already the
  shape the host expects.
- `trustedLoader.ts` activate (lines 119-133): hardcoded array of 13 adapter calls,
  each pushed to `ctx.addDisposable`. `registerExtensionContainers` is async (reads
  `.svg` icons); the rest are sync. `normalizeModule` (lines 167-181): 12 hand-written
  `if (src.X) out.X = ...` branches.
- Adapters live in separate files already: `contributionAdapters.ts` (commands,
  fileTypes, containers), `toolAdapter.ts`, `featureAdapter.ts`, `exporterAdapter.ts`,
  `fileTemplateAdapter.ts`, `keybindingAdapter.ts`, `exportEnhancerAdapter.ts`,
  `markdownCodeRendererAdapter.ts`, `editorLanguageAdapter.ts`,
  `highlightGrammarAdapter.ts`.
- **Sandbox loader** (`sandboxLoader.ts`): uses a *different* wiring model —
  `registerExtensionCommands(manifest, bridge)` (RPC-dispatched, no module) +
  `registerExtensionTools(manifest)`. Only 2 adapters, no `module` resolution. Cannot
  share the trusted ContributionAdapter registry (structurally incompatible). **Stays
  as-is.**
- Reusable patterns in `extension-host`: `ExtensionHost.registerLoader(loader)`
  returns a `Disposable`, keyed by tier. `OwnedRegistry<T>` (in `extension-sdk/src/registry.ts`)
  is the owned-contribution pattern. Both are the precedent to mirror.
- `ExtensionApiHandle` (`ExtensionHost.ts:67`) = `{ api: ExtensionApi; dispose?: Disposable }`.
  A capability registry's `buildExtensionApi` returns exactly this.
- Boot wiring lives in `App.tsx` (~lines 80-97): `extensionHost.setHooks(...)` +
  `extensionHost.registerLoader(sandboxLoader)` + `registerLoader(trustedLoader)`.
  This is where capability-provider side-effect imports go.

## Assumptions (temporary)

- None of the 13 trusted adapters have inter-dependencies (each reads its own
  `contributes.*` array independently), so registration/fold order does not affect
  behavior. To validate during impl.
- Adapter signatures can be unified to `(manifest, module) => Disposable | Promise<Disposable>`;
  adapters that ignore `module` (tools, fileTemplates, keybindings) simply don't read it.
- Capability providers are host-boot-time singletons (not extension-owned), so a
  plain `Map<slot, provider>` suffices — no `OwnedRegistry` ownership tracking needed.

## Requirements

1. Add `CapabilityProvider` registry + `buildExtensionApi(manifest)` to
   `@folyn/extension-host`. Provider: `{ slot: keyof ExtensionApi; build(manifest);
   dispose?(value) }`. `buildExtensionApi` folds registered providers into an
   `ExtensionApi` + collects `dispose` hooks into one `Disposable`.
2. Add `ContributionAdapter` registry to `@folyn/extension-host`. Adapter:
   `{ moduleKey?: keyof ExtensionModule; register(manifest, module): Disposable |
   Promise<Disposable> }`. `getContributionAdapters()` returns the list.
3. `trustedLoader.activate` folds over registered adapters (`await a.register(...)`
   per adapter) instead of the hardcoded 13-element array.
4. `normalizeModule` becomes data-driven: pull only `moduleKey`s declared by
   registered adapters (+ `activate`/`deactivate`) instead of 12 hand-written `if`s.
5. `createExtensionApi.ts` shrinks to delegating to `buildExtensionApi`; each
   existing capability factory moves to a `capabilities/<slot>.ts` file that
   self-registers via `registerCapability(...)` (function bodies unchanged).
6. `App.tsx` boot imports the `capabilities/` index (side-effect) next to existing
   `registerLoader` calls; adapter modules self-register on import.
7. **Zero behavior change** for the 3 existing extensions (dbml, file-viewer,
   rich-text) and the sandbox tier. Same `ExtensionApi` surface, same contribution
   wiring, same disposal semantics.

## Acceptance Criteria

- [ ] `buildExtensionApi(manifest)` assembles an `ExtensionApi` whose keys match the
  current `createExtensionApi` output exactly; `dispose` reaps env subscriptions
  (and any provider `dispose`) in the same order as today.
- [ ] `trustedLoader.activate` registers the same 13 contributions via the registry
  fold; a deactivated trusted extension leaves zero residual contributions
  (transactional rollback still holds).
- [ ] `normalizeModule` pulls exactly the same export keys as before (no missing,
  no extra).
- [ ] Adding a hypothetical 14th contribution point touches: one new adapter file +
  one `registerContributionAdapter(...)` line — **zero edits** to `trustedLoader.ts`
  or `normalizeModule`.
- [ ] Sandbox tier activation/deactivation unchanged (green: existing sandbox path).
- [ ] Unit test: register fake capability providers → `buildExtensionApi` assembles +
  disposes them; register fake adapter → fold calls it + `normalizeModule` pulls its
  declared `moduleKey`.
- [ ] Existing extensions build and load; `pnpm typecheck` + lint green.

## Definition of Done

- Tests added (unit: registry assembly/disposal + adapter fold/normalize).
- Lint / typecheck / CI green.
- Behavior parity verified (no regressions in dbml/file-viewer/rich-text load).
- `extension-system.SPEC.md` note added: capability + adapter registries are the
  platform-service seams (mechanism in kernel, policy in boot-registered providers).

## Technical Approach

Two registries in `packages/extension-host/src/`:

```ts
// capabilityRegistry.ts
export interface CapabilityProvider<K extends keyof ExtensionApi = keyof ExtensionApi> {
  slot: K;
  build(manifest: ExtensionManifest): ExtensionApi[K];
  dispose?(value: ExtensionApi[K]): void;
}
const providers = new Map<keyof ExtensionApi, CapabilityProvider>();
export const registerCapability = <K extends keyof ExtensionApi>(p: CapabilityProvider<K>) =>
  providers.set(p.slot, p as CapabilityProvider);
export function buildExtensionApi(manifest: ExtensionManifest): ExtensionApiHandle {
  const api = {} as ExtensionApi; const disposers: Disposable[] = [];
  for (const p of providers.values()) {
    api[p.slot] = p.build(manifest);
    if (p.dispose) disposers.push({ dispose: () => p.dispose!(api[p.slot]) });
  }
  return { api, dispose: disposers.length ? { dispose: () => disposers.forEach(d => d.dispose()) } : undefined };
}

// contributionAdapterRegistry.ts
export interface ContributionAdapter {
  moduleKey?: keyof ExtensionModule;  // absent = declarative (manifest-only)
  register(manifest: ExtensionManifest, module: ExtensionModule): Disposable | Promise<Disposable>;
}
const adapters: ContributionAdapter[] = [];
export const registerContributionAdapter = (a: ContributionAdapter) => adapters.push(a);
export const getContributionAdapters = () => adapters;
```

Each existing capability factory → `apps/desktop/src/services/extension-host/capabilities/<slot>.ts`
(`registerCapability({ slot: 'vault', build: createVaultApi })` etc.); `capabilities/index.ts`
re-exports them for the side-effect import in `App.tsx`.

**Adapter registration**: a single declarative manifest file
`apps/desktop/src/services/extension-host/trustedContributions.ts` imports each
adapter function and calls `registerContributionAdapter({ moduleKey, register })`
for it (12 entries, in registration order). `trustedLoader` imports it for the side
effect. Rationale: the `ContributionPoints` contract is SDK-level (rare to extend),
so a flat manifest is the right granularity; scatters no calls across 12 adapter
files and keeps a single readable table of all trusted contribution points. Adding a
14th = add adapter + one line in `trustedContributions.ts` — `trustedLoader.activate`
and `normalizeModule` stay stable folds.

`normalizeModule`:
```ts
function normalizeModule(mod): ExtensionModule {
  const src = (mod.default ?? mod); const out: ExtensionModule = {};
  for (const a of getContributionAdapters())
    if (a.moduleKey && src[a.moduleKey]) out[a.moduleKey] = src[a.moduleKey];
  if (typeof src.activate === 'function') out.activate = src.activate;
  if (typeof src.deactivate === 'function') out.deactivate = src.deactivate;
  return out;
}
```

## Decision (ADR-lite)

**Context**: Platform-service assembly is hardcoded; adding capabilities/contribution
points is a 3-file shotgun edit. A speculative `@folyn/platform-host` package extraction
is YAGNI (no second consumer).

**Decision**:
1. Introduce two boot-time registration registries inside `extension-host`, mirroring
   the existing `registerLoader` pattern. Modularize the *wiring*, not the *package*.
   Sandbox tier excluded (structurally different RPC model).
2. **Option A (chosen)**: `buildExtensionApi` lives in `extension-host`; App.tsx's
   existing `createApi` hook calls it (`createApi: (record) => buildExtensionApi(record.manifest)`).
   The hook seam stays as the "whole-Api override" escape hatch for tests / alternate
   shells; the default path is the provider fold. Does NOT deprecate `createApi`.

**Consequences**: + local-change extensibility, + testability (mock one provider, or
override the whole `createApi` hook), + future headless/web runner can swap provider
bindings mechanically. - one extra indirection layer (justified: N providers behind one
registry, not a one-impl interface). A later `@folyn/platform-host` extraction becomes a
mechanical file move when a second consumer appears.

## Out of Scope

- Extracting a `@folyn/platform-host` package (no second consumer — YAGNI).
- Refactoring the sandbox loader's 2 adapters (different RPC model; only 2; not worth).
- Async service broker / capability dependency resolution (capabilities are sync to build).
- New contribution points or capabilities (this task is wiring-only).
- trusted-tier runtime ACL / capability-level permission gating (separate task).

## Implementation Plan (small PRs)

- **PR1**: Add `capabilityRegistry.ts` + `contributionAdapterRegistry.ts` to
  `extension-host` with unit tests. Nothing wires to them yet — pure addition.
- **PR2**: Migrate trusted adapters to self-register + fold in `trustedLoader.activate`;
  data-drive `normalizeModule`. Behavior-preserving.
- **PR3**: Migrate `createExtensionApi` capabilities to self-registering
  `capabilities/<slot>.ts` files; `buildExtensionApi` assembles; boot import in `App.tsx`.
  Behavior-preserving. SPEC note.

## Technical Notes

- `createExtensionApi.ts` (270 lines) → ~1 line (`return buildExtensionApi(manifest)`).
- `trustedLoader.ts:119-133` hardcoded array → fold; `:167-181` normalizeModule → fold.
- Reuse `Disposable` from `folyn-extension-sdk`; registries are plain `Map`/array —
  no `OwnedRegistry` (providers/adapters are host-owned, not extension-owned).
- `ExtensionApiHandle` already defined at `ExtensionHost.ts:67`.
- Boot wiring site: `App.tsx` ~lines 80-97 (next to `registerLoader` calls).
