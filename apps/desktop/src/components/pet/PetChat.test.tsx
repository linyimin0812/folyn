import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';

// jsdom does not implement Element.scrollIntoView; the auto-scroll effect in
// PetChat calls it on render. Polyfill with a no-op before any render.
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

// Mock the CliAdapter-backed petChatService so we don't spawn a real CLI.
// We assert the service is invoked with the right shape and can simulate a
// streamed token by calling the onToken hook directly. vi.hoisted keeps
// the mock fns referenceable inside the hoisted vi.mock factory.
const {
  sendMock,
  stopMock,
  resetMock,
  lastHandlersRef,
} = vi.hoisted(() => ({
  sendMock: vi.fn(async () => undefined),
  stopMock: vi.fn(async () => undefined),
  resetMock: vi.fn(),
  lastHandlersRef: { current: null as null | {
    onToken: (text: string) => void;
    onDone: () => void;
    onError: (message: string) => void;
  } },
}));
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

const emitMock = emit as unknown as import('vitest').Mock;

beforeEach(() => {
  sendMock.mockClear();
  stopMock.mockClear();
  resetMock.mockClear();
  lastHandlersRef.current = null;
  writeTextMock.mockClear();
  writeTextMock.mockResolvedValue(undefined);
  // mockImplementation MUST be set after mockResolvedValue — otherwise the
  // latter overrides it and handlers never get captured.
  sendMock.mockResolvedValue(undefined);
  sendMock.mockImplementation(async (
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
  emitMock.mockClear();
  emitMock.mockResolvedValue(undefined);
  usePetChatStore.setState({ messages: [], streaming: false });
  settingsState.cliAdapter = 'claude';
  settingsState.cliPath = 'claude';
});

afterEach(() => {
  cleanup();
});

describe('PetChat', () => {
  it('renders the hint when there are no messages and AI is configured', () => {
    render(<PetChat />);
    expect(screen.getByText('向 AI 提问，回答会在此处流式显示。')).toBeTruthy();
  });

  it('renders the unconfigured-AI CTA when cliPath is empty', () => {
    settingsState.cliPath = '';
    render(<PetChat />);
    expect(screen.getByText('未配置 AI')).toBeTruthy();
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
    await waitFor(() => expect(emitMock).toHaveBeenCalledWith('pet://menu-action', { action: 'show-main' }));
  });

  it('send triggers the service with the prompt and appends a user message', async () => {
    render(<PetChat />);
    const input = screen.getByLabelText('Pet chat input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'hello AI' } });
    await fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1));
    expect(sendMock).toHaveBeenCalledWith('hello AI', expect.objectContaining({
      onToken: expect.any(Function),
      onDone: expect.any(Function),
      onError: expect.any(Function),
    }));
    const msgs = usePetChatStore.getState().messages;
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].content).toBe('hello AI');
    expect(msgs[1].role).toBe('assistant');
    expect(msgs[1].content).toBe('');
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
    expect(usePetChatStore.getState().messages[1].content).toBe('Hello');

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
    const last = usePetChatStore.getState().messages[1].content;
    expect(last).toContain('[错误] boom');
    expect(usePetChatStore.getState().streaming).toBe(false);
  });

  it('Stop button calls stopPetChat and clears streaming', async () => {
    render(<PetChat />);
    const input = screen.getByLabelText('Pet chat input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'q' } });
    await fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });
    await waitFor(() => expect(usePetChatStore.getState().streaming).toBe(true));

    await fireEvent.click(screen.getByLabelText('停止'));
    await waitFor(() => expect(stopMock).toHaveBeenCalledTimes(1));
    expect(usePetChatStore.getState().streaming).toBe(false);
  });

  it('Shift+Enter does not send (newline instead)', async () => {
    render(<PetChat />);
    const input = screen.getByLabelText('Pet chat input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'line1\nline2' } });
    await fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('clear button empties the message list', async () => {
    usePetChatStore.setState({
      messages: [{ id: '1', role: 'user', content: 'old', ts: 1 }],
      streaming: false,
    });
    render(<PetChat />);
    await fireEvent.click(screen.getByText('清空对话'));
    expect(usePetChatStore.getState().messages).toEqual([]);
  });

  it('renders persisted messages on mount', () => {
    usePetChatStore.setState({
      messages: [
        { id: '1', role: 'user', content: 'saved user', ts: 1 },
        { id: '2', role: 'assistant', content: 'saved ai', ts: 2 },
      ],
      streaming: false,
    });
    render(<PetChat />);
    expect(screen.getByText('saved user')).toBeTruthy();
    expect(screen.getByText('saved ai')).toBeTruthy();
  });

  it('assistant messages render a copy button; user messages do not', () => {
    usePetChatStore.setState({
      messages: [
        { id: 'u1', role: 'user', content: 'hi there', ts: 1 },
        { id: 'a1', role: 'assistant', content: 'hello back', ts: 2 },
      ],
      streaming: false,
    });
    render(<PetChat />);
    // assistant bubble has a copy button labelled "复制"
    expect(screen.getByLabelText('复制')).toBeTruthy();
    // only one copy button (the user bubble has none)
    expect(screen.getAllByLabelText('复制').length).toBe(1);
  });

  it('clicking the copy button calls clipboard writeText with the message text', async () => {
    usePetChatStore.setState({
      messages: [
        { id: 'a1', role: 'assistant', content: 'copy me please', ts: 1 },
      ],
      streaming: false,
    });
    render(<PetChat />);
    await fireEvent.click(screen.getByLabelText('复制'));
    await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith('copy me please'));
    // feedback toggles the label to "已复制"
    expect(screen.getByLabelText('已复制')).toBeTruthy();
  });

  it('assistant message content is rendered as plain text (no markdown pipeline)', async () => {
    // PR3: PetChat now renders bubbles via the shared `ChatMessageList`
    // with `plaintext`, which wraps assistant content in a plain div
    // (whitespace-pre-wrap) and skips the unified/remark/rehype pipeline.
    // The old `.pet-chat-bubble-content` `user-select: text` CSS override
    // was deleted along with the rest of `.pet-chat-*`; selection is now
    // the browser default on the shared Tailwind-rendered content.
    usePetChatStore.setState({
      messages: [
        { id: 'a1', role: 'assistant', content: 'line1\nline2', ts: 1 },
      ],
      streaming: false,
    });
    const { container } = render(<PetChat />);
    // The whitespace-pre-wrap class is applied to the plaintext wrapper.
    const wrapper = container.querySelector('.whitespace-pre-wrap');
    expect(wrapper).toBeTruthy();
    // The raw content (including the newline) is rendered as a single text
    // node; whitespace-pre-wrap preserves the \n visually.
    expect(wrapper!.textContent).toBe('line1\nline2');
    // Confirm no markdown wrapper (.msg-md) is present on the pet path.
    expect(container.querySelector('.msg-md')).toBeNull();
  });
});
