/**
 * Tests for the trusted-tier PluginLoader's TOFU gate + hot-unload behavior.
 *
 * The real `import()` and Tauri `invoke` calls are mocked so the loader can
 * be exercised without a running Tauri backend or a real plugin on disk.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PluginManifest, PluginContext } from '@quill/plugin-host';
import { PluginHost } from '@quill/plugin-host';
import {
  trustedLoader,
  setModuleResolver,
  fetchPluginRecord,
  readPluginFile,
  sha256Hex,
} from './trustedLoader';
import type { PluginModule } from './contributionAdapters';
import {
  clearPluginFeaturePanels,
} from './contributionAdapters';
import { getCommands, getCommand, clearCommands } from '@/services/commandRegistry';
import { getAllHandlers, getHandlerByExtension } from '@/components/file-types/registry';
import { HandlerRegistry } from '@/components/file-types/HandlerRegistry';
import { ContainerRegistry } from '@quill/container-plugins';

// ── Mocks ───────────────────────────────────────────────────────────────────

// We mock the Tauri invoke calls at the function level. The trusted loader
// dynamically imports `@tauri-apps/api/core`, which is aliased to a mock in
// the vitest workspace config. We override `fetchPluginRecord` /
// `readPluginFile` via module mocking.

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// The loader's Tauri wrappers are exported and used internally — but they
// dynamic-import `@tauri-apps/api/core`. To control them, we spy on the
// exported functions. Since they're real functions that call invoke(), we
// mock invoke() and let the real wrappers run. But fetchPluginRecord /
// readPluginFile / grantCapabilities are exported, so we can also just
// override the invoke mock's return per call.

import { invoke as mockInvoke } from '@tauri-apps/api/core';

// ── Polyfill: jsdom does not implement URL.createObjectURL/revokeObjectURL ──

if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = vi.fn((blob: Blob) => `blob:mock/${Math.random().toString(36).slice(2)}`);
}
if (typeof URL.revokeObjectURL !== 'function') {
  URL.revokeObjectURL = vi.fn((_url: string) => {});
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const PLUGIN_CODE = `
export const handlers = { 'default': { id: 'x', extensions: ['.x'], supportedViewModes: ['edit'], needsFileContent: true, useCodeMirror: true } };
export const containers = { 'my-block': (props) => null };
export const commands = { 'greet': () => {} };
export const features = { 'my-panel': () => null };
export function activate() {}
export function deactivate() {}
`;

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'demo-trusted',
    name: 'Demo Trusted',
    version: '1.0.0',
    tier: 'trusted',
    main: 'index.js',
    contributes: {
      commands: [{ id: 'greet', title: 'Greet', run: 'greet' }],
      fileTypes: [{ id: 'x', extensions: ['.x'], handler: 'default' }],
      containers: [
        { name: 'my-block', icon: '📦', label: 'My Block', category: 'custom', component: 'my-block', template: ':::my-block\n:::' },
      ],
      features: [{ id: 'my-panel', panel: 'right', component: 'my-panel' }],
    },
    ...overrides,
  };
}

/** A fake PluginModule the resolver returns. */
function fakeModule(overrides: Partial<PluginModule> = {}): PluginModule {
  return {
    handlers: {
      default: {
        id: 'x',
        extensions: ['.x'],
        supportedViewModes: ['edit'],
        needsFileContent: true,
        useCodeMirror: true,
      },
    },
    containers: { 'my-block': (() => null) as never },
    commands: { greet: vi.fn(async () => {}) },
    features: { 'my-panel': (() => null) as never },
    activate: vi.fn(),
    deactivate: vi.fn(),
    ...overrides,
  };
}

function makeContext(host: PluginHost, id: string): PluginContext {
  const record = host.get(id)!;
  return {
    pluginId: id,
    manifest: record.manifest,
    addDisposable: (d) => { record.disposables.push(d); },
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

let originalRegistry: HandlerRegistry | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  clearCommands();
  clearPluginFeaturePanels();
  // Clear container registry for isolation.
  const cr = ContainerRegistry.getInstance();
  for (const p of cr.getAll()) cr.unregister(p.name);
  resetFileRegistry();
});

afterEach(() => {
  setModuleResolver((url) => import(/* @vite-ignore */ url) as Promise<Record<string, unknown>>);
  clearCommands();
  clearPluginFeaturePanels();
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

// Helper: configure the Tauri invoke mock for a trusted load.
function setupInvoke(opts: {
  trusted: boolean;
  integrity?: Record<string, string>;
  code?: string;
}) {
  const code = opts.code ?? PLUGIN_CODE;
  const integrity = opts.integrity ?? {};
  // Precompute the hash so tests don't need to be async to set up.
  return sha256Hex(code).then((hash) => {
    const fullIntegrity = { 'index.js': integrity['index.js'] ?? hash, ...integrity };
    (mockInvoke as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (cmd: string, args?: { id?: string; path?: string }) => {
        if (cmd === 'get_plugin_record') {
          return { id: args?.id, trusted: opts.trusted, integrity: fullIntegrity };
        }
        if (cmd === 'read_plugin_file') {
          return code;
        }
        if (cmd === 'grant_plugin_capabilities') {
          return undefined;
        }
        throw new Error(`unexpected invoke: ${cmd}`);
      },
    );
    return { hash, code };
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('trustedLoader / TOFU gate', () => {
  it('refuses to load when trusted is false', async () => {
    await setupInvoke({ trusted: false });
    setModuleResolver(async () => ({}) as Record<string, unknown>);

    await expect(trustedLoader.load(manifest())).rejects.toThrow(/not trusted/);
  });

  it('refuses to load when integrity hash mismatches', async () => {
    await setupInvoke({ trusted: true, integrity: { 'index.js': 'deadbeef'.repeat(8) } });
    setModuleResolver(async () => fakeModule() as unknown as Record<string, unknown>);

    await expect(trustedLoader.load(manifest())).rejects.toThrow(/integrity check failed/);
  });

  it('refuses to load when no stored integrity for main', async () => {
    await setupInvoke({ trusted: true, integrity: {} });
    // Override: no integrity entry for index.js
    (mockInvoke as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (cmd: string) => {
        if (cmd === 'get_plugin_record') {
          return { id: 'demo-trusted', trusted: true, integrity: {} };
        }
        if (cmd === 'read_plugin_file') return PLUGIN_CODE;
        if (cmd === 'grant_plugin_capabilities') return undefined;
        throw new Error(`unexpected: ${cmd}`);
      },
    );
    setModuleResolver(async () => fakeModule() as unknown as Record<string, unknown>);

    await expect(trustedLoader.load(manifest())).rejects.toThrow(/no stored integrity/);
  });

  it('loads when trusted and integrity match', async () => {
    await setupInvoke({ trusted: true });
    const mod = fakeModule();
    setModuleResolver(async () => mod as unknown as Record<string, unknown>);

    const plugin = await trustedLoader.load(manifest());
    expect(plugin).toBeDefined();
    expect(plugin.manifest.id).toBe('demo-trusted');
  });

  it('does not call import() when TOFU gate fails (trusted=false)', async () => {
    await setupInvoke({ trusted: false });
    const resolver = vi.fn(async () => ({}) as Record<string, unknown>);
    setModuleResolver(resolver);

    await expect(trustedLoader.load(manifest())).rejects.toThrow(/not trusted/);
    expect(resolver).not.toHaveBeenCalled();
  });

  it('does not call import() when integrity fails', async () => {
    await setupInvoke({ trusted: true, integrity: { 'index.js': '00'.repeat(32) } });
    const resolver = vi.fn(async () => ({}) as Record<string, unknown>);
    setModuleResolver(resolver);

    await expect(trustedLoader.load(manifest())).rejects.toThrow(/integrity/);
    expect(resolver).not.toHaveBeenCalled();
  });
});

describe('trustedLoader / contribution adapters', () => {
  it('registers commands, file-types, containers, and features on activate', async () => {
    await setupInvoke({ trusted: true });
    const mod = fakeModule();
    setModuleResolver(async () => mod as unknown as Record<string, unknown>);

    const host = new PluginHost();
    host.registerLoader(trustedLoader);
    await host.install(manifest());
    await host.activate('demo-trusted');

    // Command registered
    expect(getCommand('plugin.demo-trusted.greet')).toBeDefined();

    // File-type handler registered
    const handler = getHandlerByExtension('.x');
    expect(handler).toBeDefined();
    expect(handler?.id).toBe('x');

    // Container registered
    const cr = ContainerRegistry.getInstance();
    expect(cr.get('my-block')).toBeDefined();

    // Feature panel registered
    const { getPluginFeaturePanels } = await import('./contributionAdapters');
    expect(getPluginFeaturePanels()).toHaveLength(1);
    expect(getPluginFeaturePanels()[0].contribution.id).toBe('my-panel');
  });

  it('disposes all contributions on deactivate', async () => {
    await setupInvoke({ trusted: true });
    const mod = fakeModule();
    setModuleResolver(async () => mod as unknown as Record<string, unknown>);

    const host = new PluginHost();
    host.registerLoader(trustedLoader);
    await host.install(manifest());
    await host.activate('demo-trusted');
    await host.deactivate('demo-trusted');

    // Command removed
    expect(getCommand('plugin.demo-trusted.greet')).toBeUndefined();
    // File-type removed
    expect(getHandlerByExtension('.x')).toBeUndefined();
    // Container removed
    expect(ContainerRegistry.getInstance().get('my-block')).toBeUndefined();
    // Feature panel removed
    const { getPluginFeaturePanels } = await import('./contributionAdapters');
    expect(getPluginFeaturePanels()).toHaveLength(0);
  });

  it('calls plugin activate/deactivate hooks', async () => {
    await setupInvoke({ trusted: true });
    const mod = fakeModule();
    setModuleResolver(async () => mod as unknown as Record<string, unknown>);

    const host = new PluginHost();
    host.registerLoader(trustedLoader);
    await host.install(manifest());
    await host.activate('demo-trusted');
    expect(mod.activate).toHaveBeenCalledTimes(1);
    await host.deactivate('demo-trusted');
    expect(mod.deactivate).toHaveBeenCalledTimes(1);
  });

  it('skips contributions with missing entry-refs (best-effort)', async () => {
    await setupInvoke({ trusted: true });
    const mod = fakeModule({ handlers: undefined }); // no handlers exported
    setModuleResolver(async () => mod as unknown as Record<string, unknown>);

    const host = new PluginHost();
    host.registerLoader(trustedLoader);
    await host.install(manifest());
    await host.activate('demo-trusted');

    // File-type skipped (no handlers), but command/container/feature still work
    expect(getHandlerByExtension('.x')).toBeUndefined();
    expect(getCommand('plugin.demo-trusted.greet')).toBeDefined();
  });
});

describe('trustedLoader / hot-unload', () => {
  it('revokes the blob URL on deactivate', async () => {
    await setupInvoke({ trusted: true });
    const mod = fakeModule();
    setModuleResolver(async () => mod as unknown as Record<string, unknown>);

    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');

    const host = new PluginHost();
    host.registerLoader(trustedLoader);
    await host.install(manifest());
    await host.activate('demo-trusted');
    await host.deactivate('demo-trusted');

    expect(revokeSpy).toHaveBeenCalledTimes(1);
    revokeSpy.mockRestore();
  });

  it('uses a fresh module instance per activation (fresh blob URL)', async () => {
    await setupInvoke({ trusted: true });
    const createSpy = vi.spyOn(URL, 'createObjectURL');
    const mod = fakeModule();
    setModuleResolver(async () => mod as unknown as Record<string, unknown>);

    const host = new PluginHost();
    host.registerLoader(trustedLoader);
    await host.install(manifest());

    await host.activate('demo-trusted');
    await host.deactivate('demo-trusted');
    await host.activate('demo-trusted');

    // Two blob URLs created across two activations.
    expect(createSpy).toHaveBeenCalledTimes(2);
    createSpy.mockRestore();
  });
});

describe('trustedLoader / sha256Hex', () => {
  it('matches the Rust compute_hash for the same input', async () => {
    const js = await sha256Hex('hello');
    expect(js).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('produces 64-char lowercase hex', async () => {
    const h = await sha256Hex('plugin code');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});
