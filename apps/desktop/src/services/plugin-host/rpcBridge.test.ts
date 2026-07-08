import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RpcBridge, isPathInScope, isOriginAllowed, hasPermission } from './rpcBridge';
import type { PluginManifest } from '@quill/plugin-host';
import { __internals as fsInternals } from '@tauri-apps/plugin-fs';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { invoke } from '@tauri-apps/api/core';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function sandboxManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'demo-plugin',
    name: 'Demo',
    version: '1.0.0',
    tier: 'sandbox',
    main: 'index.js',
    html: 'index.html',
    permissions: {
      fs: { scope: ['data/**'] },
      http: { origins: ['https://api.example.com'] },
      clipboard: true,
      dialog: true,
      window: true,
      vault: { readActive: true, insertContent: true },
    },
    ...overrides,
  };
}

/** A fake target window that captures postMessage calls. */
function fakeTarget() {
  const sent: unknown[] = [];
  const target = {
    postMessage: vi.fn((msg: unknown, _origin: string) => {
      sent.push(msg);
    }),
  };
  return { target: target as unknown as Window, sent };
}

beforeEach(() => {
  fsInternals.reset();
});

// ── Pure helper tests ────────────────────────────────────────────────────────

describe('isPathInScope', () => {
  it('matches data/** for nested files', () => {
    expect(isPathInScope('data/foo.txt', ['data/**'])).toBe(true);
    expect(isPathInScope('data/sub/bar.json', ['data/**'])).toBe(true);
    expect(isPathInScope('data/sub/deep/x.txt', ['data/**'])).toBe(true);
  });

  it('matches data/ itself (base dir of data/**)', () => {
    // data/** should match "data" as the zero-segment case
    expect(isPathInScope('data', ['data/**'])).toBe(true);
  });

  it('rejects path outside scope', () => {
    expect(isPathInScope('config/settings.json', ['data/**'])).toBe(false);
    expect(isPathInScope('index.html', ['data/**'])).toBe(false);
  });

  it('rejects path traversal', () => {
    expect(isPathInScope('../escape', ['data/**'])).toBe(false);
    expect(isPathInScope('data/../escape', ['data/**'])).toBe(false);
  });

  it('skips vault: tokens in scope', () => {
    expect(isPathInScope('data/x.txt', ['vault:read-active', 'data/**'])).toBe(true);
    expect(isPathInScope('vault:read-active', ['vault:read-active', 'data/**'])).toBe(false);
  });

  it('matches single-segment glob (*)', () => {
    expect(isPathInScope('config/settings.json', ['config/*'])).toBe(true);
    expect(isPathInScope('config/sub/deep.json', ['config/*'])).toBe(false);
  });

  it('rejects empty path', () => {
    expect(isPathInScope('', ['data/**'])).toBe(false);
  });

  it('rejects when scope is empty', () => {
    expect(isPathInScope('data/foo.txt', [])).toBe(false);
  });
});

describe('isOriginAllowed', () => {
  it('matches exact origin', () => {
    expect(isOriginAllowed('https://api.example.com/data', ['https://api.example.com'])).toBe(true);
  });

  it('rejects different origin', () => {
    expect(isOriginAllowed('https://evil.com/data', ['https://api.example.com'])).toBe(false);
  });

  it('rejects when allowlist is empty', () => {
    expect(isOriginAllowed('https://api.example.com/data', [])).toBe(false);
  });

  it('rejects invalid URL', () => {
    expect(isOriginAllowed('not-a-url', ['https://api.example.com'])).toBe(false);
  });

  it('handles port-specific origins', () => {
    expect(isOriginAllowed('http://localhost:3000/api', ['http://localhost:3000'])).toBe(true);
    expect(isOriginAllowed('http://localhost:8080/api', ['http://localhost:3000'])).toBe(false);
  });
});

describe('hasPermission', () => {
  it('returns true for granted boolean permissions', () => {
    expect(hasPermission(sandboxManifest(), 'clipboard')).toBe(true);
    expect(hasPermission(sandboxManifest(), 'dialog')).toBe(true);
    expect(hasPermission(sandboxManifest(), 'window')).toBe(true);
  });

  it('returns false for ungranted permissions', () => {
    expect(hasPermission(sandboxManifest({ permissions: { clipboard: false } }), 'clipboard')).toBe(false);
  });

  it('returns true for granted vault sub-permissions', () => {
    expect(hasPermission(sandboxManifest(), 'vault:read-active')).toBe(true);
    expect(hasPermission(sandboxManifest(), 'vault:insert-content')).toBe(true);
  });

  it('returns false when no permissions object', () => {
    const m = sandboxManifest();
    delete m.permissions;
    expect(hasPermission(m, 'clipboard')).toBe(false);
  });

  it('returns false for unknown capability', () => {
    expect(hasPermission(sandboxManifest(), 'unknown:cap')).toBe(false);
  });
});

// ── RpcBridge message protocol round-trip ────────────────────────────────────

describe('RpcBridge / message protocol', () => {
  it('sends lifecycle messages to iframe', () => {
    const manifest = sandboxManifest();
    const { target, sent } = fakeTarget();
    const bridge = new RpcBridge({
      pluginId: manifest.id,
      manifest,
      targetWindow: () => target,
    });

    bridge.sendLifecycle('activate');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ type: 'lifecycle', event: 'activate' });

    bridge.sendLifecycle('deactivate');
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual({ type: 'lifecycle', event: 'deactivate' });

    bridge.dispose();
  });

  it('sends invoke and resolves on invoke-result', async () => {
    const manifest = sandboxManifest();
    const { target } = fakeTarget();
    const bridge = new RpcBridge({
      pluginId: manifest.id,
      manifest,
      targetWindow: () => target,
    });

    // Capture the invoke message
    const targetObj = target as unknown as { postMessage: (msg: unknown) => void };
    let invokeId = '';
    const origPost = targetObj.postMessage;
    targetObj.postMessage = vi.fn((msg: unknown) => {
      const m = msg as { type: string; id: string; command: string };
      if (m.type === 'invoke') invokeId = m.id;
    });

    const promise = bridge.invokeCommand('my-command', { x: 1 });

    // Simulate the iframe sending back an invoke-result
    await Promise.resolve();
    bridge.handleMessage(
      { type: 'invoke-result', id: invokeId, result: 'ok' },
      target,
    );

    await expect(promise).resolves.toBe('ok');
    bridge.dispose();
    targetObj.postMessage = origPost;
  });

  it('rejects invoke on timeout if iframe never responds', async () => {
    vi.useFakeTimers();
    const manifest = sandboxManifest();
    const { target } = fakeTarget();
    const bridge = new RpcBridge({
      pluginId: manifest.id,
      manifest,
      targetWindow: () => target,
    });

    const promise = bridge.invokeCommand('no-response');
    vi.advanceTimersByTime(31_000);
    await expect(promise).rejects.toThrow(/timed out/);
    bridge.dispose();
    vi.useRealTimers();
  });

  it('ignores messages from wrong source', () => {
    const manifest = sandboxManifest();
    const { target, sent } = fakeTarget();
    const bridge = new RpcBridge({
      pluginId: manifest.id,
      manifest,
      targetWindow: () => target,
    });

    // Message from a different window — should be ignored
    bridge.handleMessage(
      { type: 'request', id: '1', method: 'clipboard:read', params: {} },
      {} as Window,
    );
    expect(sent).toHaveLength(0);
    bridge.dispose();
  });

  it('dispose rejects pending invokes and stops listening', async () => {
    const manifest = sandboxManifest();
    const { target } = fakeTarget();
    const bridge = new RpcBridge({
      pluginId: manifest.id,
      manifest,
      targetWindow: () => target,
    });

    const promise = bridge.invokeCommand('pending');
    bridge.dispose();
    await expect(promise).rejects.toThrow(/bridge disposed/);
  });
});

// ── RpcBridge capability gating ──────────────────────────────────────────────

describe('RpcBridge / fs scope enforcement', () => {
  it('reads a file within scope', async () => {
    const manifest = sandboxManifest();
    const { target, sent } = fakeTarget();
    // Pre-seed the fs mock with a file at the resolved path
    await fsInternals.root.children.clear() || true;
    // The bridge resolves via homeDir mock → /mock/home/.quill/plugins/demo-plugin/data/test.txt
    // We can't easily seed without a real path, so use a custom resolver
    const bridge = new RpcBridge({
      pluginId: manifest.id,
      manifest,
      targetWindow: () => target,
      resolvePluginPath: async (p) => `/mock/plugins/${p}`,
    });

    // Seed the mock fs
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile('/mock/plugins/data/test.txt', 'hello');

    await bridge.handleMessage(
      { type: 'request', id: 'r1', method: 'fs:read', params: { path: 'data/test.txt' } },
      target,
    );
    await Promise.resolve();

    // Should have sent a response with result
    expect(sent).toHaveLength(1);
    const resp = sent[0] as { type: string; id: string; result?: string; error?: string };
    expect(resp.type).toBe('response');
    expect(resp.id).toBe('r1');
    expect(resp.result).toBe('hello');
    expect(resp.error).toBeUndefined();

    bridge.dispose();
  });

  it('rejects read outside scope', async () => {
    const manifest = sandboxManifest();
    const { target, sent } = fakeTarget();
    const bridge = new RpcBridge({
      pluginId: manifest.id,
      manifest,
      targetWindow: () => target,
      resolvePluginPath: async (p) => `/mock/plugins/${p}`,
    });

    await bridge.handleMessage(
      { type: 'request', id: 'r2', method: 'fs:read', params: { path: 'secrets/key.txt' } },
      target,
    );
    await Promise.resolve();

    expect(sent).toHaveLength(1);
    const resp = sent[0] as { type: string; id: string; error?: string };
    expect(resp.error).toMatch(/out of scope/);

    bridge.dispose();
  });

  it('rejects write outside scope', async () => {
    const manifest = sandboxManifest();
    const { target, sent } = fakeTarget();
    const bridge = new RpcBridge({
      pluginId: manifest.id,
      manifest,
      targetWindow: () => target,
      resolvePluginPath: async (p) => `/mock/plugins/${p}`,
    });

    await bridge.handleMessage(
      { type: 'request', id: 'r3', method: 'fs:write', params: { path: '../escape.txt', content: 'x' } },
      target,
    );
    await Promise.resolve();

    const resp = sent[0] as { error?: string };
    expect(resp.error).toMatch(/out of scope/);

    bridge.dispose();
  });
});

describe('RpcBridge / http origin enforcement', () => {
  it('routes allowed-origin fetch to the Rust plugin_http_fetch command', async () => {
    const manifest = sandboxManifest();
    const { target, sent } = fakeTarget();
    const bridge = new RpcBridge({
      pluginId: manifest.id,
      manifest,
      targetWindow: () => target,
    });

    // The Rust command returns the buffered {status, headers, body} shape.
    invoke.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'text/plain' },
      body: 'body-text',
    });

    await bridge.handleMessage(
      { type: 'request', id: 'h1', method: 'http:fetch', params: { url: 'https://api.example.com/data' } },
      target,
    );
    await Promise.resolve();

    // Must invoke the Rust command with the plugin id + url, NOT global fetch.
    expect(invoke).toHaveBeenCalledWith('plugin_http_fetch', expect.objectContaining({
      pluginId: 'demo-plugin',
      url: 'https://api.example.com/data',
    }));

    const resp = sent[0] as { result?: { status: number; body: string; headers: Record<string, string> } };
    expect(resp.result?.status).toBe(200);
    expect(resp.result?.body).toBe('body-text');
    expect(resp.result?.headers).toEqual({ 'content-type': 'text/plain' });

    bridge.dispose();
  });

  it('passes method/headers/body through to plugin_http_fetch', async () => {
    const manifest = sandboxManifest();
    const { target } = fakeTarget();
    const bridge = new RpcBridge({
      pluginId: manifest.id,
      manifest,
      targetWindow: () => target,
    });

    invoke.mockResolvedValueOnce({ status: 201, headers: {}, body: '' });

    await bridge.handleMessage(
      {
        type: 'request', id: 'h1b', method: 'http:fetch',
        params: {
          url: 'https://api.example.com/data',
          init: {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{"a":1}',
          },
        },
      },
      target,
    );
    await Promise.resolve();

    expect(invoke).toHaveBeenCalledWith('plugin_http_fetch', expect.objectContaining({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
    }));

    bridge.dispose();
  });

  it('normalizes a Headers object into a plain string map for IPC', async () => {
    const manifest = sandboxManifest();
    const { target } = fakeTarget();
    const bridge = new RpcBridge({
      pluginId: manifest.id,
      manifest,
      targetWindow: () => target,
    });

    invoke.mockResolvedValueOnce({ status: 200, headers: {}, body: '' });

    const headers = new Headers();
    headers.set('x-custom', 'yes');

    await bridge.handleMessage(
      {
        type: 'request', id: 'h1c', method: 'http:fetch',
        params: { url: 'https://api.example.com/data', init: { headers } },
      },
      target,
    );
    await Promise.resolve();

    expect(invoke).toHaveBeenCalledWith('plugin_http_fetch', expect.objectContaining({
      headers: { 'x-custom': 'yes' },
    }));

    bridge.dispose();
  });

  it('rejects fetch from unallowed origin WITHOUT calling invoke', async () => {
    const manifest = sandboxManifest();
    const { target, sent } = fakeTarget();
    const bridge = new RpcBridge({
      pluginId: manifest.id,
      manifest,
      targetWindow: () => target,
    });

    await bridge.handleMessage(
      { type: 'request', id: 'h2', method: 'http:fetch', params: { url: 'https://evil.com/data' } },
      target,
    );
    await Promise.resolve();

    // JS-side fast-fail: the Rust command must never be invoked.
    expect(invoke).not.toHaveBeenCalled();

    const resp = sent[0] as { error?: string };
    expect(resp.error).toMatch(/not allowed/);

    bridge.dispose();
  });
});

describe('RpcBridge / clipboard gating', () => {
  it('reads clipboard when permission granted', async () => {
    const manifest = sandboxManifest();
    const { target, sent } = fakeTarget();
    const bridge = new RpcBridge({
      pluginId: manifest.id,
      manifest,
      targetWindow: () => target,
    });

    readText.mockResolvedValue('clipboard-content');

    await bridge.handleMessage(
      { type: 'request', id: 'c1', method: 'clipboard:read', params: {} },
      target,
    );
    await Promise.resolve();

    const resp = sent[0] as { result?: string };
    expect(resp.result).toBe('clipboard-content');

    bridge.dispose();
  });

  it('rejects clipboard read without permission', async () => {
    const manifest = sandboxManifest({ permissions: { clipboard: false } });
    const { target, sent } = fakeTarget();
    const bridge = new RpcBridge({
      pluginId: manifest.id,
      manifest,
      targetWindow: () => target,
    });

    await bridge.handleMessage(
      { type: 'request', id: 'c2', method: 'clipboard:read', params: {} },
      target,
    );
    await Promise.resolve();

    const resp = sent[0] as { error?: string };
    expect(resp.error).toMatch(/clipboard permission/);

    bridge.dispose();
  });

  it('writes clipboard when permission granted', async () => {
    const manifest = sandboxManifest();
    const { target, sent } = fakeTarget();
    const bridge = new RpcBridge({
      pluginId: manifest.id,
      manifest,
      targetWindow: () => target,
    });

    await bridge.handleMessage(
      { type: 'request', id: 'c3', method: 'clipboard:write', params: { text: 'hello' } },
      target,
    );
    await Promise.resolve();

    expect(writeText).toHaveBeenCalledWith('hello');
    const resp = sent[0] as { result?: unknown };
    expect(resp.result).toBeUndefined();

    bridge.dispose();
  });
});
