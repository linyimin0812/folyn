import { describe, it, expect, beforeEach, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { usePluginStore } from '@/store/pluginStore';

vi.mock('@quill/plugin-host', () => ({
  pluginHost: { get: () => undefined },
}));

const MANIFEST = {
  id: 'plantuml-plugin',
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
    if (cmd === 'list_plugins') return [MANIFEST];
    if (cmd === 'read_plugin_file') {
      const path: string = args?.path ?? '';
      if (path === 'manifest.json') return JSON.stringify(MANIFEST);
      if (path === 'assets/plantuml.svg') return SVG;
      throw new Error(`unexpected read_plugin_file path: ${path}`);
    }
    return undefined;
  });
});

describe('plugin icon resolution (real plantuml-plugin shape)', () => {
  it('fetchRows inlines the top-level .svg icon', async () => {
    await usePluginStore.getState().refresh();
    const rows = usePluginStore.getState().rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].description).toBe('PlantUML 图表查看器');
    expect(rows[0].icon).toBe(SVG);
    const readCalls = vi.mocked(invoke).mock.calls.filter((c) => c[0] === 'read_plugin_file');
    expect(readCalls).toContainEqual(['read_plugin_file', { id: 'plantuml-plugin', path: 'assets/plantuml.svg' }]);
  });
});
