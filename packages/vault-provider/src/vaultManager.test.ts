import { describe, it, expect, beforeEach } from 'vitest';
import { VaultManager, VaultProviderRegistry, VaultError } from '../index';
import { TauriVaultProvider } from './providers/tauriProvider';
import type { VaultConfig } from './types';
import { writeTextFile, readTextFile, exists } from '@tauri-apps/plugin-fs';

const config: VaultConfig = {
  id: 'v1',
  name: 'Test Vault',
  providerType: 'tauri',
  basePath: '/mock/vault',
};

describe('VaultProviderRegistry', () => {
  it('is a singleton', () => {
    expect(VaultProviderRegistry.getInstance()).toBe(VaultProviderRegistry.getInstance());
  });

  it('registers and creates a tauri provider', () => {
    const registry = VaultProviderRegistry.getInstance();
    const provider = registry.create(config);
    expect(provider).toBeInstanceOf(TauriVaultProvider);
  });

  it('throws for an unknown provider type', () => {
    const registry = VaultProviderRegistry.getInstance();
    expect(() => registry.create({ ...config, providerType: 'nope' as never })).toThrow(/No provider registered/);
  });

  it('getAll returns descriptors including built-in tauri', () => {
    const registry = VaultProviderRegistry.getInstance();
    const all = registry.getAll();
    expect(all.find((d) => d.type === 'tauri')).toBeDefined();
  });
});

describe('VaultError', () => {
  it('carries a code and message', () => {
    const err = new VaultError('NOT_FOUND', 'missing');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('missing');
    expect(err.name).toBe('VaultError');
  });
});

describe('TauriVaultProvider', () => {
  let provider: TauriVaultProvider;

  beforeEach(() => {
    provider = new TauriVaultProvider();
  });

  it('exposes capabilities', () => {
    expect(provider.capabilities.writable).toBe(true);
    expect(provider.capabilities.offline).toBe(true);
    expect(provider.capabilities.watch).toBe(false);
  });

  it('ping returns true (tauri provider is always reachable once constructed)', async () => {
    expect(await provider.ping()).toBe(true);
    await provider.connect(config);
    expect(await provider.ping()).toBe(true);
  });

  it('connect creates the base directory if missing', async () => {
    await provider.connect(config);
    expect(await exists('/mock/vault')).toBe(true);
  });

  it('connect expands ~ in basePath', async () => {
    await provider.connect({ ...config, basePath: '~/vault' });
    expect(await exists('/mock/home/vault')).toBe(true);
  });

  it('writeFile and readFile round-trip', async () => {
    await provider.connect(config);
    await provider.writeFile('a.md', 'hello');
    expect(await provider.readFile('a.md')).toBe('hello');
    expect(await readTextFile('/mock/vault/a.md')).toBe('hello');
  });

  it('readFile throws VaultError NOT_FOUND when the file is missing', async () => {
    await provider.connect(config);
    await expect(provider.readFile('missing.md')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('deleteFile throws VaultError NOT_FOUND when the file is missing', async () => {
    await provider.connect(config);
    await expect(provider.deleteFile('missing.md')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('createDir and deleteDir', async () => {
    await provider.connect(config);
    await provider.createDir('sub/deep');
    expect(await exists('/mock/vault/sub/deep')).toBe(true);
    await provider.deleteDir('sub');
    expect(await exists('/mock/vault/sub')).toBe(false);
  });

  it('rename moves a file to the new path', async () => {
    await provider.connect(config);
    await provider.writeFile('old.md', 'content');
    await provider.rename('old.md', 'new.md');
    expect(await provider.readFile('new.md')).toBe('content');
    await expect(provider.readFile('old.md')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('listFiles returns entries with files and dirs, sorted dirs-first', async () => {
    await provider.connect(config);
    await provider.writeFile('a.md', 'x');
    await provider.writeFile('sub/b.md', 'y');
    const entries = await provider.listFiles('');
    const names = entries.map((e) => e.name);
    expect(names).toContain('a.md');
    expect(names).toContain('sub');
    const sub = entries.find((e) => e.name === 'sub')!;
    expect(sub.type).toBe('dir');
  });

  it('listFiles recursive returns nested children', async () => {
    await provider.connect(config);
    await provider.writeFile('sub/deep/c.md', 'z');
    const entries = await provider.listFiles('sub', true);
    const flattened = JSON.stringify(entries);
    expect(flattened).toContain('c.md');
    expect(flattened).toContain('deep');
  });

  it('listFiles hides dotfiles when showHidden is false', async () => {
    await provider.connect(config);
    await provider.writeFile('.secret.md', 'x');
    const visible = await provider.listFiles('');
    expect(visible.find((e) => e.name === '.secret.md')).toBeUndefined();
    const withHidden = await provider.listFiles('', false, true);
    expect(withHidden.find((e) => e.name === '.secret.md')).toBeDefined();
  });

  it('listFiles returns an empty array for a missing directory', async () => {
    await provider.connect(config);
    expect(await provider.listFiles('does-not-exist')).toEqual([]);
  });
});

describe('VaultManager', () => {
  it('throws NOT_FOUND when no provider is active', async () => {
    const mgr = new VaultManager();
    await expect(mgr.readFile('a')).rejects.toThrow(VaultError);
  });

  it('switchVault connects and proxies file operations', async () => {
    const mgr = new VaultManager();
    await mgr.switchVault(config);
    await mgr.writeFile('hello.md', 'world');
    expect(await mgr.readFile('hello.md')).toBe('world');
  });

  it('switchVault replaces the previous provider', async () => {
    const mgr = new VaultManager();
    await mgr.switchVault(config);
    await mgr.switchVault({ ...config, basePath: '/mock/other' });
    expect(mgr.getCurrentConfig()?.basePath).toBe('/mock/other');
  });

  it('getCurrentConfig returns null before a switch', () => {
    const mgr = new VaultManager();
    expect(mgr.getCurrentConfig()).toBeNull();
  });

  it('getCapabilities returns null before connect, then provider capabilities', async () => {
    const mgr = new VaultManager();
    expect(mgr.getCapabilities()).toBeNull();
    await mgr.switchVault(config);
    expect(mgr.getCapabilities()?.writable).toBe(true);
  });

  it('dispose clears the active provider', async () => {
    const mgr = new VaultManager();
    await mgr.switchVault(config);
    await mgr.dispose();
    expect(mgr.getCurrentConfig()).toBeNull();
    await expect(mgr.readFile('a')).rejects.toThrow(VaultError);
  });
});
