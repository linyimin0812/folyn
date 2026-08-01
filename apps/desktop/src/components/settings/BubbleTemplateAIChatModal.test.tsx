import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react';

// jsdom lacks scrollIntoView — ChatMessageList calls it on render.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() { /* no-op */ };
}

// jsdom's File lacks .text() — polyfill via FileReader (real browsers have it).
if (!File.prototype.text) {
  File.prototype.text = function text() {
    return new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsText(this);
    });
  };
}

// Mock runRigChat — capture onEvent so tests can drive text/done events.
const runRigChatMock = vi.fn();
vi.mock('@/services/rigChat', () => ({
  runRigChat: (params: unknown) => runRigChatMock(params),
}));

// Mock useAiConfigStore — providerSettings/customerProviders only. Phase 2:
// the modal reads the bt pair from useBubbleTemplateChatStore's active
// session and resolves via resolvePairForBtSession (mocked on the bt store
// module). The aiConfigStore mock stays a callable function (so hook usage
// `useAiConfigStore((s) => s.x)` works for any PairSelector-driven reads of
// providerSettings/customerProviders).
const { aiConfigState } = vi.hoisted(() => {
  const aiConfigState = {
    providerSettings: {
      anthropic: {
        id: 'anthropic',
        apiKey: 'k',
        baseUrl: '',
        enabled: true,
        selectedModelIds: ['claude-sonnet-4-6'],
        extra: {},
      },
    },
    customerProviders: {},
  };
  return { aiConfigState };
});
vi.mock('@/store/aiConfigStore', () => ({
  useAiConfigStore: Object.assign(
    (sel: (s: typeof aiConfigState) => unknown) => sel(aiConfigState),
    { getState: () => aiConfigState },
  ),
  // ponytail: real bubbleTemplateChatStore.createEmptySession calls
  // firstEnabledPair on import; stub it to null so the mock stays
  // self-contained. Phase 3 widens ChatProvider to string; the cast stays
  // until then.
  firstEnabledPair: () => null,
  resolvePairConfig: () => null,
}));

// Mock resolvePairForBtSession — Phase 2: readChatConfig delegates to this.
// Default returns a resolved config for the active session; tests can
// override per-test to drive the unconfigured path.
const { resolvePairForBtSessionMock } = vi.hoisted(() => ({
  resolvePairForBtSessionMock: vi.fn<(sid: string | null) => unknown>(() => ({
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    apiKey: 'k',
    baseUrl: '',
    thinkingBudget: null,
    adapterFamily: undefined,
  })),
}));
vi.mock('@/store/bubbleTemplateChatStore', async () => {
  const actual = await vi.importActual<typeof import('@/store/bubbleTemplateChatStore')>(
    '@/store/bubbleTemplateChatStore',
  );
  return {
    ...actual,
    resolvePairForBtSession: (sid: string | null) => resolvePairForBtSessionMock(sid),
  };
});

// Mock useTranslation — return keys verbatim so tests can grep for them.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

// Mock storageClient — the store rehydrates from it on first open. Default
// returns null → store seeds one empty default session. Mirrors petChatStore
// test pattern.
const { storageGet, storageSet } = vi.hoisted(() => ({
  storageGet: vi.fn(async () => null),
  storageSet: vi.fn(async () => undefined),
}));
vi.mock('@/utils/storageClient', () => ({
  storageClient: {
    get: storageGet,
    set: storageSet,
  },
}));

import { BubbleTemplateAIChatModal } from './BubbleTemplateAIChatModal';
import { useBubbleTemplateChatStore } from '@/store/bubbleTemplateChatStore';
import type { BtSession } from '@/store/bubbleTemplateChatStore';

type RigParams = {
  sessionId: string;
  prompt: string;
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  preamble?: string;
  images?: Array<{ data: string; mediaType: string }>;
  onEvent: (event: { type: string; content: string }) => void;
};

/** Reset the store to a known-empty state between tests. Mirrors
 *  petChatStore.test's resetStoreToSingleEmpty. Phase 2: the session carries
 *  a (provider, model) pair so the modal's PairSelector + readChatConfig
 *  see a configured state — mirrors the production default where a fresh
 *  session seeds from firstEnabledPair. */
function resetStoreToSingleEmpty(): void {
  const session: BtSession = {
    id: 's1',
    title: '新会话',
    messages: [],
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    createdAt: 1,
  };
  useBubbleTemplateChatStore.setState({
    sessions: [session],
    activeSessionId: session.id,
    streaming: false,
    loaded: true,
  });
}

beforeEach(() => {
  runRigChatMock.mockReset();
  runRigChatMock.mockImplementation(async (params: RigParams) => {
    params.onEvent({ type: 'done', content: '' });
  });
  storageGet.mockReset();
  storageGet.mockResolvedValue(null);
  storageSet.mockReset();
  storageSet.mockResolvedValue(undefined);
  resolvePairForBtSessionMock.mockReset();
  resolvePairForBtSessionMock.mockReturnValue({
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    apiKey: 'k',
    baseUrl: '',
    thinkingBudget: null,
    adapterFamily: undefined,
  });
  resetStoreToSingleEmpty();
});

afterEach(() => cleanup());

describe('BubbleTemplateAIChatModal', () => {
  it('renders nothing when open=false', () => {
    render(
      <BubbleTemplateAIChatModal open={false} onClose={vi.fn()} onImport={vi.fn()} />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the dialog when open=true', () => {
    render(
      <BubbleTemplateAIChatModal open onClose={vi.fn()} onImport={vi.fn()} />,
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
  });  it('imports the JSON when the AI reply contains a json fence', async () => {
    const onImport = vi.fn(() => ({ ok: true }));
    const onClose = vi.fn();
    runRigChatMock.mockImplementation(async (params: RigParams) => {
      params.onEvent({
        type: 'text',
        content: 'Here is your template:\n```json\n{"id":"ai-birthday","name":"Birthday"}\n```',
      });
      params.onEvent({ type: 'done', content: '' });
    });

    render(<BubbleTemplateAIChatModal open onClose={onClose} onImport={onImport} />);

    // Type + send
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'birthday card' } });
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    });

    // Import button appears once AI emits the json fence.
    const importBtn = await screen.findByText('settings:pet.templates.ai.importTemplate');
    expect(importBtn).toBeTruthy();

    await act(async () => {
      fireEvent.click(importBtn);
    });

    // onImport receives the extracted JSON content (the fence inner text).
    expect(onImport).toHaveBeenCalledTimes(1);
    const extracted = onImport.mock.calls[0][0] as string;
    expect(extracted.trim()).toBe('{"id":"ai-birthday","name":"Birthday"}');

    // onImport returned ok=true → modal closes.
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays open when onImport returns ok=false', async () => {
    const onImport = vi.fn(() => ({ ok: false, error: 'bad json' }));
    const onClose = vi.fn();
    runRigChatMock.mockImplementation(async (params: RigParams) => {
      params.onEvent({
        type: 'text',
        content: '```json\n{"id":"ai-x"}```',
      });
      params.onEvent({ type: 'done', content: '' });
    });

    render(<BubbleTemplateAIChatModal open onClose={onClose} onImport={onImport} />);

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'go' } });
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    });

    const importBtn = await screen.findByText('settings:pet.templates.ai.importTemplate');
    await act(async () => {
      fireEvent.click(importBtn);
    });

    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    // Modal surfaces the returned error message.
    expect(screen.getByText('bad json')).toBeTruthy();
  });

  it('does not show the import button when the AI reply has no json fence', async () => {
    runRigChatMock.mockImplementation(async (params: RigParams) => {
      params.onEvent({ type: 'text', content: 'Tell me more about what you want.' });
      params.onEvent({ type: 'done', content: '' });
    });

    render(<BubbleTemplateAIChatModal open onClose={vi.fn()} onImport={vi.fn()} />);

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hi' } });
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    });

    // No import button since no fence.
    expect(screen.queryByText('settings:pet.templates.ai.importTemplate')).toBeNull();
  });

  it('surfaces an error event from the AI provider', async () => {
    runRigChatMock.mockImplementation(async (params: RigParams) => {
      params.onEvent({ type: 'error', content: 'rate limit exceeded' });
    });

    render(<BubbleTemplateAIChatModal open onClose={vi.fn()} onImport={vi.fn()} />);

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hi' } });
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    });

    expect(await screen.findByText('rate limit exceeded')).toBeTruthy();
  });

  it('passes the bubble-template system prompt as preamble', async () => {
    render(<BubbleTemplateAIChatModal open onClose={vi.fn()} onImport={vi.fn()} />);

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hi' } });
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    });

    await act(async () => {
      await Promise.resolve(); // let microtasks flush
    });

    expect(runRigChatMock).toHaveBeenCalledTimes(1);
    const params = runRigChatMock.mock.calls[0][0] as RigParams;
    expect(params.preamble).toBeTruthy();
    expect(params.preamble).toContain('BubbleTemplate');
    expect(params.preamble).toContain('```json');
  });

  it('attaches an HTML file as a chip and wraps its text into the send prompt', async () => {
    const onImport = vi.fn(() => ({ ok: true }));
    render(<BubbleTemplateAIChatModal open onClose={vi.fn()} onImport={onImport} />);

    const fileInput = screen.getByLabelText('settings:pet.templates.ai.paperclip') as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    expect(fileInput.accept).toBe('.html,.htm,image/*');

    const file = new File(['<div>hello</div>'], 'card.html', { type: 'text/html' });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
      // file.text() is async; let it resolve before the act block exits.
      await new Promise((r) => setTimeout(r, 0));
    });

    // Chip shows the file name.
    expect(await screen.findByText('card.html')).toBeTruthy();

    // Send (no extra user text needed — attachment alone can send).
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    });

    expect(runRigChatMock).toHaveBeenCalledTimes(1);
    const params = runRigChatMock.mock.calls[0][0] as RigParams;
    expect(params.prompt).toContain('```html');
    expect(params.prompt).toContain('<div>hello</div>');
    // No raw user text was typed — only the wrapped HTML is sent.
    expect(params.prompt.startsWith('settings:pet.templates.ai.htmlWrapPrefix')).toBe(true);
  });

  it('rejects non-HTML, non-image files with an error', async () => {
    render(<BubbleTemplateAIChatModal open onClose={vi.fn()} onImport={vi.fn()} />);

    const fileInput = screen.getByLabelText('settings:pet.templates.ai.paperclip') as HTMLInputElement;
    const file = new File(['x'], 'note.txt', { type: 'text/plain' });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    expect(screen.getByText('settings:pet.templates.ai.unsupportedFile')).toBeTruthy();
    // No chip.
    expect(screen.queryByText('note.txt')).toBeNull();
  });

  it('attaches an image as a chip with thumbnail and passes images to runRigChat', async () => {
    const onImport = vi.fn(() => ({ ok: true }));
    render(<BubbleTemplateAIChatModal open onClose={vi.fn()} onImport={onImport} />);

    const fileInput = screen.getByLabelText('settings:pet.templates.ai.paperclip') as HTMLInputElement;
    // 1x1 transparent PNG.
    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAAmCBfltAAAAASUVORK5CYII=';
    const file = new File([new Uint8Array([1, 2, 3])], 'design.png', { type: 'image/png' });
    // jsdom FileReader returns data: URL; patch File.text polyfill path is not used here.
    // Use a real FileReader-backed data URL by stubbing readAsDataURL via Object.defineProperty? Simpler:
    // the readImageFile helper uses readAsDataURL, which jsdom supports. We patch the result via a spy.
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
      await new Promise((r) => setTimeout(r, 0));
    });

    // Chip shows file name + a thumbnail <img>. Scoped to the chip row —
    // the PairSelector trigger may also render an alt-less provider icon.
    const chipText = await screen.findByText('design.png');
    expect(chipText).toBeTruthy();
    const chip = chipText.closest('div')!;
    const thumb = chip.querySelector('img') as HTMLImageElement | null;
    expect(thumb).toBeTruthy();
    expect(thumb!.src.startsWith('data:image/')).toBe(true);

    // Send.
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    });

    expect(runRigChatMock).toHaveBeenCalledTimes(1);
    const params = runRigChatMock.mock.calls[0][0] as RigParams;
    expect(params.images).toBeTruthy();
    expect(params.images!.length).toBe(1);
    expect(params.images![0].mediaType).toBe('image/png');
    expect(params.images![0].data).toBeTruthy();
    // Silence unused var linter.
    expect(pngBase64.length).toBeGreaterThan(0);
  });

  it('removes the HTML chip when its remove button is clicked', async () => {
    render(<BubbleTemplateAIChatModal open onClose={vi.fn()} onImport={vi.fn()} />);

    const fileInput = screen.getByLabelText('settings:pet.templates.ai.paperclip') as HTMLInputElement;
    const file = new File(['<div>x</div>'], 'a.html', { type: 'text/html' });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(await screen.findByText('a.html')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByLabelText('settings:pet.templates.ai.removeAttachment'));
    });
    expect(screen.queryByText('a.html')).toBeNull();
  });

  it('persists sessions + messages to storageClient so close+reopen rehydrates', async () => {
    runRigChatMock.mockImplementation(async (params: RigParams) => {
      params.onEvent({ type: 'text', content: '```json\n{"id":"ai-x"}\n```' });
      params.onEvent({ type: 'done', content: '' });
    });

    const onImport = vi.fn(() => ({ ok: true }));
    const { unmount } = render(
      <BubbleTemplateAIChatModal open onClose={vi.fn()} onImport={onImport} />,
    );

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'draft birthday card' } });
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    });

    // Wait for the assistant reply to render. The session title also matches
    // the pattern (it's derived from the first user message), so scope to the
    // message list to disambiguate.
    const log = screen.getByRole('log');
    await within(log).findByText(/draft birthday card/);

    // Store now holds the session with 2 messages + auto-title.
    const state = useBubbleTemplateChatStore.getState();
    expect(state.sessions.length).toBe(1);
    expect(state.sessions[0].messages.length).toBe(2);
    expect(state.sessions[0].title).toContain('draft birthday card');

    // Persisted to storageClient (debounced 300ms — flush with a real wait).
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    expect(storageSet).toHaveBeenCalled();
    const persisted = storageSet.mock.calls.at(-1)![1] as { sessions: BtSession[] };
    expect(persisted.sessions[0].title).toContain('draft birthday card');

    unmount();

    // Simulate rehydrate from storageClient: seed the store from the persisted
    // payload, then re-mount — should rehydrate both sessionId and messages.
    useBubbleTemplateChatStore.setState({ sessions: persisted.sessions, activeSessionId: persisted.sessions[0].id, loaded: true });
    render(<BubbleTemplateAIChatModal open onClose={vi.fn()} onImport={onImport} />);
    const logAfter = screen.getByRole('log');
    expect(within(logAfter).getByText(/draft birthday card/)).toBeTruthy();
  });

  it('清空 button deletes current session and starts a fresh one', async () => {
    runRigChatMock.mockImplementation(async (params: RigParams) => {
      params.onEvent({ type: 'text', content: '```json\n{"id":"ai-y"}\n```' });
      params.onEvent({ type: 'done', content: '' });
    });

    const onImport = vi.fn(() => ({ ok: true }));
    render(<BubbleTemplateAIChatModal open onClose={vi.fn()} onImport={onImport} />);

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'first draft' } });
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    });
    await within(screen.getByRole('log')).findByText(/first draft/);

    const oldSessionId = useBubbleTemplateChatStore.getState().activeSessionId!;
    expect(oldSessionId).toBeTruthy();

    // Two-click inline confirm: first click arms, second click commits.
    await act(async () => {
      fireEvent.click(screen.getByLabelText('settings:pet.templates.ai.clear'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('settings:pet.templates.ai.confirmDelete'));
    });

    // Messages cleared from view (the deleted session's option is gone too,
    // so /first draft/ should match nothing on the page).
    expect(screen.queryByText(/first draft/)).toBeNull();
    // Fresh sessionId differs from the old one.
    const newState = useBubbleTemplateChatStore.getState();
    expect(newState.activeSessionId).toBeTruthy();
    expect(newState.activeSessionId).not.toBe(oldSessionId);
    // Old session removed from list.
    expect(newState.sessions.find((s) => s.id === oldSessionId)).toBeUndefined();
    // New session's messages empty.
    expect(newState.sessions.find((s) => s.id === newState.activeSessionId)?.messages).toEqual([]);
  });

  it('new-session button creates a fresh session and keeps the old one in the list', async () => {
    runRigChatMock.mockImplementation(async (params: RigParams) => {
      params.onEvent({ type: 'text', content: '```json\n{"id":"ai-z"}\n```' });
      params.onEvent({ type: 'done', content: '' });
    });

    const onImport = vi.fn(() => ({ ok: true }));
    render(<BubbleTemplateAIChatModal open onClose={vi.fn()} onImport={onImport} />);

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'first in session A' } });
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    });
    await within(screen.getByRole('log')).findByText(/first in session A/);

    const sessionA = useBubbleTemplateChatStore.getState().activeSessionId!;

    // Click new-session button.
    await act(async () => {
      fireEvent.click(screen.getByLabelText('settings:pet.templates.ai.newSession'));
    });

    const stateB = useBubbleTemplateChatStore.getState();
    const sessionB = stateB.activeSessionId!;
    expect(sessionB).not.toBe(sessionA);

    // Session A remains in the list (title derived from first user message).
    expect(stateB.sessions.length).toBe(2);
    expect(stateB.sessions.find((s) => s.id === sessionA)?.title).toContain('first in session A');

    // Messages from session A no longer visible in the log.
    const logAfter = screen.getByRole('log');
    expect(within(logAfter).queryByText(/first in session A/)).toBeNull();
  });

  it('selecting a session from the dropdown switches to it and loads its messages', async () => {
    runRigChatMock.mockImplementation(async (params: RigParams) => {
      params.onEvent({ type: 'text', content: '```json\n{"id":"ai-z"}\n```' });
      params.onEvent({ type: 'done', content: '' });
    });

    const onImport = vi.fn(() => ({ ok: true }));
    render(<BubbleTemplateAIChatModal open onClose={vi.fn()} onImport={onImport} />);

    // Session A: send a message.
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'message in A' } });
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    });
    await within(screen.getByRole('log')).findByText(/message in A/);
    const sessionA = useBubbleTemplateChatStore.getState().activeSessionId!;

    // New session B.
    await act(async () => {
      fireEvent.click(screen.getByLabelText('settings:pet.templates.ai.newSession'));
    });
    const sessionB = useBubbleTemplateChatStore.getState().activeSessionId!;
    expect(sessionB).not.toBe(sessionA);
    // B is empty — A's message should be gone from view.
    const logB = screen.getByRole('log');
    expect(within(logB).queryByText(/message in A/)).toBeNull();

    // Switch back to A via dropdown.
    const select = screen.getByLabelText('settings:pet.templates.ai.sessionSelect') as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(select, { target: { value: sessionA } });
    });
    expect(useBubbleTemplateChatStore.getState().activeSessionId).toBe(sessionA);
    // A's message re-appears.
    const logA = screen.getByRole('log');
    expect(within(logA).getByText(/message in A/)).toBeTruthy();
  });

  it('preview button calls onPreview with the JSON and surfaces errors', async () => {
    const onPreview = vi.fn(() => ({ ok: true }));
    runRigChatMock.mockImplementation(async (params: RigParams) => {
      params.onEvent({
        type: 'text',
        content: '```json\n{"id":"ai-x","name":"X"}\n```',
      });
      params.onEvent({ type: 'done', content: '' });
    });

    render(
      <BubbleTemplateAIChatModal
        open
        onClose={vi.fn()}
        onImport={vi.fn()}
        onPreview={onPreview}
      />,
    );

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'go' } });
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    });

    const previewBtn = await screen.findByText('settings:pet.templates.ai.preview');
    await act(async () => {
      fireEvent.click(previewBtn);
    });

    expect(onPreview).toHaveBeenCalledTimes(1);
    const extracted = onPreview.mock.calls[0][0] as string;
    expect(extracted.trim()).toBe('{"id":"ai-x","name":"X"}');
  });

  it('preview button surfaces onPreview error when it returns ok=false', async () => {
    const onPreview = vi.fn(() => ({ ok: false, error: 'bad json' }));
    runRigChatMock.mockImplementation(async (params: RigParams) => {
      params.onEvent({
        type: 'text',
        content: '```json\n{"id":"ai-x"}\n```',
      });
      params.onEvent({ type: 'done', content: '' });
    });

    render(
      <BubbleTemplateAIChatModal
        open
        onClose={vi.fn()}
        onImport={vi.fn()}
        onPreview={onPreview}
      />,
    );

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'go' } });
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    });

    const previewBtn = await screen.findByText('settings:pet.templates.ai.preview');
    await act(async () => {
      fireEvent.click(previewBtn);
    });

    expect(screen.getByText('bad json')).toBeTruthy();
  });

  it('surfaces an empty-response error when the AI replies with no content', async () => {
    // Stream completes (done event) but no text ever arrives — assistant
    // bubble stays empty. The modal should surface a clear error instead
    // of leaving the user staring at a blank bubble.
    runRigChatMock.mockImplementation(async (params: RigParams) => {
      params.onEvent({ type: 'done', content: '' });
    });

    render(<BubbleTemplateAIChatModal open onClose={vi.fn()} onImport={vi.fn()} />);

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hi' } });
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    });

    expect(await screen.findByText('settings:pet.templates.ai.emptyResponse')).toBeTruthy();
  });

  it('surfaces an error event from the AI provider and clears streaming', async () => {
    runRigChatMock.mockImplementation(async (params: RigParams) => {
      params.onEvent({ type: 'error', content: 'rate limit exceeded' });
    });

    render(<BubbleTemplateAIChatModal open onClose={vi.fn()} onImport={vi.fn()} />);

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hi' } });
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    });

    expect(await screen.findByText('rate limit exceeded')).toBeTruthy();
    // Streaming cleared so the input is usable again.
    expect(useBubbleTemplateChatStore.getState().streaming).toBe(false);
  });

  it('renders thinking chunks in the assistant message', async () => {
    runRigChatMock.mockImplementation(async (params: RigParams) => {
      params.onEvent({ type: 'thinking', content: 'let me consider' });
      params.onEvent({ type: 'thinking', content: ' the options' });
      params.onEvent({ type: 'text', content: 'final answer' });
      params.onEvent({ type: 'done', content: '' });
    });

    render(<BubbleTemplateAIChatModal open onClose={vi.fn()} onImport={vi.fn()} />);

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'go' } });
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    });

    // Thinking body rendered in the message list (ChatMessageList shows it
    // in a <details> with class msg-thinking-body).
    const thinking = await screen.findByText('let me consider the options');
    expect(thinking).toBeTruthy();
    // Final text answer also present.
    expect(screen.getByText('final answer')).toBeTruthy();
    // Thinking persisted on the message.
    const sess = useBubbleTemplateChatStore.getState().sessions[0];
    expect(sess.messages.at(-1)?.thinking).toBe('let me consider the options');
  });

  it('surfaces empty-response when stream ended with thinking but no text', async () => {
    // Stream emits thinking then completes (done) without any final text.
    // Thinking-only is still a failure for this UI (no BubbleTemplate draft
    // produced), so surface empty-response so the user isn't left silent.
    runRigChatMock.mockImplementation(async (params: RigParams) => {
      params.onEvent({ type: 'thinking', content: 'partway through' });
      params.onEvent({ type: 'done', content: '' });
    });

    render(<BubbleTemplateAIChatModal open onClose={vi.fn()} onImport={vi.fn()} />);

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'go' } });
    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    });

    // Thinking body is visible.
    expect(await screen.findByText('partway through')).toBeTruthy();
    // Empty-response error surfaces because no text content arrived.
    expect(screen.queryByText('settings:pet.templates.ai.emptyResponse')).toBeTruthy();
  });
});
