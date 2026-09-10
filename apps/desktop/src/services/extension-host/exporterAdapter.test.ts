/**
 * Tests for the exporter contribution adapter.
 *
 * Covers: register resolves the `run` entry-ref and registers an
 * `Export as <label>` command; missing entry-ref is skipped with a warning;
 * dispose unregisters; running the command invokes the handler with the
 * active doc content + ctx and writes the result via `downloadBlob`.
 *
 * Tauri save-dialog / fs writes are mocked (`downloadBlob`); we verify the
 * wiring, not the OS dialog.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ExtensionManifest } from '@folyn/extension-host';
import { registerExtensionExporters, getExtensionExportersForFileType, clearExtensionExporters } from './exporterAdapter';
import type { ExtensionModule } from './contributionAdapters';
import { getCommands, getCommand, clearCommands } from '@/services/commandRegistry';

vi.mock('@/hooks/useExport', () => ({
  getActiveDocument: () => ({
    name: 'note.md',
    content: 'hello world',
    path: 'notes/note.md',
    vaultRoot: '/vault',
    fileType: 'markdown',
  }),
}));

const downloadBlobMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/services/export/shared', () => ({
  downloadBlob: (...args: unknown[]) => downloadBlobMock(...args),
}));

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
  clearCommands();
  clearExtensionExporters();
  downloadBlobMock.mockClear();
});

afterEach(() => {
  clearCommands();
  vi.restoreAllMocks();
});

describe('registerExtensionExporters', () => {
  it('registers an "Export as <label>" command', () => {
    registerExtensionExporters(manifest(), fakeModule());
    const cmd = getCommand('extension.exporter-test.export.txt-header');
    expect(cmd).toBeDefined();
    expect(cmd!.title).toBe('Export as Text with header');
    expect(cmd!.category).toBe('action');
  });

  it('skips exporters with missing entry-ref and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = fakeModule();
    mod.exporters = {}; // no handler for the entry-ref
    registerExtensionExporters(manifest(), mod);
    expect(getCommand('extension.exporter-test.export.txt-header')).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns no-op disposable when no exporters declared', () => {
    expect(() =>
      registerExtensionExporters(manifest({ contributes: {} }), fakeModule()).dispose(),
    ).not.toThrow();
  });

  it('dispose unregisters the command', () => {
    const d = registerExtensionExporters(manifest(), fakeModule());
    expect(getCommand('extension.exporter-test.export.txt-header')).toBeDefined();
    d.dispose();
    expect(getCommand('extension.exporter-test.export.txt-header')).toBeUndefined();
  });

  it('running the command invokes the handler with active doc + ctx and writes via downloadBlob', async () => {
    const handler = vi.fn(async (_content: string, _ctx) => 'BODY');
    const mod = fakeModule();
    mod.exporters = { 'txt-with-header': handler };
    registerExtensionExporters(manifest(), mod);
    const cmd = getCommand('extension.exporter-test.export.txt-header')!;
    await cmd.run();
    expect(handler).toHaveBeenCalledTimes(1);
    const [content, ctx] = handler.mock.calls[0];
    expect(content).toBe('hello world');
    expect(ctx).toEqual({ filePath: 'notes/note.md', vaultRoot: '/vault' });
    // downloadBlob received a Blob + filename + extensions
    expect(downloadBlobMock).toHaveBeenCalledTimes(1);
    const [blob, filename, exts] = downloadBlobMock.mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(filename).toBe('note.txt');
    expect(exts).toEqual(['txt']);
  });

  it('running the command with a string result wraps it in a Blob', async () => {
    registerExtensionExporters(manifest(), fakeModule());
    const cmd = getCommand('extension.exporter-test.export.txt-header')!;
    await cmd.run();
    expect(downloadBlobMock).toHaveBeenCalledTimes(1);
    const [blob] = downloadBlobMock.mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
  });

  describe('getExtensionExportersForFileType', () => {
    function manifestWithFileType(fileType: string | undefined): ExtensionManifest {
      return {
        ...manifest(),
        contributes: {
          exporters: [
            {
              id: 'svg',
              format: 'svg',
              label: 'Export as SVG',
              fileExtension: 'svg',
              run: 'svg',
              ...(fileType ? { fileType } : {}),
            },
          ],
        },
      };
    }

    const svgHandler = async () => new Blob([''], { type: 'image/svg+xml' });

    it('returns exporters whose fileType matches the active tab', () => {
      const d = registerExtensionExporters(manifestWithFileType('plantuml'), {
        exporters: { svg: svgHandler },
      });
      const matches = getExtensionExportersForFileType('plantuml');
      expect(matches).toHaveLength(1);
      expect(matches[0].contrib.label).toBe('Export as SVG');
      expect(matches[0].commandId).toBe('extension.exporter-test.export.svg');
      d.dispose();
    });

    it('excludes exporters whose fileType does not match', () => {
      const d = registerExtensionExporters(manifestWithFileType('plantuml'), {
        exporters: { svg: svgHandler },
      });
      expect(getExtensionExportersForFileType('markdown')).toHaveLength(0);
      d.dispose();
    });

    it('includes exporters with no fileType for any tab (backward-compat)', () => {
      const d = registerExtensionExporters(manifestWithFileType(undefined), {
        exporters: { svg: svgHandler },
      });
      expect(getExtensionExportersForFileType('plantuml')).toHaveLength(1);
      expect(getExtensionExportersForFileType('markdown')).toHaveLength(1);
      d.dispose();
    });

    it('removes entries on dispose', () => {
      const d = registerExtensionExporters(manifestWithFileType('plantuml'), {
        exporters: { svg: svgHandler },
      });
      expect(getExtensionExportersForFileType('plantuml')).toHaveLength(1);
      d.dispose();
      expect(getExtensionExportersForFileType('plantuml')).toHaveLength(0);
    });
  });
});
