import { describe, it, expect, beforeEach, vi } from 'vitest';

// Shared Tauri mocks (@tauri-apps/plugin-fs, @tauri-apps/api/path,
// @tauri-apps/api/core) are installed via resolve.alias in
// vitest.workspace.ts and reset between tests by test/setup.ts.

/** A fake adapter that records calls and lets the test emit stream events
 *  back through the registered handlers (mirrors ClaudeAdapter's emit). */
function makeFakeAdapter(id: string) {
  const handlers: ((event: { type: string; content?: string; sessionId?: string }) => void)[] = [];
  return {
    id,
    displayName: `Fake ${id}`,
    description: `Fake description ${id}`,
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    send: vi.fn(async (_prompt: string, _options?: unknown) => {}),
    isRunning: vi.fn(() => false),
    onEvent: vi.fn((h: (event: { type: string; content?: string; sessionId?: string }) => void) => {
      handlers.push(h);
    }),
    offEvent: vi.fn((h: (event: { type: string; content?: string; sessionId?: string }) => void) => {
      const idx = handlers.indexOf(h);
      if (idx >= 0) handlers.splice(idx, 1);
    }),
    __emit(event: { type: string; content?: string; sessionId?: string }) {
      for (const h of [...handlers]) h(event);
    },
    __handlerCount() {
      return handlers.length;
    },
  };
}

const { aiConfigState, vaultConfigState, createAdapter, resolvePairForPetSessionMock } = vi.hoisted(() => {
  const aiConfigState: {
    cliAdapter: string;
    cliPath: string;
    providerSettings: Record<string, { apiKey: string; baseUrl: string }>;
    customerProviders: Record<string, unknown>;
  } = {
    cliAdapter: 'claude',
    cliPath: '/mock/claude',
    providerSettings: {},
    customerProviders: {},
  };
  const vaultConfigState: { vaultPath: string } = {
    vaultPath: '',
  };
  return {
    aiConfigState,
    vaultConfigState,
    // Factory stub the test re-points before each send to control which
    // adapter instance a session gets.
    createAdapter: vi.fn(() => makeFakeAdapter('claude')),
    // Phase 2: petChatService now calls resolvePairForPetSession(sessionId)
    // from petChatStore. The petChatStore mock below delegates to this fn so
    // tests can override its return per-test.
    resolvePairForPetSessionMock: vi.fn<(sid: string) => unknown>(() => null),
  };
});

vi.mock('@/store/aiConfigStore', () => ({
  useAiConfigStore: { getState: () => aiConfigState },
}));

vi.mock('@/store/vaultConfigStore', () => ({
  useVaultConfigStore: { getState: () => vaultConfigState },
}));

vi.mock('@/store/petChatStore', () => {
  // A lightweight stand-in for the store: a sessions array + activeSessionId
  // + setCliSessionId spy + inputMode (rig vs ask/agent). The service reads
  // sessions/cliSessionId + inputMode and calls setCliSessionId. inputMode
  // defaults to undefined so existing ask/agent tests see `resolveSendOptions`
  // pass `base` through unchanged (no permissionMode added).
  // Phase 2: also exports resolvePairForPetSession (delegated to the hoisted
  // mock so tests can drive the rig-mode pair-resolution path).
  const store: {
    sessions: { id: string; cliSessionId?: string; provider?: string; model?: string }[];
    activeSessionId: string | null;
    setCliSessionId: ReturnType<typeof vi.fn>;
    inputMode: string | undefined;
  } = {
    sessions: [],
    activeSessionId: null,
    setCliSessionId: vi.fn(),
    inputMode: undefined,
  };
  return {
    usePetChatStore: { getState: () => store },
    resolvePairForPetSession: (sid: string) => resolvePairForPetSessionMock(sid),
  };
});

vi.mock('@quill/cli-adapter', () => ({
  createAdapter: (id: string) => createAdapter(id),
}));

// rig-mode (chat inputMode) forwards to runRigChat. Mock it so the rig path
// can be exercised without a real Tauri Channel (which the core mock doesn't
// export). vi.hoisted keeps the mock ref available to the hoisted vi.mock
// factory below.
const { runRigChatMock } = vi.hoisted(() => ({ runRigChatMock: vi.fn() }));
vi.mock('@/services/rigChat', () => ({ runRigChat: runRigChatMock }));

import { mkdir as mockedMkdir } from '@tauri-apps/plugin-fs';
import { appDataDir as mockedAppDataDir, join as mockedJoin } from '@tauri-apps/api/path';
import {
  sendPetChatMessage,
  stopPetChat,
  resetPetChatAdapter,
  __getAdapterForTesting,
} from './petChatService';

// Reaching the mocked store state to seed sessions per-test.
const petChatStoreState = (
  await import('@/store/petChatStore')
).usePetChatStore.getState() as {
  sessions: { id: string; cliSessionId?: string; provider?: string; model?: string }[];
  activeSessionId: string | null;
  setCliSessionId: ReturnType<typeof vi.fn>;
  inputMode: string | undefined;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedAppDataDir.mockResolvedValue('/mock/appdata');
  mockedJoin.mockImplementation(async (...parts: string[]) =>
    parts
      .filter((p) => p !== '' && p !== undefined && p !== null)
      .join('/')
      .replace(/\/+/g, '/'),
  );
  aiConfigState.cliAdapter = 'claude';
  aiConfigState.cliPath = '/mock/claude';
  aiConfigState.providerSettings = {};
  aiConfigState.customerProviders = {};
  createAdapter.mockImplementation(() => makeFakeAdapter('claude'));
  petChatStoreState.sessions = [];
  petChatStoreState.activeSessionId = null;
  petChatStoreState.inputMode = undefined;
  petChatStoreState.setCliSessionId.mockClear();
  // Default: rig-mode pair resolution returns null (no pair on the session).
  // Tests that need a configured pair override this with mockReturnValue.
  resolvePairForPetSessionMock.mockReset();
  resolvePairForPetSessionMock.mockReturnValue(null);
  // Default: rig path resolves but emits nothing. Tests that need events
  // override this with mockImplementation.
  runRigChatMock.mockReset();
  runRigChatMock.mockResolvedValue(undefined);
  // Clear the per-session adapter Map between tests.
  void resetPetChatAdapter();
});

/** Seed a session with an optional cliSessionId (for resume assertions). */
function seedSession(id: string, cliSessionId?: string): void {
  petChatStoreState.sessions = [{ id, cliSessionId }];
  petChatStoreState.activeSessionId = id;
}

// ── send: adapter.send options ──
describe('sendPetChatMessage — send options', () => {
  it('calls adapter.send with { bare: true, resumeSessionId } where resumeSessionId comes from the session cliSessionId', async () => {
    const fake = makeFakeAdapter('claude');
    createAdapter.mockReturnValue(fake);
    seedSession('s1', 'cli-prev');

    await sendPetChatMessage('s1', 'hi', {});

    expect(fake.send).toHaveBeenCalledWith('hi', { bare: true, resumeSessionId: 'cli-prev' });
  });

  it('passes resumeSessionId: undefined on a session with no cliSessionId yet (first send)', async () => {
    const fake = makeFakeAdapter('claude');
    createAdapter.mockReturnValue(fake);
    seedSession('s1'); // no cliSessionId

    await sendPetChatMessage('s1', 'hi', {});

    expect(fake.send).toHaveBeenCalledWith('hi', { bare: true, resumeSessionId: undefined });
  });

  it('creates <appData>/pet-chat-tmp via mkdir before adapter.start and passes it as workingDir', async () => {
    const fake = makeFakeAdapter('claude');
    createAdapter.mockReturnValue(fake);
    seedSession('s1');

    await sendPetChatMessage('s1', 'hello', {});

    expect(mockedMkdir).toHaveBeenCalledWith('/mock/appdata/pet-chat-tmp', { recursive: true });
    const mkdirOrder = mockedMkdir.mock.invocationCallOrder[0];
    const startOrder = fake.start.mock.invocationCallOrder[0];
    expect(mkdirOrder).toBeLessThan(startOrder);
    expect(fake.start).toHaveBeenCalledWith({
      cliPath: '/mock/claude',
      workingDir: '/mock/appdata/pet-chat-tmp',
    });
  });
});

// ── event mapping ──
describe('sendPetChatMessage — event mapping', () => {
  it('text event → onToken with content', async () => {
    const fake = makeFakeAdapter('claude');
    createAdapter.mockReturnValue(fake);
    seedSession('s1');
    const onToken = vi.fn();

    await sendPetChatMessage('s1', 'hi', { onToken });
    fake.__emit({ type: 'text', content: 'Hel' });
    fake.__emit({ type: 'text', content: 'lo' });

    expect(onToken).toHaveBeenNthCalledWith(1, 'Hel');
    expect(onToken).toHaveBeenNthCalledWith(2, 'lo');
  });

  it('session_id event → setCliSessionId(sessionId, id) on the store', async () => {
    const fake = makeFakeAdapter('claude');
    createAdapter.mockReturnValue(fake);
    seedSession('s1');

    await sendPetChatMessage('s1', 'hi', {});
    fake.__emit({ type: 'session_id', sessionId: 'cli-abc' });

    expect(petChatStoreState.setCliSessionId).toHaveBeenCalledWith('s1', 'cli-abc');
  });

  it('done event → onDone + handler deregistered (offEvent called)', async () => {
    const fake = makeFakeAdapter('claude');
    createAdapter.mockReturnValue(fake);
    seedSession('s1');
    const onDone = vi.fn();

    await sendPetChatMessage('s1', 'hi', { onDone });
    expect(fake.__handlerCount()).toBe(1);
    fake.__emit({ type: 'done' });

    expect(onDone).toHaveBeenCalledOnce();
    expect(fake.__handlerCount()).toBe(0);
    expect(fake.offEvent).toHaveBeenCalled();
  });

  it('error event → onError + handler deregistered', async () => {
    const fake = makeFakeAdapter('claude');
    createAdapter.mockReturnValue(fake);
    seedSession('s1');
    const onError = vi.fn();

    await sendPetChatMessage('s1', 'hi', { onError });
    fake.__emit({ type: 'error', content: 'boom' });

    expect(onError).toHaveBeenCalledWith('boom');
    expect(fake.__handlerCount()).toBe(0);
  });

  it('error event with no content falls back to "LLM error"', async () => {
    const fake = makeFakeAdapter('claude');
    createAdapter.mockReturnValue(fake);
    seedSession('s1');
    const onError = vi.fn();

    await sendPetChatMessage('s1', 'hi', { onError });
    fake.__emit({ type: 'error' });

    expect(onError).toHaveBeenCalledWith('LLM error');
  });

  it('thinking / tool_start / tool_end / file_change are silently dropped (no store mutation, no handler call)', async () => {
    const fake = makeFakeAdapter('claude');
    createAdapter.mockReturnValue(fake);
    seedSession('s1');
    const onToken = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    await sendPetChatMessage('s1', 'hi', { onToken, onDone, onError });
    fake.__emit({ type: 'thinking', content: 'ponder' });
    fake.__emit({ type: 'tool_start', content: 't' });
    fake.__emit({ type: 'tool_end', content: 't' });
    fake.__emit({ type: 'file_change', content: 'f' });

    expect(onToken).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(petChatStoreState.setCliSessionId).not.toHaveBeenCalled();
    // handler still registered (no terminal event yet).
    expect(fake.__handlerCount()).toBe(1);
  });

  it('adapter.send rejection deregisters the handler and rethrows', async () => {
    const fake = makeFakeAdapter('claude');
    fake.send.mockRejectedValueOnce(new Error('spawn failed'));
    createAdapter.mockReturnValue(fake);
    seedSession('s1');

    await expect(sendPetChatMessage('s1', 'hi', {})).rejects.toThrow('spawn failed');
    expect(fake.__handlerCount()).toBe(0);
  });
});

// ── session_id race prevention ──
describe('session_id event attribution (race prevention)', () => {
  it('attributes session_id to the SEND session, not "current active" after a mid-stream switch', async () => {
    const fake = makeFakeAdapter('claude');
    createAdapter.mockReturnValue(fake);
    // Send for session A.
    seedSession('A');

    await sendPetChatMessage('A', 'hi', {});
    // Handler is now registered, closed over 'A'.

    // User switches active to B BEFORE the session_id event fires.
    petChatStoreState.activeSessionId = 'B';
    petChatStoreState.sessions = [
      { id: 'A' },
      { id: 'B' },
    ];

    // Late session_id event from A's stream.
    fake.__emit({ type: 'session_id', sessionId: 'cli-A' });

    // Must attribute to A (the send's session), NOT B (now-active).
    expect(petChatStoreState.setCliSessionId).toHaveBeenCalledWith('A', 'cli-A');
    expect(petChatStoreState.setCliSessionId).not.toHaveBeenCalledWith('B', expect.anything());
  });
});

// ── per-session adapter isolation ──
describe('per-session adapter isolation', () => {
  it('two sessions get two distinct adapter instances from the Map', async () => {
    const fakeA = makeFakeAdapter('claude');
    const fakeB = makeFakeAdapter('claude');
    createAdapter.mockReturnValueOnce(fakeA).mockReturnValueOnce(fakeB);
    seedSession('A');

    await sendPetChatMessage('A', 'hi', {});
    seedSession('B');
    await sendPetChatMessage('B', 'hi', {});

    expect(__getAdapterForTesting('A')).toBe(fakeA);
    expect(__getAdapterForTesting('B')).toBe(fakeB);
    expect(fakeA).not.toBe(fakeB);
  });

  it('reuses the same adapter for a second send to the same session', async () => {
    const fake = makeFakeAdapter('claude');
    createAdapter.mockReturnValue(fake);
    seedSession('A');

    await sendPetChatMessage('A', 'hi', {});
    await sendPetChatMessage('A', 'again', {});

    // createAdapter called once for the session; second send reuses.
    expect(createAdapter).toHaveBeenCalledTimes(1);
    expect(__getAdapterForTesting('A')).toBe(fake);
  });
});

// ── adapter id invalidation ──
describe('adapter id invalidation', () => {
  it('changing settings.cliAdapter creates a fresh adapter for the session (and stops the stale one)', async () => {
    const stale = makeFakeAdapter('claude');
    const fresh = makeFakeAdapter('gemini');
    createAdapter.mockReturnValueOnce(stale).mockReturnValueOnce(fresh);
    seedSession('A');

    await sendPetChatMessage('A', 'hi', {});
    expect(__getAdapterForTesting('A')).toBe(stale);

    // User switches adapter type in settings.
    aiConfigState.cliAdapter = 'gemini';
    createAdapter.mockReturnValue(fresh);

    await sendPetChatMessage('A', 'again', {});

    expect(__getAdapterForTesting('A')).toBe(fresh);
    expect(stale.stop).toHaveBeenCalled();
  });
});

// ── Phase 2: rig-mode (chat inputMode) reads the pet session's pair via
// resolvePairForPetSession, no global fallback ──
describe('sendPetChatMessage — rig-mode pair resolution (Phase 2)', () => {
  it('rig mode: resolves the pet session pair and forwards to runRigChat', async () => {
    petChatStoreState.inputMode = 'chat';
    resolvePairForPetSessionMock.mockReturnValue({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      apiKey: 'sk-test',
      baseUrl: '',
      thinkingBudget: null,
      adapterFamily: undefined,
    });
    seedSession('s1');

    await sendPetChatMessage('s1', 'hi', {});

    expect(runRigChatMock).toHaveBeenCalledTimes(1);
    const params = runRigChatMock.mock.calls[0][0] as {
      provider: string; model: string; apiKey: string;
    };
    expect(params.provider).toBe('anthropic');
    expect(params.model).toBe('claude-sonnet-4-6');
    expect(params.apiKey).toBe('sk-test');
    // The resolver was called with the send's sessionId (not "current active").
    expect(resolvePairForPetSessionMock).toHaveBeenCalledWith('s1');
  });

  it('rig mode: fires onError + returns when the session has no pair (no global fallback)', async () => {
    petChatStoreState.inputMode = 'chat';
    // resolvePairForPetSession returns null (default mock) — no pair on session.
    seedSession('s1');
    const onError = vi.fn();

    await sendPetChatMessage('s1', 'hi', { onError });

    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/pet chat not configured/i));
    expect(runRigChatMock).not.toHaveBeenCalled();
  });

  it('rig mode: fires onError when the session pair points to a provider with no apiKey', async () => {
    petChatStoreState.inputMode = 'chat';
    // Resolver returns null because the provider slot has no apiKey — same
    // surfaced-empty-state path as a missing pair.
    resolvePairForPetSessionMock.mockReturnValue(null);
    seedSession('s1');
    const onError = vi.fn();

    await sendPetChatMessage('s1', 'hi', { onError });

    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/pet chat not configured/i));
    expect(runRigChatMock).not.toHaveBeenCalled();
  });
});

// ── stop / reset ──
describe('stopPetChat', () => {
  it('stops the adapter for the given session', async () => {
    const fake = makeFakeAdapter('claude');
    createAdapter.mockReturnValue(fake);
    seedSession('A');
    await sendPetChatMessage('A', 'hi', {});

    await stopPetChat('A');

    expect(fake.stop).toHaveBeenCalled();
  });

  it('is a safe no-op for a session with no adapter', async () => {
    await expect(stopPetChat('never')).resolves.toBeUndefined();
  });
});

describe('resetPetChatAdapter', () => {
  it('with a sessionId stops + deletes only that one', async () => {
    const fakeA = makeFakeAdapter('claude');
    const fakeB = makeFakeAdapter('claude');
    createAdapter.mockReturnValueOnce(fakeA).mockReturnValueOnce(fakeB);
    seedSession('A');
    await sendPetChatMessage('A', 'hi', {});
    seedSession('B');
    await sendPetChatMessage('B', 'hi', {});

    await resetPetChatAdapter('A');

    expect(fakeA.stop).toHaveBeenCalled();
    expect(fakeB.stop).not.toHaveBeenCalled();
    expect(__getAdapterForTesting('A')).toBeUndefined();
    expect(__getAdapterForTesting('B')).toBe(fakeB);
  });

  it('with no arg stops + deletes ALL adapters (window unmount path)', async () => {
    const fakeA = makeFakeAdapter('claude');
    const fakeB = makeFakeAdapter('claude');
    createAdapter.mockReturnValueOnce(fakeA).mockReturnValueOnce(fakeB);
    seedSession('A');
    await sendPetChatMessage('A', 'hi', {});
    seedSession('B');
    await sendPetChatMessage('B', 'hi', {});

    await resetPetChatAdapter();

    expect(fakeA.stop).toHaveBeenCalled();
    expect(fakeB.stop).toHaveBeenCalled();
    expect(__getAdapterForTesting('A')).toBeUndefined();
    expect(__getAdapterForTesting('B')).toBeUndefined();
  });
});
