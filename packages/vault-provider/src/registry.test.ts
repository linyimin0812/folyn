import { describe, it, expect, beforeEach } from 'vitest';
import {
  VaultProviderRegistry,
  VaultError,
  TauriVaultProvider,
} from '../index';
import type { VaultProviderDescriptor } from '../src/registry';
import type { VaultConfig, ProviderType } from '../src/types';
import type { VaultProvider as IVaultProvider } from '../src/providerInterface';

const baseConfig: VaultConfig = {
  id: 'v1',
  name: 'Test Vault',
  providerType: 'custom',
  basePath: '/mock/vault',
};

/** Minimal in-memory fake provider so registry tests don't touch the network or fs. */
function makeFakeProvider(config: VaultConfig): IVaultProvider {
  return {
    id: config.id,
    type: 'custom' as ProviderType,
    displayName: `Fake ${config.id}`,
    capabilities: {
      writable: false,
      watch: false,
      search: false,
      history: false,
      sharing: false,
      streaming: false,
      offline: true,
    },
    connect: async () => {},
    disconnect: async () => {},
    ping: async () => true,
    readFile: async () => '',
    writeFile: async () => {},
    deleteFile: async () => {},
    listFiles: async () => [],
    createDir: async () => {},
    deleteDir: async () => {},
  };
}

function makeDescriptor(
  type: ProviderType,
  factory: (config: VaultConfig) => IVaultProvider = makeFakeProvider,
): VaultProviderDescriptor {
  return {
    type,
    displayName: `Fake ${type}`,
    icon: '🔖',
    description: `Fake ${type} provider`,
    factory,
  };
}

describe('VaultProviderRegistry singleton', () => {
  it('returns the same instance across calls', () => {
    expect(VaultProviderRegistry.getInstance()).toBe(VaultProviderRegistry.getInstance());
  });
});

describe('VaultProviderRegistry built-in tauri descriptor', () => {
  it('registers a "tauri" descriptor with the expected metadata', () => {
    const registry = VaultProviderRegistry.getInstance();
    const desc = registry.get('tauri');
    expect(desc).toBeDefined();
    expect(desc?.type).toBe('tauri');
    expect(desc?.displayName).toBe('本地文件');
    expect(desc?.icon).toBe('📂');
  });

  it('create returns a TauriVaultProvider for a tauri config', () => {
    const registry = VaultProviderRegistry.getInstance();
    const provider = registry.create({ ...baseConfig, providerType: 'tauri' });
    expect(provider).toBeInstanceOf(TauriVaultProvider);
  });
});

describe('VaultProviderRegistry unregistered types', () => {
  it('get returns undefined for github / s3 / webdav (not registered by default)', () => {
    const registry = VaultProviderRegistry.getInstance();
    expect(registry.get('github')).toBeUndefined();
    expect(registry.get('s3')).toBeUndefined();
    expect(registry.get('webdav')).toBeUndefined();
  });

  it('create throws "No provider registered" for an unregistered type', () => {
    const registry = VaultProviderRegistry.getInstance();
    expect(() => registry.create({ ...baseConfig, providerType: 's3' })).toThrow(
      /No provider registered/,
    );
  });
});

describe('VaultProviderRegistry.register custom flow', () => {
  let registry: VaultProviderRegistry;

  beforeEach(() => {
    registry = VaultProviderRegistry.getInstance();
    registry.register(makeDescriptor('custom'));
  });

  it('get returns the registered descriptor', () => {
    expect(registry.get('custom')?.type).toBe('custom');
  });

  it('create returns the provider instance produced by the factory', () => {
    const provider = registry.create(baseConfig);
    expect(provider.id).toBe(baseConfig.id);
    expect(provider.type).toBe('custom');
    expect(provider.capabilities.offline).toBe(true);
  });

  it('getAll includes the custom descriptor alongside the built-in tauri', () => {
    const types = registry.getAll().map((d) => d.type);
    expect(types).toContain('tauri');
    expect(types).toContain('custom');
  });

  it('register overwrites a descriptor for the same type (last wins)', () => {
    const replacement = makeDescriptor('custom');
    replacement.displayName = 'Replaced';
    registry.register(replacement);
    expect(registry.get('custom')?.displayName).toBe('Replaced');
  });
});

describe('VaultProviderRegistry.unregister', () => {
  it('removes a custom descriptor and returns true', () => {
    const registry = VaultProviderRegistry.getInstance();
    registry.register(makeDescriptor('unreg-target'));
    expect(registry.unregister('unreg-target')).toBe(true);
    expect(registry.get('unreg-target')).toBeUndefined();
  });

  it('returns false for a type that was never registered', () => {
    const registry = VaultProviderRegistry.getInstance();
    expect(registry.unregister('never-registered' as ProviderType)).toBe(false);
  });
});

describe('VaultError', () => {
  it('is throwable and carries a code + message', () => {
    const err = new VaultError('CONFLICT', 'already exists');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('CONFLICT');
    expect(err.message).toBe('already exists');
    expect(err.name).toBe('VaultError');
  });
});
