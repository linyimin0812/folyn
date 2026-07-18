/**
 * Tests for the in-process contribution adapters (file-type, container,
 * command, feature).
 *
 * These tests exercise the register → dispose lifecycle directly against the
 * real app registries, without going through the trusted loader's blob-URL
 * import path. They verify: registration surfaces the contribution; dispose
 * removes it; late-dispose safety (re-registration not clobbered).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PluginManifest } from '@quill/plugin-host';
import {
  registerTrustedPluginCommands,
  registerPluginFileTypes,
  registerPluginContainers,
} from './contributionAdapters';
import type { PluginModule } from './contributionAdapters';
import { getCommands, getCommand, clearCommands } from '@/services/commandRegistry';
import { getHandlerByExtension, getAllHandlers } from '@/components/file-types/registry';
import { ContainerRegistry } from '@quill/container-plugins';

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'adapter-test',
    name: 'Adapter Test',
    version: '1.0.0',
    tier: 'trusted',
    main: 'index.js',
    contributes: {
      commands: [{ id: 'greet', title: 'Greet', run: 'greet' }],
      fileTypes: [{ id: 'adt', extensions: ['.adt'], handler: 'default' }],
      containers: [
        { name: 'adt-block', icon: '📦', label: 'ADT', category: 'custom', component: 'block', template: ':::adt-block\n:::' },
      ],
      features: [{ id: 'adt-panel', panel: 'right', component: 'panel', icon: '<svg/>' }],
    },
    ...overrides,
  };
}

function fakeModule(): PluginModule {
  return {
    handlers: {
      default: {
        id: 'adt',
        extensions: ['.adt'],
        supportedViewModes: ['edit'],
        needsFileContent: true,
        useCodeMirror: true,
      },
    },
    containers: { block: (() => null) as never },
    commands: { greet: async () => {} },
  };
}

beforeEach(() => {
  clearCommands();
  const cr = ContainerRegistry.getInstance();
  for (const p of cr.getAll()) cr.unregister(p.name);
  resetFileRegistry();
});

afterEach(() => {
  clearCommands();
  const cr = ContainerRegistry.getInstance();
  for (const p of cr.getAll()) cr.unregister(p.name);
  resetFileRegistry();
});

/** Reset the mocked file-types registry between tests. */
async function resetFileRegistry(): Promise<void> {
  const mod = await import('@/components/file-types/registry');
  const reset = (mod as unknown as { __resetTestFileRegistry?: () => void }).__resetTestFileRegistry;
  reset?.();
}

describe('registerTrustedPluginCommands', () => {
  it('registers commands in-process (run calls the handler directly)', async () => {
    const handler = vi.fn(async () => {});
    const mod = fakeModule();
    mod.commands = { greet: handler };
    registerTrustedPluginCommands(manifest(), mod);

    const cmd = getCommand('plugin.adapter-test.greet');
    expect(cmd).toBeDefined();
    await cmd!.run();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('dispose removes the command', () => {
    const d = registerTrustedPluginCommands(manifest(), fakeModule());
    expect(getCommand('plugin.adapter-test.greet')).toBeDefined();
    d.dispose();
    expect(getCommand('plugin.adapter-test.greet')).toBeUndefined();
  });

  it('skips commands with missing entry-ref', () => {
    const mod = fakeModule();
    mod.commands = {}; // no 'greet' handler
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerTrustedPluginCommands(manifest(), mod);
    expect(getCommand('plugin.adapter-test.greet')).toBeUndefined();
    warn.mockRestore();
  });

  it('returns no-op disposable when no commands declared', () => {
    const m = manifest({ contributes: undefined });
    expect(() => registerTrustedPluginCommands(m, fakeModule()).dispose()).not.toThrow();
  });
});

describe('registerPluginFileTypes', () => {
  it('registers the handler for the declared extension', () => {
    registerPluginFileTypes(manifest(), fakeModule());
    const h = getHandlerByExtension('.adt');
    expect(h).toBeDefined();
    expect(h?.id).toBe('adt');
  });

  it('dispose removes the handler', () => {
    const d = registerPluginFileTypes(manifest(), fakeModule());
    expect(getHandlerByExtension('.adt')).toBeDefined();
    d.dispose();
    expect(getHandlerByExtension('.adt')).toBeUndefined();
  });

  it('skips file-types with missing handler entry-ref', () => {
    const mod = fakeModule();
    mod.handlers = undefined;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerPluginFileTypes(manifest(), mod);
    expect(getHandlerByExtension('.adt')).toBeUndefined();
    warn.mockRestore();
  });

  it('late-dispose does not remove a re-registered handler', () => {
    const d1 = registerPluginFileTypes(manifest(), fakeModule());
    // Re-register (simulating re-activation)
    registerPluginFileTypes(manifest(), fakeModule());
    // Dispose the first registration — should NOT remove the handler because
    // the registry's disposable contract only removes if it's still the same
    // instance.
    d1.dispose();
    expect(getHandlerByExtension('.adt')).toBeDefined();
  });
});

describe('registerPluginContainers', () => {
  it('registers the container directive', () => {
    registerPluginContainers(manifest(), fakeModule());
    const cr = ContainerRegistry.getInstance();
    expect(cr.get('adt-block')).toBeDefined();
    expect(cr.get('adt-block')?.label).toBe('ADT');
  });

  it('dispose unregisters the container', async () => {
    const d = registerPluginContainers(manifest(), fakeModule());
    const cr = ContainerRegistry.getInstance();
    expect(cr.get('adt-block')).toBeDefined();
    await d.dispose();
    expect(cr.get('adt-block')).toBeUndefined();
  });

  it('skips containers with missing component entry-ref', () => {
    const mod = fakeModule();
    mod.containers = undefined;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerPluginContainers(manifest(), mod);
    expect(ContainerRegistry.getInstance().get('adt-block')).toBeUndefined();
    warn.mockRestore();
  });
});
