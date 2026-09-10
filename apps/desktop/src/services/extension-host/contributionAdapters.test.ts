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
import type { ExtensionManifest } from '@folyn/extension-host';
import {
  registerTrustedExtensionCommands,
  registerExtensionFileTypes,
  registerExtensionContainers,
} from './contributionAdapters';
import type { ExtensionModule } from './contributionAdapters';
import { getCommands, getCommand, clearCommands } from '@/services/commandRegistry';
import { getHandlerByExtension, getAllHandlers } from '@/components/file-types/registry';
import { ContainerRegistry } from '@folyn/container-extensions';

// `registerExtensionContainers` resolves `.svg` file-path icons via the
// `readExtensionFile` Tauri wrapper (which dynamic-imports `@tauri-apps/api/core`
// and calls `invoke('read_extension_file', ...)`). Mock the invoke at the module
// boundary so the real wrapper runs but hits a fake backend.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));
import { invoke as mockInvoke } from '@tauri-apps/api/core';

function manifest(overrides: Partial<ExtensionManifest> = {}): ExtensionManifest {
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

function fakeModule(): ExtensionModule {
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

describe('registerTrustedExtensionCommands', () => {
  it('registers commands in-process (run calls the handler directly)', async () => {
    const handler = vi.fn(async () => {});
    const mod = fakeModule();
    mod.commands = { greet: handler };
    registerTrustedExtensionCommands(manifest(), mod);

    const cmd = getCommand('extension.adapter-test.greet');
    expect(cmd).toBeDefined();
    await cmd!.run();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('dispose removes the command', () => {
    const d = registerTrustedExtensionCommands(manifest(), fakeModule());
    expect(getCommand('extension.adapter-test.greet')).toBeDefined();
    d.dispose();
    expect(getCommand('extension.adapter-test.greet')).toBeUndefined();
  });

  it('skips commands with missing entry-ref', () => {
    const mod = fakeModule();
    mod.commands = {}; // no 'greet' handler
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerTrustedExtensionCommands(manifest(), mod);
    expect(getCommand('extension.adapter-test.greet')).toBeUndefined();
    warn.mockRestore();
  });

  it('returns no-op disposable when no commands declared', () => {
    const m = manifest({ contributes: undefined });
    expect(() => registerTrustedExtensionCommands(m, fakeModule()).dispose()).not.toThrow();
  });
});

describe('registerExtensionFileTypes', () => {
  it('registers the handler for the declared extension', () => {
    registerExtensionFileTypes(manifest(), fakeModule());
    const h = getHandlerByExtension('.adt');
    expect(h).toBeDefined();
    expect(h?.id).toBe('adt');
  });

  it('dispose removes the handler', () => {
    const d = registerExtensionFileTypes(manifest(), fakeModule());
    expect(getHandlerByExtension('.adt')).toBeDefined();
    d.dispose();
    expect(getHandlerByExtension('.adt')).toBeUndefined();
  });

  it('skips file-types with missing handler entry-ref', () => {
    const mod = fakeModule();
    mod.handlers = undefined;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerExtensionFileTypes(manifest(), mod);
    expect(getHandlerByExtension('.adt')).toBeUndefined();
    warn.mockRestore();
  });

  it('late-dispose does not remove a re-registered handler', () => {
    const d1 = registerExtensionFileTypes(manifest(), fakeModule());
    // Re-register (simulating re-activation)
    registerExtensionFileTypes(manifest(), fakeModule());
    // Dispose the first registration — should NOT remove the handler because
    // the registry's disposable contract only removes if it's still the same
    // instance.
    d1.dispose();
    expect(getHandlerByExtension('.adt')).toBeDefined();
  });
});

describe('registerExtensionContainers', () => {
  it('registers the container directive', async () => {
    await registerExtensionContainers(manifest(), fakeModule());
    const cr = ContainerRegistry.getInstance();
    expect(cr.get('adt-block')).toBeDefined();
    expect(cr.get('adt-block')?.label).toBe('ADT');
  });

  it('dispose unregisters the container', async () => {
    const d = await registerExtensionContainers(manifest(), fakeModule());
    const cr = ContainerRegistry.getInstance();
    expect(cr.get('adt-block')).toBeDefined();
    await d.dispose();
    expect(cr.get('adt-block')).toBeUndefined();
  });

  it('skips containers with missing component entry-ref', async () => {
    const mod = fakeModule();
    mod.containers = undefined;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await registerExtensionContainers(manifest(), mod);
    expect(ContainerRegistry.getInstance().get('adt-block')).toBeUndefined();
    warn.mockRestore();
  });

  it('resolves a `.svg` file-path icon via read_extension_file and stores the SVG string', async () => {
    const svgStr = '<svg width="16" height="16"><rect/></svg>';
    mockInvoke.mockReset();
    mockInvoke.mockImplementation((cmd: string, _args: unknown) => {
      if (cmd === 'read_extension_file') return Promise.resolve(svgStr);
      return Promise.reject(new Error(`unexpected invoke: ${cmd}`));
    });
    const m = manifest({
      contributes: {
        containers: [
          { name: 'svg-icon-block', icon: 'assets/icon.svg', label: 'Svg', category: 'custom', component: 'block', template: ':::svg-icon-block\n:::' },
        ],
      },
    });
    await registerExtensionContainers(m, fakeModule());
    const reg = ContainerRegistry.getInstance().get('svg-icon-block');
    expect(reg).toBeDefined();
    expect(reg?.icon).toBe(svgStr);
    expect(mockInvoke).toHaveBeenCalledWith('read_extension_file', {
      id: 'adapter-test',
      path: 'assets/icon.svg',
    });
  });

  it('falls back to empty icon when read_extension_file rejects (no throw, no literal path)', async () => {
    mockInvoke.mockReset();
    mockInvoke.mockRejectedValue(new Error('not found'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = manifest({
      contributes: {
        containers: [
          { name: 'missing-svg-block', icon: 'assets/missing.svg', label: 'Missing', category: 'custom', component: 'block', template: ':::missing-svg-block\n:::' },
        ],
      },
    });
    await expect(registerExtensionContainers(m, fakeModule())).resolves.toBeDefined();
    const reg = ContainerRegistry.getInstance().get('missing-svg-block');
    expect(reg).toBeDefined();
    expect(reg?.icon).toBe('');
    warn.mockRestore();
  });

  it('passes inline-SVG and emoji icons through unchanged (no read_extension_file call)', async () => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation((cmd: string) => Promise.reject(new Error(`unexpected: ${cmd}`)));
    const m = manifest({
      contributes: {
        containers: [
          { name: 'inline-svg-block', icon: '<svg/>', label: 'A', category: 'custom', component: 'block', template: ':::inline-svg-block\n:::' },
          { name: 'emoji-block', icon: '📦', label: 'B', category: 'custom', component: 'block', template: ':::emoji-block\n:::' },
        ],
      },
    });
    await registerExtensionContainers(m, fakeModule());
    expect(ContainerRegistry.getInstance().get('inline-svg-block')?.icon).toBe('<svg/>');
    expect(ContainerRegistry.getInstance().get('emoji-block')?.icon).toBe('📦');
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
