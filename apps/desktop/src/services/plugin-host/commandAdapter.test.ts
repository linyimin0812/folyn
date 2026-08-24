import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PluginManifest } from '@folyn/plugin-host';
import { registerPluginCommands } from './commandAdapter';
import {
  getCommands,
  getCommand,
  runCommand,
  clearCommands,
} from '@/services/commandRegistry';
import type { RpcBridge } from './rpcBridge';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'demo-plugin',
    name: 'Demo',
    version: '1.0.0',
    tier: 'sandbox',
    main: 'index.js',
    html: 'index.html',
    contributes: {
      commands: [
        { id: 'greet', title: 'Greet', keywords: ['hello'], run: 'greet' },
        { id: 'farewell', title: 'Farewell', run: 'farewell' },
      ],
    },
    ...overrides,
  };
}

/** A minimal RpcBridge mock — invokeCommand is a vi.fn. */
function mockBridge(): RpcBridge {
  return {
    invokeCommand: vi.fn(async () => undefined),
  } as unknown as RpcBridge;
}

beforeEach(() => {
  clearCommands();
});

afterEach(() => {
  clearCommands();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('registerPluginCommands', () => {
  it('registers all commands from contributes.commands', () => {
    const m = manifest();
    const bridge = mockBridge();
    registerPluginCommands(m, bridge);

    const cmds = getCommands();
    expect(cmds).toHaveLength(2);
    expect(getCommand('plugin.demo-plugin.greet')).toBeDefined();
    expect(getCommand('plugin.demo-plugin.farewell')).toBeDefined();
  });

  it('namespaces command ids as plugin.<pluginId>.<cmdId>', () => {
    const m = manifest();
    const bridge = mockBridge();
    registerPluginCommands(m, bridge);

    const greet = getCommand('plugin.demo-plugin.greet');
    expect(greet?.title).toBe('Greet');
    expect(greet?.category).toBe('action');
    expect(greet?.keywords).toEqual(['hello']);
  });

  it('run dispatches invokeCommand to the bridge', async () => {
    const m = manifest();
    const bridge = mockBridge();
    registerPluginCommands(m, bridge);

    await runCommand('plugin.demo-plugin.greet');

    expect(bridge.invokeCommand).toHaveBeenCalledTimes(1);
    expect(bridge.invokeCommand).toHaveBeenCalledWith('greet');
  });

  it('dispose unregisters all commands', () => {
    const m = manifest();
    const bridge = mockBridge();
    const disposable = registerPluginCommands(m, bridge);

    expect(getCommands()).toHaveLength(2);
    disposable.dispose();
    expect(getCommands()).toHaveLength(0);
    expect(getCommand('plugin.demo-plugin.greet')).toBeUndefined();
    expect(getCommand('plugin.demo-plugin.farewell')).toBeUndefined();
  });

  it('does not unregister a re-registered command on late dispose', () => {
    const m = manifest();
    const bridge1 = mockBridge();
    const bridge2 = mockBridge();
    const d1 = registerPluginCommands(m, bridge1);
    // Re-register with a new bridge (simulating re-activation)
    registerPluginCommands(m, bridge2);

    // Dispose the first registration — should NOT remove commands
    // because they were replaced by the second registration.
    d1.dispose();
    expect(getCommands()).toHaveLength(2);
    expect(getCommand('plugin.demo-plugin.greet')).toBeDefined();
  });

  it('returns no-op disposable when no commands declared', () => {
    const m = manifest({ contributes: undefined });
    const bridge = mockBridge();
    const disposable = registerPluginCommands(m, bridge);

    expect(getCommands()).toHaveLength(0);
    // dispose should not throw
    expect(() => disposable.dispose()).not.toThrow();
  });

  it('passes icon through to the command', () => {
    const m = manifest({
      contributes: {
        commands: [{ id: 'styled', title: 'Styled', icon: 'star', run: 'styled' }],
      },
    });
    const bridge = mockBridge();
    registerPluginCommands(m, bridge);

    const cmd = getCommand('plugin.demo-plugin.styled');
    expect(cmd?.icon).toBe('star');
  });
});
