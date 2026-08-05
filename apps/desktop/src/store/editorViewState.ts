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
  /** Which tab the right dock is showing when both are open. */
  rightDockTab: 'ai' | 'terminal';

  setCursorPosition: (line: number, col: number) => void;
  setWordCount: (count: number) => void;
  toggleOutline: () => void;
  toggleAiPanel: () => void;
  /** Open the dock on the terminal tab (used by "+ 新建终端"). */
  openTerminalDock: () => void;
  /** Switch the dock tab; ensures the target panel becomes visible. */
  setRightDockTab: (tab: 'ai' | 'terminal') => void;
  /** Close the currently active dock tab (hides the dock when both are off). */
  closeRightDock: () => void;
}

export const useEditorViewStateStore = create<EditorViewState>((set) => ({
  cursorLine: 1,
  cursorCol: 1,
  wordCount: 0,
  outlineVisible: false,
  aiPanelVisible: false,
  terminalPanelVisible: false,
  rightDockTab: 'ai' as const,

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
  toggleAiPanel: () =>
    set((state) => ({
      aiPanelVisible: !state.aiPanelVisible,
      // Opening the AI panel always surfaces its tab; closing it leaves the
      // dock on the terminal tab if the user was there.
      rightDockTab: state.aiPanelVisible ? state.rightDockTab : 'ai',
    })),

  openTerminalDock: () =>
    set((state) => ({
      terminalPanelVisible: true,
      rightDockTab: 'terminal',
      // Keep the AI panel open in the background so switching back is one click.
      aiPanelVisible: state.aiPanelVisible,
    })),

  setRightDockTab: (tab) =>
    set((state) => ({
      rightDockTab: tab,
      aiPanelVisible: tab === 'ai' ? true : state.aiPanelVisible,
      terminalPanelVisible: tab === 'terminal' ? true : state.terminalPanelVisible,
    })),

  closeRightDock: () =>
    set((state) => {
      if (state.rightDockTab === 'terminal') {
        return { terminalPanelVisible: false };
      }
      // Closing the AI tab while the terminal is still open falls back to it,
      // so the dock never shows a hidden panel.
      return {
        aiPanelVisible: false,
        rightDockTab: state.terminalPanelVisible ? 'terminal' : 'ai',
      };
    }),
}));
