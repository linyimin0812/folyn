import { describe, it, expect, afterEach } from 'vitest';
import { extensionHost } from '@folyn/extension-host';
import type { ExtensionManifest } from '@folyn/extension-host';
import { isDeclaredByInstalledExtension } from './declaredByExtension';

const manifest = (id: string, extensions: string[]): ExtensionManifest => ({
  id,
  name: id,
  version: '1.0.0',
  tier: 'trusted',
  main: 'index.js',
  contributes: { fileTypes: [{ id: `${id}-type`, extensions, handler: 'h' }] },
});

afterEach(async () => {
  for (const r of extensionHost.list()) await extensionHost.uninstall(r.manifest.id);
});

describe('isDeclaredByInstalledExtension', () => {
  it('is true for an extension an installed (not yet active) extension declares', async () => {
    await extensionHost.install(manifest('erd-ext', ['erd', '.Schema']));

    expect(isDeclaredByInstalledExtension('erd')).toBe(true);
    // Declarations may carry a dot or capitals; the check does not care.
    expect(isDeclaredByInstalledExtension('schema')).toBe(true);
    expect(isDeclaredByInstalledExtension('ERD')).toBe(true);
  });

  it('is false for an extension nothing declares, and once the extension is uninstalled', async () => {
    await extensionHost.install(manifest('erd-ext', ['erd']));
    expect(isDeclaredByInstalledExtension('txt')).toBe(false);

    await extensionHost.uninstall('erd-ext');
    expect(isDeclaredByInstalledExtension('erd')).toBe(false);
  });
});
