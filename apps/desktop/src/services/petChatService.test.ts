import { describe, it, expect, beforeEach, vi } from 'vitest';

// Shared Tauri mocks (@tauri-apps/plugin-fs, @tauri-apps/api/path,
// @tauri-apps/api/core) are installed via resolve.alias in
// vitest.workspace.ts and reset between tests by test/setup.ts. We spy on
// the mocked `mkdir` directly by importing the module.

const { fakeAdapter, mkdir, appDataDir, join } = vi.hoisted(() => {
  const fakeAdapter = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    send: vi.fn(async (_prompt: string) => {}),
    onEvent: vi.fn(),
    offEvent: vi.fn(),
  };
  return {
    fakeAdapter,
    // Placeholders; the real mocked fns are imported below. These bindings
    // exist so vi.mock factories (hoisted) can reference the same adapter
    // instance without re-creating it.
    mkdir: vi.fn(),
    appDataDir: vi.fn(),
    join: vi.fn(),
  };
});

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ cliAdapter: 'claude', cliPath: '/mock/claude' }),
  },
}));

vi.mock('@quill/cli-adapter', () => ({
  CliAdapterRegistry: {
    getInstance: () => ({ create: () => fakeAdapter }),
  },
}));

import { mkdir as mockedMkdir } from '@tauri-apps/plugin-fs';
import { appDataDir as mockedAppDataDir, join as mockedJoin } from '@tauri-apps/api/path';
import { sendPetChatMessage, resetPetChatAdapter } from './petChatService';

beforeEach(() => {
  vi.clearAllMocks();
  // The shared mock module is reset by test/setup.ts; re-arm the path mock
  // defaults here so each test starts from a known state.
  mockedAppDataDir.mockResolvedValue('/mock/appdata');
  mockedJoin.mockImplementation(async (...parts: string[]) =>
    parts
      .filter((p) => p !== '' && p !== undefined && p !== null)
      .join('/')
      .replace(/\/+/g, '/'),
  );
  resetPetChatAdapter();
});

describe('petChatService — workingDir creation', () => {
  it('creates <appData>/pet-chat-tmp via mkdir({ recursive: true }) before adapter.start', async () => {
    await sendPetChatMessage('hello', {
      onToken: () => {},
      onDone: () => {},
      onError: () => {},
    });

    // mkdir must be called with the pet-chat-tmp path and recursive: true.
    expect(mockedMkdir).toHaveBeenCalledWith('/mock/appdata/pet-chat-tmp', {
      recursive: true,
    });

    // adapter.start must be called AFTER mkdir (mkdir call index < start
    // call index) with the pet-chat-tmp path as workingDir.
    const mkdirOrder = mockedMkdir.mock.invocationCallOrder[0];
    const startOrder = fakeAdapter.start.mock.invocationCallOrder[0];
    expect(mkdirOrder).toBeLessThan(startOrder);
    expect(fakeAdapter.start).toHaveBeenCalledWith({
      cliPath: '/mock/claude',
      workingDir: '/mock/appdata/pet-chat-tmp',
    });
  });

  it('passes bare: true on send (no vault grounding)', async () => {
    await sendPetChatMessage('hi', {
      onToken: () => {},
      onDone: () => {},
      onError: () => {},
    });

    expect(fakeAdapter.send).toHaveBeenCalledWith('hi', { bare: true });
  });

  it('falls back to appDataDir when mkdir rejects', async () => {
    mockedMkdir.mockRejectedValueOnce(new Error('fs denied'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await sendPetChatMessage('hello', {
      onToken: () => {},
      onDone: () => {},
      onError: () => {},
    });

    // start still called, with appDataDir as workingDir (fallback).
    expect(fakeAdapter.start).toHaveBeenCalledWith({
      cliPath: '/mock/claude',
      workingDir: '/mock/appdata',
    });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('falls back to empty workingDir when appDataDir rejects', async () => {
    mockedAppDataDir.mockRejectedValueOnce(new Error('no appdata'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await sendPetChatMessage('hello', {
      onToken: () => {},
      onDone: () => {},
      onError: () => {},
    });

    // start called with empty workingDir (adapter skips `cd`).
    expect(fakeAdapter.start).toHaveBeenCalledWith({
      cliPath: '/mock/claude',
      workingDir: '',
    });
    // mkdir must NOT have been called since appDataDir failed first.
    expect(mockedMkdir).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
