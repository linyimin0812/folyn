import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExtensionManifest } from '@folyn/extension-host';
import { buildExtensionSystem } from './systemCapability';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { invoke as mockInvoke } from '@tauri-apps/api/core';

function manifest(system?: { frontWindow?: boolean }): ExtensionManifest {
  return {
    id: 'demo-extension',
    name: 'Demo',
    version: '0.1.0',
    tier: 'trusted',
    main: 'index.js',
    permissions: system ? { system } : {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildExtensionSystem / frontWindow', () => {
  it('asks the host under the extension\'s own id when declared', async () => {
    vi.mocked(mockInvoke).mockResolvedValueOnce({ app: 'Folyn', title: 'notes.md' });

    await expect(buildExtensionSystem(manifest({ frontWindow: true })).frontWindow())
      .resolves.toEqual({ app: 'Folyn', title: 'notes.md' });
    expect(mockInvoke).toHaveBeenCalledWith('extension_front_window', { extensionId: 'demo-extension' });
  });

  it('passes the host\'s null through (nothing readable)', async () => {
    vi.mocked(mockInvoke).mockResolvedValueOnce(null);
    await expect(buildExtensionSystem(manifest({ frontWindow: true })).frontWindow()).resolves.toBeNull();
  });

  it('refuses without the declaration, before reaching the host', async () => {
    for (const m of [manifest(), manifest({}), manifest({ frontWindow: false })]) {
      await expect(buildExtensionSystem(m).frontWindow()).rejects.toThrow(/permissions\.system\.frontWindow/);
    }
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
