import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';

// jsdom does not implement Element.scrollIntoView; the auto-scroll effect in
// ChatMessageList calls it on render. Polyfill with a no-op before any render.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() { /* no-op */ };
}

// Mock @tauri-apps/api/event (emit) — provided by vitest.workspace.ts alias.
import { emit } from '@tauri-apps/api/event';

// Mock @tauri-apps/plugin-clipboard-manager — the copy button on assistant
// messages dynamically imports `writeText`. Mirror the stub pattern used in
// JsonFileViewerPreview.test.tsx.
const writeTextMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: writeTextMock,
}));

// Mock storageClient so the store's module-load rehydrate is deterministic
// (returns null → seeds one empty default session) and does not touch the
// fs/path mocks. Mirrors petChatStore.test.ts.
const { storageGet, storageSet, storageRemove } = vi.hoisted(() => ({
  storageGet: vi.fn(async () => null),
  storageSet: vi.fn(async () => undefined),
  storageRemove: vi.fn(async () => undefined),
}));
vi.mock('@/utils/storageClient', () => ({
  storageClient: {
    get: storageGet,
    set: storageSet,
    remove: storageRemove,
    __resetForTesting: vi.fn(),
  },
}));

// Mock the CliAdapter-backed petChatService so we don't spawn a real CLI.
// PR2 signature: sendPetChatMessage(sessionId, prompt, handlers),
// stopPetChat(sessionId), resetPetChatAdapter(sessionId?). vi.hoisted keeps
// the mock fns referenceable inside the hoisted vi.mock factory.
const {
  sendMock,
  stopMock,
  resetMock,
  lastHandlersRef,
} = vi.hoisted(() => {
  type Handlers = {
    onToken: (text: string) => void;
    onDone: () => void;
    onError: (message: string) => void;
  };
  const sendMock = vi.fn<(s: string, p: string, h: Handlers) => Promise<void>>(
    async () => undefined,
  );
  const stopMock = vi.fn<(s: string) => Promise<void>>(async () => undefined);
  const resetMock = vi.fn<(s?: string) => Promise<void>>(async () => undefined);
  const lastHandlersRef: { current: Handlers | null } = { current: null };
  return { sendMock, stopMock, resetMock, lastHandlersRef };
});
vi.mock('@/services/petChatService', () => ({
  sendPetChatMessage: sendMock,
  stopPetChat: stopMock,
  resetPetChatAdapter: resetMock,
}));

const settingsState = {
  cliAdapter: 'claude',
  cliPath: 'claude',
  setCurrentPage: vi.fn(),
  setSettingsTab: vi.fn(),
};
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: {
    getState: () => settingsState,
  },
}));

import { PetChat } from './PetChat';
import { usePetChatStore } from '@/store/petChatStore';
import type { PetChatSession, PetChatMessage } from '@/store/petChatStore';
import { MAX_SESSIONS } from '@/store/petChatStore';

const emitMock = emit as unknown as import('vitest').Mock;

/** Reset the store to a single empty session (id `s1`) so tests have a
 *  deterministic baseline. Mirrors petChatStore.test.ts. */
function resetStoreToSingleEmpty(id = 's1', title = '新对话'): void {
  const session: PetChatSession = {
    id,
    title,
    messages: [],
    createdAt: 1,
  };
  usePetChatStore.setState({ sessions: [session], activeSessionId: id, streaming: false });
}

/** Build a session with messages for seed state. */
function sessionWith(
  id: string,
  messages: PetChatMessage[],
  title?: string,
): PetChatSession {
  return {
    id,
    title: title ?? '新对话',
    messages,
    createdAt: 1,
  };
}

beforeEach(() => {
  sendMock.mockClear();
  stopMock.mockClear();
  resetMock.mockClear();
  lastHandlersRef.current = null;
  writeTextMock.mockClear();
  writeTextMock.mockResolvedValue(undefined);
  sendMock.mockResolvedValue(undefined);
  sendMock.mockImplementation(async (
    _sessionId: string,
    _prompt: string,
    handlers: {
      onToken: (text: string) => void;
      onDone: () => void;
      onError: (message: string) => void;
    },
  ) => {
    lastHandlersRef.current = handlers;
  });
  stopMock.mockResolvedValue(undefined);
  resetMock.mockResolvedValue(undefined);
  emitMock.mockClear();
  emitMock.mockResolvedValue(undefined);
  storageGet.mockClear();
  storageGet.mockResolvedValue(null);
  storageSet.mockClear();
  storageSet.mockResolvedValue(undefined);
  storageRemove.mockClear();
  storageRemove.mockResolvedValue(undefined);
  resetStoreToSingleEmpty();
  settingsState.cliAdapter = 'claude';
  settingsState.cliPath = 'claude';
});

afterEach(() => {
  cleanup();
});

describe('PetChat', () => {
  // ── Unconfigured CTA ──
  it('renders the unconfigured-AI CTA when cliPath is empty (no session header)', () => {
    settingsState.cliPath = '';
    render(<PetChat />);
    expect(screen.getByText('未配置 AI')).toBeTruthy();
    expect(screen.queryByLabelText('切换会话')).toBeNull();
    expect(screen.queryByLabelText('Pet chat input')).toBeNull();
  });

  it('renders the unconfigured-AI CTA when cliAdapter is empty', () => {
    settingsState.cliAdapter = '';
    render(<PetChat />);
    expect(screen.getByText('未配置 AI')).toBeTruthy();
  });

  it('CTA button emits show-main and navigates to AI settings', async () => {
    settingsState.cliPath = '';
    render(<PetChat />);
    await fireEvent.click(screen.getByText('打开 AI 设置'));
    expect(settingsState.setCurrentPage).toHaveBeenCalledWith('settings');
    expect(settingsState.setSettingsTab).toHaveBeenCalledWith('ai');
    await waitFor(() =>
      expect(emitMock).toHaveBeenCalledWith('pet://menu-action', { action: 'show-main' }),
    );
  });

  // ── Configured baseline + session header ──
  it('renders the session header with the active session title and the empty hint', () => {
    render(<PetChat />);
    // Header button shows the active session's title.
    const headerBtn = screen.getByLabelText('切换会话');
    expect(headerBtn.textContent).toContain('新对话');
    // Empty-state hint is rendered by ChatMessageList.
    expect(screen.getByText('向 AI 提问，回答会在此处流式显示。')).toBeTruthy();
  });

  // Regression: the real pet-panel window first renders with the store's
  // INITIAL state (sessions: [], activeSessionId: null) because `rehydrate()`
  // is async and hasn't resolved yet. The messages selector
  // `s.sessions.find(...)?.messages ?? []` returned an inline `[]` on that
  // path — a NEW reference per selector call. Zustand v5 uses
  // `useSyncExternalStore`, so React 18 treated each new reference as a store
  // change → re-render → new reference → infinite loop →
  // "Maximum update depth exceeded" → the component tree crashed → the panel
  // showed blank. This test renders the initial empty state directly (the
  // beforeEach seed is overwritten) and asserts it renders without crashing.
  it('renders the empty hint without crashing in the initial empty-sessions state (selector referential stability)', () => {
    usePetChatStore.setState({ sessions: [], activeSessionId: null, streaming: false });
    render(<PetChat />);
    // Header falls back to '新对话' (active session is undefined).
    expect(screen.getByLabelText('切换会话').textContent).toContain('新对话');
    // Empty-state hint renders — no infinite loop, no crash.
    expect(screen.getByText('向 AI 提问，回答会在此处流式显示。')).toBeTruthy();
    expect(screen.getByLabelText('Pet chat input')).toBeTruthy();
  });

  it('renders the active session messages on mount', () => {
    usePetChatStore.setState({
      sessions: [
        sessionWith('s1', [
          { id: 'u1', role: 'user', content: 'saved user', ts: 1 },
          { id: 'a1', role: 'assistant', content: 'saved ai', ts: 2 },
        ]),
      ],
      activeSessionId: 's1',
      streaming: false,
    });
    render(<PetChat />);
    expect(screen.getByText('saved user')).toBeTruthy();
    expect(screen.getByText('saved ai')).toBeTruthy();
  });

  // ── Dropdown open / close ──
  it('opens the dropdown on header click and lists sessions + 新建会话', () => {
    usePetChatStore.setState({
      sessions: [
        sessionWith('s1', [], 'first'),
        sessionWith('s2', [], 'second'),
      ],
      activeSessionId: 's1',
      streaming: false,
    });
    render(<PetChat />);
    fireEvent.click(screen.getByLabelText('切换会话'));
    // Both session titles appear in the dropdown (the active one also appears
    // in the header button, so use getAllByText).
    expect(screen.getAllByText('first').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('second').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('新建会话')).toBeTruthy();
  });

  it('closes the dropdown on outside click', () => {
    render(<PetChat />);
    fireEvent.click(screen.getByLabelText('切换会话'));
    expect(screen.getByText('新建会话')).toBeTruthy();
    // Click outside the dropdown container (the header itself is inside the
    // container, so click on the body area below).
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('新建会话')).toBeNull();
  });

  // ── createSession ──
  it('新建会话 creates a new session and switches active to it', () => {
    render(<PetChat />);
    fireEvent.click(screen.getByLabelText('切换会话'));
    fireEvent.click(screen.getByText('新建会话'));
    const state = usePetChatStore.getState();
    expect(state.sessions).toHaveLength(2);
    expect(state.activeSessionId).toBe(state.sessions[0].id);
    // The new session is the most-recent (prepended), title 新对话.
    expect(state.sessions[0].title).toBe('新对话');
    // Header now reflects the new active session.
    expect(screen.getByLabelText('切换会话').textContent).toContain('新对话');
  });

  it('at MAX_SESSIONS cap: 新建会话 is disabled and shows the cap hint', () => {
    const sessions: PetChatSession[] = Array.from({ length: MAX_SESSIONS }, (_, i) => ({
      id: `cap-${i}`,
      title: `s${i}`,
      messages: [],
      createdAt: i,
    }));
    usePetChatStore.setState({ sessions, activeSessionId: sessions[0].id, streaming: false });
    render(<PetChat />);
    fireEvent.click(screen.getByLabelText('切换会话'));
    // Cap hint is rendered.
    expect(screen.getByText(`会话数已达上限（${MAX_SESSIONS}）`)).toBeTruthy();
    // The new-session button is disabled.
    const newBtn = screen.getByText('新建会话').closest('button')!;
    expect(newBtn.disabled).toBe(true);
    // Clicking a disabled button does not add a session.
    expect(usePetChatStore.getState().sessions).toHaveLength(MAX_SESSIONS);
  });

  // ── switchSession ──
  it('switching sessions changes the displayed messages and active title', () => {
    usePetChatStore.setState({
      sessions: [
        sessionWith('s1', [{ id: 'm1', role: 'user', content: 'in s1', ts: 1 }], 'first'),
        sessionWith('s2', [{ id: 'm2', role: 'user', content: 'in s2', ts: 2 }], 'second'),
      ],
      activeSessionId: 's1',
      streaming: false,
    });
    render(<PetChat />);
    expect(screen.getByText('in s1')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('切换会话'));
    // Click the "second" session row in the dropdown.
    fireEvent.click(screen.getByText('second'));
    expect(usePetChatStore.getState().activeSessionId).toBe('s2');
    // The s1 message is gone; s2's message is now shown.
    expect(screen.queryByText('in s1')).toBeNull();
    expect(screen.getByText('in s2')).toBeTruthy();
  });

  it('switching while streaming stops the active adapter first', async () => {
    usePetChatStore.setState({
      sessions: [
        sessionWith('s1', [], 'first'),
        sessionWith('s2', [], 'second'),
      ],
      activeSessionId: 's1',
      streaming: true,
    });
    render(<PetChat />);
    fireEvent.click(screen.getByLabelText('切换会话'));
    fireEvent.click(screen.getByText('second'));
    await waitFor(() => expect(stopMock).toHaveBeenCalledWith('s1'));
    expect(usePetChatStore.getState().streaming).toBe(false);
    expect(usePetChatStore.getState().activeSessionId).toBe('s2');
  });

  // ── deleteSession ──
  it('delete shows a second-confirm; confirming deletes the session', async () => {
    usePetChatStore.setState({
      sessions: [
        sessionWith('s1', [], 'first'),
        sessionWith('s2', [], 'second'),
      ],
      activeSessionId: 's1',
      streaming: false,
    });
    render(<PetChat />);
    fireEvent.click(screen.getByLabelText('切换会话'));
    // Click the per-row delete affordance on the active session's row.
    // There are two delete buttons (one per row); click the first.
    const deleteBtns = screen.getAllByLabelText('删除');
    fireEvent.click(deleteBtns[0]);
    // Row morphs into the confirm prompt.
    expect(screen.getByText('确认删除？')).toBeTruthy();
    fireEvent.click(screen.getByText('是'));
    await waitFor(() => expect(resetMock).toHaveBeenCalled());
    const state = usePetChatStore.getState();
    expect(state.sessions).toHaveLength(1);
  });

  it('delete second-confirm can be cancelled', () => {
    usePetChatStore.setState({
      sessions: [
        sessionWith('s1', [], 'first'),
        sessionWith('s2', [], 'second'),
      ],
      activeSessionId: 's1',
      streaming: false,
    });
    render(<PetChat />);
    fireEvent.click(screen.getByLabelText('切换会话'));
    fireEvent.click(screen.getAllByLabelText('删除')[0]);
    fireEvent.click(screen.getByText('否'));
    expect(usePetChatStore.getState().sessions).toHaveLength(2);
  });

  it('deleting the last session auto-creates an empty session and switches to it', async () => {
    render(<PetChat />);
    fireEvent.click(screen.getByLabelText('切换会话'));
    fireEvent.click(screen.getAllByLabelText('删除')[0]);
    fireEvent.click(screen.getByText('是'));
    await waitFor(() => expect(usePetChatStore.getState().sessions).toHaveLength(1));
    const state = usePetChatStore.getState();
    expect(state.activeSessionId).toBe(state.sessions[0].id);
    expect(state.sessions[0].messages).toEqual([]);
  });

  it('deleting the active streaming session stops it first', async () => {
    usePetChatStore.setState({
      sessions: [
        sessionWith('s1', [], 'first'),
        sessionWith('s2', [], 'second'),
      ],
      activeSessionId: 's1',
      streaming: true,
    });
    render(<PetChat />);
    fireEvent.click(screen.getByLabelText('切换会话'));
    fireEvent.click(screen.getAllByLabelText('删除')[0]); // delete s1 (active)
    fireEvent.click(screen.getByText('是'));
    await waitFor(() => expect(stopMock).toHaveBeenCalledWith('s1'));
    expect(usePetChatStore.getState().streaming).toBe(false);
  });

  // ── renameSession ──
  it('rename inline edit commits the title on Enter', () => {
    usePetChatStore.setState({
      sessions: [sessionWith('s1', [], 'old title')],
      activeSessionId: 's1',
      streaming: false,
    });
    render(<PetChat />);
    fireEvent.click(screen.getByLabelText('切换会话'));
    fireEvent.click(screen.getByLabelText('重命名'));
    const input = screen.getByDisplayValue('old title') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'new title' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(usePetChatStore.getState().sessions[0].title).toBe('new title');
  });

  it('rename cancels on Escape', () => {
    usePetChatStore.setState({
      sessions: [sessionWith('s1', [], 'old title')],
      activeSessionId: 's1',
      streaming: false,
    });
    render(<PetChat />);
    fireEvent.click(screen.getByLabelText('切换会话'));
    fireEvent.click(screen.getByLabelText('重命名'));
    const input = screen.getByDisplayValue('old title') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'discarded' } });
    fireEvent.keyDown(input, { key: 'Escape', bubbles: true });
    expect(usePetChatStore.getState().sessions[0].title).toBe('old title');
  });

  // ── Send flow ──
  it('Enter sends: adds user+assistant messages, sets streaming, calls service with (sessionId, prompt, handlers)', async () => {
    render(<PetChat />);
    const input = screen.getByLabelText('Pet chat input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'hello AI' } });
    await fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1));
    // PR2 signature: (sessionId, prompt, handlers).
    expect(sendMock).toHaveBeenCalledWith(
      's1',
      'hello AI',
      expect.objectContaining({
        onToken: expect.any(Function),
        onDone: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
    const active = usePetChatStore.getState().sessions.find((s) => s.id === 's1')!;
    expect(active.messages[0].role).toBe('user');
    expect(active.messages[0].content).toBe('hello AI');
    expect(active.messages[1].role).toBe('assistant');
    expect(active.messages[1].content).toBe('');
    expect(usePetChatStore.getState().streaming).toBe(true);
  });

  it('streamed tokens are appended to the assistant message', async () => {
    render(<PetChat />);
    const input = screen.getByLabelText('Pet chat input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'q' } });
    await fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });
    await waitFor(() => expect(lastHandlersRef.current).not.toBeNull());

    act(() => {
      lastHandlersRef.current!.onToken('Hel');
      lastHandlersRef.current!.onToken('lo');
    });
    const active = usePetChatStore.getState().sessions.find((s) => s.id === 's1')!;
    expect(active.messages[1].content).toBe('Hello');

    act(() => lastHandlersRef.current!.onDone());
    expect(usePetChatStore.getState().streaming).toBe(false);
  });

  it('error event appends an error note and clears streaming', async () => {
    render(<PetChat />);
    const input = screen.getByLabelText('Pet chat input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'q' } });
    await fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });
    await waitFor(() => expect(lastHandlersRef.current).not.toBeNull());

    act(() => lastHandlersRef.current!.onError('boom'));
    const active = usePetChatStore.getState().sessions.find((s) => s.id === 's1')!;
    expect(active.messages[1].content).toContain('[错误] boom');
    expect(usePetChatStore.getState().streaming).toBe(false);
  });

  it('Stop button calls stopPetChat(sessionId) and clears streaming', async () => {
    render(<PetChat />);
    const input = screen.getByLabelText('Pet chat input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'q' } });
    await fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });
    await waitFor(() => expect(usePetChatStore.getState().streaming).toBe(true));

    await fireEvent.click(screen.getByLabelText('停止'));
    await waitFor(() => expect(stopMock).toHaveBeenCalledWith('s1'));
    expect(usePetChatStore.getState().streaming).toBe(false);
  });

  it('Shift+Enter does not send (newline instead)', async () => {
    render(<PetChat />);
    const input = screen.getByLabelText('Pet chat input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'line1\nline2' } });
    await fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(sendMock).not.toHaveBeenCalled();
  });

  // ── clearActive ──
  it('clear button empties the active session messages', async () => {
    usePetChatStore.setState({
      sessions: [
        sessionWith('s1', [{ id: '1', role: 'user', content: 'old', ts: 1 }]),
      ],
      activeSessionId: 's1',
      streaming: false,
    });
    render(<PetChat />);
    await fireEvent.click(screen.getByText('清空对话'));
    const active = usePetChatStore.getState().sessions.find((s) => s.id === 's1')!;
    expect(active.messages).toEqual([]);
  });

  // ── Copy + plaintext rendering (shared-component smoke) ──
  it('assistant messages render a copy button; user messages do not', () => {
    usePetChatStore.setState({
      sessions: [
        sessionWith('s1', [
          { id: 'u1', role: 'user', content: 'hi there', ts: 1 },
          { id: 'a1', role: 'assistant', content: 'hello back', ts: 2 },
        ]),
      ],
      activeSessionId: 's1',
      streaming: false,
    });
    render(<PetChat />);
    expect(screen.getAllByLabelText('复制').length).toBe(1);
  });

  it('clicking the copy button calls clipboard writeText with the message text', async () => {
    usePetChatStore.setState({
      sessions: [
        sessionWith('s1', [{ id: 'a1', role: 'assistant', content: 'copy me please', ts: 1 }]),
      ],
      activeSessionId: 's1',
      streaming: false,
    });
    render(<PetChat />);
    await fireEvent.click(screen.getByLabelText('复制'));
    await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith('copy me please'));
    expect(screen.getByLabelText('已复制')).toBeTruthy();
  });

  it('assistant message content is rendered as plain text (no markdown pipeline)', () => {
    usePetChatStore.setState({
      sessions: [
        sessionWith('s1', [{ id: 'a1', role: 'assistant', content: 'line1\nline2', ts: 1 }]),
      ],
      activeSessionId: 's1',
      streaming: false,
    });
    const { container } = render(<PetChat />);
    const wrapper = container.querySelector('.whitespace-pre-wrap');
    expect(wrapper).toBeTruthy();
    expect(wrapper!.textContent).toBe('line1\nline2');
    expect(container.querySelector('.msg-md')).toBeNull();
  });
});
