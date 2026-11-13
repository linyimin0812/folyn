/**
 * exportWithOwnExporter: the host renders a file type it does not know by
 * asking the registry for the exporter that type registered for itself.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { ExportContext, ExporterRegistration } from 'folyn-extension-sdk';
import { exporterRegistry } from './exporterRegistry';
import { exportWithOwnExporter } from './shared';

const OWNER = 'own-exporter-test';
const ctx: ExportContext = { filePath: 'a.erd', vaultRoot: '/vault', content: 'Table t {}' };
const loadCtx = vi.fn(async () => ctx);

function exporter(over: Partial<ExporterRegistration> & { id: string }, output: string | Uint8Array = 'out'): ExporterRegistration {
  return {
    title: over.id,
    fileTypes: ['erd'],
    formats: [{ id: 'svg', title: 'SVG', extension: 'svg', mimeType: 'image/svg+xml' }],
    export: async () => ({ data: output, mimeType: 'image/svg+xml', suggestedName: 'a.svg' }),
    ...over,
  };
}

afterEach(() => {
  exporterRegistry.removeByOwner(OWNER);
  loadCtx.mockClear();
});

describe('exportWithOwnExporter', () => {
  it('runs the exporter the file type registered for the format, with the loaded context', async () => {
    const run = vi.fn(async (c: ExportContext) => ({ data: `<svg>${c.content}</svg>`, mimeType: 'image/svg+xml', suggestedName: 'a.svg' }));
    exporterRegistry.register(exporter({ id: 'erd.svg', export: run }), OWNER);

    await expect(exportWithOwnExporter('erd', 'svg', loadCtx)).resolves.toBe('<svg>Table t {}</svg>');
    expect(run).toHaveBeenCalledWith(ctx);
  });

  it('decodes a binary result as text', async () => {
    exporterRegistry.register(exporter({ id: 'erd.svg' }, new TextEncoder().encode('<svg>é</svg>')), OWNER);

    await expect(exportWithOwnExporter('erd', 'svg', loadCtx)).resolves.toBe('<svg>é</svg>');
  });

  it('is null, without loading the file, when the type registered nothing for the format', async () => {
    exporterRegistry.register(exporter({ id: 'erd.svg' }), OWNER);

    await expect(exportWithOwnExporter('erd', 'html', loadCtx)).resolves.toBeNull();
    await expect(exportWithOwnExporter('other', 'svg', loadCtx)).resolves.toBeNull();
    expect(loadCtx).not.toHaveBeenCalled();
  });

  it('ignores exporters that apply to every file type', async () => {
    exporterRegistry.register(exporter({ id: 'any.svg', fileTypes: [] }), OWNER);

    await expect(exportWithOwnExporter('erd', 'svg', loadCtx)).resolves.toBeNull();
    expect(loadCtx).not.toHaveBeenCalled();
  });

  it('prefers the higher priority, and skips one that does not support the context', async () => {
    exporterRegistry.register(exporter({ id: 'erd.low', priority: 1 }, 'low'), OWNER);
    exporterRegistry.register(exporter({ id: 'erd.high', priority: 5 }, 'high'), OWNER);
    await expect(exportWithOwnExporter('erd', 'svg', loadCtx)).resolves.toBe('high');

    exporterRegistry.register(exporter({ id: 'erd.top', priority: 9, supports: () => false }, 'top'), OWNER);
    await expect(exportWithOwnExporter('erd', 'svg', loadCtx)).resolves.toBe('high');
  });

  it('lets the exporter\'s failure reach the caller', async () => {
    exporterRegistry.register(exporter({ id: 'erd.svg', export: async () => { throw new Error('parse error at line 3'); } }), OWNER);

    await expect(exportWithOwnExporter('erd', 'svg', loadCtx)).rejects.toThrow('parse error at line 3');
  });
});
