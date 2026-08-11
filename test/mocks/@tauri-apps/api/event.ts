import { vi } from 'vitest';

/**
 * Shared Tauri event mock (aliased from `@tauri-apps/api/event` in
 * vitest.workspace.ts).
 *
 * Components use dynamic `import('@tauri-apps/api/event')` in effects.
 * A per-test `vi.mock` of this aliased module only reliably intercepts the
 * FIRST dynamic import, so tests should NOT vi.mock it — instead they drive
 * listeners through `__internals` below (all dynamic imports resolve to this
 * same module instance).
 */

type Listener = (payload?: unknown) => void;

const listeners = new Map<string, Set<Listener>>();

export const listen = vi.fn(async (channel: string, cb: Listener) => {
  let set = listeners.get(channel);
  if (!set) {
    set = new Set();
    listeners.set(channel, set);
  }
  set.add(cb);
  return () => {
    set.delete(cb);
  };
});

export const emit = vi.fn(async () => undefined);

export const unlisten = vi.fn(async () => undefined);

export const __internals = {
  reset() {
    listen.mockClear();
    emit.mockClear();
    unlisten.mockClear();
    listeners.clear();
    // NOTE: do NOT call listen.mockResolvedValue here — it would replace the
    // capturing implementation below and listeners would never be populated.
  },
  /** Registered callbacks for a channel (undefined when none). */
  getListeners(channel: string): ReadonlySet<Listener> | undefined {
    return listeners.get(channel);
  },
  /** Invoke the callbacks registered for a channel (test driver). */
  emitTo(channel: string, payload?: unknown) {
    const set = listeners.get(channel);
    if (set) for (const cb of set) cb(payload);
  },
};
