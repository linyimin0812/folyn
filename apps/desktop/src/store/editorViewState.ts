import { create } from 'zustand';
import { useEditorStore } from './editorStore';

/**
 * Editor view-state split out of the legacy editorStore god-store (PR1).
 *
 * Owns cursor position, word count, and outline/AI-panel visibility — the
 * per-keystroke view state that is conceptually editor-local but written from
 * multiple components (EditorView writes cursor/wordCount; GlobalSearchPanel
 * jumps cursor), so it can't live in component-local `useState`.
 *
 * Runtime-only — NOT persisted.
 *
 * Consumers (EditorView, GlobalSearchPanel, Topbar, StatusBar, …) read/write
 * these fields directly here. Behavior is identical to the old editorStore
 * fields they replaced.
 */

interface EditorViewState {
  cursorLine: number;
  cursorCol: number;
  wordCount: number;
  outlineVisible: boolean;
  aiPanelVisible: boolean;
  /** Right-dock terminal panel visibility (independent of the AI panel). */
  terminalPanelVisible: boolean;

  setCursorPosition: (line: number, col: number) => void;
  setWordCount: (count: number) => void;
  toggleOutline: () => void;
  toggleAiPanel: () => void;
  /** Show the terminal panel (used by "+ 新建终端"). */
  openTerminalDock: () => void;
  /** Hide the terminal panel. */
  closeTerminalPanel: () => void;
}

export const useEditorViewStateStore = create<EditorViewState>((set) => ({
  cursorLine: 1,
  cursorCol: 1,
  wordCount: 0,
  outlineVisible: false,
  aiPanelVisible: false,
  terminalPanelVisible: false,

  setCursorPosition: (line, col) => {
    // ponytail: cursor is also persisted onto the active tab so it survives tab
    // switches. The tab still lives in editorStore (PR2 keeps tabs there), so we
    // delegate the tab write. Equivalent to old editorStore.setCursorPosition,
    // just split across stores — the cursor fields move here, the tab-shaped
    // write stays on editorStore until PR2 reconciles.
    const activeTabId = useEditorStore.getState().activeTabId;
    set({ cursorLine: line, cursorCol: col });
    if (activeTabId) {
      useEditorStore.setState((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === activeTabId ? { ...t, cursorLine: line, cursorCol: col } : t,
        ),
      }));
    }
  },

  setWordCount: (count) => set({ wordCount: count }),

  toggleOutline: () => set((state) => ({ outlineVisible: !state.outlineVisible })),
  toggleAiPanel: () => set((state) => ({ aiPanelVisible: !state.aiPanelVisible })),

  openTerminalDock: () => set({ terminalPanelVisible: true }),

  closeTerminalPanel: () => set({ terminalPanelVisible: false }),
}));
