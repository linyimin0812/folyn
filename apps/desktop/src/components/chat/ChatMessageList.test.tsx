import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// Mock useTranslation — return keys verbatim so tests can grep for them.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() { /* no-op */ };
}

// Mock the clipboard plugin so the CopyButton's dynamic import resolves to
// the test stub (same alias as vitest.workspace.ts).
const writeTextMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: writeTextMock,
}));

import { ChatMessageList } from './ChatMessageList';
import type { CliMessage } from '@quill/cli-adapter';

function mkMsg(partial: Partial<CliMessage>): CliMessage {
  return {
    id: partial.id ?? 'm1',
    role: partial.role ?? 'assistant',
    content: partial.content ?? '',
    timestamp: partial.timestamp ?? 0,
    ...partial,
  } as CliMessage;
}

beforeEach(() => {
  cleanup();
  writeTextMock.mockClear();
  writeTextMock.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); });

describe('ChatMessageList', () => {
  it('renders the default empty-state hint when messages is empty', () => {
    render(<ChatMessageList messages={[]} streaming={false} />);
    expect(screen.getByText('ai:panel.emptyState.title')).toBeTruthy();
  });

  it('renders a custom emptyState when provided', () => {
    render(<ChatMessageList messages={[]} streaming={false} emptyState={<div>no messages yet</div>} />);
    expect(screen.getByText('no messages yet')).toBeTruthy();
  });

  it('renders messages (user + assistant)', () => {
    const messages: CliMessage[] = [
      mkMsg({ id: 'u1', role: 'user', content: 'hello there' }),
      mkMsg({ id: 'a1', role: 'assistant', content: 'hi back' }),
    ];
    render(<ChatMessageList messages={messages} streaming={false} />);
    expect(screen.getByText('hello there')).toBeTruthy();
    expect(screen.getByText('hi back')).toBeTruthy();
  });

  it('exposes an auto-scroll sentinel (the end-of-list div)', () => {
    const { container } = render(<ChatMessageList messages={[]} streaming={false} />);
    // role="log" container exists
    expect(container.querySelector('[role="log"]')).toBeTruthy();
  });

  it('streamingIndicator="dots" renders the 3-dot block when streaming', () => {
    const messages: CliMessage[] = [mkMsg({ id: 'a1', role: 'assistant', content: 'thinking...' })];
    const { container } = render(<ChatMessageList messages={messages} streaming streamingIndicator="dots" />);
    expect(container.querySelector('.ai-streaming-indicator')).toBeTruthy();
    expect(container.querySelector('.ai-streaming-dots')).toBeTruthy();
    expect(screen.getByText('AI 正在处理...')).toBeTruthy();
  });

  it('streamingIndicator="dots" does NOT render the block when not streaming', () => {
    const messages: CliMessage[] = [mkMsg({ id: 'a1', role: 'assistant', content: 'done' })];
    const { container } = render(<ChatMessageList messages={messages} streaming={false} streamingIndicator="dots" />);
    expect(container.querySelector('.ai-streaming-indicator')).toBeNull();
  });

  it('streamingIndicator="cursor" renders a per-bubble cursor on the last assistant msg and NO list-level dots', () => {
    const messages: CliMessage[] = [
      mkMsg({ id: 'a1', role: 'assistant', content: 'first' }),
      mkMsg({ id: 'a2', role: 'assistant', content: 'second' }),
    ];
    const { container } = render(<ChatMessageList messages={messages} streaming streamingIndicator="cursor" />);
    expect(container.querySelector('.ai-streaming-indicator')).toBeNull();
    // exactly one cursor-blink span (on the last assistant msg only)
    expect(container.querySelectorAll('.cursor-blink').length).toBe(1);
  });

  it('streamingIndicator="none" renders neither dots nor per-bubble cursor', () => {
    const messages: CliMessage[] = [mkMsg({ id: 'a1', role: 'assistant', content: 'x' })];
    const { container } = render(<ChatMessageList messages={messages} streaming streamingIndicator="none" />);
    expect(container.querySelector('.ai-streaming-indicator')).toBeNull();
    expect(container.querySelectorAll('.cursor-blink').length).toBe(0);
  });

  it('streamingIndicator="dots" also shows the per-bubble cursor on the last assistant msg', () => {
    const messages: CliMessage[] = [mkMsg({ id: 'a1', role: 'assistant', content: 'x' })];
    const { container } = render(<ChatMessageList messages={messages} streaming streamingIndicator="dots" />);
    expect(container.querySelectorAll('.cursor-blink').length).toBe(1);
  });

  it('showCopy renders a copy button on assistant-with-content, NOT on user/empty', () => {
    const messages: CliMessage[] = [
      mkMsg({ id: 'u1', role: 'user', content: 'hi' }),
      mkMsg({ id: 'a-empty', role: 'assistant', content: '' }),
      mkMsg({ id: 'a1', role: 'assistant', content: 'copy me' }),
    ];
    render(<ChatMessageList messages={messages} streaming={false} showCopy />);
    // only the assistant-with-content bubble has a 复制 button
    expect(screen.getAllByLabelText('复制').length).toBe(1);
  });

  it('clicking the copy button writes the message content to the clipboard', async () => {
    const messages: CliMessage[] = [mkMsg({ id: 'a1', role: 'assistant', content: 'copy me please' })];
    render(<ChatMessageList messages={messages} streaming={false} showCopy />);
    await fireEvent.click(screen.getByLabelText('复制'));
    await vi.waitFor(() => expect(writeTextMock).toHaveBeenCalledWith('copy me please'));
    expect(screen.getByLabelText('已复制')).toBeTruthy();
  });

  it('onCopy callback, when provided, is called instead of the clipboard', async () => {
    const onCopy = vi.fn();
    const messages: CliMessage[] = [mkMsg({ id: 'a1', role: 'assistant', content: 'cb' })];
    render(<ChatMessageList messages={messages} streaming={false} showCopy onCopy={onCopy} />);
    await fireEvent.click(screen.getByLabelText('复制'));
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onCreateMockArg(onCopy, 0)?.id).toBe('a1');
    // clipboard NOT touched when onCopy is supplied
    expect(writeTextMock).not.toHaveBeenCalled();
  });

  it('onClear renders the clear button only when messages exist', () => {
    const onClear = vi.fn();
    const { rerender } = render(<ChatMessageList messages={[]} streaming={false} onClear={onClear} />);
    expect(screen.queryByText('清空对话')).toBeNull();
    const messages: CliMessage[] = [mkMsg({ id: 'a1', role: 'assistant', content: 'x' })];
    rerender(<ChatMessageList messages={messages} streaming={false} onClear={onClear} />);
    expect(screen.getByText('清空对话')).toBeTruthy();
  });

  it('clear button is disabled while streaming', () => {
    const onClear = vi.fn();
    const messages: CliMessage[] = [mkMsg({ id: 'a1', role: 'assistant', content: 'x' })];
    render(<ChatMessageList messages={messages} streaming onClear={onClear} />);
    const btn = screen.getByText('清空对话') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('onSaveToWiki renders the wiki button on assistant-with-content', () => {
    const onSaveToWiki = vi.fn();
    const messages: CliMessage[] = [
      mkMsg({ id: 'u1', role: 'user', content: 'hi' }),
      mkMsg({ id: 'a1', role: 'assistant', content: 'wiki me' }),
    ];
    render(<ChatMessageList messages={messages} streaming={false} onSaveToWiki={onSaveToWiki} />);
    const btn = screen.getByText('保存到 Wiki');
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(onSaveToWiki).toHaveBeenCalledTimes(1);
    expect(onCreateMockArg(onSaveToWiki, 0)?.id).toBe('a1');
  });

  it('renderMessage, when provided, replaces the default row', () => {
    const messages: CliMessage[] = [mkMsg({ id: 'a1', role: 'assistant', content: 'orig' })];
    render(
      <ChatMessageList
        messages={messages}
        streaming={false}
        renderMessage={(msg) => <div data-testid="custom">{msg.content}-custom</div>}
      />,
    );
    expect(screen.getByTestId('custom').textContent).toBe('orig-custom');
    // default bubble NOT rendered
    expect(screen.queryByText('orig')).toBeNull();
  });

  // PR4: per-message pair tag on AI responses — rendered inline after "AI".
  it('renderPairTag renders the tag under assistant messages that carry provider+model', () => {
    const messages: CliMessage[] = [
      mkMsg({ id: 'u1', role: 'user', content: 'hi', provider: 'openai', model: 'gpt-4o' }),
      mkMsg({ id: 'a1', role: 'assistant', content: 'reply', provider: 'openai', model: 'gpt-4o' }),
    ];
    render(
      <ChatMessageList
        messages={messages}
        streaming={false}
        renderPairTag={(m) => <span>{m.provider} : {m.model}</span>}
      />,
    );
    const tags = screen.getAllByTestId('msg-pair-tag');
    expect(tags).toHaveLength(1); // only the assistant bubble
    // inline label, right-aligned: "AI openai : gpt-4o"
    expect(tags[0].textContent).toBe('openai : gpt-4o');
  });

  it('renderPairTag is not rendered when the message has no provider/model (legacy)', () => {
    const messages: CliMessage[] = [mkMsg({ id: 'a1', role: 'assistant', content: 'legacy reply' })];
    render(
      <ChatMessageList
        messages={messages}
        streaming={false}
        renderPairTag={(m) => <span>{m.provider} : {m.model}</span>}
      />,
    );
    expect(screen.queryByTestId('msg-pair-tag')).toBeNull();
  });

  it('renderPairTag is not rendered when the prop is omitted (pet/bubble path)', () => {
    const messages: CliMessage[] = [mkMsg({ id: 'a1', role: 'assistant', content: 'reply', provider: 'openai', model: 'gpt-4o' })];
    render(<ChatMessageList messages={messages} streaming={false} />);
    expect(screen.queryByTestId('msg-pair-tag')).toBeNull();
  });
});

/** Tiny helper: pull the first call's first argument off a vi.fn (avoids the
 * `unknown` cast noise inline). */
function onCreateMockArg(fn: ReturnType<typeof vi.fn>, index: number): CliMessage | undefined {
  return fn.mock.calls[index]?.[0] as CliMessage | undefined;
}
