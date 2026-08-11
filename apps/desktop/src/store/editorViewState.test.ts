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
    terminalPanelVisible: false,
    terminalInRightDock: false,
    terminalRightWidth: 300,
    versionHistoryVisible: false,
    versionHistorySelection: { selectedKey: null, diffLines: null, diffError: null },
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
    expect(s.terminalPanelVisible).toBe(false);
    expect(s.terminalInRightDock).toBe(false);
    expect(s.terminalRightWidth).toBe(300);
    expect(s.versionHistoryVisible).toBe(false);
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

  it('openTerminalDock shows the terminal panel and keeps AI available', () => {
    useEditorViewStateStore.getState().openTerminalDock();
    const s = useEditorViewStateStore.getState();
    expect(s.terminalPanelVisible).toBe(true);
    expect(s.aiPanelVisible).toBe(false);
  });

  it('openTerminalDock keeps the AI panel visible when it was already open', () => {
    useEditorViewStateStore.getState().toggleAiPanel();
    useEditorViewStateStore.getState().openTerminalDock();
    const s = useEditorViewStateStore.getState();
    expect(s.aiPanelVisible).toBe(true);
    expect(s.terminalPanelVisible).toBe(true);
  });

  it('showTerminalInRightDock moves the terminal to the right dock', () => {
    useEditorViewStateStore.getState().openTerminalDock();
    useEditorViewStateStore.getState().showTerminalInRightDock();
    const s = useEditorViewStateStore.getState();
    expect(s.terminalPanelVisible).toBe(false);
    expect(s.terminalInRightDock).toBe(true);
  });

  it('setTerminalRightWidth updates the right dock width', () => {
    useEditorViewStateStore.getState().setTerminalRightWidth(420);
    expect(useEditorViewStateStore.getState().terminalRightWidth).toBe(420);
  });

  it('closeTerminalPanel hides only the terminal panel', () => {
    useEditorViewStateStore.getState().showTerminalInRightDock();
    useEditorViewStateStore.getState().closeTerminalPanel();
    expect(useEditorViewStateStore.getState().terminalPanelVisible).toBe(false);
    expect(useEditorViewStateStore.getState().terminalInRightDock).toBe(false);
    expect(useEditorViewStateStore.getState().aiPanelVisible).toBe(false);
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

  it('toggleVersionHistory flips versionHistoryVisible', () => {
    useEditorViewStateStore.getState().toggleVersionHistory();
    expect(useEditorViewStateStore.getState().versionHistoryVisible).toBe(true);
    useEditorViewStateStore.getState().toggleVersionHistory();
    expect(useEditorViewStateStore.getState().versionHistoryVisible).toBe(false);
  });

  it('setVersionHistoryVisible sets an explicit value', () => {
    useEditorViewStateStore.getState().setVersionHistoryVisible(true);
    expect(useEditorViewStateStore.getState().versionHistoryVisible).toBe(true);
    useEditorViewStateStore.getState().setVersionHistoryVisible(false);
    expect(useEditorViewStateStore.getState().versionHistoryVisible).toBe(false);
  });

  it('defaults versionHistorySelection to empty (no selected key, no diff)', () => {
    const s = useEditorViewStateStore.getState().versionHistorySelection;
    expect(s.selectedKey).toBeNull();
    expect(s.diffLines).toBeNull();
    expect(s.diffError).toBeNull();
  });

  it('setVersionHistorySelection writes the selection payload', () => {
    const lines = [{ text: 'x', kind: 'context' as const }];
    useEditorViewStateStore.getState().setVersionHistorySelection({
      selectedKey: 'abc',
      diffLines: lines,
      diffError: null,
    });
    const s = useEditorViewStateStore.getState().versionHistorySelection;
    expect(s.selectedKey).toBe('abc');
    expect(s.diffLines).toBe(lines);
    expect(s.diffError).toBeNull();
  });

  it('setVersionHistoryVisible clears the selection when hiding', () => {
    useEditorViewStateStore.getState().setVersionHistorySelection({
      selectedKey: 'abc',
      diffLines: [{ text: 'x', kind: 'context' }],
      diffError: null,
    });
    useEditorViewStateStore.getState().setVersionHistoryVisible(false);
    const s = useEditorViewStateStore.getState().versionHistorySelection;
    expect(s.selectedKey).toBeNull();
    expect(s.diffLines).toBeNull();
  });

  it('toggleVersionHistory clears the selection when toggling off', () => {
    useEditorViewStateStore.getState().setVersionHistoryVisible(true);
    useEditorViewStateStore.getState().setVersionHistorySelection({
      selectedKey: 'abc',
      diffLines: [{ text: 'x', kind: 'context' }],
      diffError: null,
    });
    useEditorViewStateStore.getState().toggleVersionHistory();
    expect(useEditorViewStateStore.getState().versionHistoryVisible).toBe(false);
    expect(useEditorViewStateStore.getState().versionHistorySelection.selectedKey).toBeNull();
  });
});
