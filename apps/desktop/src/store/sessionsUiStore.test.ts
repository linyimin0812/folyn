/**
 * Persistence tests for the sessions UI store's `notePair` (the AI-note
 * provider/model choice). Follows the app's registerPersistSlice convention
 * (translationStore is the prior art for persisting a PairSelector choice):
 * the value lives in the `sessions` storage file (~/.folyn/storage/), written
 * by the per-setter persist closure and rehydrated by loadSettings() at
 * startup. The Tauri fs/path modules resolve to the global in-memory test
 * mocks (vitest.workspace.ts aliases), so the on-disk file is a mock-FS node
 * at /mock/home/.folyn/storage/sessions.json.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readTextFile, writeTextFile, __internals as fsInternals } from '@tauri-apps/plugin-fs';
import { storageClient } from '@/utils/storageClient';
import {
  loadSettings,
  markSettingsHydrated,
  __resetSettingsHydrationForTesting,
} from './settingsPersistence';
import { useSessionsUiStore, INITIAL_SESSIONS_UI } from './sessionsUiStore';
import type { PendingSave } from './sessionsUiStore';
import type { ExternalSessionDetail } from '@/services/externalSessions';

const STORAGE_FILE = '/mock/home/.folyn/storage/sessions.json';
const PAIR = { provider: 'openai', model: 'gpt-5.2' };

const FAKE_DETAIL = {
  summary: {},
  messages: [],
  branch: { currentId: 'main', all: [] },
} as unknown as ExternalSessionDetail;

async function readStored(): Promise<string | null> {
  try {
    return await readTextFile(STORAGE_FILE);
  } catch {
    return null;
  }
}

beforeEach(() => {
  fsInternals.reset();
  storageClient.__resetForTesting();
  __resetSettingsHydrationForTesting();
  useSessionsUiStore.setState(INITIAL_SESSIONS_UI);
});

describe('sessionsUiStore.notePair persistence', () => {
  it('setNotePair writes the sessions storage file; a fresh launch rehydrates it', async () => {
    // app lifecycle: hydration completes before user setters persist
    markSettingsHydrated();
    useSessionsUiStore.getState().setNotePair(PAIR);
    await storageClient.flushNow();

    const raw = await readStored();
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ notePair: PAIR });

    // fresh launch: empty store + cold storage cache → loadSettings re-reads
    // the file and hydrates the slice
    useSessionsUiStore.setState(INITIAL_SESSIONS_UI);
    storageClient.__resetForTesting();
    __resetSettingsHydrationForTesting();
    await loadSettings();
    expect(useSessionsUiStore.getState().notePair).toEqual(PAIR);
  });

  it('clearing the choice back to the default persists null', async () => {
    markSettingsHydrated();
    useSessionsUiStore.getState().setNotePair(PAIR);
    useSessionsUiStore.getState().setNotePair(null);
    await storageClient.flushNow();

    const raw = await readStored();
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ notePair: null });
  });

  it('a malformed persisted notePair is ignored — hydrates to null (default)', async () => {
    await writeTextFile(STORAGE_FILE, JSON.stringify({ notePair: { provider: 42, model: 'x' } }));
    await loadSettings();
    expect(useSessionsUiStore.getState().notePair).toBeNull();
  });

  it('generation resets, detail reloads and back-to-list never clear or rewrite the persisted choice', async () => {
    markSettingsHydrated();
    useSessionsUiStore.getState().setNotePair(PAIR);
    await storageClient.flushNow();
    const rawBefore = await readStored();

    // every RESET_GEN / RESET_SELECTION path, plus a fresh generation after
    const ctx = {} as PendingSave;
    useSessionsUiStore.getState().genStart(ctx, false);
    useSessionsUiStore.getState().genFail('error', 'boom');
    useSessionsUiStore.getState().setDetail(FAKE_DETAIL); // branch switch = re-read + setDetail
    useSessionsUiStore.getState().beginDetailLoad();
    useSessionsUiStore.getState().closeDetail();
    useSessionsUiStore.getState().genStart(ctx, false);

    // the choice survives in the store AND the persisted file is untouched
    expect(useSessionsUiStore.getState().notePair).toEqual(PAIR);
    expect(await readStored()).toBe(rawBefore);
  });
});
