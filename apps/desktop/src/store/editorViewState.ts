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
  /** Fraction (0..1) of the cursor within the editor scroll viewport. */
  cursorViewportY: number;
  /** Top of the editor scroll viewport in screen coords (for preview alignment). */
  editorViewportTop: number;
  /** Rendered height of the editor line at the cursor (px). Used to center
   *  preview blocks on the cursor LINE center, not just its top — coordsAtPos
   *  gives the line top, so half of this offsets to the line center. */
  editorLineHeight: number;
  /** Vertical fraction (0..1) of the cursor within its soft-wrapped source
   *  line (0 = first visual line, 1 = last). Lets the preview track the
   *  cursor down a wrapped single-line paragraph. ≈0 when the line isn't
   *  wrapped (cursor stays on the only visual line). */
  cursorLineFrac: number;
  /** Cursor's measured Y (px) below the top of the first line of its
   *  containing markdown BLOCK (syntax-tree anchored — the same block the
   *  preview's cursor-sync targets; NOT a blank-line run, which
   *  mis-anchors paragraphs directly after code fences/lists/blockquotes).
   *  Includes the soft-wrap rows of every earlier line — the exact
   *  editor-side anchor for pinning the preview's block tops. 0 = on the
   *  block's first line, blank cursor line, or unknown. */
  cursorBlockOffsetY: number;
  /** True when the editor has an active (non-empty) text selection.
   *  Previews skip cursor-sync while the user is selecting. */
  hasSelection: boolean;
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

  /** Focus mode: hides the top bar, activity bar, left sidebar, right AI
   *  dock, terminal, and status bar so only the editor/preview area remains.
   *  Toggled via Cmd/Ctrl+Shift+F or the Topbar button. Runtime-only. */
  focusMode: boolean;

  setCursorPosition: (line: number, col: number) => void;
  /** Persist the editor scroll top onto the active tab (survives tab
   *  switches + disk persistence). Throttled at the call site. */
  setEditorScrollTop: (top: number) => void;
  /** Persist the editor scroll top onto a specific tab. Used by the
   *  debounced scroll-persistence path: the debounce captures the
   *  activeTabId at schedule time so a flush after a tab switch writes
   *  to the tab the user was actually scrolling, not the new active one
   *  (the trailing-edge race that lost scroll position on tab return). */
  setEditorScrollTopForTab: (tabId: string, top: number) => void;
  /** Persist the preview scroll top onto the active tab (survives tab
   *  switches + disk persistence). Throttled at the call site. */
  setPreviewScrollTop: (top: number) => void;
  setWordCount: (count: number) => void;
  setCursorViewportY: (y: number, viewportTop: number, cursorCol: number, lineHeight: number, lineFrac: number, blockOffsetY: number) => void;
  setHasSelection: (v: boolean) => void;
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
  /** Toggle focus mode on/off. */
  toggleFocusMode: () => void;
  /** Set focus mode explicitly (used to force-exit when leaving the editor page). */
  setFocusMode: (v: boolean) => void;
}

export const useEditorViewStateStore = create<EditorViewState>((set) => ({
  cursorLine: 1,
  cursorCol: 1,
  wordCount: 0,
  cursorViewportY: 0,
  editorViewportTop: 0,
  editorLineHeight: 0,
  cursorLineFrac: 0,
  cursorBlockOffsetY: 0,
  hasSelection: false,
  outlineVisible: false,
  aiPanelVisible: false,
  terminalPanelVisible: false,
  terminalInRightDock: false,
  terminalRightWidth: 300,
  versionHistoryVisible: false,
  versionHistorySelection: { selectedKey: null, snapshotContent: null, snapshotError: null },
  focusMode: false,

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

  setEditorScrollTop: (top) => {
    // ponytail: mirror setCursorPosition — persist scrollTop onto the active
    // tab so the exact viewport (not just cursorLine's scrollIntoView center)
    // survives tab switches + restart. Throttled by the FolynEditor caller.
    const activeTabId = useEditorStore.getState().activeTabId;
    if (activeTabId) {
      useEditorStore.setState((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === activeTabId ? { ...t, editorScrollTop: top } : t,
        ),
      }));
    }
  },

  setEditorScrollTopForTab: (tabId, top) => {
    // ponytail: write scrollTop to a SPECIFIC tab, not the current
    // activeTabId. The debounced scroll-persistence caller captures
    // activeTabId at schedule time and passes it here on flush, so a tab
    // switch between schedule and flush no longer diverts the old tab's
    // scrollTop onto the new tab (the trailing-edge debounce race that left
    // the old tab's editorScrollTop stale → wrong viewport on return).
    useEditorStore.setState((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, editorScrollTop: top } : t,
      ),
    }));
  },

  setPreviewScrollTop: (top) => {
    // ponytail: persist the preview pane scrollTop onto the active tab so
    // switching files resumes each file's exact preview position, not the
    // previous file's. Throttled by the PreviewPane caller.
    const activeTabId = useEditorStore.getState().activeTabId;
    if (activeTabId) {
      useEditorStore.setState((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === activeTabId ? { ...t, previewScrollTop: top } : t,
        ),
      }));
    }
  },

  setWordCount: (count) => set({ wordCount: count }),
  setCursorViewportY: (y, viewportTop, cursorCol, lineHeight, lineFrac, blockOffsetY) => set({ cursorViewportY: y, editorViewportTop: viewportTop, cursorCol, editorLineHeight: lineHeight, cursorLineFrac: lineFrac, cursorBlockOffsetY: blockOffsetY }),
  setHasSelection: (v) => set({ hasSelection: v }),

  toggleOutline: () => set((state) => ({ outlineVisible: !state.outlineVisible })),
  toggleAiPanel: () => set((state) => ({ aiPanelVisible: !state.aiPanelVisible })),

  openTerminalDock: () => set({ terminalPanelVisible: true, terminalInRightDock: false }),

  showTerminalInRightDock: () => set({ terminalPanelVisible: false, terminalInRightDock: true }),

  setTerminalRightWidth: (width) => set({ terminalRightWidth: width }),

  closeTerminalPanel: () => set({ terminalPanelVisible: false, terminalInRightDock: false }),

  toggleVersionHistory: () => set((state) => ({ versionHistoryVisible: !state.versionHistoryVisible, versionHistorySelection: { selectedKey: null, snapshotContent: null, snapshotError: null } })),
  setVersionHistoryVisible: (v) => set({ versionHistoryVisible: v, versionHistorySelection: { selectedKey: null, snapshotContent: null, snapshotError: null } }),
  setVersionHistorySelection: (sel) => set({ versionHistorySelection: sel }),

  toggleFocusMode: () => set((state) => ({ focusMode: !state.focusMode })),
  setFocusMode: (v) => set({ focusMode: v }),
}));
