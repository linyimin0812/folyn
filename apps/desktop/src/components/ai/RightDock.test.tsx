import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { RightDock } from './RightDock';
import { useEditorViewStateStore } from '@/store/editorViewState';

// Avoid mounting the real AI panel (SiriGL canvas / chat scroll effects are
// jsdom-hostile); the dock layout is what we're asserting.
vi.mock('@/components/ai/AiPanel', () => ({
  AiPanel: () => <div data-testid="ai-panel" />,
}));

beforeEach(() => {
  useEditorViewStateStore.setState({ aiPanelVisible: false });
});

describe('RightDock', () => {
  it('renders nothing when the AI panel is hidden', () => {
    const { container } = render(<RightDock />);
    expect(container.querySelector('[data-testid="ai-panel"]')).toBeNull();
  });

  it('renders the AI column when visible', () => {
    useEditorViewStateStore.getState().toggleAiPanel();
    const { container } = render(<RightDock />);
    expect(container.querySelector('[data-testid="ai-panel"]')).toBeTruthy();
  });
});
