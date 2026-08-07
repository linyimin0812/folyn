import { describe, it, expect } from 'vitest';
import { PluginHost } from './PluginHost';
import type { PluginManifest } from 'quill-plugin-sdk';

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

describe('PluginHost / permissions.ai validation', () => {
  it('accepts manifest without permissions.ai', async () => {
    const host = new PluginHost();
    await expect(host.install(manifest())).resolves.toBe('demo-plugin');
  });

  it('accepts chat boolean + agents string[]', async () => {
    const host = new PluginHost();
    await expect(
      host.install(
        manifest({
          permissions: { ai: { chat: true, agents: ['study', 'wiki'] } },
        }),
      ),
    ).resolves.toBe('demo-plugin');
  });

  it('accepts partial — chat only', async () => {
    const host = new PluginHost();
    await expect(
      host.install(manifest({ permissions: { ai: { chat: false } } })),
    ).resolves.toBe('demo-plugin');
  });

  it('rejects non-boolean chat', async () => {
    const host = new PluginHost();
    await expect(
      host.install(
        manifest({
          permissions: { ai: { chat: 'yes' as unknown as boolean } },
        }),
      ),
    ).rejects.toThrow(/chat must be a boolean/);
  });

  it('rejects non-array agents', async () => {
    const host = new PluginHost();
    await expect(
      host.install(
        manifest({
          permissions: { ai: { agents: 'study' as unknown as string[] } },
        }),
      ),
    ).rejects.toThrow(/agents must be a string\[\]/);
  });

  it('rejects empty-string feature names', async () => {
    const host = new PluginHost();
    await expect(
      host.install(
        manifest({
          permissions: { ai: { agents: ['study', ''] } },
        }),
      ),
    ).rejects.toThrow(/agents must be a string\[\]/);
  });

  it('rejects non-string agent entries', async () => {
    const host = new PluginHost();
    await expect(
      host.install(
        manifest({
          permissions: { ai: { agents: ['study', 42] as unknown as string[] } },
        }),
      ),
    ).rejects.toThrow(/agents must be a string\[\]/);
  });
});
