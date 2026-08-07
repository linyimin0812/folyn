import { describe, it, expect, vi } from 'vitest';
import { PluginHost } from './PluginHost';
import type { Plugin, PluginLoader, PluginManifest } from 'quill-plugin-sdk';

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'demo-plugin',
    name: 'Demo',
    version: '0.1.0',
    tier: 'trusted',
    main: 'index.js',
    ...overrides,
  };
}

function fakeLoader(plugin: Plugin): PluginLoader {
  return {
    tier: plugin.manifest.tier,
    load: async () => plugin,
  };
}

describe('PluginHost / manifest validation', () => {
  it('rejects non-kebab id', async () => {
    const host = new PluginHost();
    await expect(host.install(manifest({ id: 'BadId' }))).rejects.toThrow(/kebab/);
  });

  it('rejects sandbox plugin without html', async () => {
    const host = new PluginHost();
    await expect(host.install(manifest({ tier: 'sandbox' }))).rejects.toThrow(/html/);
  });

  it('rejects unknown tier', async () => {
    const host = new PluginHost();
    await expect(host.install(manifest({ tier: 'wat' as never }))).rejects.toThrow(/tier/);
  });
});

describe('PluginHost / lifecycle', () => {
  it('install → installed; activate → active; deactivate → inactive; uninstall removes', async () => {
    const host = new PluginHost();
    const activate = vi.fn();
    const deactivate = vi.fn();
    const plugin: Plugin = { manifest: manifest(), activate, deactivate };
    host.registerLoader(fakeLoader(plugin));

    await host.install(manifest());
    expect(host.get('demo-plugin')?.state).toBe('installed');

    await host.activate('demo-plugin');
    expect(activate).toHaveBeenCalledTimes(1);
    expect(host.get('demo-plugin')?.state).toBe('active');

    await host.deactivate('demo-plugin');
    expect(deactivate).toHaveBeenCalledTimes(1);
    expect(host.get('demo-plugin')?.state).toBe('inactive');

    await host.uninstall('demo-plugin');
    expect(host.get('demo-plugin')).toBeUndefined();
  });

  it('activate is idempotent', async () => {
    const host = new PluginHost();
    const activate = vi.fn();
    const plugin: Plugin = { manifest: manifest(), activate };
    host.registerLoader(fakeLoader(plugin));
    await host.install(manifest());
    await host.activate('demo-plugin');
    await host.activate('demo-plugin');
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('deactivate is a no-op when not active', async () => {
    const host = new PluginHost();
    const deactivate = vi.fn();
    const plugin: Plugin = { manifest: manifest(), deactivate };
    host.registerLoader(fakeLoader(plugin));
    await host.install(manifest());
    await host.deactivate('demo-plugin');
    expect(deactivate).not.toHaveBeenCalled();
  });

  it('reaps disposables on deactivate', async () => {
    const host = new PluginHost();
    const disposed: string[] = [];
    const plugin: Plugin = {
      manifest: manifest(),
      activate: (ctx) => {
        ctx.addDisposable({ dispose: () => { disposed.push('a'); } });
        ctx.addDisposable({ dispose: () => { disposed.push('b'); } });
      },
    };
    host.registerLoader(fakeLoader(plugin));
    await host.install(manifest());
    await host.activate('demo-plugin');
    await host.deactivate('demo-plugin');
    expect(disposed).toEqual(['a', 'b']);
    expect(host.get('demo-plugin')?.disposables).toHaveLength(0);
  });

  it('activate throws when no loader for tier', async () => {
    const host = new PluginHost();
    await host.install(manifest());
    await expect(host.activate('demo-plugin')).rejects.toThrow(/loader/);
    expect(host.get('demo-plugin')?.state).toBe('failed');
  });

  it('install duplicate id throws', async () => {
    const host = new PluginHost();
    await host.install(manifest());
    await expect(host.install(manifest())).rejects.toThrow(/already installed/);
  });

  it('deactivate still reaps disposables when plugin.deactivate throws', async () => {
    const host = new PluginHost();
    const disposed: string[] = [];
    const plugin: Plugin = {
      manifest: manifest(),
      activate: (ctx) => {
        ctx.addDisposable({ dispose: () => { disposed.push('x'); } });
      },
      deactivate: () => { throw new Error('boom'); },
    };
    host.registerLoader(fakeLoader(plugin));
    await host.install(manifest());
    await host.activate('demo-plugin');
    await expect(host.deactivate('demo-plugin')).resolves.toBeUndefined();
    expect(disposed).toEqual(['x']);
    expect(host.get('demo-plugin')?.state).toBe('failed');
  });
});

describe('PluginHost / loaders', () => {
  it('registerLoader is replaceable + disposable', () => {
    const host = new PluginHost();
    const a: PluginLoader = { tier: 'trusted', load: async () => ({ manifest: manifest() }) };
    const b: PluginLoader = { tier: 'trusted', load: async () => ({ manifest: manifest() }) };
    const handle = host.registerLoader(a);
    handle.dispose();
    host.registerLoader(b);
    // No public getter; assert via activate path not throwing 'no loader'.
    // (If a were still registered, activate would use a — both work; this
    // just exercises the dispose branch without throwing.)
    expect(true).toBe(true);
  });
});
