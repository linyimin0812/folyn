import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';

// Tauri APIs are aliased to vi.fn mocks via vitest.workspace.ts.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { usePetStore } from '@/store/petStore';
import { usePetHostBridge } from '@/hooks/usePetHostBridge';
import { dispatchNotification } from '@/services/petNotifyDispatcher';

// `@tauri-apps/api/window` is the real installed package (not aliased); mock
// it so focusMain's show/setFocus don't hit a non-Tauri runtime.
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ show: vi.fn(async () => undefined), setFocus: vi.fn(async () => undefined) }),
}));

// The dispatcher is exercised by its own sibling test; stub it so the hook
// test stays focused on listen-lifecycle (mount/unlisten).
vi.mock('@/services/petNotifyDispatcher', () => ({
  dispatchNotification: vi.fn(async () => undefined),
}));

const invokeMock = invoke as unknown as import('vitest').Mock;
const listenMock = listen as unknown as import('vitest').Mock;

/** Component that calls the hook once so we can mount/unmount it. */
function Harness() {
  usePetHostBridge();
  return null;
}

/** Each `listen` call returns its own unlisten spy so we can assert cleanup. */
function makeUnlistenSpies(n: number) {
  const spies = Array.from({ length: n }, () => vi.fn(async () => undefined));
  listenMock.mockImplementation(async () => spies.shift()!);
  return spies;
}

beforeEach(() => {
  invokeMock.mockClear();
  invokeMock.mockResolvedValue(undefined);
  listenMock.mockClear();
});

describe('usePetHostBridge — lifecycle', () => {
  it('registers the four pet:// listeners on mount', async () => {
    makeUnlistenSpies(4);
    render(<Harness />);
    // The effect awaits a couple of Tauri imports before calling listen; let
    // the microtasks flush.
    await vi.waitFor(() => {
      expect(listenMock).toHaveBeenCalledTimes(4);
    });
    const channels = listenMock.mock.calls.map((c: unknown[]) => c[0]);
    expect(channels).toContain('pet://menu-action');
    expect(channels).toContain('pet://visibility-changed');
    expect(channels).toContain('pet://bubble-action');
    expect(channels).toContain('pet://notify');
  });

  it('disconnects every listener on unmount', async () => {
    const spies = makeUnlistenSpies(4);
    const { unmount } = render(<Harness />);
    await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(4));
    unmount();
    // Flush the cleanup (the effect return calls unlisten synchronously).
    await Promise.resolve();
    for (const spy of spies) {
      expect(spy).toHaveBeenCalledTimes(1);
    }
  });

  it('launch-restore re-shows the pet window only when pet mode was enabled', async () => {
    usePetStore.setState({ petModeEnabled: true });
    makeUnlistenSpies(4);
    render(<Harness />);
    await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(4));
    expect(invokeMock).toHaveBeenCalledWith('show_pet_if_hidden');
    cleanup();
  });

  it('launch-restore skips show_pet_if_hidden when pet mode was off', async () => {
    usePetStore.setState({ petModeEnabled: false });
    makeUnlistenSpies(4);
    render(<Harness />);
    await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(4));
    expect(invokeMock).not.toHaveBeenCalledWith('show_pet_if_hidden');
    cleanup();
  });
});
