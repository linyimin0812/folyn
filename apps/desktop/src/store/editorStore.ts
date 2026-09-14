import { create } from 'zustand';
import { useVaultStore } from './vaultStore';
import { usePrefsStore } from './prefsStore';
import { getHandlerByExtension, listProviders } from '@/components/file-types/registry';
import { isBinaryExtension, isExtensionRequired } from '@/components/file-types/binaryExtensions';
import { useFileTypePreferenceStore } from './fileTypePreferenceStore';
import { persistOpenTabs, flushPersistOpenTabs, flushPersistExternalOpenTabs } from './editorPersistence';
import { scheduleAutoSave } from './editorAutoSave';
import { saveFile as saveFileIo } from '@/services/editorIoService';
import { useEditorPrefsStore } from './editorPrefsStore';
import type { ActivityPanel } from '@/components/shell/ActivityBar';
import type { ViewMode } from '@/components/file-types/types';
export type { ViewMode };

export type FileType = string;

export function detectFileType(filePath: string): FileType {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  // User preference (Open With, §53) overrides the priority default — but
  // only if the preferred provider still claims this extension.
  const preferred = useFileTypePreferenceStore.getState().getPreferredProvider(ext);
  if (preferred && listProviders(ext).some((p) => p.id === preferred)) {
    return preferred;
  }
  const handler = getHandlerByExtension(ext);
  if (handler) return handler.id;
  // No app builtin or installed extension claims this extension. A known
  // non-text format (binary) → unsupported preview-only (don't dump binary
  // bytes as text); a text format that needs a dedicated viewer (e.g. .dbml
  // without its extension) → unsupported-text (plain-text edit + notice);
  // anything else → the generic code/text editor.
  if (isBinaryExtension(ext)) return 'unsupported';
  if (isExtensionRequired(ext)) return 'unsupported-text';
  return 'code';
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
  /** Saved cursor line (1-based) for this tab */
  cursorLine?: number;
  /** Saved cursor column (1-based) for this tab */
  cursorCol?: number;
  /** Saved view mode for this tab (restored on tab switch) */
  viewMode?: ViewMode;
}

/** Determine which activity panel a tab belongs to based on its path and file type */
export function detectActivity(filePath: string, _fileType: FileType): ActivityPanel {
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

  /** Open a web URL in a new tab */
  openWebTab: (url: string, title?: string) => void;
  /** Rewrite open tab paths after a directory rename (e.g. legacy prefix → managed prefix) */
  rewriteTabPrefixes: (mapping: { from: string; to: string }[]) => void;
}

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
          let newViewMode = state.viewMode;
          if (state.activeTabId === tabId) {
            // Prefer a tab from the same activity panel
            const sameActivityTab = closedTab
              ? newTabs.find((t) => t.activity === closedTab.activity)
              : undefined;
            const nextActive = sameActivityTab ?? newTabs[newTabs.length - 1] ?? null;
            newActiveId = nextActive?.id ?? null;
            // ponytail: reconcile viewMode to the new active tab's saved mode,
            // otherwise the closed tab's mode leaks into the new active tab's
            // UI (mirrors setActiveTab's per-tab restoration).
            if (nextActive?.viewMode) newViewMode = nextActive.viewMode;
          }
          return { tabs: newTabs, activeTabId: newActiveId, viewMode: newViewMode };
        });
        // Flush immediately (no debounce): a debounced write would be lost if
        // the app quits right after closing, restoring the closed tab on the
        // next launch. Flush both vault and external (vault-independent) tabs.
        const vaultId = useVaultStore.getState().activeVaultId;
        const { tabs, activeTabId } = get();
        if (vaultId) flushPersistOpenTabs(vaultId, tabs, activeTabId);
        flushPersistExternalOpenTabs('ext', tabs, activeTabId);
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
        // Persist web tabs so they reappear in the open-files tab bar on the
        // next launch (same path as file tabs).
        const vaultId = useVaultStore.getState().activeVaultId;
        if (vaultId) persistOpenTabs(vaultId, get().tabs, newTab.id);
      },

      rewriteTabPrefixes: (mapping) => {
        if (mapping.length === 0) return;
        set((state) => {
          const rewritten = state.tabs.map((tab) => {
            if (tab.fileType === 'web') return tab;
            for (const { from, to } of mapping) {
              if (tab.path === from || tab.path.startsWith(`${from}/`)) {
                const suffix = tab.path === from ? '' : tab.path.slice(from.length);
                const newPath = `${to}${suffix}`;
                const newName = newPath.includes('/') ? newPath.substring(newPath.lastIndexOf('/') + 1) : newPath;
                return { ...tab, path: newPath, name: newName };
              }
            }
            return tab;
          });
          return { tabs: rewritten };
        });
      },
    }),
);
