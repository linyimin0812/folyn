import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { TerminalPanel } from './TerminalPanel';
import { useEditorViewStateStore } from '@/store/editorViewState';
import { useTerminalStore } from '@/store/terminalStore';

// Avoid mounting xterm (needs canvas) — the panel layout is what we test.
vi.mock('@/components/terminal/TerminalView', () => ({
  TerminalView: () => <div data-testid="term-view" />,
}));

beforeEach(() => {
  useEditorViewStateStore.setState({ terminalPanelVisible: true, terminalInRightDock: false });
  useTerminalStore.setState({ sessions: [], activeId: null });
});

describe('TerminalPanel (bottom)', () => {
  it('renders the session tab row with an add button', () => {
    useTerminalStore.getState().addSession();
    const { container } = render(<TerminalPanel />);
    expect(container.querySelector('div.font-mono')).toBeTruthy();
    expect(container.querySelector('button[title="新建终端"]')).toBeTruthy();
  });

  it('moves the terminal to the right dock via the columns toggle', () => {
    useTerminalStore.getState().addSession();
    render(<TerminalPanel />);
    const toggle = document.querySelector('button[title="在右侧栏显示终端"]') as HTMLButtonElement;
    fireEvent.click(toggle);
    expect(useEditorViewStateStore.getState().terminalPanelVisible).toBe(false);
    expect(useEditorViewStateStore.getState().terminalInRightDock).toBe(true);
  });
});
