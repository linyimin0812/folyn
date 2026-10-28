// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ state: { askRunning: false, askPhase: '', askQuestion: 'What changed?', askAnswer: '## Findings\n\n**Supported** by sources.', askEvidence: [], askNote: '', setAskQuestion: vi.fn(), ask: vi.fn(), cancelAskRequested: vi.fn(), setPage: vi.fn() } }));
vi.mock('@/store/knowledgeStore', () => ({ useKnowledgeStore: (selector: (s: typeof mocks.state) => unknown) => selector(mocks.state) }));
vi.mock('@/store/editorStore', () => ({ useEditorStore: { getState: () => ({ setActivePanel: vi.fn() }) } }));
vi.mock('@/services/editorIoService', () => ({ openFile: vi.fn() }));
import { AskView } from './AskView';

beforeEach(() => { mocks.state.ask.mockClear(); mocks.state.askRunning = false; });
afterEach(cleanup);
describe('AskView', () => {
  it('uses the shared Markdown pipeline for readable answer structure', () => {
    render(<AskView />);
    expect(screen.getByRole('heading', { name: 'Findings' })).toBeTruthy();
    expect(screen.getByText('Supported').tagName).toBe('STRONG');
  });
  it('submits Enter while preserving IME confirmation and multiline input', () => {
    render(<AskView />);
    const input = screen.getByRole('textbox', { name: '问题' });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(mocks.state.ask).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mocks.state.ask).toHaveBeenCalledTimes(1);
  });
  it('does not submit another question while retrieval is running', () => {
    mocks.state.askRunning = true;
    render(<AskView />);
    fireEvent.keyDown(screen.getByRole('textbox', { name: '问题' }), { key: 'Enter' });
    expect(mocks.state.ask).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /停止/ }));
    expect(mocks.state.cancelAskRequested).toHaveBeenCalled();
  });
});
