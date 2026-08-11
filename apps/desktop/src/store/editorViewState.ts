import { create } from 'zustand';
import { useEditorStore } from './editorStore';
import type { DiffLine } from '@/components/work-area/versionHistoryDiff';

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

export interface VersionHistorySelection {
  /** Hash of the snapshot currently selected in the side panel. When non-null
   *  AND `versionHistoryVisible` is true, WorkArea renders the diff view in
   *  the editor area instead of the active editor (CodeMirror / custom). */
  selectedHash: string | null;
  /** Parsed unified-diff lines for the selected snapshot vs current on-disk
   *  content. `null` = not yet computed or loading. Empty array = identical. */
  diffLines: DiffLine[] | null;
  /** Error surfaced while computing the diff (fs read failure etc.). */
  diffError: string | null;
}

interface EditorViewState {
  cursorLine: number;
  cursorCol: number;
  wordCount: number;
  outlineVisible: boolean;
  aiPanelVisible: boolean;
  /** Right-dock terminal panel visibility (independent of the AI panel). */
  terminalPanelVisible: boolean;
  /** Right-dock terminal panel visibility (mutually exclusive with bottom dock). */
  terminalInRightDock: boolean;
  terminalRightWidth: number;
  /** Version-history side-panel visibility (PR3). Toggled from the Topbar
   *  History button; the panel itself lives in WorkArea. */
  versionHistoryVisible: boolean;
  /** Selected snapshot + diff state for the version-history panel. Lifted to
   *  the store (PR4) so WorkArea can render the diff view in the editor area
   *  without prop-drilling through the panel. */
  versionHistorySelection: VersionHistorySelection;

  setCursorPosition: (line: number, col: number) => void;
  setWordCount: (count: number) => void;
  toggleOutline: () => void;
  toggleAiPanel: () => void;
  /** Show the terminal panel in the bottom dock (used by the Topbar terminal icon). */
  openTerminalDock: () => void;
  /** Show the terminal panel in the right dock. */
  showTerminalInRightDock: () => void;
  /** Set the right-dock terminal column width. */
  setTerminalRightWidth: (width: number) => void;
  /** Hide the terminal panel. */
  closeTerminalPanel: () => void;
  /** Toggle the version-history side panel. */
  toggleVersionHistory: () => void;
  /** Set version-history panel visibility (used to force-close on tab switch). */
  setVersionHistoryVisible: (v: boolean) => void;
  /** Set the version-history selection (selected hash + parsed diff lines +
   *  error). Pass `null` hash to clear (panel close, restore success, tab
   *  switch). */
  setVersionHistorySelection: (sel: VersionHistorySelection) => void;
}

export const useEditorViewStateStore = create<EditorViewState>((set) => ({
  cursorLine: 1,
  cursorCol: 1,
  wordCount: 0,
  outlineVisible: false,
  aiPanelVisible: false,
  terminalPanelVisible: false,
  terminalInRightDock: false,
  terminalRightWidth: 300,
  versionHistoryVisible: false,
  versionHistorySelection: { selectedHash: null, diffLines: null, diffError: null },

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

  openTerminalDock: () => set({ terminalPanelVisible: true, terminalInRightDock: false }),

  showTerminalInRightDock: () => set({ terminalPanelVisible: false, terminalInRightDock: true }),

  setTerminalRightWidth: (width) => set({ terminalRightWidth: width }),

  closeTerminalPanel: () => set({ terminalPanelVisible: false, terminalInRightDock: false }),

  toggleVersionHistory: () => set((state) => ({ versionHistoryVisible: !state.versionHistoryVisible, versionHistorySelection: { selectedHash: null, diffLines: null, diffError: null } })),
  setVersionHistoryVisible: (v) => set({ versionHistoryVisible: v, versionHistorySelection: { selectedHash: null, diffLines: null, diffError: null } }),
  setVersionHistorySelection: (sel) => set({ versionHistorySelection: sel }),
}));
