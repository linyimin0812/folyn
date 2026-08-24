/**
 * Tests for the tool contribution adapter.
 *
 * Verifies: register → "Open: <title>" command appears; dispose removes the
 * command; `window: false` tools are skipped with a warning; dispose also
 * closes open tool windows for the plugin (via the store's closeAllForPlugin).
 *
 * Doesn't exercise the WebviewWindow itself — that path is Tauri-only and
 * integration-tested manually. The adapter's contract is: register a command
 * whose `run` calls `toolWindowStore.open`. We verify the command is wired
 * and that dispose cascades to the store.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PluginManifest } from '@folyn/plugin-host';
import { registerPluginTools } from './toolAdapter';
import { getCommands, clearCommands } from '@/services/commandRegistry';
import { useToolWindowStore } from '@/store/toolWindowStore';

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'tool-test',
    name: 'Tool Test',
    version: '1.0.0',
    tier: 'sandbox',
    main: 'index.js',
    html: 'index.html',
    contributes: {
      tools: [
        {
          id: 'hello',
          title: 'Hello Tool',
          icon: '🛠',
          window: true,
          entry: 'index.html',
        },
      ],
    },
    ...overrides,
  };
}

beforeEach(() => {
  clearCommands();
  useToolWindowStore.setState({ windows: [] });
});

afterEach(() => {
  clearCommands();
  useToolWindowStore.setState({ windows: [] });
  vi.restoreAllMocks();
});

describe('registerPluginTools', () => {
  it('registers an "Open: <title>" command per tool (window: true)', () => {
    registerPluginTools(manifest());
    const cmds = getCommands().filter((c) =>
      c.id.startsWith('plugin.openTool.tool-test.'),
    );
    expect(cmds).toHaveLength(1);
    expect(cmds[0].title).toBe('Open: Hello Tool');
    expect(cmds[0].category).toBe('action');
  });

  it('skips tools with window: false and warns', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerPluginTools(
      manifest({
        contributes: {
          tools: [
            {
              id: 'inline',
              title: 'Inline',
              window: false,
              entry: 'index.html',
            } as never,
          ],
        },
      }),
    );
    const cmds = getCommands().filter((c) =>
      c.id.startsWith('plugin.openTool.tool-test.'),
    );
    expect(cmds).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('returns an empty disposable when no tools are contributed', async () => {
    const d = registerPluginTools(manifest({ contributes: {} }));
    expect(getCommands().filter((c) => c.id.startsWith('plugin.openTool.')).length).toBe(0);
    await d.dispose();
  });

  it('dispose unregisters the command', async () => {
    const d = registerPluginTools(manifest());
    expect(getCommands().some((c) => c.id === 'plugin.openTool.tool-test.hello')).toBe(true);
    await d.dispose();
    expect(getCommands().some((c) => c.id === 'plugin.openTool.tool-test.hello')).toBe(false);
  });

  it('dispose cascades to closeAllForPlugin on the tool window store', async () => {
    const closeSpy = vi
      .spyOn(useToolWindowStore.getState(), 'closeAllForPlugin')
      .mockResolvedValue(undefined);
    const d = registerPluginTools(manifest());
    await d.dispose();
    expect(closeSpy).toHaveBeenCalledWith('tool-test');
  });

  it("run on the registered command calls toolWindowStore.open with manifest id + tool", () => {
    // ponytail: in tests isTauri() is false, so open() no-ops before touching
    // WebviewWindow. We spy open() to verify the wiring without a real window.
    const openSpy = vi.fn().mockResolvedValue(undefined);
    // Replace the bound action so the existing getState() returns our spy.
    useToolWindowStore.setState({ open: openSpy } as never);

    registerPluginTools(manifest());
    const cmd = getCommands().find((c) => c.id === 'plugin.openTool.tool-test.hello');
    expect(cmd).toBeDefined();
    cmd!.run();
    expect(openSpy).toHaveBeenCalledTimes(1);
    const [pluginId, tool] = openSpy.mock.calls[0];
    expect(pluginId).toBe('tool-test');
    expect(tool.id).toBe('hello');
    expect(tool.entry).toBe('index.html');
  });
});
