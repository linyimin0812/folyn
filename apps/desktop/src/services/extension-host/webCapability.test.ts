import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExtensionManifest } from 'folyn-extension-sdk';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { buildExtensionWeb } from './webCapability';

const manifest = (web?: { fetch?: boolean; render?: boolean }, tier: 'trusted' | 'sandbox' = 'trusted'): ExtensionManifest => ({
  id: 'reader', name: 'Reader', version: '1.0.0', tier, main: 'index.js', permissions: web ? { web } : {},
});

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({ status: 200, headers: {}, body: '<html/>', url: 'https://example.com/' });
});

describe('buildExtensionWeb', () => {
  it('fetches through the host under the extension id when granted', async () => {
    const web = buildExtensionWeb(manifest({ fetch: true }));
    await expect(web.fetch('https://example.com/')).resolves.toMatchObject({ status: 200 });
    expect(invoke).toHaveBeenCalledWith('extension_web_fetch', { extensionId: 'reader', url: 'https://example.com/', binary: false, requestId: null });
  });

  it('refuses without the fetch grant, or on the sandbox tier, before reaching the host', async () => {
    for (const m of [manifest(), manifest({ render: true }), manifest({ fetch: true }, 'sandbox')]) {
      await expect(buildExtensionWeb(m).fetch('https://example.com/')).rejects.toThrow(/permissions\.web\.fetch/);
    }
    expect(invoke).not.toHaveBeenCalled();
  });

  it('offers render only with the render grant', () => {
    expect(buildExtensionWeb(manifest({ fetch: true })).render).toBeUndefined();
    expect(buildExtensionWeb(manifest({ fetch: true, render: true })).render).toBeTypeOf('function');
  });

  it('cancels a pending render on disposal and rejects its late result', async () => {
    const web = buildExtensionWeb(manifest({ fetch: true, render: true }));
    let finish: (value: unknown) => void = () => {};
    invoke.mockImplementation((command: string) => (command === 'extension_web_render' ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve()));
    const pending = web.render!('https://example.com/blog');
    expect(invoke).toHaveBeenCalledWith('extension_web_render', expect.objectContaining({ extensionId: 'reader', url: 'https://example.com/blog', requestId: expect.any(String) }));
    web.dispose();
    expect(invoke).toHaveBeenCalledWith('extension_web_cancel_renders', expect.objectContaining({ extensionId: 'reader', requestIds: [expect.any(String)] }));
    finish({ status: 200, headers: {}, body: '<html>rendered</html>', url: 'https://example.com/blog' });
    await expect(pending).rejects.toThrow('inactive');
  });

  it('tracks a binary fetch for browser-fallback cancellation only with the render grant', async () => {
    const plain = buildExtensionWeb(manifest({ fetch: true }));
    await plain.fetch('https://example.com/a.png', { binary: true });
    expect(invoke).toHaveBeenLastCalledWith('extension_web_fetch', expect.objectContaining({ binary: true, requestId: null }));

    const withRender = buildExtensionWeb(manifest({ fetch: true, render: true }));
    let finish: (value: unknown) => void = () => {};
    invoke.mockImplementation((command: string) => (command === 'extension_web_fetch' ? new Promise((resolve) => { finish = resolve; }) : Promise.resolve()));
    const pending = withRender.fetch('https://example.com/a.png', { binary: true });
    expect(invoke).toHaveBeenLastCalledWith('extension_web_fetch', expect.objectContaining({ binary: true, requestId: expect.any(String) }));
    withRender.dispose();
    expect(invoke).toHaveBeenCalledWith('extension_web_cancel_renders', expect.objectContaining({ requestIds: [expect.any(String)] }));
    finish({ status: 200, headers: {}, body: 'aW1n', url: 'https://example.com/a.png' });
    await expect(pending).rejects.toThrow('inactive');
  });

  it('refuses new work after disposal', async () => {
    const web = buildExtensionWeb(manifest({ fetch: true }));
    web.dispose();
    await expect(web.fetch('https://example.com/')).rejects.toThrow('inactive');
  });
});
