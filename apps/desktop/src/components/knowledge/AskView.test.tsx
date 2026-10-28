// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  state: {
    askRunning: false,
    askPhase: '',
    askQuestion: 'What changed?',
    askTurns: [] as { question: string; answer: string; evidence: { kind: 'source' | 'topic'; path: string; title?: string; startLine?: number; endLine?: number; versionHash?: string; text: string }[]; note?: string }[],
    setAskQuestion: vi.fn(),
    ask: vi.fn(),
    cancelAskRequested: vi.fn(),
    clearAsk: vi.fn(),
    setPage: vi.fn(),
  },
  openFile: vi.fn(),
}));
vi.mock('@/store/knowledgeStore', () => ({ useKnowledgeStore: (selector: (s: typeof mocks.state) => unknown) => selector(mocks.state) }));
vi.mock('@/store/editorStore', () => ({ useEditorStore: { getState: () => ({ setActivePanel: vi.fn() }) } }));
vi.mock('@/services/editorIoService', () => ({ openFile: mocks.openFile }));
import { AskView } from './AskView';

beforeEach(() => { mocks.state.ask.mockClear(); mocks.state.cancelAskRequested.mockClear(); mocks.state.clearAsk.mockClear(); mocks.state.setPage.mockClear(); mocks.openFile.mockClear(); mocks.state.askRunning = false; });
afterEach(cleanup);
describe('AskView', () => {
  it('uses the shared Markdown pipeline for readable answer structure', () => {
    mocks.state.askTurns = [{ question: 'What changed?', answer: '## Findings\n\n**Supported** by sources.', evidence: [] }];
    render(<AskView />);
    expect(screen.getByRole('heading', { name: 'Findings' })).toBeTruthy();
    expect(screen.getByText('Supported').tagName).toBe('STRONG');
    mocks.state.askTurns = [];
  });
  it('renders the conversation turn by turn with per-turn evidence access', () => {
    mocks.state.askTurns = [
      { question: 'First question', answer: 'First answer', evidence: [] },
      { question: 'Second question', answer: '## Second answer', evidence: [{ kind: 'source', path: 'notes/a.md', title: 'a.md', startLine: 3, endLine: 9, text: 'excerpt text' }] },
    ];
    render(<AskView />);
    expect(screen.getByText('First question')).toBeTruthy();
    expect(screen.getByText('Second question')).toBeTruthy();
    expect(screen.getByText('First answer')).toBeTruthy();
    expect(screen.queryByText('excerpt text')).toBeNull(); // 证据默认收起
    fireEvent.click(screen.getByRole('button', { name: /来源依据（1）/ }));
    expect(screen.getByText('excerpt text')).toBeTruthy();
    fireEvent.click(screen.getByTitle('在编辑器中打开：notes/a.md'));
    expect(mocks.openFile).toHaveBeenCalledWith('notes/a.md', 'a.md');
    mocks.state.askTurns = [];
  });
  it('clears the whole conversation from the header action', () => {
    mocks.state.askTurns = [{ question: 'Q', answer: 'A', evidence: [] }];
    render(<AskView />);
    fireEvent.click(screen.getByRole('button', { name: /清空会话/ }));
    expect(mocks.state.clearAsk).toHaveBeenCalledTimes(1);
    mocks.state.askTurns = [];
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
