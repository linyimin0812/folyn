/**
 * Capability provider registry — the platform-service seam.
 *
 * The {@link ExtensionHost} kernel stays thin (lifecycle state machine only).
 * Concrete capability implementations (vault fs, editor, ai, network, env,
 * terminal, storage, ...) are injected by the host shell at boot: each
 * registers a {@link CapabilityProvider} for one slot of {@link ExtensionApi}.
 * `buildExtensionApi` folds the registered providers into the `ExtensionApi`
 * the host hands to `module.activate(api, ctx)`.
 *
 * This is the "mechanism in kernel, policy in swappable servers" split, done at
 * registration time (appropriate for a single-process Tauri app) — the same seam
 * `ExtensionHost.registerLoader` already uses for tiers. A future headless / web
 * runner swaps provider bindings without touching the kernel.
 *
 * The default path: App.tsx's `createApi` hook calls `buildExtensionApi`. The
 * hook stays as the whole-`ExtensionApi` override escape hatch for tests /
 * alternate shells (ADR-lite, Decision 2 — Option A).
 *
 * ponytail: providers are host-boot singletons (not extension-owned), so a plain
 * Map keyed by slot suffices — no {@link OwnedRegistry} ownership tracking. If a
 * slot is registered twice, the later provider wins (last-write); mirrors how
 * `ExtensionHost.registerLoader` replaces a tier's loader.
 */
import type { Disposable, ExtensionApi, ExtensionManifest } from 'folyn-extension-sdk';
import type { ExtensionApiHandle } from './ExtensionHost';

/**
 * Fills one slot of {@link ExtensionApi}. `build` runs once per activation;
 * `dispose`, if present, runs once on deactivate/reload (reaped by the runtime).
 */
export interface CapabilityProvider<K extends keyof ExtensionApi = keyof ExtensionApi> {
  slot: K;
  build(manifest: ExtensionManifest): ExtensionApi[K];
  /** Optional host-side teardown (e.g. env store subscriptions). */
  dispose?(value: ExtensionApi[K]): void;
}

const providers = new Map<keyof ExtensionApi, CapabilityProvider>();

/** Register (or replace) the provider for a capability slot. */
export function registerCapability<K extends keyof ExtensionApi>(
  provider: CapabilityProvider<K>,
): void {
  providers.set(provider.slot, provider as CapabilityProvider);
}

/** All registered providers, in registration order. */
export function getCapabilityProviders(): CapabilityProvider[] {
  return Array.from(providers.values());
}

/** Test-only: reset between tests. */
export function clearCapabilityProviders(): void {
  providers.clear();
}

/**
 * Fold registered providers into an {@link ExtensionApi} + one `Disposable`
 * that reaps every provider's `dispose` (in registration order). Returns the
 * {@link ExtensionApiHandle} the `createApi` hook expects.
 */
export function buildExtensionApi(manifest: ExtensionManifest): ExtensionApiHandle {
  // ponytail: assemble into a mutable record, then cast to ExtensionApi at the
  // boundary — the SDK's ExtensionApi properties are `readonly` (the public
  // contract is immutable post-build). Each provider's built value is captured
  // in its dispose closure so teardown sees the exact instance it built.
  const api: Record<string, unknown> = {};
  const disposers: Disposable[] = [];
  for (const p of providers.values()) {
    const value = p.build(manifest);
    api[p.slot as string] = value;
    if (p.dispose) {
      const dispose = p.dispose;
      disposers.push({ dispose: () => dispose(value) });
    }
  }
  return {
    api: api as unknown as ExtensionApi,
    dispose: disposers.length
      ? { dispose: () => disposers.forEach((d) => d.dispose()) }
      : undefined,
  };
}
