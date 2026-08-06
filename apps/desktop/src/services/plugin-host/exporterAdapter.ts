/**
 * Exporter contribution adapter (trusted-tier custom export formats).
 *
 * For each `contributes.exporters[]` entry: resolve the `run` entry-ref against
 * `module.exporters`, then register a command `plugin.<id>.export.<format>`
 * titled `Export as <label>` in the palette. Running the command reads the
 * active doc (content + path + vault root via {@link getActiveDocument}),
 * invokes the exporter handler, and writes the result through the shared
 * {@link downloadBlob} chokepoint (same save-dialog + writeFile path the
 * built-in exporters use).
 *
 * Mirrors `contributionAdapters.ts`: entry-ref missing → warn + skip; returns
 * a merged Disposable that unregisters all commands on plugin deactivate.
 */

import type { Disposable, PluginManifest } from '@quill/plugin-host';
import type { ExporterContribution } from '@quill/plugin-host';
import type { PluginModule } from './contributionAdapters';
import { registerCommand } from '@/services/commandRegistry';
import { getActiveDocument } from '@/hooks/useExport';
import { downloadBlob } from '@/services/export/shared';

export function registerPluginExporters(
  manifest: PluginManifest,
  module: PluginModule,
): Disposable {
  const exporters: ExporterContribution[] = manifest.contributes?.exporters ?? [];
  if (exporters.length === 0) return { dispose: () => {} };

  const disposables: Disposable[] = [];
  for (const exp of exporters) {
    const handler = module.exporters?.[exp.run];
    if (typeof handler !== 'function') {
      console.warn(
        `[plugin-host] plugin "${manifest.id}" exporter "${exp.id}" has no handler for entry-ref "${exp.run}" — skipped`,
      );
      continue;
    }
    const fullId = `plugin.${manifest.id}.export.${exp.format}`;
    const d = registerCommand({
      id: fullId,
      title: `Export as ${exp.label}`,
      category: 'action',
      icon: '⬇',
      keywords: ['plugin', 'export', manifest.id, exp.format, exp.fileExtension],
      run: async () => {
        const { name, content, path, vaultRoot } = getActiveDocument();
        if (!content && !path) return; // no active doc
        try {
          const result = await handler(content, { filePath: path, vaultRoot });
          const blob =
            typeof result === 'string'
              ? new Blob([result], { type: 'text/plain;charset=utf-8' })
              : result;
          const baseName = name.replace(/\.[^.]+$/, '') || 'export';
          await downloadBlob(blob, `${baseName}.${exp.fileExtension}`, [exp.fileExtension]);
        } catch (err) {
          console.error(`[plugin-host] exporter "${fullId}" failed:`, err);
        }
      },
    });
    disposables.push(d);
  }

  return {
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
