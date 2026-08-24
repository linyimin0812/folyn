/**
 * Tests for the trusted-tier HTTP capability.
 *
 * Verifies:
 * - `fetch` invokes the Rust `plugin_http_fetch` command with the plugin id +
 *   url + serialized init.
 * - Origin not in `permissions.http.origins` → throws before invoking Rust.
 * - Header normalization handles `Headers`, arrays, and plain objects.
 *
 * ponytail: mocks `@tauri-apps/api/core` invoke + asserts the IPC payload
 * shape. The Rust command itself is integration-tested elsewhere.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PluginManifest } from '@folyn/plugin-host';
import { buildPluginHttp } from './httpCapability';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke as mockInvoke } from '@tauri-apps/api/core';

function makeManifest(origins: string[] | undefined): PluginManifest {
  return {
    id: 'plantuml-plugin',
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

describe('buildPluginHttp', () => {
  it('throws when permissions.http.origins is absent', async () => {
    const http = buildPluginHttp(makeManifest(undefined));
    await expect(http.fetch('https://www.plantuml.com/plantuml/svg/x')).rejects.toThrow(
      /lacks permissions\.http\.origins/,
    );
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('throws when the url origin is not in the allowlist', async () => {
    const http = buildPluginHttp(makeManifest(['https://www.plantuml.com']));
    await expect(http.fetch('https://evil.example.com/x')).rejects.toThrow(
      /lacks permissions\.http\.origins.*evil\.example\.com/,
    );
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('invokes plugin_http_fetch with pluginId + url when origin is allowed', async () => {
    (mockInvoke as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'image/svg+xml' },
      body: '<svg/>',
    });
    const http = buildPluginHttp(makeManifest(['https://www.plantuml.com']));
    const res = await http.fetch('https://www.plantuml.com/plantuml/svg/abc');

    expect(res).toEqual({ status: 200, headers: { 'content-type': 'image/svg+xml' }, body: '<svg/>' });
    expect(mockInvoke).toHaveBeenCalledWith('plugin_http_fetch', {
      pluginId: 'plantuml-plugin',
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
    const http = buildPluginHttp(makeManifest(['https://api.example.com']));

    await http.fetch('https://api.example.com/v1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
    });

    expect(mockInvoke).toHaveBeenCalledWith('plugin_http_fetch', {
      pluginId: 'plantuml-plugin',
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
    const http = buildPluginHttp(makeManifest(['https://api.example.com']));

    const headers = new Headers();
    headers.set('x-trace', 'abc');
    await http.fetch('https://api.example.com/v1', { headers });

    expect(mockInvoke).toHaveBeenCalledWith('plugin_http_fetch', expect.objectContaining({
      headers: { 'x-trace': 'abc' },
    }));
  });
});
