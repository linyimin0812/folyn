import { describe, it, expect, beforeEach } from 'vitest';
import { resolvePreviewPath, resolveAssetBase } from './previewPath';
import { homeDir } from '@tauri-apps/api/path';

describe('resolvePreviewPath', () => {
  beforeEach(() => {
    homeDir.mockResolvedValue('/mock/home');
  });

  it('returns an absolute external path unchanged', async () => {
    expect(await resolvePreviewPath('/Users/x/notes/a.md', '~/vault')).toBe(
      '/Users/x/notes/a.md',
    );
  });

  it('expands a ~/ external path against home', async () => {
    expect(await resolvePreviewPath('~/Documents/x.md', '~/vault')).toBe(
      '/mock/home/Documents/x.md',
    );
  });

  it('joins a vault-relative path under the resolved vault root', async () => {
    expect(await resolvePreviewPath('notes/a.md', '~/vault')).toBe(
      '/mock/home/vault/notes/a.md',
    );
  });

  it('joins a vault-relative path under a non-~ vault root', async () => {
    expect(await resolvePreviewPath('a.md', '/srv/vault')).toBe('/srv/vault/a.md');
  });
});

describe('resolveAssetBase', () => {
  beforeEach(() => {
    homeDir.mockResolvedValue('/mock/home');
  });

  it('uses the external file\'s own directory', async () => {
    expect(await resolveAssetBase('/Users/x/docs/a.md', '~/vault')).toBe('/Users/x/docs');
  });

  it('uses the external file\'s own directory for ~ paths', async () => {
    expect(await resolveAssetBase('~/docs/a.md', '~/vault')).toBe('/mock/home/docs');
  });

  it('resolves a vault-relative file\'s directory under the vault root', async () => {
    expect(await resolveAssetBase('sub/a.md', '~/vault')).toBe(
      '/mock/home/vault/sub',
    );
  });

  it('resolves to the vault root when the file has no directory', async () => {
    expect(await resolveAssetBase('a.md', '~/vault')).toBe('/mock/home/vault');
  });
});
