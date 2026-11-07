/**
 * Tests for the downloads capability: locating, listing and revealing the files
 * `network.download` saved. Rendering is `preview`'s job, not this one's.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExtensionManifest } from '@folyn/extension-host';
import { buildExtensionDownloads } from './downloadsCapability';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@/utils/platform', () => ({ isTauri: () => true }));

import { invoke as mockInvoke } from '@tauri-apps/api/core';

const manifest: ExtensionManifest = { id: 'demo-extension', name: 'Demo', version: '0.1.0', tier: 'trusted', main: 'index.js' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildExtensionDownloads', () => {
  it('lists the saved files', async () => {
    const saved = [{ name: 'a.zip', size: 3, modifiedMs: 1 }];
    vi.mocked(mockInvoke).mockResolvedValueOnce(saved);

    await expect(buildExtensionDownloads(manifest).list()).resolves.toEqual(saved);

    expect(mockInvoke).toHaveBeenCalledWith('extension_downloads_list', { extensionId: 'demo-extension' });
  });

  it('resolves the absolute path the preview needs', async () => {
    vi.mocked(mockInvoke).mockResolvedValueOnce('/Users/x/.folyn/extension-data/demo-extension/downloads/a.png');

    await expect(buildExtensionDownloads(manifest).path('a.png')).resolves.toBe(
      '/Users/x/.folyn/extension-data/demo-extension/downloads/a.png',
    );

    expect(mockInvoke).toHaveBeenCalledWith('extension_download_path', { extensionId: 'demo-extension', name: 'a.png' });
  });

  it('reveals by name under its own extension id', async () => {
    vi.mocked(mockInvoke).mockResolvedValueOnce(undefined);

    await buildExtensionDownloads(manifest).reveal('a.zip');

    expect(mockInvoke).toHaveBeenCalledWith('extension_reveal_download', { extensionId: 'demo-extension', name: 'a.zip' });
  });
});
