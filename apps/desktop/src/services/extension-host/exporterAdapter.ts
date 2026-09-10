/**
 * Exporter contribution adapter (trusted-tier custom export formats).
 *
 * For each `contributes.exporters[]` entry: resolve the `run` entry-ref against
 * `module.exporters`, then register a command `extension.<id>.export.<format>`
 * titled `Export as <label>` in the palette. Running the command reads the
 * active doc (content + path + vault root via {@link getActiveDocument}),
 * invokes the exporter handler, and writes the result through the shared
 * {@link downloadBlob} chokepoint (same save-dialog + writeFile path the
 * built-in exporters use).
 *
 * Also keeps an in-memory registry of active contributions so the host's
 * ExportMenu can append matching entries (filtered by `contrib.fileType`).
 * Mirrors `contributionAdapters.ts`: entry-ref missing → warn + skip; returns
 * a merged Disposable that unregisters all commands on extension deactivate.
 */

import type { Disposable, ExtensionManifest } from '@folyn/extension-host';
import type { ExporterContribution } from '@folyn/extension-host';
import type { ExtensionModule } from './contributionAdapters';
import { registerCommand } from '@/services/commandRegistry';
import { getActiveDocument } from '@/hooks/useExport';
import { downloadBlob } from '@/services/export/shared';

export interface ExtensionExporterEntry {
  extensionId: string;
  contrib: ExporterContribution;
  commandId: string;
}

// ponytail: module-level Map keyed by commandId. One entry per registered
// exporter; dispose removes by key. No per-instance Map on each call — this
// is the smallest data structure that lets ExportMenu filter by fileType at
// menu-open time. Extension deactivation always routes through dispose().
const activeExporters = new Map<string, ExtensionExporterEntry>();

/**
 * Returns extension-contributed exporters applicable to the given file type.
 * Entries with `contrib.fileType` set only match when it equals `fileType`;
 * entries without `fileType` match every file type (backward-compat).
 */
export function getExtensionExportersForFileType(fileType: string): ExtensionExporterEntry[] {
  const out: ExtensionExporterEntry[] = [];
  for (const e of activeExporters.values()) {
    if (!e.contrib.fileType || e.contrib.fileType === fileType) out.push(e);
  }
  return out;
}

/** Test-only: clear the active exporters registry. Mirrors `clearCommands()`. */
export function clearExtensionExporters(): void {
  activeExporters.clear();
}

export function registerExtensionExporters(
  manifest: ExtensionManifest,
  module: ExtensionModule,
): Disposable {
  const exporters: ExporterContribution[] = manifest.contributes?.exporters ?? [];
  if (exporters.length === 0) return { dispose: () => {} };

  const disposables: Disposable[] = [];
  const registeredKeys: string[] = [];
  for (const exp of exporters) {
    const handler = module.exporters?.[exp.run];
    if (typeof handler !== 'function') {
      console.warn(
        `[extension-host] extension "${manifest.id}" exporter "${exp.id}" has no handler for entry-ref "${exp.run}" — skipped`,
      );
      continue;
    }
    const fullId = `extension.${manifest.id}.export.${exp.format}`;
    const d = registerCommand({
      id: fullId,
      title: `Export as ${exp.label}`,
      category: 'action',
      icon: '⬇',
      keywords: ['extension', 'export', manifest.id, exp.format, exp.fileExtension],
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
          console.error(`[extension-host] exporter "${fullId}" failed:`, err);
        }
      },
    }, manifest.id);
    disposables.push(d);
    activeExporters.set(fullId, { extensionId: manifest.id, contrib: exp, commandId: fullId });
    registeredKeys.push(fullId);
  }

  return {
    dispose: () => {
      for (const k of registeredKeys) activeExporters.delete(k);
      for (const d of disposables) d.dispose();
    },
  };
}
