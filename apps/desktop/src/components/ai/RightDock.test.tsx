import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { RightDock } from './RightDock';
import { useEditorViewStateStore } from '@/store/editorViewState';
import { useTerminalStore } from '@/store/terminalStore';

// Avoid mounting xterm (needs canvas) — the terminal body is irrelevant here.
vi.mock('@/components/terminal/TerminalView', () => ({
  TerminalView: () => <div data-testid="term-view" />,
}));
// Avoid mounting the real AI panel (SiriGL canvas / chat scroll effects are
// jsdom-hostile); the dock layout is what we're asserting.
vi.mock('@/components/ai/AiPanel', () => ({
  AiPanel: () => <div data-testid="ai-panel" />,
}));

beforeEach(() => {
  useEditorViewStateStore.setState({ aiPanelVisible: false, terminalPanelVisible: true });
  useTerminalStore.setState({ sessions: [], activeId: null });
});

describe('RightDock', () => {
  it('keeps the terminal column mounted (hidden) after collapse so content survives', () => {
    useTerminalStore.getState().addSession();
    useEditorViewStateStore.getState().closeTerminalPanel();

    const { container, rerender } = render(<RightDock />);

    // Dock is invisible when nothing is shown, but the terminal column stays
    // in the DOM (display:none) so xterm scrollback / the PTY survive.
    const hiddenCol = Array.from(container.querySelectorAll('div')).find(
      (d) => (d as HTMLElement).style.display === 'none',
    );
    expect(hiddenCol).toBeTruthy();

    // Reopening makes the same column visible again with the session intact.
    useEditorViewStateStore.getState().openTerminalDock();
    rerender(<RightDock />);
    expect(container.querySelector('[data-testid="term-view"]')).toBeTruthy();
  });

  it('renders AI and terminal as two separate columns when both are open', () => {
    useTerminalStore.getState().addSession();
    useEditorViewStateStore.getState().toggleAiPanel();
    const { container } = render(<RightDock />);
    const columns = Array.from(container.querySelectorAll('.border-l')).filter(
      (el) => el.parentElement?.className.includes('items-stretch'),
    );
    expect(columns.length).toBe(2);
  });
});
