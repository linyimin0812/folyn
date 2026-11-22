/**
 * `api.network.connect`: a TLS socket to a host the extension declares in
 * `permissions.net.hosts`. Rust (`extension_net.rs`) owns the connection and
 * re-checks the declaration; received bytes arrive on an IPC channel and are
 * queued here until the extension reads them.
 */

import type { ExtensionManifest, ExtensionSocket } from '@folyn/extension-host';

type NetEvent = { kind: 'data'; data: string } | { kind: 'closed'; error: string | null };

/** True when `host:port` is declared (case-insensitive host), or `*:port`. */
export function isNetHostAllowed(manifest: ExtensionManifest, host: string, port: number): boolean {
  const wanted = `${host.toLowerCase()}:${port}`;
  return (manifest.permissions?.net?.hosts ?? []).some((h) => {
    const declared = h.toLowerCase();
    return declared === wanted || declared === `*:${port}`;
  });
}

const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export async function connect(manifest: ExtensionManifest, host: string, port: number): Promise<ExtensionSocket> {
  if (!isNetHostAllowed(manifest, host, port)) {
    throw new Error(
      `extension "${manifest.id}" lacks permissions.net.hosts for ${host}:${port} — add it to manifest.json`,
    );
  }
  const { invoke, Channel } = await import('@tauri-apps/api/core');

  const received: Uint8Array[] = [];
  let closed = false;
  let error: string | null = null;
  let waiting: ((chunk: Uint8Array | null) => void) | null = null;
  const settle = () => {
    if (!waiting) return;
    const resolve = waiting;
    if (received.length > 0) { waiting = null; resolve(received.shift()!); }
    else if (closed) { waiting = null; resolve(null); }
  };

  const events = new Channel<NetEvent>();
  events.onmessage = (event) => {
    if (event.kind === 'data') received.push(fromBase64(event.data));
    else { closed = true; error = event.error; }
    settle();
  };

  const id = await invoke<number>('extension_net_connect', {
    extensionId: manifest.id,
    host,
    port,
    onEvent: events,
  });

  return {
    read() {
      if (waiting) return Promise.reject(new Error('net: a read is already pending'));
      return new Promise((resolve) => {
        waiting = resolve;
        settle();
      });
    },
    async write(data) {
      if (closed) throw new Error(`net: connection to ${host}:${port} is closed`);
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
      await invoke('extension_net_write', { extensionId: manifest.id, id, data: toBase64(bytes) });
    },
    async close() {
      if (!closed) {
        closed = true;
        settle();
      }
      await invoke('extension_net_close', { extensionId: manifest.id, id });
    },
    get error() {
      return error;
    },
  };
}
