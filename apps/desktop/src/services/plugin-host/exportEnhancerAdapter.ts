/**
 * Export-enhancer contribution adapter (trusted-tier post-render DOM mutation).
 *
 * For each `contributes.exportEnhancers[]` entry: resolve the `run` entry-ref
 * against `module.exportEnhancers`, then register the handler into a
 * module-level {@link pluginExportEnhancerRegistry} keyed by the contribution's
 * `name`. The export pipeline (`exportService.ts`) consults this registry
 * during `renderMarkdownToHtmlViaDom` to mutate rendered container/file-preview
 * DOM into a self-contained form for HTML/PDF export.
 *
 * The `name` key is matched against BOTH `:::` container directive names AND
 * file extensions (without dot) — the host tries both lookups so one enhancer
 * can serve either surface. Multiple plugins for the same key →
 * last-registered-wins (ponytail: a per-plugin precedence list is the upgrade
 * path if colliding enhancers ever need to compose).
 *
 * Mirrors `contributionAdapters.ts`: entry-ref missing → warn + skip; returns
 * a merged Disposable that unregisters all (by pluginId+key) on deactivate.
 */

import type { Disposable, PluginManifest } from '@folyn/plugin-host';
import type { ExportEnhancerContribution, ExportEnhancerHandler } from '@folyn/plugin-host';
import type { PluginModule } from './contributionAdapters';

interface RegisteredEnhancer {
  pluginId: string;
  key: string;
  handler: ExportEnhancerHandler;
}

const enhancers = new Map<string, RegisteredEnhancer>();

/** Register an enhancer for a container-name or file-extension key. */
export function registerEnhancer(
  pluginId: string,
  key: string,
  handler: ExportEnhancerHandler,
): { dispose: () => void } {
  enhancers.set(key, { pluginId, key, handler });
  return { dispose: () => unregisterEnhancer(key, pluginId) };
}

/** Remove an enhancer (only if it still belongs to this plugin). */
export function unregisterEnhancer(key: string, pluginId: string): void {
  const existing = enhancers.get(key);
  if (existing?.pluginId === pluginId) enhancers.delete(key);
}

/**
 * Look up an enhancer by container-name or file-extension key. Returns the
 * handler or undefined. Used by `exportService` during the export DOM walk.
 */
export function getEnhancer(key: string): ExportEnhancerHandler | undefined {
  return enhancers.get(key)?.handler;
}

/** Test helper: clear the registry. */
export function clearExportEnhancers(): void {
  enhancers.clear();
}

export function registerPluginExportEnhancers(
  manifest: PluginManifest,
  module: PluginModule,
): Disposable {
  const contributions: ExportEnhancerContribution[] = manifest.contributes?.exportEnhancers ?? [];
  if (contributions.length === 0) return { dispose: () => {} };

  const disposables: Array<{ dispose: () => void }> = [];
  for (const c of contributions) {
    const handler = module.exportEnhancers?.[c.run];
    if (typeof handler !== 'function') {
      console.warn(
        `[plugin-host] plugin "${manifest.id}" export-enhancer "${c.name}" has no handler for entry-ref "${c.run}" — skipped`,
      );
      continue;
    }
    disposables.push(registerEnhancer(manifest.id, c.name, handler));
  }

  return {
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
