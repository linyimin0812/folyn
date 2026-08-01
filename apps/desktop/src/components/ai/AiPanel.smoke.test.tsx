if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() { /* no-op */ };
}

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { useEditorViewStateStore } from '@/store/editorViewState';
import { AiPanel } from './AiPanel';

afterEach(() => {
  cleanup();
  useEditorViewStateStore.setState({ aiPanelVisible: false });
});

describe('AiPanel smoke', () => {
  it('renders nothing when aiPanelVisible is false', () => {
    const { container } = render(<AiPanel />);
    expect(container.innerHTML).toBe('');
  });

  it('renders the panel when aiPanelVisible flips to true', () => {
    useEditorViewStateStore.setState({ aiPanelVisible: true });
    render(<AiPanel />);
    // session-title button (✦ 新会话) should be present
    expect(screen.getByText(/新会话/).textContent).toContain('新会话');
  });

  it('unmounts again when aiPanelVisible flips back to false', () => {
    useEditorViewStateStore.setState({ aiPanelVisible: true });
    const { container } = render(<AiPanel />);
    expect(container.innerHTML).not.toBe('');
    fireEvent.click(screen.getByTitle('关闭'));
    expect(useEditorViewStateStore.getState().aiPanelVisible).toBe(false);
  });
});

describe('AiPanel with real session data', () => {
  it('renders a session with user/assistant messages, pair tag, thinking', async () => {
    const { useAiStore } = await import('@/store/aiStore');
    const sid = useAiStore.getState().createSession();
    useAiStore.getState().addMessage('user', '帮我总结这个文件\n第二行', sid);
    useAiStore.getState().addMessage('assistant', '好的，这是总结。', sid, undefined, 'anthropic', 'claude-sonnet-4');
    useAiStore.getState().appendThinking('先读取文件…', sid);
    useEditorViewStateStore.setState({ aiPanelVisible: true });
    render(<AiPanel />);
    expect(screen.getAllByText(/帮我总结这个文件/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/好的，这是总结/)).toBeTruthy();
    expect(screen.getByText('Thinking')).toBeTruthy();
    expect(screen.getByTestId('msg-pair-tag')).toBeTruthy();
  });
});
