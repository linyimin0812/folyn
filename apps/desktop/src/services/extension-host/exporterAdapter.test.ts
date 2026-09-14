/**
 * Tests for the exporter contribution adapter.
 *
 * Covers: register resolves the `run` entry-ref and registers an
 * `ExporterRegistration` into `exporterRegistry`; missing entry-ref is
 * skipped with a warning; dispose unregisters; running the registration's
 * `export()` invokes the handler with ctx.content + ctx and returns an
 * `ExportResult` whose `suggestedName` is derived from `ctx.filePath`.
 *
 * The local/remote target picker is owned by `FormatExportDialog` — not
 * under test here (its own suite covers the dialog flow).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ExtensionManifest } from '@folyn/extension-host';
import { registerExtensionExporters } from './exporterAdapter';
import type { ExtensionModule } from './contributionAdapters';
import { exporterRegistry } from '@/services/export/exporterRegistry';

function manifest(overrides: Partial<ExtensionManifest> = {}): ExtensionManifest {
  return {
    id: 'exporter-test',
    name: 'Exporter Test',
    version: '1.0.0',
    tier: 'trusted',
    main: 'index.js',
    contributes: {
      exporters: [
        {
          id: 'txt',
          format: 'txt-header',
          label: 'Text with header',
          fileExtension: 'txt',
          run: 'txt-with-header',
        },
      ],
    },
    ...overrides,
  };
}

function fakeModule(): ExtensionModule {
  return {
    exporters: {
      'txt-with-header': async (content, ctx) =>
        `# ${ctx.filePath}\n\n${content}`,
    },
  };
}

beforeEach(() => {
  // ponytail: registry owns state; remove the test extension's registrations
  // between cases. `removeByOwner` is the bulk-dispose path the live runtime
  // uses on extension deactivate.
  exporterRegistry.removeByOwner('exporter-test');
});

afterEach(() => {
  exporterRegistry.removeByOwner('exporter-test');
  vi.restoreAllMocks();
});

describe('registerExtensionExporters', () => {
  it('registers an ExporterRegistration under the extension id namespace', () => {
    registerExtensionExporters(manifest(), fakeModule());
    const reg = exporterRegistry.get('extension.exporter-test.txt');
    expect(reg).toBeDefined();
    expect(reg!.title).toBe('Text with header');
    expect(reg!.fileTypes).toEqual([]);
    expect(reg!.formats[0]).toMatchObject({
      id: 'txt-header',
      title: 'Text with header',
      extension: 'txt',
      mimeType: 'text/plain;charset=utf-8',
    });
  });

  it('skips exporters with missing entry-ref and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = fakeModule();
    mod.exporters = {};
    registerExtensionExporters(manifest(), mod);
    expect(exporterRegistry.get('extension.exporter-test.txt')).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns no-op disposable when no exporters declared', () => {
    expect(() =>
      registerExtensionExporters(manifest({ contributes: {} }), fakeModule()).dispose(),
    ).not.toThrow();
  });

  it('dispose unregisters the registration', () => {
    const d = registerExtensionExporters(manifest(), fakeModule());
    expect(exporterRegistry.get('extension.exporter-test.txt')).toBeDefined();
    d.dispose();
    expect(exporterRegistry.get('extension.exporter-test.txt')).toBeUndefined();
  });

  it('export() invokes the handler with ctx + content and returns an ExportResult', async () => {
    const handler = vi.fn(async (_content: string, _ctx) => 'BODY');
    const mod = fakeModule();
    mod.exporters = { 'txt-with-header': handler };
    registerExtensionExporters(manifest(), mod);
    const reg = exporterRegistry.get('extension.exporter-test.txt')!;
    const result = await reg.export({
      filePath: 'notes/note.md',
      vaultRoot: '/vault',
      content: 'hello world',
    });
    expect(handler).toHaveBeenCalledTimes(1);
    const [content, ctx] = handler.mock.calls[0];
    expect(content).toBe('hello world');
    expect(ctx).toEqual({
      filePath: 'notes/note.md',
      vaultRoot: '/vault',
      content: 'hello world',
    });
    expect(result).toEqual({
      data: 'BODY',
      mimeType: 'text/plain;charset=utf-8',
      suggestedName: 'note.txt',
    });
  });

  it('export() wraps a Blob result as Uint8Array with the Blob mimeType', async () => {
    // jsdom Blob lacks arrayBuffer(); install a stub (same pattern as
    // chat/attachments.test.ts and ChatInput.test.tsx).
    const buffer = new TextEncoder().encode('<html/>').buffer;
    const blob = {
      type: 'text/html;charset=utf-8',
      size: buffer.byteLength,
      arrayBuffer: () => Promise.resolve(buffer),
    } as unknown as Blob;
    const mod = fakeModule();
    mod.exporters = { 'txt-with-header': async () => blob };
    registerExtensionExporters(manifest(), mod);
    const reg = exporterRegistry.get('extension.exporter-test.txt')!;
    const result = await reg.export({
      filePath: 'note.richtext',
      vaultRoot: '/vault',
      content: '',
    });
    expect(result.data).toBeInstanceOf(Uint8Array);
    expect(result.mimeType).toBe('text/html;charset=utf-8');
    expect(result.suggestedName).toBe('note.txt');
  });

  it('registers under fileTypes when contrib.fileType is set', () => {
    const plantumlManifest: ExtensionManifest = {
      ...manifest(),
      contributes: {
        exporters: [
          {
            id: 'svg',
            format: 'svg',
            label: 'Export as SVG',
            fileExtension: 'svg',
            run: 'svg',
            fileType: 'plantuml',
          },
        ],
      },
    };
    registerExtensionExporters(plantumlManifest, {
      exporters: { svg: async () => new Blob(['<svg/>'], { type: 'image/svg+xml' }) },
    });
    const ctx = { filePath: 'x.puml', vaultRoot: '', content: '' };
    const matched = exporterRegistry.getForFileType('plantuml', ctx);
    expect(matched).toHaveLength(1);
    expect(matched[0].id).toBe('extension.exporter-test.svg');
    // Not surfaced for unrelated file types.
    expect(exporterRegistry.getForFileType('markdown', ctx)).toHaveLength(0);
  });
});
