# Lifecycle Guidelines

> The extension lifecycle state machine and activation guarantees.

Reference: `packages/extension-host/src/ExtensionHost.ts` and `ExtensionRuntime.ts`, design doc `Folyn-Extension-System-Refactor-Technical-Design.md` §37/§38/§42/§60 (§numbers cited in the file headers).

---

## State machine

`ExtensionState` (ExtensionHost.ts:37) — `discovered` → `validated`, then `loading` → `activating` → `active`, with `disabled`, `waiting`, `deactivating`, and `failed` branches. One `ExtensionRecord` per extension carries `manifest`, `state`, the lazily-resolved `extension`, the bound `runtime`, and reaped `disposables`.

Rules:

- `loading`/`activating` records are not re-entrant — activation is skipped while one is in flight (ExtensionHost.ts:133)
- an activate throw is caught: runtime disposed, `state = 'failed'`, error stored on the record; it is rethrown only so the UI can surface it — it never crashes the host loop (error isolation)
- `deactivate()` **never rejects**: failures during teardown still land in `failed` and the call resolves (the test contract, ExtensionHost.ts:195)
- `validate` persists a `validated` record; validation itself delegates to the SDK's `validateManifest` — never re-implement a rule here

## Transactional activation

`ExtensionRuntime` (one per activation, doc §35/§36/§59) owns an `AbortController`, a `DisposableStore`, and the scoped `ExtensionContext`. Activation is **transactional**:

- disposables pushed during `activate()` are **staged**, not committed
- success → commit (they become owned)
- failure → **rollback in reverse (LIFO) order** — a half-wired extension leaves no residual contributions (doc §42.1, §59)
- `dispose()` = abort the signal (cancels in-flight ops) → `extension.deactivate?.(ctx)` → reap remaining disposables LIFO

Never add a code path that registers a contribution outside the transactional scope; legacy loader-pushed side effects go into `record.disposables` and are reaped on deactivate, but new code must use `ctx.addDisposable`.

## Per-activation AbortSignal

Each activation's context carries its own `signal`. Long-running extension work must observe it; deactivate aborts it. Do not share signals across activations or reuse a runtime after dispose.

## Registration seams

Mechanism in the kernel, policy injected at boot (single-process Tauri app — not a speculative extraction):

- **`CapabilityProvider` registry** (`capabilityRegistry.ts`) — each provider fills one slot of `ExtensionApi` (`{ slot, build(manifest), dispose?(value) }`). `buildExtensionApi` folds providers into the Api handed to `module.activate(api, ctx)`. Providers are host-boot singletons: a plain `Map`, later registration wins a slot, no `OwnedRegistry`.
- **`ContributionAdapter` registry** (`contributionAdapterRegistry.ts`) — trusted-tier contribution wiring. Each adapter (`{ moduleKey?, register(manifest, module): Disposable }`) wires one contribution point; the trusted loader folds over registered adapters and `normalizeModule` pulls only their declared `moduleKey`s. Adding a contribution point = one adapter + one `registerContributionAdapter(...)` line — `trustedLoader` and `normalizeModule` stay stable folds.
- The **sandbox tier is excluded** from the adapter seam (RPC-dispatched, no module) — do not route sandbox contributions through it.

Adapters must be idempotent-safe on repeat registration where the app relies on first-registered-wins registries.
