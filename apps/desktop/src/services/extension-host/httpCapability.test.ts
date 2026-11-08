/**
 * Tests for the trusted-tier HTTP capability.
 *
 * Verifies:
 * - `fetch` invokes the Rust `extension_http_fetch` command with the extension id +
 *   url + serialized init.
 * - Origin not in `permissions.http.origins` → throws before invoking Rust.
 * - Header normalization handles `Headers`, arrays, and plain objects.
 *
 * ponytail: mocks `@tauri-apps/api/core` invoke + asserts the IPC payload
 * shape. The Rust command itself is integration-tested elsewhere.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExtensionManifest } from '@folyn/extension-host';
import { buildExtensionHttp } from './httpCapability';

// `Channel` is a real class on the Tauri side; the mock keeps `onmessage` so a
// test can push progress the way Rust would.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage: (message: unknown) => void = () => {};
  },
}));

import { invoke as mockInvoke } from '@tauri-apps/api/core';

function makeManifest(origins: string[] | undefined): ExtensionManifest {
  return {
    id: 'plantuml-extension',
    name: 'PlantUML Viewer',
    version: '0.1.1',
    tier: 'trusted',
    main: 'index.js',
    permissions: origins ? { http: { origins } } : undefined,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildExtensionHttp', () => {
  it('throws when permissions.http.origins is absent', async () => {
    const http = buildExtensionHttp(makeManifest(undefined));
    await expect(http.fetch('https://www.plantuml.com/plantuml/svg/x')).rejects.toThrow(
      /lacks permissions\.http\.origins/,
    );
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('throws when the url origin is not in the allowlist', async () => {
    const http = buildExtensionHttp(makeManifest(['https://www.plantuml.com']));
    await expect(http.fetch('https://evil.example.com/x')).rejects.toThrow(
      /lacks permissions\.http\.origins.*evil\.example\.com/,
    );
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('invokes extension_http_fetch with extensionId + url when origin is allowed', async () => {
    (mockInvoke as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'image/svg+xml' },
      body: '<svg/>',
    });
    const http = buildExtensionHttp(makeManifest(['https://www.plantuml.com']));
    const res = await http.fetch('https://www.plantuml.com/plantuml/svg/abc');

    expect(res).toEqual({ status: 200, headers: { 'content-type': 'image/svg+xml' }, body: '<svg/>' });
    expect(mockInvoke).toHaveBeenCalledWith('extension_http_fetch', {
      extensionId: 'plantuml-extension',
      url: 'https://www.plantuml.com/plantuml/svg/abc',
      method: undefined,
      headers: undefined,
      body: undefined,
    });
  });

  it('forwards method, headers, and string body when provided', async () => {
    (mockInvoke as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
      headers: {},
      body: '',
    });
    const http = buildExtensionHttp(makeManifest(['https://api.example.com']));

    await http.fetch('https://api.example.com/v1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
    });

    expect(mockInvoke).toHaveBeenCalledWith('extension_http_fetch', {
      extensionId: 'plantuml-extension',
      url: 'https://api.example.com/v1',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
    });
  });

  it('normalizes a Headers instance into a plain string map', async () => {
    (mockInvoke as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
      headers: {},
      body: '',
    });
    const http = buildExtensionHttp(makeManifest(['https://api.example.com']));

    const headers = new Headers();
    headers.set('x-trace', 'abc');
    await http.fetch('https://api.example.com/v1', { headers });

    expect(mockInvoke).toHaveBeenCalledWith('extension_http_fetch', expect.objectContaining({
      headers: { 'x-trace': 'abc' },
    }));
  });
});

describe('buildExtensionHttp download', () => {
  const origin = 'https://api.example.com';

  it('invokes extension_http_download with the serialized init', async () => {
    const saved = { saved: true, status: 200, name: 'a.zip', path: '/d/a.zip', size: 3 };
    vi.mocked(mockInvoke).mockResolvedValueOnce(saved);

    const result = await buildExtensionHttp(makeManifest([origin])).download(`${origin}/file`, {
      method: 'POST',
      headers: { 'X-Token': 't' },
      body: '{}',
    });

    expect(result).toEqual(saved);
    expect(mockInvoke).toHaveBeenCalledWith('extension_http_download', {
      extensionId: 'plantuml-extension',
      url: `${origin}/file`,
      method: 'POST',
      headers: { 'X-Token': 't' },
      body: '{}',
      onProgress: expect.anything(),
    });
  });

  it('rejects an undeclared origin before invoking Rust', async () => {
    await expect(buildExtensionHttp(makeManifest([origin])).download('https://evil.com/file')).rejects.toThrow(
      /permissions\.http\.origins/,
    );
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('reports streamed progress through a channel', async () => {
    vi.mocked(mockInvoke).mockImplementationOnce(async (_cmd, args) => {
      const channel = (args as { onProgress: { onmessage: (p: unknown) => void } }).onProgress;
      channel.onmessage({ received: 5, total: 10 });
      channel.onmessage({ received: 10, total: 10 });
      return { saved: true, status: 200, name: 'a.zip', path: '/d/a.zip', size: 10 };
    });
    const seen: unknown[] = [];

    await buildExtensionHttp(makeManifest([origin])).download(`${origin}/file`, { onProgress: (p) => seen.push(p) });

    expect(seen).toEqual([{ received: 5, total: 10 }, { received: 10, total: 10 }]);
  });

  it('downloads without a progress listener', async () => {
    vi.mocked(mockInvoke).mockResolvedValueOnce({ saved: false, status: 500, headers: {}, body: 'boom' });

    const result = await buildExtensionHttp(makeManifest([origin])).download(`${origin}/file`);

    expect(result).toMatchObject({ saved: false, status: 500 });
  });
});

describe('buildExtensionHttp fetchBytes', () => {
  const origin = 'https://api.example.com';

  it('decodes the base64 body Rust returns into bytes', async () => {
    vi.mocked(mockInvoke).mockResolvedValueOnce({ status: 200, headers: { 'content-type': 'image/png' }, body: btoa('\x89PNG\x00\xff') });

    const result = await buildExtensionHttp(makeManifest([origin])).fetchBytes(`${origin}/file`, { method: 'POST', body: '{}' });

    expect(Array.from(result.body)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    expect(result).toMatchObject({ status: 200, headers: { 'content-type': 'image/png' } });
    expect(mockInvoke).toHaveBeenCalledWith('extension_http_fetch_bytes', {
      extensionId: 'plantuml-extension',
      url: `${origin}/file`,
      method: 'POST',
      headers: undefined,
      body: '{}',
    });
  });

  it('rejects an undeclared origin before invoking Rust', async () => {
    await expect(buildExtensionHttp(makeManifest([origin])).fetchBytes('https://evil.com/a.png')).rejects.toThrow(
      /permissions\.http\.origins/,
    );
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
