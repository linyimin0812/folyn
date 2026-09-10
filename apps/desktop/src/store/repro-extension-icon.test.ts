import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { useExtensionStore } from '@/store/extensionStore';

vi.mock('@folyn/extension-host', () => ({
  extensionHost: { get: () => undefined },
}));

const MANIFEST = {
  id: 'plantuml-extension',
  name: 'PlantUML Viewer',
  version: '0.1.1',
  tier: 'trusted',
  trusted: false,
  icon: 'assets/plantuml.svg',
  description: 'PlantUML 图表查看器',
  main: 'dist/index.js',
  contributes: { fileTypes: [], containers: [], exporters: [] },
};

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" style="width: 200px; height: 200px;"><path d="M0 0"/></svg>';

beforeEach(() => {
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
    if (cmd === 'list_extensions') return [MANIFEST];
    if (cmd === 'read_extension_file') {
      const path: string = args?.path ?? '';
      if (path === 'manifest.json') return JSON.stringify(MANIFEST);
      if (path === 'assets/plantuml.svg') return SVG;
      throw new Error(`unexpected read_extension_file path: ${path}`);
    }
    return undefined;
  });
});

describe('extension icon resolution (real plantuml-extension shape)', () => {
  it('fetchRows inlines the top-level .svg icon', async () => {
    await useExtensionStore.getState().refresh();
    const rows = useExtensionStore.getState().rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].description).toBe('PlantUML 图表查看器');
    expect(rows[0].icon).toBe(SVG);
    const readCalls = vi.mocked(invoke).mock.calls.filter((c) => c[0] === 'read_extension_file');
    expect(readCalls).toContainEqual(['read_extension_file', { id: 'plantuml-extension', path: 'assets/plantuml.svg' }]);
  });
});
