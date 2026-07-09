import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

afterEach(() => { cleanup(); });
beforeEach(() => { cleanup(); });

import { ChatInputBox } from './ChatInputBox';

describe('ChatInputBox', () => {
  it('Enter (no shift) calls onSend; Shift+Enter does not', () => {
    const onSend = vi.fn();
    render(<ChatInputBox value="hi" onChange={() => {}} onSend={onSend} streaming={false} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: false });
    expect(onSend).toHaveBeenCalledTimes(1);
    onSend.mockClear();
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('onBeforeKeyDown returning true prevents onSend', () => {
    const onSend = vi.fn();
    const onBefore = vi.fn(() => true);
    render(<ChatInputBox value="hi" onChange={() => {}} onSend={onSend} streaming={false} onBeforeKeyDown={onBefore} />);
    const ta = screen.getByRole('textbox');
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: false });
    expect(onBefore).toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('onBeforeKeyDown returning false (or omitted) still sends on Enter', () => {
    const onSend = vi.fn();
    const onBefore = vi.fn(() => false);
    render(<ChatInputBox value="hi" onChange={() => {}} onSend={onSend} streaming={false} onBeforeKeyDown={onBefore} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', shiftKey: false });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('send button is disabled when disabled prop is true', () => {
    const onSend = vi.fn();
    render(<ChatInputBox value="hi" onChange={() => {}} onSend={onSend} streaming={false} disabled />);
    const sendBtn = screen.getByLabelText('发送') as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
    fireEvent.click(sendBtn);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('send button is disabled when value is empty/whitespace', () => {
    const onSend = vi.fn();
    render(<ChatInputBox value="   " onChange={() => {}} onSend={onSend} streaming={false} />);
    const sendBtn = screen.getByLabelText('发送') as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);
  });

  it('stop button renders (and send does not) when streaming && onStop provided', () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    render(<ChatInputBox value="" onChange={() => {}} onSend={onSend} streaming onStop={onStop} />);
    expect(screen.getByLabelText('停止')).toBeTruthy();
    expect(screen.queryByLabelText('发送')).toBeNull();
    fireEvent.click(screen.getByLabelText('停止'));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('slots render when provided, absent when not', () => {
    const { rerender } = render(
      <ChatInputBox
        value=""
        onChange={() => {}}
        onSend={() => {}}
        streaming={false}
        leadingSlot={<span data-testid="lead">L</span>}
        attachmentsRow={<div data-testid="att">A</div>}
        overlayLayer={<div data-testid="ov">O</div>}
        trailingSlot={<span data-testid="trail">T</span>}
      />,
    );
    expect(screen.getByTestId('lead')).toBeTruthy();
    expect(screen.getByTestId('att')).toBeTruthy();
    expect(screen.getByTestId('ov')).toBeTruthy();
    expect(screen.getByTestId('trail')).toBeTruthy();

    rerender(<ChatInputBox value="" onChange={() => {}} onSend={() => {}} streaming={false} />);
    expect(screen.queryByTestId('lead')).toBeNull();
    expect(screen.queryByTestId('att')).toBeNull();
    expect(screen.queryByTestId('ov')).toBeNull();
    expect(screen.queryByTestId('trail')).toBeNull();
  });

  it('onClear button renders when provided and is disabled while streaming', () => {
    const onClear = vi.fn();
    const { rerender } = render(<ChatInputBox value="" onChange={() => {}} onSend={() => {}} streaming={false} onClear={onClear} />);
    const btn = screen.getByText('清空') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(onClear).toHaveBeenCalledTimes(1);
    rerender(<ChatInputBox value="" onChange={() => {}} onSend={() => {}} streaming onClear={onClear} />);
    const btn2 = screen.getByText('清空') as HTMLButtonElement;
    expect(btn2.disabled).toBe(true);
  });

  it('textarea is disabled while streaming', () => {
    render(<ChatInputBox value="x" onChange={() => {}} onSend={() => {}} streaming />);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true);
  });

  it('passes placeholder, rows, aria-label through', () => {
    render(<ChatInputBox value="" onChange={() => {}} onSend={() => {}} streaming={false} placeholder="say something" textareaRows={4} inputAriaLabel="my chat" />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(ta.placeholder).toBe('say something');
    expect(ta.rows).toBe(4);
    expect(ta.getAttribute('aria-label')).toBe('my chat');
  });
});
