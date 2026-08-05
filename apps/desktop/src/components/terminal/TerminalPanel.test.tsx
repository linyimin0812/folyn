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
  useEditorViewStateStore.setState({ terminalPanelVisible: true });
  useTerminalStore.setState({ sessions: [], activeId: null });
});

describe('TerminalPanel (bottom)', () => {
  it('renders the drag-resize handle on top', () => {
    useTerminalStore.getState().addSession();
    const { container } = render(<TerminalPanel />);
    const handle = container.querySelector('.cursor-row-resize');
    expect(handle).toBeTruthy();
  });

  it('collapses via the header toggle when visible', () => {
    useTerminalStore.getState().addSession();
    render(<TerminalPanel />);
    const toggle = document.querySelector('button[title="收起到底部"]') as HTMLButtonElement;
    fireEvent.click(toggle);
    expect(useEditorViewStateStore.getState().terminalPanelVisible).toBe(false);
  });
});
