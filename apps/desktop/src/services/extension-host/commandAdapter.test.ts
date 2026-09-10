import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ExtensionManifest } from '@folyn/extension-host';
import { registerExtensionCommands } from './commandAdapter';
import {
  getCommands,
  getCommand,
  runCommand,
  clearCommands,
} from '@/services/commandRegistry';
import type { RpcBridge } from './rpcBridge';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function manifest(overrides: Partial<ExtensionManifest> = {}): ExtensionManifest {
  return {
    id: 'demo-extension',
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

describe('registerExtensionCommands', () => {
  it('registers all commands from contributes.commands', () => {
    const m = manifest();
    const bridge = mockBridge();
    registerExtensionCommands(m, bridge);

    const cmds = getCommands();
    expect(cmds).toHaveLength(2);
    expect(getCommand('extension.demo-extension.greet')).toBeDefined();
    expect(getCommand('extension.demo-extension.farewell')).toBeDefined();
  });

  it('namespaces command ids as extension.<extensionId>.<cmdId>', () => {
    const m = manifest();
    const bridge = mockBridge();
    registerExtensionCommands(m, bridge);

    const greet = getCommand('extension.demo-extension.greet');
    expect(greet?.title).toBe('Greet');
    expect(greet?.category).toBe('action');
    expect(greet?.keywords).toEqual(['hello']);
  });

  it('run dispatches invokeCommand to the bridge', async () => {
    const m = manifest();
    const bridge = mockBridge();
    registerExtensionCommands(m, bridge);

    await runCommand('extension.demo-extension.greet');

    expect(bridge.invokeCommand).toHaveBeenCalledTimes(1);
    expect(bridge.invokeCommand).toHaveBeenCalledWith('greet');
  });

  it('dispose unregisters all commands', () => {
    const m = manifest();
    const bridge = mockBridge();
    const disposable = registerExtensionCommands(m, bridge);

    expect(getCommands()).toHaveLength(2);
    disposable.dispose();
    expect(getCommands()).toHaveLength(0);
    expect(getCommand('extension.demo-extension.greet')).toBeUndefined();
    expect(getCommand('extension.demo-extension.farewell')).toBeUndefined();
  });

  it('does not unregister a re-registered command on late dispose', () => {
    const m = manifest();
    const bridge1 = mockBridge();
    const bridge2 = mockBridge();
    const d1 = registerExtensionCommands(m, bridge1);
    // Re-register with a new bridge (simulating re-activation)
    registerExtensionCommands(m, bridge2);

    // Dispose the first registration — should NOT remove commands
    // because they were replaced by the second registration.
    d1.dispose();
    expect(getCommands()).toHaveLength(2);
    expect(getCommand('extension.demo-extension.greet')).toBeDefined();
  });

  it('returns no-op disposable when no commands declared', () => {
    const m = manifest({ contributes: undefined });
    const bridge = mockBridge();
    const disposable = registerExtensionCommands(m, bridge);

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
    registerExtensionCommands(m, bridge);

    const cmd = getCommand('extension.demo-extension.styled');
    expect(cmd?.icon).toBe('star');
  });
});
