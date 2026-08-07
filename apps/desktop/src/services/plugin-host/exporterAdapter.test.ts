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
import type { PluginManifest } from '@quill/plugin-host';
import { registerPluginExporters, getPluginExportersForFileType, clearPluginExporters } from './exporterAdapter';
import type { PluginModule } from './contributionAdapters';
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

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
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

function fakeModule(): PluginModule {
  return {
    exporters: {
      'txt-with-header': async (content, ctx) =>
        `# ${ctx.filePath}\n\n${content}`,
    },
  };
}

beforeEach(() => {
  clearCommands();
  clearPluginExporters();
  downloadBlobMock.mockClear();
});

afterEach(() => {
  clearCommands();
  vi.restoreAllMocks();
});

describe('registerPluginExporters', () => {
  it('registers an "Export as <label>" command', () => {
    registerPluginExporters(manifest(), fakeModule());
    const cmd = getCommand('plugin.exporter-test.export.txt-header');
    expect(cmd).toBeDefined();
    expect(cmd!.title).toBe('Export as Text with header');
    expect(cmd!.category).toBe('action');
  });

  it('skips exporters with missing entry-ref and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = fakeModule();
    mod.exporters = {}; // no handler for the entry-ref
    registerPluginExporters(manifest(), mod);
    expect(getCommand('plugin.exporter-test.export.txt-header')).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns no-op disposable when no exporters declared', () => {
    expect(() =>
      registerPluginExporters(manifest({ contributes: {} }), fakeModule()).dispose(),
    ).not.toThrow();
  });

  it('dispose unregisters the command', () => {
    const d = registerPluginExporters(manifest(), fakeModule());
    expect(getCommand('plugin.exporter-test.export.txt-header')).toBeDefined();
    d.dispose();
    expect(getCommand('plugin.exporter-test.export.txt-header')).toBeUndefined();
  });

  it('running the command invokes the handler with active doc + ctx and writes via downloadBlob', async () => {
    const handler = vi.fn(async (_content: string, _ctx) => 'BODY');
    const mod = fakeModule();
    mod.exporters = { 'txt-with-header': handler };
    registerPluginExporters(manifest(), mod);
    const cmd = getCommand('plugin.exporter-test.export.txt-header')!;
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
    registerPluginExporters(manifest(), fakeModule());
    const cmd = getCommand('plugin.exporter-test.export.txt-header')!;
    await cmd.run();
    expect(downloadBlobMock).toHaveBeenCalledTimes(1);
    const [blob] = downloadBlobMock.mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
  });

  describe('getPluginExportersForFileType', () => {
    function manifestWithFileType(fileType: string | undefined): PluginManifest {
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
      const d = registerPluginExporters(manifestWithFileType('plantuml'), {
        exporters: { svg: svgHandler },
      });
      const matches = getPluginExportersForFileType('plantuml');
      expect(matches).toHaveLength(1);
      expect(matches[0].contrib.label).toBe('Export as SVG');
      expect(matches[0].commandId).toBe('plugin.exporter-test.export.svg');
      d.dispose();
    });

    it('excludes exporters whose fileType does not match', () => {
      const d = registerPluginExporters(manifestWithFileType('plantuml'), {
        exporters: { svg: svgHandler },
      });
      expect(getPluginExportersForFileType('markdown')).toHaveLength(0);
      d.dispose();
    });

    it('includes exporters with no fileType for any tab (backward-compat)', () => {
      const d = registerPluginExporters(manifestWithFileType(undefined), {
        exporters: { svg: svgHandler },
      });
      expect(getPluginExportersForFileType('plantuml')).toHaveLength(1);
      expect(getPluginExportersForFileType('markdown')).toHaveLength(1);
      d.dispose();
    });

    it('removes entries on dispose', () => {
      const d = registerPluginExporters(manifestWithFileType('plantuml'), {
        exporters: { svg: svgHandler },
      });
      expect(getPluginExportersForFileType('plantuml')).toHaveLength(1);
      d.dispose();
      expect(getPluginExportersForFileType('plantuml')).toHaveLength(0);
    });
  });
});
