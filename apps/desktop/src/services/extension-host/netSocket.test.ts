/**
 * The socket over a fake host: the test plays the Rust side by pushing events
 * onto the channel `extension_net_connect` received.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExtensionManifest } from '@folyn/extension-host';

type Event = { kind: 'data'; data: string } | { kind: 'closed'; error: string | null };
const channels: Array<{ onmessage: (e: Event) => void }> = [];

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string) => (cmd === 'extension_net_connect' ? 7 : undefined)),
  Channel: class {
    onmessage: (e: Event) => void = () => {};
    constructor() { channels.push(this); }
  },
}));

import { invoke as mockInvoke } from '@tauri-apps/api/core';
import { connect, isNetHostAllowed } from './netSocket';

const manifest = (hosts?: string[]): ExtensionManifest => ({
  id: 'mail', name: 'Mail', version: '1.0.0', tier: 'trusted', main: 'index.js',
  permissions: hosts ? { net: { hosts } } : {},
});
const b64 = (s: string) => btoa(s);
const text = (b: Uint8Array | null) => (b === null ? null : new TextDecoder().decode(b));

beforeEach(() => {
  vi.clearAllMocks();
  channels.length = 0;
});

describe('isNetHostAllowed', () => {
  it('matches host:port case-insensitively, or *:port', () => {
    expect(isNetHostAllowed(manifest(['IMAP.gmail.com:993']), 'imap.GMAIL.com', 993)).toBe(true);
    expect(isNetHostAllowed(manifest(['imap.gmail.com:993']), 'imap.gmail.com', 143)).toBe(false);
    expect(isNetHostAllowed(manifest(['*:993']), 'any.example', 993)).toBe(true);
    expect(isNetHostAllowed(manifest(['*:993']), 'any.example', 465)).toBe(false);
    expect(isNetHostAllowed(manifest(), 'a.com', 993)).toBe(false);
  });
});

describe('connect', () => {
  it('refuses an undeclared host before reaching the host', async () => {
    await expect(connect(manifest(['a.com:993']), 'b.com', 993)).rejects.toThrow(/permissions\.net\.hosts/);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('opens under the extension id and delivers received bytes in order, across and before reads', async () => {
    const socket = await connect(manifest(['imap.x:993']), 'imap.x', 993);
    expect(mockInvoke).toHaveBeenCalledWith('extension_net_connect', expect.objectContaining({ extensionId: 'mail', host: 'imap.x', port: 993 }));
    const ch = channels[0]!;

    ch.onmessage({ kind: 'data', data: b64('* OK ready\r\n') });     // arrives before any read
    expect(text(await socket.read())).toBe('* OK ready\r\n');

    const pending = socket.read();                                    // read waits for data
    ch.onmessage({ kind: 'data', data: b64('a1 OK\r\n') });
    expect(text(await pending)).toBe('a1 OK\r\n');
  });

  it('writes text and bytes as base64 to its own connection id', async () => {
    const socket = await connect(manifest(['imap.x:993']), 'imap.x', 993);
    await socket.write('a1 NOOP\r\n');
    await socket.write(Uint8Array.from([0, 255]));
    expect(mockInvoke).toHaveBeenCalledWith('extension_net_write', { extensionId: 'mail', id: 7, data: b64('a1 NOOP\r\n') });
    expect(mockInvoke).toHaveBeenCalledWith('extension_net_write', { extensionId: 'mail', id: 7, data: 'AP8=' });
  });

  it('reads null once the peer closes, after the data that came first, and keeps the error', async () => {
    const socket = await connect(manifest(['imap.x:993']), 'imap.x', 993);
    const ch = channels[0]!;
    ch.onmessage({ kind: 'data', data: b64('bye') });
    ch.onmessage({ kind: 'closed', error: 'connection reset' });
    expect(text(await socket.read())).toBe('bye');
    expect(await socket.read()).toBeNull();
    expect(socket.error).toBe('connection reset');
    await expect(socket.write('x')).rejects.toThrow(/closed/);
  });

  it('close resolves a pending read with null and tells the host', async () => {
    const socket = await connect(manifest(['imap.x:993']), 'imap.x', 993);
    const pending = socket.read();
    await socket.close();
    expect(await pending).toBeNull();
    expect(mockInvoke).toHaveBeenCalledWith('extension_net_close', { extensionId: 'mail', id: 7 });
  });

  it('allows one read at a time', async () => {
    const socket = await connect(manifest(['imap.x:993']), 'imap.x', 993);
    void socket.read();
    await expect(socket.read()).rejects.toThrow(/already pending/);
  });
});
