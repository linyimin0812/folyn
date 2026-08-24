/**
 * PluginHost — the microkernel.
 *
 * Owns the plugin lifecycle state machine and dispatches activation to a
 * per-tier {@link PluginLoader}. Contribution-point wiring (command/fileType/
 * container/feature/tool adapters into the app registries) is layered on top
 * in PR2/PR3; PR1 delivers the lifecycle + manifest validation + disposable
 * reaping so the kernel is unit-testable in isolation.
 *
 * State machine:
 *   install → 'installed'
 *   activate → 'active'   (loader.load + plugin.activate)
 *   deactivate → 'inactive' (plugin.deactivate + dispose all disposables)
 *   failure at activate/deactivate → 'failed'
 *   uninstall → record removed (deactivates first if active)
 */

import type { Disposable } from 'mochi-plugin-sdk';
import type {
  PluginContext,
  PluginLoader,
  PluginManifest,
  PluginRecord,
  PluginTier,
} from 'mochi-plugin-sdk';
import { validateManifest as validate } from 'mochi-plugin-sdk';

export class PluginHost {
  private readonly records = new Map<string, PluginRecord>();
  private readonly loaders = new Map<PluginTier, PluginLoader>();

  /** Register a loader for a tier. Replaces any prior loader for that tier. */
  registerLoader(loader: PluginLoader): Disposable {
    this.loaders.set(loader.tier, loader);
    return {
      dispose: () => {
        if (this.loaders.get(loader.tier) === loader) {
          this.loaders.delete(loader.tier);
        }
      },
    };
  }

  /** Validate a manifest and persist an 'installed' record. Returns the id. */
  async install(manifest: PluginManifest): Promise<string> {
    this.validateManifest(manifest);
    if (this.records.has(manifest.id)) {
      throw new Error(`Plugin already installed: ${manifest.id}`);
    }
    this.records.set(manifest.id, {
      manifest,
      state: 'installed',
      disposables: [],
    });
    return manifest.id;
  }

  /** Load + activate a plugin. No-op if already active. */
  async activate(id: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) throw new Error(`Unknown plugin: ${id}`);
    if (record.state === 'active') return;

    try {
      const loader = this.loaders.get(record.manifest.tier);
      if (!loader) {
        throw new Error(`No loader registered for tier: ${record.manifest.tier}`);
      }
      const plugin = await loader.load(record.manifest);
      record.plugin = plugin;
      const ctx = this.makeContext(record);
      await plugin.activate?.(ctx);
      record.state = 'active';
      record.error = undefined;
    } catch (err) {
      // Rollback any disposables pushed during this activation. The trusted
      // loader registers contribution adapters BEFORE calling module.activate();
      // without this reap, a failed activate leaves a half-wired plugin — its
      // commands/file-types/containers still registered, its components still
      // rendering and still crashing. Reap so a failed plugin is fully inert.
      await this.reapDisposables(record);
      record.plugin = undefined;
      record.state = 'failed';
      record.error = err;
      throw err;
    }
  }

  /** Deactivate a plugin, reaping all disposables registered this activation. */
  async deactivate(id: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) throw new Error(`Unknown plugin: ${id}`);
    if (record.state !== 'active') return;

    const ctx = this.makeContext(record);
    try {
      await record.plugin?.deactivate?.(ctx);
    } catch (err) {
      record.state = 'failed';
      record.error = err;
      // Still reap disposables even if deactivate threw.
    }
    await this.reapDisposables(record);
    record.plugin = undefined;
    if (record.state !== 'failed') record.state = 'inactive';
  }

  /** Deactivate (if active) and remove the record. */
  async uninstall(id: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) return;
    if (record.state === 'active') {
      await this.deactivate(id);
    }
    // Defensive: ensure disposables are reaped even from a failed record.
    await this.reapDisposables(record);
    this.records.delete(id);
  }

  get(id: string): PluginRecord | undefined {
    return this.records.get(id);
  }

  list(): PluginRecord[] {
    return Array.from(this.records.values());
  }

  /** Throw on invalid manifest. Delegates to the SDK's `validateManifest` so
   * plugin authors and the host share one source of truth. */
  validateManifest(manifest: PluginManifest): void {
    validate(manifest);
  }

  private makeContext(record: PluginRecord): PluginContext {
    return {
      pluginId: record.manifest.id,
      manifest: record.manifest,
      addDisposable: (d: Disposable) => {
        record.disposables.push(d);
      },
    };
  }

  private async reapDisposables(record: PluginRecord): Promise<void> {
    const pending = record.disposables.splice(0);
    for (const d of pending) {
      try {
        await d.dispose();
      } catch (err) {
        record.state = 'failed';
        record.error = err;
        console.error(`[plugin-host] disposable failed during cleanup of ${record.manifest.id}:`, err);
      }
    }
  }
}

/** Shared app-wide host instance. Tests should `new PluginHost()` for isolation. */
export const pluginHost = new PluginHost();
