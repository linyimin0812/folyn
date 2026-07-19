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

import type { Disposable } from './Disposable';
import type {
  PluginContext,
  PluginLoader,
  PluginManifest,
  PluginRecord,
  PluginTier,
} from './types';

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)+$/;

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

  /** Throw on invalid manifest. Kept strict-but-minimal for PR1. */
  validateManifest(manifest: PluginManifest): void {
    if (!manifest || typeof manifest !== 'object') {
      throw new Error('manifest must be an object');
    }
    if (!manifest.id || !ID_RE.test(manifest.id)) {
      throw new Error(`manifest.id must be kebab-case, got: ${manifest.id}`);
    }
    if (!manifest.version) {
      throw new Error('manifest.version is required');
    }
    if (manifest.tier !== 'sandbox' && manifest.tier !== 'trusted') {
      throw new Error(`manifest.tier must be 'sandbox' | 'trusted', got: ${manifest.tier}`);
    }
    if (!manifest.main) {
      throw new Error('manifest.main is required');
    }
    if (manifest.tier === 'sandbox' && !manifest.html) {
      throw new Error('sandbox plugins require manifest.html');
    }
    if (manifest.permissions?.ai) {
      const { chat, agents } = manifest.permissions.ai;
      if (chat !== undefined && typeof chat !== 'boolean') {
        throw new Error('permissions.ai.chat must be a boolean');
      }
      if (agents !== undefined) {
        if (!Array.isArray(agents) || agents.some((a) => typeof a !== 'string' || !a)) {
          throw new Error('permissions.ai.agents must be a string[] of non-empty feature names');
        }
      }
    }
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
