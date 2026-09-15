/**
 * Contribution adapter registry — the trusted-tier wiring seam.
 *
 * Each {@link ContributionAdapter} maps one manifest contribution array
 * (commands / fileTypes / containers / features / exporters / ...) into the
 * matching app registry and returns a {@link Disposable}. The trusted loader
 * folds over registered adapters in `activate()` instead of a hardcoded 13-call
 * list, and `normalizeModule` pulls only the `moduleKey`s declared by registered
 * adapters instead of hand-written `if` branches.
 *
 * Adding a contribution point = one adapter file + one
 * `registerContributionAdapter(...)` line — zero edits to `trustedLoader` or
 * `normalizeModule`.
 *
 * ponytail: adapters are host-boot singletons; a plain array, no ownership
 * tracking (contributions themselves stay in {@link OwnedRegistry} by owner id).
 * The sandbox tier is excluded — its RPC-dispatched model (no `module`, commands
 * forward over postMessage) is structurally different and has only 2 adapters.
 */
import type { Disposable, ExtensionManifest, ExtensionModule } from 'folyn-extension-sdk';

/**
 * Wires one contribution point. `moduleKey` (when present) is the
 * {@link ExtensionModule} export map this adapter reads — `normalizeModule`
 * pulls it so entry-refs resolve. Omit for declarative contributions (tools,
 * fileTemplates, keybindings) that read only the manifest.
 */
export interface ContributionAdapter {
  moduleKey?: keyof ExtensionModule;
  /**
   * Wire the manifest's contribution array into the app registry. May be async
   * (e.g. containers resolve `.svg` icons via `readExtensionFile` before
   * registering). The returned {@link Disposable} is pushed to the activation
   * context so `ExtensionHost` reaps it on deactivate/reload.
   */
  register(
    manifest: ExtensionManifest,
    module: ExtensionModule,
  ): Disposable | Promise<Disposable>;
}

const adapters: ContributionAdapter[] = [];

/** Append a contribution adapter (order = registration order = boot import order). */
export function registerContributionAdapter(adapter: ContributionAdapter): void {
  adapters.push(adapter);
}

/** All registered adapters, in registration order. */
export function getContributionAdapters(): ContributionAdapter[] {
  return adapters;
}

/** Test-only: reset between tests. */
export function clearContributionAdapters(): void {
  adapters.length = 0;
}
