import { create } from 'zustand';
import { useVaultStore } from './vaultStore';
import { usePrefsStore } from './prefsStore';
import { storageClient } from '@/utils/storageClient';
import { getHandlerByExtension } from '@/components/file-types/registry';
import { WIKI_PREFIX } from '@/types/wiki';
import { persistOpenTabs } from './editorPersistence';
import { scheduleAutoSave } from './editorAutoSave';
import { saveFile as saveFileIo } from '@/services/editorIoService';
import { useEditorPrefsStore } from './editorPrefsStore';
import { wikiProvider } from '@/services/wikiProvider';
import type { ActivityPanel } from '@/components/shell/ActivityBar';

export type ViewMode = 'split' | 'edit' | 'preview' | 'visual' | 'source';

export type FileType = string;

export function detectFileType(filePath: string): FileType {
  // Detect clip files by path prefix
  if (filePath.startsWith('__clips__/') && filePath.endsWith('.md')) {
    return 'clip';
  }
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const handler = getHandlerByExtension(ext);
  return handler?.id ?? 'code';
}

export interface FileTab {
  id: string;
  name: string;
  path: string;
  content: string;
  isDirty: boolean;
  fileType: FileType;
  /** Which activity panel this tab belongs to */
  activity: ActivityPanel;
  /** Original clip file path (set when web tab was opened from a clip card) */
  clipPath?: string;
  /** Saved cursor line (1-based) for this tab */
  cursorLine?: number;
  /** Saved cursor column (1-based) for this tab */
  cursorCol?: number;
  /** Saved view mode for this tab (restored on tab switch) */
  viewMode?: ViewMode;
}

/** Determine which activity panel a tab belongs to based on its path and file type */
export function detectActivity(filePath: string, fileType: FileType): ActivityPanel {
  if (filePath === 'wiki-graph') return 'wiki';
  if (fileType === 'clip' || filePath.startsWith('__clips__/')) return 'clips';
  if (filePath.startsWith(WIKI_PREFIX)) return 'wiki';
  if (filePath.startsWith('__reports__/')) return 'analyze';

  // Check daily notes directory
  const dailyDir = usePrefsStore.getState().dailyNotesDir || '__daily__';
  if (filePath.startsWith(`${dailyDir}/`)) return 'calendar';

  return 'files';
}

interface EditorState {
  /** Currently active view mode */
  viewMode: ViewMode;
  /** Currently active activity panel */
  activePanel: ActivityPanel;
  /** List of open file tabs */
  tabs: FileTab[];
  /** ID of the currently active tab */
  activeTabId: string | null;
  /** Whether a file is currently being loaded */
  isFileLoading: boolean;

  // Actions
  setViewMode: (mode: ViewMode) => void;
  setActivePanel: (panel: ActivityPanel) => void;
  addTab: (tab: FileTab) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTabContent: (tabId: string, content: string) => void;
  markTabDirty: (tabId: string, isDirty: boolean) => void;

  /** Update a web tab's URL and title after in-page navigation */
  updateWebTabUrl: (tabId: string, url: string, title: string) => void;
  /** Open a web URL in a new tab */
  openWebTab: (url: string, title?: string) => void;
  /** Open a web URL from a clip card (converts clip tab to web tab, adds back-to-clip button) */
  openWebFromClip: (tabId: string, url: string, clipPath: string, title?: string) => void;
  /** Convert a web tab back to its original clip card */
  backToClip: (tabId: string) => Promise<void>;
  /** Rewrite open tab paths after a directory rename (e.g. clips/ → __clips__/) */
  rewriteTabPrefixes: (mapping: { from: string; to: string }[]) => void;
}

const EDITOR_STORAGE_KEY = 'editor:viewMode';

export const useEditorStore = create<EditorState>()(
    (set, get) => ({
      viewMode: 'split',
      activePanel: 'files' as ActivityPanel,
      tabs: [],
      activeTabId: null,
      isFileLoading: false,

      setViewMode: (mode) => {
        const activeTabId = get().activeTabId;
        set((state) => ({
          viewMode: mode,
          tabs: activeTabId
            ? state.tabs.map((t) =>
                t.id === activeTabId ? { ...t, viewMode: mode } : t,
              )
            : state.tabs,
        }));
        storageClient.set(EDITOR_STORAGE_KEY, mode);
      },

      setActivePanel: (panel) => {
        set((state) => {
          // Find the first tab belonging to the new activity panel
          const firstTabOfPanel = state.tabs.find((t) => t.activity === panel);
          return {
            activePanel: panel,
            activeTabId: firstTabOfPanel?.id ?? null,
          };
        });
      },

      addTab: (tab) =>
        set((state) => {
          // Auto-detect activity if not already set on the tab
          const tabWithActivity = tab.activity ? tab : { ...tab, activity: detectActivity(tab.path, tab.fileType) };
          return {
            tabs: [...state.tabs, tabWithActivity],
            activeTabId: tabWithActivity.id,
          };
        }),

      closeTab: (tabId) => {
        set((state) => {
          const closedTab = state.tabs.find((t) => t.id === tabId);
          const newTabs = state.tabs.filter((t) => t.id !== tabId);
          let newActiveId = state.activeTabId;
          if (state.activeTabId === tabId) {
            // Prefer a tab from the same activity panel
            const sameActivityTab = closedTab
              ? newTabs.find((t) => t.activity === closedTab.activity)
              : undefined;
            newActiveId = sameActivityTab?.id ?? newTabs[newTabs.length - 1]?.id ?? null;
          }
          return { tabs: newTabs, activeTabId: newActiveId };
        });
        const vaultId = useVaultStore.getState().activeVaultId;
        if (vaultId) persistOpenTabs(vaultId, get().tabs, get().activeTabId);
      },

      setActiveTab: (tabId) => {
        const tab = get().tabs.find((t) => t.id === tabId);
        set({
          activeTabId: tabId,
          ...(tab?.viewMode ? { viewMode: tab.viewMode } : {}),
        });
        const vaultId = useVaultStore.getState().activeVaultId;
        if (vaultId) persistOpenTabs(vaultId, get().tabs, tabId);
      },

      updateTabContent: (tabId, content) => {
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId ? { ...t, content, isDirty: true } : t,
          ),
        }));

        // Debounced auto-save — ponytail: saveFile lives in editorIoService;
        // route the debounced save through it. ESM live binding resolves
        // the editorStore↔editorIoService cycle at call time, not eval time.
        if (useEditorPrefsStore.getState().autoSave) {
          scheduleAutoSave(tabId, (id) => saveFileIo(id));
        }
      },

      markTabDirty: (tabId, isDirty) =>
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId ? { ...t, isDirty } : t,
          ),
        })),

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
          activity: 'files',
        };
        set((state) => ({
          tabs: [...state.tabs, newTab],
          activeTabId: newTab.id,
        }));
      },

      openWebFromClip: (tabId, url, clipPath, title) => {
        const displayName = title || (() => { try { return new URL(url).hostname; } catch { return url; } })();
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === tabId
              ? { ...tab, path: url, name: displayName, content: '', fileType: 'web' as FileType, isDirty: false, clipPath, activity: 'clips' as ActivityPanel }
              : tab,
          ),
        }));
      },

      backToClip: async (tabId) => {
        const tab = get().tabs.find((t) => t.id === tabId);
        if (!tab?.clipPath) return;
        const clipPath = tab.clipPath;
        const fileName = clipPath.split('/').pop() || clipPath;
        // Read clip file content
        let content = '';
        try {
          if (clipPath.startsWith(WIKI_PREFIX)) {
            content = await wikiProvider.readFile(clipPath.slice(WIKI_PREFIX.length));
          } else {
            content = await useVaultStore.getState().readFile(clipPath);
          }
        } catch (err) {
          console.error('[EditorStore] backToClip: failed to read clip file:', err);
        }
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId
              ? { ...t, path: clipPath, name: fileName, content, fileType: 'clip' as FileType, isDirty: false, clipPath: undefined, activity: 'clips' as ActivityPanel }
              : t,
          ),
        }));
      },

      rewriteTabPrefixes: (mapping) => {
        if (mapping.length === 0) return;
        set((state) => {
          const rewritten = state.tabs.map((tab) => {
            if (tab.fileType === 'web' || tab.path.startsWith(WIKI_PREFIX)) return tab;
            for (const { from, to } of mapping) {
              if (tab.path === from || tab.path.startsWith(`${from}/`)) {
                const suffix = tab.path === from ? '' : tab.path.slice(from.length);
                return { ...tab, path: `${to}${suffix}` };
              }
            }
            return tab;
          });
          return { tabs: rewritten };
        });
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
