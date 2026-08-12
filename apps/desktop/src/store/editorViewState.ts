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

export interface VersionHistorySelection {
  /** Composite key (`${hash}-${ts}`) of the snapshot currently selected in the
   *  side panel. Composite (not bare hash) because content-addressable storage
   *  means the same hash can legitimately appear in multiple index entries
   *  (e.g. after a restore that re-snapshots identical content) — `ts` keeps
   *  the selection unique. When non-null AND `versionHistoryVisible` is true,
   *  WorkArea renders the snapshot content view in the editor area instead of
   *  the active editor (CodeMirror / custom). */
  selectedKey: string | null;
  /** Full snapshot content for the selected entry. `null` = not yet loaded or
   *  loading. Shown verbatim in the editor area — no diff, no on-disk read. */
  snapshotContent: string | null;
  /** Error surfaced while fetching the snapshot blob (fs read failure etc.). */
  snapshotError: string | null;
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
  /** Set the version-history selection (selected key + snapshot content +
   *  error). Pass `null` key to clear (panel close, restore success, tab
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
  versionHistorySelection: { selectedKey: null, snapshotContent: null, snapshotError: null },

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

  toggleVersionHistory: () => set((state) => ({ versionHistoryVisible: !state.versionHistoryVisible, versionHistorySelection: { selectedKey: null, snapshotContent: null, snapshotError: null } })),
  setVersionHistoryVisible: (v) => set({ versionHistoryVisible: v, versionHistorySelection: { selectedKey: null, snapshotContent: null, snapshotError: null } }),
  setVersionHistorySelection: (sel) => set({ versionHistorySelection: sel }),
}));
