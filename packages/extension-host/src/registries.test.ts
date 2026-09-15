import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Disposable, ExtensionApi, ExtensionManifest } from 'folyn-extension-sdk';
import {
  registerCapability,
  buildExtensionApi,
  clearCapabilityProviders,
  getCapabilityProviders,
} from './capabilityRegistry';
import {
  registerContributionAdapter,
  getContributionAdapters,
  clearContributionAdapters,
} from './contributionAdapterRegistry';

// ── fixtures ────────────────────────────────────────────────────────────────

function manifest(): ExtensionManifest {
  return { id: 'demo-extension', name: 'Demo', version: '0.1.0', tier: 'trusted', main: 'index.js' };
}

// ── capabilityRegistry ───────────────────────────────────────────────────────

describe('capabilityRegistry', () => {
  beforeEach(() => clearCapabilityProviders());

  it('assembles an ExtensionApi from registered providers', () => {
    const fakeVault = { readText: vi.fn() } as unknown as ExtensionApi['vault'];
    registerCapability({ slot: 'vault', build: () => fakeVault });
    const { api } = buildExtensionApi(manifest());
    expect(api.vault).toBe(fakeVault);
  });

  it('collects provider dispose hooks into one Disposable, in registration order', () => {
    const order: string[] = [];
    registerCapability({
      slot: 'vault',
      build: () => ({}) as ExtensionApi['vault'],
      dispose: () => { order.push('vault'); },
    });
    registerCapability({
      slot: 'storage',
      build: () => ({}) as ExtensionApi['storage'],
      dispose: () => { order.push('storage'); },
    });
    const { dispose } = buildExtensionApi(manifest());
    expect(dispose).toBeDefined();
    dispose!.dispose();
    expect(order).toEqual(['vault', 'storage']);
  });

  it('returns no dispose when no provider has one', () => {
    registerCapability({ slot: 'vault', build: () => ({}) as ExtensionApi['vault'] });
    const { dispose } = buildExtensionApi(manifest());
    expect(dispose).toBeUndefined();
  });

  it('a later provider for the same slot replaces the earlier (one provider per slot)', () => {
    const a = {} as ExtensionApi['vault'];
    const b = {} as ExtensionApi['vault'];
    registerCapability({ slot: 'vault', build: () => a });
    registerCapability({ slot: 'vault', build: () => b });
    expect(getCapabilityProviders()).toHaveLength(1);
    expect(buildExtensionApi(manifest()).api.vault).toBe(b);
  });
});

// ── contributionAdapterRegistry ──────────────────────────────────────────────

describe('contributionAdapterRegistry', () => {
  beforeEach(() => clearContributionAdapters());

  it('registers and returns adapters in order', () => {
    const a: Disposable = { dispose() {} };
    const b: Disposable = { dispose() {} };
    const adapterA = { moduleKey: 'commands', register: () => a } as const;
    const adapterB = { moduleKey: 'handlers', register: () => b } as const;
    registerContributionAdapter(adapterA);
    registerContributionAdapter(adapterB);
    expect(getContributionAdapters()).toEqual([adapterA, adapterB]);
  });

  it('supports async register returning a Promise<Disposable>', async () => {
    const disp: Disposable = { dispose() {} };
    registerContributionAdapter({ moduleKey: 'containers', register: async () => disp });
    const result = getContributionAdapters()[0].register(manifest(), {} as never);
    expect(result).toBeInstanceOf(Promise);
    expect(await result).toBe(disp);
  });

  it('supports declarative adapters with no moduleKey', () => {
    const disp: Disposable = { dispose() {} };
    registerContributionAdapter({ register: () => disp });
    expect(getContributionAdapters()[0].moduleKey).toBeUndefined();
  });
});
