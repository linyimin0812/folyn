import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorViewStateStore } from './editorViewState';
import { useEditorStore } from './editorStore';

beforeEach(() => {
  useEditorViewStateStore.setState({
    cursorLine: 1,
    cursorCol: 1,
    wordCount: 0,
    outlineVisible: false,
    aiPanelVisible: false,
  });
  useEditorStore.setState({ tabs: [], activeTabId: null });
});

describe('useEditorViewStateStore', () => {
  it('defaults match old editorStore (1/1/0/false/false)', () => {
    const s = useEditorViewStateStore.getState();
    expect(s.cursorLine).toBe(1);
    expect(s.cursorCol).toBe(1);
    expect(s.wordCount).toBe(0);
    expect(s.outlineVisible).toBe(false);
    expect(s.aiPanelVisible).toBe(false);
  });

  it('setWordCount updates wordCount', () => {
    useEditorViewStateStore.getState().setWordCount(42);
    expect(useEditorViewStateStore.getState().wordCount).toBe(42);
  });

  it('toggleOutline flips outlineVisible', () => {
    useEditorViewStateStore.getState().toggleOutline();
    expect(useEditorViewStateStore.getState().outlineVisible).toBe(true);
    useEditorViewStateStore.getState().toggleOutline();
    expect(useEditorViewStateStore.getState().outlineVisible).toBe(false);
  });

  it('toggleAiPanel flips aiPanelVisible', () => {
    useEditorViewStateStore.getState().toggleAiPanel();
    expect(useEditorViewStateStore.getState().aiPanelVisible).toBe(true);
  });

  it('openTerminalDock shows the terminal tab and keeps AI available', () => {
    useEditorViewStateStore.getState().openTerminalDock();
    const s = useEditorViewStateStore.getState();
    expect(s.terminalPanelVisible).toBe(true);
    expect(s.rightDockTab).toBe('terminal');
    expect(s.aiPanelVisible).toBe(false);
  });

  it('setRightDockTab surfaces the target panel', () => {
    useEditorViewStateStore.getState().openTerminalDock();
    useEditorViewStateStore.getState().setRightDockTab('ai');
    const s = useEditorViewStateStore.getState();
    expect(s.rightDockTab).toBe('ai');
    expect(s.aiPanelVisible).toBe(true);
    expect(s.terminalPanelVisible).toBe(true);
  });

  it('closeRightDock hides only the active tab', () => {
    useEditorViewStateStore.getState().openTerminalDock();
    useEditorViewStateStore.getState().closeRightDock();
    expect(useEditorViewStateStore.getState().terminalPanelVisible).toBe(false);
    useEditorViewStateStore.getState().closeRightDock();
    expect(useEditorViewStateStore.getState().aiPanelVisible).toBe(false);
  });

  it('closing the AI tab while terminal is open falls back to the terminal tab', () => {
    useEditorViewStateStore.getState().openTerminalDock();
    useEditorViewStateStore.getState().setRightDockTab('ai');
    useEditorViewStateStore.getState().closeRightDock();
    const s = useEditorViewStateStore.getState();
    expect(s.aiPanelVisible).toBe(false);
    expect(s.rightDockTab).toBe('terminal');
    expect(s.terminalPanelVisible).toBe(true);
  });

  it('setCursorPosition updates cursor fields and writes the active tab cursor', () => {
    useEditorStore.setState({
      tabs: [
        { id: 't1', name: 'a.md', path: 'a.md', content: '', isDirty: false, fileType: 'markdown', activity: 'files' },
        { id: 't2', name: 'b.md', path: 'b.md', content: '', isDirty: false, fileType: 'markdown', activity: 'files' },
      ],
      activeTabId: 't1',
    });

    useEditorViewStateStore.getState().setCursorPosition(7, 3);

    expect(useEditorViewStateStore.getState().cursorLine).toBe(7);
    expect(useEditorViewStateStore.getState().cursorCol).toBe(3);

    const tabs = useEditorStore.getState().tabs;
    expect(tabs[0].cursorLine).toBe(7);
    expect(tabs[0].cursorCol).toBe(3);
    expect(tabs[1].cursorLine).toBeUndefined();
  });

  it('setCursorPosition is a no-op on tabs when no active tab', () => {
    useEditorStore.setState({ tabs: [], activeTabId: null });
    useEditorViewStateStore.getState().setCursorPosition(5, 2);
    expect(useEditorViewStateStore.getState().cursorLine).toBe(5);
    expect(useEditorViewStateStore.getState().cursorCol).toBe(2);
    expect(useEditorStore.getState().tabs).toEqual([]);
  });
});
