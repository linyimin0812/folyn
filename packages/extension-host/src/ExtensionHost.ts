/**
 * ExtensionHost — the lifecycle host (doc §37, §38, §42, §60).
 *
 * Owns the per-tier {@link ExtensionLoader} dispatch + manifest validation +
 * disposable reap, driven through an {@link ExtensionRuntime} per activation.
 * Loaders return an {@link Extension} directly; the host calls
 * `activate(api, ctx)` with no adapter.
 *
 * Guarantees:
 *  - AbortSignal: each activation gets its own; deactivate aborts it.
 *  - Transactional activation: a failed activate rolls back all staged
 *    disposables so a half-wired extension is fully inert (doc §42.1, §59).
 *  - State machine: discovered → validated → loading → activating → active →
 *    deactivating → failed (doc §37).
 *  - Error isolation: an activate throw is caught → runtime disposed →
 *    state='failed'; it never propagates to crash the caller (rethrown only so
 *    the UI can surface it).
 *
 * Capability wiring (ai/env/http/vault/...) and the ExtensionApi impl are
 * injected by the host's `createApi`/`createContext` hooks — the host stays
 * Tauri-free and unit-testable with fakes.
 */

import { validateManifest } from 'folyn-extension-sdk';
import type {
  Disposable,
  Extension,
  ExtensionApi,
  ExtensionContext,
  ExtensionLoader,
  ExtensionManifest,
  ExtensionUIContext,
  VaultContext,
} from 'folyn-extension-sdk';
import { consoleLogger, ExtensionRuntime } from './ExtensionRuntime';

export type ExtensionState =
  | 'discovered'
  | 'validated'
  | 'disabled'
  | 'waiting'
  | 'loading'
  | 'activating'
  | 'active'
  | 'deactivating'
  | 'failed';

export interface ExtensionRecord {
  manifest: ExtensionManifest;
  state: ExtensionState;
  /** Resolved lazily on activation; cleared on deactivate. */
  extension?: Extension;
  /** The runtime bound to the current activation, if any. */
  runtime?: ExtensionRuntime;
  /** Disposables registered outside the runtime's transactional scope
   * (e.g. legacy loader-pushed side effects). Reaped on deactivate. */
  disposables: Disposable[];
  error?: unknown;
}

/**
 * Hooks a host wires to build the capability surface + context for an
 * activation. All optional so the host is testable in isolation: with none
 * set, `ExtensionApi` is `undefined` and the legacy adapter path still works
 * (the adapter ignores `api`).
 */
export interface ExtensionApiHandle {
  api: ExtensionApi;
  /** Optional host-side teardown (e.g. env store subscriptions); reaped by
   * the runtime on deactivate. */
  dispose?: Disposable;
}

export interface ExtensionHostHooks {
  /** Build the {@link ExtensionApi} (and optional teardown) for an activation. */
  createApi?: (record: ExtensionRecord) => ExtensionApi | ExtensionApiHandle;
  /** Build the base context fields (vault/ui/path). Layered with signal +
   * addDisposable by the runtime. */
  createContext?: (
    record: ExtensionRecord,
  ) => Pick<ExtensionContext, 'extensionId' | 'extensionPath' | 'manifest' | 'vault' | 'ui' | 'logger'>;
}

/** A loader that returns an {@link Extension} for a tier. */
export type HostLoader = ExtensionLoader;

export class ExtensionHost {
  private readonly records = new Map<string, ExtensionRecord>();
  private readonly loaders = new Map<string, HostLoader>();
  private hooks: ExtensionHostHooks;

  constructor(hooks: ExtensionHostHooks = {}) {
    this.hooks = hooks;
  }

  /** Inject/replace the host hooks (createApi / createContext). Called once
   * at app boot by the desktop shell to wire the real capability surface. */
  setHooks(hooks: ExtensionHostHooks): void {
    this.hooks = hooks;
  }

  /** Register a loader for a tier. Replaces any prior loader for that tier. */
  registerLoader(loader: HostLoader): Disposable {
    this.loaders.set(loader.tier, loader);
    return {
      dispose: () => {
        if (this.loaders.get(loader.tier) === loader) {
          this.loaders.delete(loader.tier);
        }
      },
    };
  }

  /** Validate a manifest and persist a 'discovered' record. Returns the id. */
  async install(manifest: ExtensionManifest): Promise<string> {
    validateManifest(manifest);
    if (this.records.has(manifest.id)) {
      throw new Error(`Extension already installed: ${manifest.id}`);
    }
    this.records.set(manifest.id, {
      manifest,
      state: 'validated',
      disposables: [],
    });
    return manifest.id;
  }

  /** Load + activate an extension. No-op if already active. */
  async activate(id: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) throw new Error(`Unknown extension: ${id}`);
    if (record.state === 'active') return;
    if (record.state === 'loading' || record.state === 'activating') return;

    record.state = 'loading';
    try {
      const loader = this.loaders.get(record.manifest.tier);
      if (!loader) {
        throw new Error(`No loader registered for tier: ${record.manifest.tier}`);
      }
      const extension = await loader.load(record.manifest);
      record.extension = extension;
      record.state = 'activating';

      const apiHandle = this.hooks.createApi?.(record);
      const api = apiHandle && 'api' in apiHandle ? apiHandle.api : (apiHandle as ExtensionApi | undefined);
      const apiDispose = apiHandle && 'api' in apiHandle ? apiHandle.dispose : undefined;
      const baseCtx = this.hooks.createContext?.(record) ?? defaultContext(record);
      const runtime = new ExtensionRuntime({
        extension: record.extension,
        api: api as ExtensionApi,
        context: baseCtx,
      });
      record.runtime = runtime;
      // Push the api-level teardown (env subscriptions, etc.) so the runtime
      // reaps it on deactivate, alongside the extension's own disposables.
      if (apiDispose) runtime.context.addDisposable(apiDispose);

      try {
        await runtime.activate();
        record.state = 'active';
        record.error = undefined;
      } catch (err) {
        // Transactional rollback already ran inside runtime.activate();
        // ensure the runtime is fully disposed then mark failed.
        await runtime.dispose();
        record.runtime = undefined;
        record.extension = undefined;
        record.state = 'failed';
        record.error = err;
        throw err;
      }
    } catch (err) {
      record.state = 'failed';
      record.error = err;
      // Reap any disposables pushed outside the runtime (legacy loader paths).
      await this.reapLegacyDisposables(record);
      throw err;
    }
  }

  /** Deactivate an extension, aborting its runtime and reaping disposables. */
  async deactivate(id: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) throw new Error(`Unknown extension: ${id}`);
    if (record.state !== 'active') return;

    record.state = 'deactivating';
    const runtime = record.runtime;
    record.runtime = undefined;
    try {
      await runtime?.dispose();
    } catch (err) {
      // deactivate threw (rethrown by runtime.dispose after cleanup) — mark
      // failed but RESOLVE (the test contract: deactivate never rejects,
      // cleanup still completes). Cleanup already ran inside dispose.
      record.state = 'failed';
      record.error = err;
    } finally {
      // Legacy disposables pushed directly onto record.disposables (outside
      // the runtime's DisposableStore).
      await this.reapLegacyDisposables(record);
      record.extension = undefined;
      if (record.state === 'deactivating') record.state = 'validated';
    }
  }

  /** Deactivate (if active) and remove the record. */
  async uninstall(id: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) return;
    if (record.state === 'active') {
      await this.deactivate(id);
    }
    // Defensive: ensure legacy disposables are reaped even from a failed record.
    await this.reapLegacyDisposables(record);
    this.records.delete(id);
  }

  /** Reload = destroy runtime + recreate (doc §36). */
  async reload(id: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) throw new Error(`Unknown extension: ${id}`);
    if (record.state === 'active') {
      await this.deactivate(id);
    }
    await this.activate(id);
  }

  get(id: string): ExtensionRecord | undefined {
    return this.records.get(id);
  }

  list(): ExtensionRecord[] {
    return Array.from(this.records.values());
  }

  validateManifest(manifest: ExtensionManifest): void {
    validateManifest(manifest);
  }

  private async reapLegacyDisposables(record: ExtensionRecord): Promise<void> {
    const pending = record.disposables.splice(0);
    for (let i = pending.length - 1; i >= 0; i--) {
      try {
        await pending[i].dispose();
      } catch (err) {
        record.state = 'failed';
        record.error = err;
        console.error(`[extension-host] disposable failed during cleanup of ${record.manifest.id}:`, err);
      }
    }
  }
}

function defaultContext(record: ExtensionRecord): Pick<ExtensionContext, 'extensionId' | 'extensionPath' | 'manifest' | 'vault' | 'ui' | 'logger'> {
  return {
    extensionId: record.manifest.id,
    extensionPath: record.manifest.main,
    manifest: record.manifest,
    vault: { name: 'default', path: 'default' } satisfies VaultContext,
    ui: { dialogs: noopDialogs, notifications: noopNotifications } satisfies ExtensionUIContext,
    logger: consoleLogger,
  };
}

const noopDialogs = {
  async info() {},
  async confirm() {
    return false;
  },
};
const noopNotifications = { show() {} };

/** Shared app-wide host instance. Tests should `new ExtensionHost()` for isolation. */
export const extensionHost = new ExtensionHost();
