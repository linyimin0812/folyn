import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';

// Tauri APIs are aliased to vi.fn mocks via vitest.workspace.ts.
import { invoke } from '@tauri-apps/api/core';
import { listen, emit } from '@tauri-apps/api/event';
import { writeTextFile, remove, mkdir, __internals as fsInternals } from '@tauri-apps/plugin-fs';
import { usePetStore } from '@/store/petStore';
import { usePetHostBridge } from '@/hooks/usePetHostBridge';
import { dispatchNotification } from '@/services/petNotifyDispatcher';
import { resolveSettingsLoadDone } from '@/store/settingsPersistence';

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
const emitMock = emit as unknown as import('vitest').Mock;
const removeMock = remove as unknown as import('vitest').Mock;
const mkdirMock = mkdir as unknown as import('vitest').Mock;

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
  emitMock.mockClear();
  fsInternals.reset();
  usePetStore.setState({
    petModeEnabled: true,
    petIconSource: 'builtin',
    petIconPath: '',
    petIcons: [],
  });
});

describe('usePetHostBridge — lifecycle', () => {
  it('registers the five pet:// listeners on mount', async () => {
    makeUnlistenSpies(5);
    render(<Harness />);
    // The effect awaits a couple of Tauri imports before calling listen; let
    // the microtasks flush.
    await vi.waitFor(() => {
      expect(listenMock).toHaveBeenCalledTimes(5);
    });
    const channels = listenMock.mock.calls.map((c: unknown[]) => c[0]);
    expect(channels).toContain('pet://menu-action');
    expect(channels).toContain('pet://visibility-changed');
    expect(channels).toContain('pet://bubble-action');
    expect(channels).toContain('pet://notify');
    expect(channels).toContain('pet://settings-request');
  });

  it('disconnects every listener on unmount', async () => {
    const spies = makeUnlistenSpies(5);
    const { unmount } = render(<Harness />);
    await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(5));
    unmount();
    // Flush the cleanup (the effect return calls unlisten synchronously).
    await Promise.resolve();
    for (const spy of spies) {
      expect(spy).toHaveBeenCalledTimes(1);
    }
  });

  it('launch-restore re-shows the pet window only when pet mode was enabled', async () => {
    usePetStore.setState({ petModeEnabled: true });
    makeUnlistenSpies(5);
    render(<Harness />);
    await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(5));
    expect(invokeMock).toHaveBeenCalledWith('show_pet_if_hidden');
    cleanup();
  });

  it('launch-restore skips show_pet_if_hidden when pet mode was off', async () => {
    usePetStore.setState({ petModeEnabled: false });
    makeUnlistenSpies(5);
    render(<Harness />);
    await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(5));
    expect(invokeMock).not.toHaveBeenCalledWith('show_pet_if_hidden');
    cleanup();
  });

  it('answers pet://settings-request with the hydrated settings blob', async () => {
    makeUnlistenSpies(5);
    render(<Harness />);
    await vi.waitFor(() => expect(listenMock).toHaveBeenCalledTimes(5));
    // Grab the settings-request handler from the registered listeners and
    // fire it as a secondary window (e.g. the pet window) would.
    const requestCall = listenMock.mock.calls.find((c: unknown[]) => c[0] === 'pet://settings-request');
    expect(requestCall).toBeDefined();
    const handler = requestCall![1] as () => void;
    handler();
    // The handler awaits settingsLoadDone (resolved by the describe block
    // below) then emits the merged blob back on pet://settings-updated.
    await vi.waitFor(() => {
      expect(emitMock).toHaveBeenCalledWith(
        'pet://settings-updated',
        expect.objectContaining({ petIconSource: expect.any(String), petSize: expect.any(String) }),
      );
    });
    cleanup();
  });
});

// ── Pet icon startup reconcile ─────────────────────────────
// Regression coverage for the restart data-loss bug: the startup effect used
// to SWEEP ~/.quill/pet-icon/ (deleting every `pet-icon*` file) whenever the
// store's library was empty — which happens on any launch where hydration
// hasn't run or the persisted library was lost, permanently destroying the
// user's uploaded icons (see 634123f / f33ad53). Startup must reconcile the
// in-memory library only and never delete files.
describe('usePetHostBridge — pet icon startup reconcile', () => {
  // settingsLoadDone is a module-level deferred promise; resolve it once so
  // every test in this file can run the reconcile body. Idempotent.
  resolveSettingsLoadDone();

  it('does NOT delete pet-icon files when the library is empty', async () => {
    // Seed an uploaded icon in the mock ~/.quill/pet-icon/ dir; the store is
    // at default builtin/empty state (un-hydrated or lost persistence).
    await writeTextFile('/mock/home/.quill/pet-icon/pet-icon-123.png', 'x');
    makeUnlistenSpies(5);
    render(<Harness />);
    // The reconcile effect's `mkdir` is its first action after hydration
    // resolves — waiting on it proves the effect ran, so the subsequent
    // file-exists assertions are meaningful rather than "effect never ran".
    await vi.waitFor(() => expect(mkdirMock).toHaveBeenCalled());
    const iconEntries = fsInternals.root.children.get('mock')?.children
      .get('home')?.children.get('.quill')?.children
      .get('pet-icon')?.children;
    expect(iconEntries?.has('pet-icon-123.png')).toBe(true);
    expect(removeMock).not.toHaveBeenCalled();
    cleanup();
  });

  it('drops a custom icon whose file is missing', async () => {
    usePetStore.setState({
      petIconSource: 'custom',
      petIconPath: '/mock/home/.quill/pet-icon/pet-icon-123.png',
      petIcons: ['/mock/home/.quill/pet-icon/pet-icon-123.png'],
    });
    makeUnlistenSpies(5);
    render(<Harness />);
    await vi.waitFor(() => {
      expect(usePetStore.getState().petIconSource).toBe('builtin');
    });
    expect(usePetStore.getState().petIcons).toEqual([]);
    expect(removeMock).not.toHaveBeenCalled();
    cleanup();
  });

  it('keeps a custom icon whose file exists', async () => {
    const iconPath = '/mock/home/.quill/pet-icon/pet-icon-123.png';
    await writeTextFile(iconPath, 'x');
    usePetStore.setState({
      petIconSource: 'custom',
      petIconPath: iconPath,
      petIcons: [iconPath],
    });
    makeUnlistenSpies(5);
    render(<Harness />);
    await vi.waitFor(() => expect(mkdirMock).toHaveBeenCalled());
    expect(usePetStore.getState().petIconSource).toBe('custom');
    expect(usePetStore.getState().petIconPath).toBe(iconPath);
    expect(usePetStore.getState().petIcons).toEqual([iconPath]);
    expect(removeMock).not.toHaveBeenCalled();
    cleanup();
  });
});
