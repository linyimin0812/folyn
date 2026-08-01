import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

// jsdom lacks URL.createObjectURL / revokeObjectURL; the attachments helper
// (addFiles / handlePaste) calls them to build image preview URLs. Polyfill
// with vitest mocks so individual tests can assert call counts.
const createObjectURLMock = vi.fn((_blob: Blob) => 'blob:mock');
const revokeObjectURLMock = vi.fn((_url: string) => {});
beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const urlAny = URL as any;
  if (typeof urlAny.createObjectURL !== 'function') {
    urlAny.createObjectURL = createObjectURLMock;
  }
  if (typeof urlAny.revokeObjectURL !== 'function') {
    urlAny.revokeObjectURL = revokeObjectURLMock;
  }
});

// Mock FileIcon — the chip renders it for non-image attachments; its real
// impl pulls in ThemeIcon → useAppearanceStore. Stubbing keeps the test
// focused on ChatInput's attachment wiring (mirrors PetChat.test.tsx).
vi.mock('@/components/icons/FileIcon', () => ({
  FileIcon: () => React.createElement('span', { 'data-testid': 'file-icon' }),
  getFileTypeIcon: () => null,
}));

// Mock the aiStore hooks ChatInput reads (pendingFileAttachments /
// pendingPrompt / inputMode). A plain object with getState-style stable
// hooks is not enough because ChatInput calls them as hooks; expose both
// the hook form (selectors) and a mutable backing state for test control.
const aiState = {
  pendingFileAttachments: [] as { name: string; path: string }[],
  consumePendingFiles: vi.fn(() => [] as { name: string; path: string }[]),
  pendingPrompt: '',
  consumePendingPrompt: vi.fn(() => ''),
  inputMode: 'agent',
  setInputMode: vi.fn(),
  activeSessionId: null as string | null,
  sessions: [] as { id: string; kind?: string; provider?: string; model?: string }[],
  setSessionPair: vi.fn(),
};
vi.mock('@/store/aiStore', () => ({
  useAiStore: (sel: (s: typeof aiState) => unknown) => sel(aiState),
}));

// Mock vaultStore (fileTree for @mention) + editorStore (activeFilePath).
// Empty file tree → no @mention matches; ChatInput still renders + sends.
const vaultState = { fileTree: [] as never[] };
vi.mock('@/store/vaultStore', () => ({
  useVaultStore: (sel: (s: typeof vaultState) => unknown) => sel(vaultState),
}));
const editorState = { tabs: [], activeTabId: null };
vi.mock('@/store/editorStore', () => ({
  useEditorStore: (sel: (s: typeof editorState) => unknown) => sel(editorState),
}));

// inputModes returns at least one mode so the dropdown branch is exercised.
vi.mock('./inputModes', () => ({
  listInputModes: () => [
    { id: 'chat', label: 'Chat', description: 'chat mode', backend: 'rig' },
    { id: 'agent', label: 'Agent', description: 'agent mode' },
    { id: 'ask', label: 'Ask', description: 'ask mode' },
  ],
  isRigMode: (id: string) => id === 'chat',
}));

import { ChatInput } from './ChatInput';
import { DEFAULT_MAX_BYTES } from '@/components/chat';

beforeEach(() => {
  aiState.pendingFileAttachments = [];
  aiState.consumePendingFiles.mockReturnValue([]);
  aiState.pendingPrompt = '';
  aiState.consumePendingPrompt.mockReturnValue('');
  aiState.inputMode = 'agent';
  aiState.setInputMode.mockClear();
  createObjectURLMock.mockClear();
  createObjectURLMock.mockReturnValue('blob:mock');
  revokeObjectURLMock.mockClear();
});

afterEach(() => {
  cleanup();
});

/** Build a File whose blob.arrayBuffer() resolves (jsdom Blob lacks it). */
function makeFile(name: string, content: string, type = ''): File {
  const bytes = new TextEncoder().encode(content);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const file = new File([bytes], name, { type });
  Object.defineProperty(file, 'arrayBuffer', {
    value: () => Promise.resolve(buffer),
    configurable: true,
  });
  return file;
}

function getFileInput(container: HTMLElement): HTMLInputElement {
  const el = container.querySelector('input[type="file"]');
  if (!el) throw new Error('file input not rendered');
  return el as HTMLInputElement;
}

/** Synthesize a paste event carrying file items (jsdom has no ClipboardEvent
 *  constructor). Mirrors PetChat.test.tsx's dispatchPaste helper. */
function dispatchPaste(
  target: HTMLElement,
  items: { kind: 'file' | 'string'; type: string; file?: File | null }[],
) {
  const evt = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(evt, 'clipboardData', {
    value: {
      items: items.map((it) => ({
        kind: it.kind,
        type: it.type,
        getAsFile: () => it.file ?? null,
      })),
    },
    configurable: true,
  });
  target.dispatchEvent(evt);
  return evt;
}

async function pasteAsync(
  target: HTMLElement,
  items: { kind: 'file' | 'string'; type: string; file?: File | null }[],
) {
  let evt!: Event;
  await act(() => {
    evt = dispatchPaste(target, items);
  });
  return evt;
}

describe('ChatInput (PR3 helper adoption)', () => {
  it('file picker: adding a valid file renders a chip and send passes attachments to onSend', async () => {
    const onSend = vi.fn();
    const { container } = render(<ChatInput onSend={onSend} onStop={vi.fn()} isStreaming={false} />);
    const fileInput = getFileInput(container);
    const file = makeFile('note.md', 'hello', 'text/markdown');
    await fireEvent.change(fileInput, { target: { files: [file] } });

    expect(screen.getByText('note.md')).toBeTruthy();

    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'read this' } });
    await fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    expect(onSend).toHaveBeenCalledTimes(1);
    const [sentText, sentAttachments] = onSend.mock.calls[0];
    expect(sentText).toBe('read this');
    expect(sentAttachments).toHaveLength(1);
    expect(sentAttachments[0].name).toBe('note.md');
    expect(sentAttachments[0].type).toBe('file');
    expect(sentAttachments[0].blob).toBe(file);
  });

  it('paste image: adds an image chip and preventDefault is called', async () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} onStop={vi.fn()} isStreaming={false} />);
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    const img = makeFile('pic.png', 'pngdata', 'image/png');
    const pasteEvt = await pasteAsync(input, [{ kind: 'file', type: 'image/png', file: img }]);

    expect(pasteEvt.defaultPrevented).toBe(true);
    expect(screen.getByText(/paste-\d+\.png/)).toBeTruthy();
    expect(createObjectURLMock).toHaveBeenCalled();
  });

  it('canSend: empty input + one attachment enables send; attachment-only send works', async () => {
    const onSend = vi.fn();
    const { container } = render(<ChatInput onSend={onSend} onStop={vi.fn()} isStreaming={false} />);
    const fileInput = getFileInput(container);
    const file = makeFile('data.json', '{}', 'application/json');
    await fireEvent.change(fileInput, { target: { files: [file] } });

    const sendBtn = screen.getByLabelText('发送') as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(false);

    await fireEvent.click(sendBtn);
    expect(onSend).toHaveBeenCalledTimes(1);
    // Empty text → onSend receives empty string + the attachment.
    expect(onSend.mock.calls[0][0]).toBe('');
    expect(onSend.mock.calls[0][1]).toHaveLength(1);
  });

  it('remove chip: clicking × removes the attachment and revokes its previewUrl', async () => {
    const onSend = vi.fn();
    const { container } = render(<ChatInput onSend={onSend} onStop={vi.fn()} isStreaming={false} />);
    const fileInput = getFileInput(container);
    const img = makeFile('pic.png', 'x', 'image/png');
    await fireEvent.change(fileInput, { target: { files: [img] } });
    expect(screen.getByText('pic.png')).toBeTruthy();

    await fireEvent.click(screen.getByLabelText('移除附件'));
    expect(screen.queryByText('pic.png')).toBeNull();
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock');
  });

  it('guardrail: oversize file is rejected and not added; rejectError is shown', async () => {
    const onSend = vi.fn();
    const { container } = render(<ChatInput onSend={onSend} onStop={vi.fn()} isStreaming={false} />);
    const fileInput = getFileInput(container);
    const big = makeFile('big.txt', 'x'.repeat(DEFAULT_MAX_BYTES + 1), 'text/plain');
    Object.defineProperty(big, 'size', { value: DEFAULT_MAX_BYTES + 1 });
    await fireEvent.change(fileInput, { target: { files: [big] } });

    expect(screen.queryByText('big.txt')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('big.txt');
    expect(screen.getByRole('alert').textContent).toMatch(/超过/);
  });

  it('guardrail: non-whitelist extension is rejected', async () => {
    const onSend = vi.fn();
    const { container } = render(<ChatInput onSend={onSend} onStop={vi.fn()} isStreaming={false} />);
    const fileInput = getFileInput(container);
    const bad = makeFile('malware.exe', 'MZ', 'application/x-msdownload');
    await fireEvent.change(fileInput, { target: { files: [bad] } });
    expect(screen.queryByText('malware.exe')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('不支持的文件类型');
  });

  it('after successful send: attachments are cleared (chips gone)', async () => {
    const onSend = vi.fn();
    const { container } = render(<ChatInput onSend={onSend} onStop={vi.fn()} isStreaming={false} />);
    const fileInput = getFileInput(container);
    const file = makeFile('note.md', 'hi', 'text/markdown');
    await fireEvent.change(fileInput, { target: { files: [file] } });
    expect(screen.getByText('note.md')).toBeTruthy();

    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'go' } });
    await fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    expect(onSend).toHaveBeenCalledTimes(1);
    // Chips cleared after send (ChatInput resets attachments on send).
    expect(screen.queryByText('note.md')).toBeNull();
  });

  it('send is disabled while streaming', () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} onStop={vi.fn()} isStreaming={true} />);
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'hello' } });
    // Streaming → stop button is shown instead of send; send is not rendered.
    expect(screen.queryByLabelText('发送')).toBeNull();
    expect(screen.getByLabelText('停止')).toBeTruthy();
  });
});

describe('ChatInput mode-linked selector', () => {
  it('icon-only trigger exposes the current mode via aria-label + tooltip', () => {
    aiState.inputMode = 'agent';
    render(<ChatInput onSend={vi.fn()} onStop={vi.fn()} isStreaming={false} />);
    const trigger = screen.getByLabelText('Agent');
    expect(trigger.title).toBe('Agent — agent mode');
  });

  it('Chat (rig) mode renders the model pair icon trigger, not the adapter selector', () => {
    aiState.inputMode = 'chat';
    render(<ChatInput onSend={vi.fn()} onStop={vi.fn()} isStreaming={false} />);
    // Real aiConfigStore has no enabled providers → icon-variant empty state.
    expect(screen.getByTestId('pair-selector-empty')).toBeTruthy();
  });

  it('Agent/Ask (CLI) modes do not render the model pair picker', () => {
    for (const mode of ['agent', 'ask']) {
      aiState.inputMode = mode;
      const { unmount } = render(<ChatInput onSend={vi.fn()} onStop={vi.fn()} isStreaming={false} />);
      expect(screen.queryByTestId('pair-selector')).toBeNull();
      expect(screen.queryByTestId('pair-selector-empty')).toBeNull();
      unmount();
    }
  });

  it('mode dropdown lists modes in Chat → Agent → Ask order', () => {
    aiState.inputMode = 'agent';
    const { container } = render(<ChatInput onSend={vi.fn()} onStop={vi.fn()} isStreaming={false} />);
    // open the mode menu (trigger title = "<label> — <description>")
    fireEvent.click(screen.getByTitle(/agent mode/));
    const panel = container.querySelector('[class*="bottom-full"]');
    const ids = Array.from(panel?.querySelectorAll('[data-mode]') ?? []).map((el) =>
      el.getAttribute('data-mode'),
    );
    expect(ids).toEqual(['chat', 'agent', 'ask']);
  });
});
