import { create } from 'zustand';
import { useVaultStore } from './vaultStore';
import { storageClient } from '@/utils/storageClient';

/** Debounced auto-save timers per tab */
const autoSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const AUTO_SAVE_DELAY_MS = 1000;

export type ViewMode = 'split' | 'edit' | 'preview';

export type FileType = 'text' | 'image' | 'pdf' | 'code' | 'web';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']);
const PDF_EXTENSIONS = new Set(['pdf']);
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx']);

export function detectFileType(filePath: string): FileType {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (PDF_EXTENSIONS.has(ext)) return 'pdf';
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'text';
  return 'code';
}

export interface FileTab {
  id: string;
  name: string;
  path: string;
  content: string;
  isDirty: boolean;
  fileType: FileType;
  /** Saved cursor line (1-based) for this tab */
  cursorLine?: number;
  /** Saved cursor column (1-based) for this tab */
  cursorCol?: number;
}

interface EditorState {
  /** Currently active view mode */
  viewMode: ViewMode;
  /** List of open file tabs */
  tabs: FileTab[];
  /** ID of the currently active tab */
  activeTabId: string | null;
  /** Whether the outline panel is visible */
  outlineVisible: boolean;
  /** Whether the AI panel is visible */
  aiPanelVisible: boolean;
  /** Current cursor position */
  cursorLine: number;
  cursorCol: number;
  /** Word count of current document */
  wordCount: number;
  /** Whether a file is currently being loaded */
  isFileLoading: boolean;

  // Actions
  setViewMode: (mode: ViewMode) => void;
  addTab: (tab: FileTab) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTabContent: (tabId: string, content: string) => void;
  markTabDirty: (tabId: string, isDirty: boolean) => void;
  toggleOutline: () => void;
  toggleAiPanel: () => void;
  setCursorPosition: (line: number, col: number) => void;
  setWordCount: (count: number) => void;

  /** Update a web tab's URL and title after in-page navigation */
  updateWebTabUrl: (tabId: string, url: string, title: string) => void;
  /** Open a web URL in a new tab */
  openWebTab: (url: string, title?: string) => void;
  /** Open a file from the vault (reads content via VaultStore) */
  openFile: (path: string, name: string) => Promise<void>;
  /** Save the active tab's content to the vault */
  saveFile: (tabId: string) => Promise<void>;
  /** Restore previously open tabs for the current vault */
  restoreOpenTabs: () => Promise<void>;
}

const EDITOR_STORAGE_KEY = 'editor:viewMode';

/** Storage key for open tabs, scoped by vault ID */
function openTabsStorageKey(vaultId: string): string {
  return `editor:openTabs:${vaultId}`;
}

interface PersistedTabInfo {
  path: string;
  name: string;
  fileType?: FileType;
  cursorLine?: number;
  cursorCol?: number;
}

interface PersistedOpenTabs {
  tabs: PersistedTabInfo[];
  activeTabPath: string | null;
}

/** Persist currently open tabs to storage (debounced) */
let persistTabsTimer: ReturnType<typeof setTimeout> | null = null;
function persistOpenTabs(vaultId: string, tabs: FileTab[], activeTabId: string | null) {
  if (persistTabsTimer) clearTimeout(persistTabsTimer);
  persistTabsTimer = setTimeout(() => {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    const data: PersistedOpenTabs = {
      tabs: tabs.map((t) => ({ path: t.path, name: t.name, fileType: t.fileType, cursorLine: t.cursorLine, cursorCol: t.cursorCol })),
      activeTabPath: activeTab?.path ?? null,
    };
    storageClient.set(openTabsStorageKey(vaultId), data);
  }, 500);
}

export const useEditorStore = create<EditorState>()(
    (set, get) => ({
      viewMode: 'split',
      tabs: [],
      activeTabId: null,
      outlineVisible: false,
      aiPanelVisible: false,
      cursorLine: 1,
      cursorCol: 1,
      wordCount: 0,
      isFileLoading: false,

      setViewMode: (mode) => {
        set({ viewMode: mode });
        storageClient.set(EDITOR_STORAGE_KEY, mode);
      },

      addTab: (tab) =>
        set((state) => ({
          tabs: [...state.tabs, tab],
          activeTabId: tab.id,
        })),

      closeTab: (tabId) => {
        set((state) => {
          const newTabs = state.tabs.filter((t) => t.id !== tabId);
          const newActiveId =
            state.activeTabId === tabId
              ? newTabs[newTabs.length - 1]?.id ?? null
              : state.activeTabId;
          return { tabs: newTabs, activeTabId: newActiveId };
        });
        const vaultId = useVaultStore.getState().activeVaultId;
        if (vaultId) persistOpenTabs(vaultId, get().tabs, get().activeTabId);
      },

      setActiveTab: (tabId) => {
        set({ activeTabId: tabId });
        const vaultId = useVaultStore.getState().activeVaultId;
        if (vaultId) persistOpenTabs(vaultId, get().tabs, tabId);
      },

      updateTabContent: (tabId, content) => {
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId ? { ...t, content, isDirty: true } : t,
          ),
        }));

        // Debounced auto-save
        const existing = autoSaveTimers.get(tabId);
        if (existing) clearTimeout(existing);
        autoSaveTimers.set(
          tabId,
          setTimeout(() => {
            autoSaveTimers.delete(tabId);
            get().saveFile(tabId);
          }, AUTO_SAVE_DELAY_MS),
        );
      },

      markTabDirty: (tabId, isDirty) =>
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId ? { ...t, isDirty } : t,
          ),
        })),

      toggleOutline: () => set((state) => ({ outlineVisible: !state.outlineVisible })),
      toggleAiPanel: () => set((state) => ({ aiPanelVisible: !state.aiPanelVisible })),
      setCursorPosition: (line, col) => {
        const activeTabId = get().activeTabId;
        set((state) => ({
          cursorLine: line,
          cursorCol: col,
          tabs: activeTabId
            ? state.tabs.map((t) =>
                t.id === activeTabId ? { ...t, cursorLine: line, cursorCol: col } : t,
              )
            : state.tabs,
        }));
      },
      setWordCount: (count) => set({ wordCount: count }),

      updateWebTabUrl: (tabId, url, title) => {
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === tabId ? { ...tab, path: url, name: title || tab.name } : tab,
          ),
        }));
      },

      openWebTab: (url, title) => {
        const tabId = `web:${url}`;
        const existing = get().tabs.find((t) => t.id === tabId);
        if (existing) {
          set({ activeTabId: existing.id });
          return;
        }
        const displayName = title || (() => { try { return new URL(url).hostname; } catch { return url; } })();
        const newTab: FileTab = {
          id: tabId,
          name: displayName,
          path: url,
          content: '',
          isDirty: false,
          fileType: 'web',
        };
        set((state) => ({
          tabs: [...state.tabs, newTab],
          activeTabId: newTab.id,
        }));
      },

      openFile: async (filePath, name) => {
        // Include vault id in tab id to distinguish same-name files across vaults
        const vaultId = useVaultStore.getState().activeVaultId || '';
        const tabId = `${vaultId}:${filePath}`;

        const existing = get().tabs.find((t) => t.id === tabId);
        if (existing) {
          set({ activeTabId: existing.id });
          return;
        }
        set({ isFileLoading: true });
        try {
          const fileType = detectFileType(filePath);
          const content = (fileType === 'text' || fileType === 'code') ? await useVaultStore.getState().readFile(filePath) : '';
          const newTab: FileTab = {
            id: tabId,
            name,
            path: filePath,
            content,
            isDirty: false,
            fileType,
          };
          set((state) => ({
            tabs: [...state.tabs, newTab],
            activeTabId: newTab.id,
          }));
          persistOpenTabs(vaultId, get().tabs, get().activeTabId);
        } catch (err) {
          console.error('[EditorStore] openFile failed:', err);
        } finally {
          set({ isFileLoading: false });
        }
      },

      restoreOpenTabs: async () => {
        const vaultId = useVaultStore.getState().activeVaultId;
        if (!vaultId) return;
        const saved = await storageClient.get<PersistedOpenTabs>(openTabsStorageKey(vaultId));
        if (!saved || saved.tabs.length === 0) return;

        for (const tabInfo of saved.tabs) {
          const isWebTab = tabInfo.fileType === 'web'
            || tabInfo.path.startsWith('http://') || tabInfo.path.startsWith('https://');

          if (isWebTab) {
            // Restore web tab — use openWebTab logic
            const webTabId = `web:${tabInfo.path}`;
            const alreadyOpen = get().tabs.find((t) => t.id === webTabId);
            if (alreadyOpen) continue;
            const newTab: FileTab = {
              id: webTabId,
              name: tabInfo.name,
              path: tabInfo.path,
              content: '',
              isDirty: false,
              fileType: 'web',
            };
            set((state) => ({
              tabs: [...state.tabs, newTab],
            }));
          } else {
            // Restore file tab
            const tabId = `${vaultId}:${tabInfo.path}`;
            const alreadyOpen = get().tabs.find((t) => t.id === tabId);
            if (alreadyOpen) continue;
            try {
              const fileType = detectFileType(tabInfo.path);
              const content = (fileType === 'text' || fileType === 'code') ? await useVaultStore.getState().readFile(tabInfo.path) : '';
              const newTab: FileTab = {
                id: tabId,
                name: tabInfo.name,
                path: tabInfo.path,
                content,
                isDirty: false,
                fileType,
                cursorLine: tabInfo.cursorLine,
                cursorCol: tabInfo.cursorCol,
              };
              set((state) => ({
                tabs: [...state.tabs, newTab],
              }));
            } catch {
              // File may have been deleted since last session, skip
            }
          }
        }

        // Restore active tab
        if (saved.activeTabPath) {
          // Try both file-tab and web-tab id formats
          const fileActiveId = `${vaultId}:${saved.activeTabPath}`;
          const webActiveId = `web:${saved.activeTabPath}`;
          const exists = get().tabs.find((t) => t.id === fileActiveId || t.id === webActiveId);
          if (exists) {
            set({ activeTabId: exists.id });
          }
        } else if (get().tabs.length > 0 && !get().activeTabId) {
          set({ activeTabId: get().tabs[0].id });
        }
      },

      saveFile: async (tabId) => {
        const tab = get().tabs.find((t) => t.id === tabId);
        if (!tab) return;
        try {
          await useVaultStore.getState().writeFile(tab.path, tab.content);
          set((state) => ({
            tabs: state.tabs.map((t) =>
              t.id === tabId ? { ...t, isDirty: false } : t,
            ),
          }));
        } catch (err) {
          console.error('[EditorStore] saveFile failed:', err);
        }
      },
    }),
);

/** Load persisted viewMode from backend on startup */
const VALID_VIEW_MODES: ViewMode[] = ['split', 'edit', 'preview'];
storageClient.get<string>(EDITOR_STORAGE_KEY).then((saved) => {
  if (saved && VALID_VIEW_MODES.includes(saved as ViewMode)) {
    useEditorStore.setState({ viewMode: saved as ViewMode });
  }
});
