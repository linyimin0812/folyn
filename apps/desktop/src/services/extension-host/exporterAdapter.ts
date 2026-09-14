/**
 * Exporter contribution adapter (trusted-tier custom export formats).
 *
 * For each `contributes.exporters[]` entry: resolve the `run` entry-ref
 * against `module.exporters`, then register an {@link ExporterRegistration}
 * into the host's `exporterRegistry` so the contribution flows through the
 * standard export pipeline (`ExportMenu` → `FormatExportDialog` → local
 * download OR remote upload via configured storage providers). The handler
 * returns `Blob | string`; this adapter wraps it as `ExportResult`.
 *
 * Why register into `exporterRegistry` (not as a command): the host's
 * `FormatExportDialog` already implements the local/remote target picker,
 * storage-provider config, and post-upload share-URL flow. Routing manifest
 * exporters through the registry lets every extension-contributed format
 * reuse that UI for free — no per-extension dialog wiring.
 *
 * Entry-ref missing → warn + skip; returns a merged Disposable that
 * unregisters all registrations on extension deactivate.
 */

import type { Disposable, ExtensionManifest } from '@folyn/extension-host';
import type { ExporterContribution } from '@folyn/extension-host';
import type { ExporterRegistration, ExportResult, ExportContext } from 'folyn-extension-sdk';
import type { ExtensionModule } from './contributionAdapters';
import { exporterRegistry } from '@/services/export/exporterRegistry';

function baseNameFromCtx(ctx: ExportContext): string {
  const path = ctx.filePath ?? '';
  const file = path.split('/').pop() ?? '';
  return file.replace(/\.[^.]+$/, '') || 'export';
}

/**
 * Build an {@link ExporterRegistration} from a manifest contribution + the
 * extension's resolved handler. The handler returns `Blob | string`; the
 * adapter wraps either into an `ExportResult`. mimeType comes from the
 * Blob's type for Blob returns, or `text/plain;charset=utf-8` for strings.
 */
function toRegistration(
  manifest: ExtensionManifest,
  contrib: ExporterContribution,
  handler: (content: string, ctx: ExportContext) => Promise<Blob | string>,
): ExporterRegistration {
  const fullId = `extension.${manifest.id}.${contrib.id}`;
  return {
    id: fullId,
    title: contrib.label,
    fileTypes: contrib.fileType ? [contrib.fileType] : [],
    formats: [{
      id: contrib.format,
      title: contrib.label,
      extension: contrib.fileExtension,
      mimeType: 'text/plain;charset=utf-8',
    }],
    async export(ctx): Promise<ExportResult> {
      const baseName = baseNameFromCtx(ctx);
      const result = await handler(ctx.content, ctx);
      if (typeof result === 'string') {
        return {
          data: result,
          mimeType: 'text/plain;charset=utf-8',
          suggestedName: `${baseName}.${contrib.fileExtension}`,
        };
      }
      return {
        data: new Uint8Array(await result.arrayBuffer()),
        mimeType: result.type || 'application/octet-stream',
        suggestedName: `${baseName}.${contrib.fileExtension}`,
      };
    },
  };
}

export function registerExtensionExporters(
  manifest: ExtensionManifest,
  module: ExtensionModule,
): Disposable {
  const exporters: ExporterContribution[] = manifest.contributes?.exporters ?? [];
  if (exporters.length === 0) return { dispose: () => {} };

  const disposables: Disposable[] = [];
  for (const exp of exporters) {
    const handler = module.exporters?.[exp.run];
    if (typeof handler !== 'function') {
      console.warn(
        `[extension-host] extension "${manifest.id}" exporter "${exp.id}" has no handler for entry-ref "${exp.run}" — skipped`,
      );
      continue;
    }
    disposables.push(exporterRegistry.register(toRegistration(manifest, exp, handler), manifest.id));
  }

  return {
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}
