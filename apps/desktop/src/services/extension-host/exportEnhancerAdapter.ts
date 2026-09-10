/**
 * Export-enhancer contribution adapter (trusted-tier post-render DOM mutation).
 *
 * For each `contributes.exportEnhancers[]` entry: resolve the `run` entry-ref
 * against `module.exportEnhancers`, then register the handler into a
 * module-level {@link extensionExportEnhancerRegistry} keyed by the contribution's
 * `name`. The export pipeline (`exportService.ts`) consults this registry
 * during `renderMarkdownToHtmlViaDom` to mutate rendered container/file-preview
 * DOM into a self-contained form for HTML/PDF export.
 *
 * The `name` key is matched against BOTH `:::` container directive names AND
 * file extensions (without dot) — the host tries both lookups so one enhancer
 * can serve either surface. Multiple extensions for the same key →
 * last-registered-wins (ponytail: a per-extension precedence list is the upgrade
 * path if colliding enhancers ever need to compose).
 *
 * Mirrors `contributionAdapters.ts`: entry-ref missing → warn + skip; returns
 * a merged Disposable that unregisters all (by extensionId+key) on deactivate.
 */

import type { Disposable, ExtensionManifest } from '@folyn/extension-host';
import type { ExportEnhancerContribution, ExportEnhancerHandler } from '@folyn/extension-host';
import type { ExtensionModule } from './contributionAdapters';

interface RegisteredEnhancer {
  extensionId: string;
  key: string;
  handler: ExportEnhancerHandler;
}

const enhancers = new Map<string, RegisteredEnhancer>();

/** Register an enhancer for a container-name or file-extension key. */
export function registerEnhancer(
  extensionId: string,
  key: string,
  handler: ExportEnhancerHandler,
): { dispose: () => void } {
  enhancers.set(key, { extensionId, key, handler });
  return { dispose: () => unregisterEnhancer(key, extensionId) };
}

/** Remove an enhancer (only if it still belongs to this extension). */
export function unregisterEnhancer(key: string, extensionId: string): void {
  const existing = enhancers.get(key);
  if (existing?.extensionId === extensionId) enhancers.delete(key);
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

export function registerExtensionExportEnhancers(
  manifest: ExtensionManifest,
  module: ExtensionModule,
): Disposable {
  const contributions: ExportEnhancerContribution[] = manifest.contributes?.exportEnhancers ?? [];
  if (contributions.length === 0) return { dispose: () => {} };

  const disposables: Array<{ dispose: () => void }> = [];
  for (const c of contributions) {
    const handler = module.exportEnhancers?.[c.run];
    if (typeof handler !== 'function') {
      console.warn(
        `[extension-host] extension "${manifest.id}" export-enhancer "${c.name}" has no handler for entry-ref "${c.run}" — skipped`,
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
