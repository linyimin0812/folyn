import { create } from 'zustand';
import { useVaultStore } from './vaultStore';
import { useSettingsStore } from './settingsStore';
import { storageClient } from '@/utils/storageClient';
import { getHandlerByExtension, getHandlerById } from '@/components/file-types/registry';
import { suppressWatcherFor } from '@/utils/fileWatcher';
import { wikiProvider } from '@/services/wikiProvider';
import { WIKI_PREFIX } from '@/types/wiki';
import { scheduleAutoSave, flushAllAutoSaves } from './editorAutoSave';
import { persistOpenTabs, flushPersistOpenTabs, loadPersistedOpenTabs } from './editorPersistence';
import type { ActivityPanel } from '@/components/shell/ActivityBar';

function formatDailyDate(date: Date, format: string): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return format
    .replace('YYYY', String(y))
    .replace('MM', m)
    .replace('DD', d);
}

export type ViewMode = 'split' | 'edit' | 'preview';

export type FileType = string;

export function detectFileType(filePath: string): FileType {
  // Detect clip files by path prefix
  if (filePath.startsWith('clips/') && filePath.endsWith('.md')) {
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
  if (fileType === 'clip' || filePath.startsWith('clips/')) return 'clips';
  if (filePath.startsWith(WIKI_PREFIX)) return 'wiki';
  if (filePath.startsWith('reports/')) return 'analyze';

  // Check daily notes directory
  const dailyDir = useSettingsStore.getState().dailyNotesDir || 'daily';
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
  /** Version counter incremented when content is set externally (not from editor typing) */
  externalContentVersion: number;

  /** Inline diff review mode state */
  diffReviewMode: boolean;
  diffFilePath: string | null;
  diffOldContent: string | null;
  diffNewContent: string | null;

  // Actions
  setViewMode: (mode: ViewMode) => void;
  setActivePanel: (panel: ActivityPanel) => void;
  addTab: (tab: FileTab) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTabContent: (tabId: string, content: string) => void;
  markTabDirty: (tabId: string, isDirty: boolean) => void;
  toggleOutline: () => void;
  toggleAiPanel: () => void;
  setCursorPosition: (line: number, col: number) => void;
  setWordCount: (count: number) => void;

  /** Enter inline diff review mode */
  enterDiffReview: (filePath: string, oldContent: string, newContent: string) => void;
  /** Exit inline diff review mode */
  exitDiffReview: () => void;

  /** Set tab content from an external source (triggers editor sync) */
  setContentExternal: (tabId: string, content: string) => void;
  /** Update a web tab's URL and title after in-page navigation */
  updateWebTabUrl: (tabId: string, url: string, title: string) => void;
  /** Open a web URL in a new tab */
  openWebTab: (url: string, title?: string) => void;
  /** Open a web URL from a clip card (converts clip tab to web tab, adds back-to-clip button) */
  openWebFromClip: (tabId: string, url: string, clipPath: string, title?: string) => void;
  /** Convert a web tab back to its original clip card */
  backToClip: (tabId: string) => Promise<void>;
  /** Open a file from the vault (reads content via VaultStore) */
  openFile: (path: string, name: string) => Promise<void>;
  /** Open (or create) today's daily note */
  openDailyNote: (dateStr?: string) => Promise<void>;
  /** Save the active tab's content to the vault */
  saveFile: (tabId: string) => Promise<void>;
  /** Save current open tabs immediately (flush, no debounce) */
  saveOpenTabs: () => void;
  /** Restore previously open tabs for the current vault */
  restoreOpenTabs: () => Promise<void>;
  /** Check open tabs against disk content and enter diff review if changed */
  checkDiskChanges: () => Promise<void>;
  /** Immediately save all tabs with pending auto-save timers */
  flushAutoSaves: () => Promise<void>;
}

const EDITOR_STORAGE_KEY = 'editor:viewMode';

export const useEditorStore = create<EditorState>()(
    (set, get) => ({
      viewMode: 'split',
      activePanel: 'files' as ActivityPanel,
      tabs: [],
      activeTabId: null,
      outlineVisible: false,
      aiPanelVisible: false,
      cursorLine: 1,
      cursorCol: 1,
      wordCount: 0,
      isFileLoading: false,
      externalContentVersion: 0,
      diffReviewMode: false,
      diffFilePath: null,
      diffOldContent: null,
      diffNewContent: null,

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

        // Debounced auto-save
        scheduleAutoSave(tabId, (id) => get().saveFile(id));
      },

      enterDiffReview: (filePath, oldContent, newContent) => {
        set({
          diffReviewMode: true,
          diffFilePath: filePath,
          diffOldContent: oldContent,
          diffNewContent: newContent,
        });
      },

      exitDiffReview: () => {
        set({
          diffReviewMode: false,
          diffFilePath: null,
          diffOldContent: null,
          diffNewContent: null,
        });
      },

      setContentExternal: (tabId, content) => {
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId ? { ...t, content, isDirty: true } : t,
          ),
          externalContentVersion: state.externalContentVersion + 1,
        }));

        scheduleAutoSave(tabId, (id) => get().saveFile(id));
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

      openFile: async (filePath, name) => {
        // Include vault id in tab id to distinguish same-name files across vaults
        const vaultId = useVaultStore.getState().activeVaultId || '';
        const tabId = `${vaultId}:${filePath}`;

        const existing = get().tabs.find((t) => t.id === tabId);
        if (existing) {
          // Re-detect activity to fix stale values from before path-based detection
          const correctActivity = detectActivity(filePath, existing.fileType);
          const needsActivityUpdate = existing.activity !== correctActivity;

          // If existing tab has empty content but the file type needs content, reload it
          if (!existing.content && getHandlerById(existing.fileType)?.needsFileContent) {
            try {
              const handler = getHandlerById(existing.fileType);
              let raw: string;
              if (filePath.startsWith(WIKI_PREFIX)) {
                raw = await wikiProvider.readFile(filePath.slice(WIKI_PREFIX.length));
              } else {
                raw = await useVaultStore.getState().readFile(filePath);
              }
              const content = handler?.deserialize ? handler.deserialize(raw) : raw;
              set((state) => ({
                tabs: state.tabs.map((t) =>
                  t.id === tabId ? { ...t, content, ...(needsActivityUpdate ? { activity: correctActivity } : {}) } : t,
                ),
                activeTabId: tabId,
              }));
            } catch (err) {
              console.error('[EditorStore] Failed to reload content for existing tab:', err);
              set((state) => ({
                activeTabId: existing.id,
                ...(needsActivityUpdate ? { tabs: state.tabs.map((t) => t.id === tabId ? { ...t, activity: correctActivity } : t) } : {}),
              }));
            }
          } else if (needsActivityUpdate) {
            set((state) => ({
              tabs: state.tabs.map((t) => t.id === tabId ? { ...t, activity: correctActivity } : t),
              activeTabId: existing.id,
            }));
          } else {
            set({ activeTabId: existing.id });
          }
          // Auto-switch to appropriate view mode — tab's saved mode takes priority
          const handler = getHandlerById(existing.fileType);
          const targetMode = existing.viewMode ?? handler?.defaultViewMode;
          if (targetMode) {
            set({ viewMode: targetMode });
          }
          return;
        }
        set({ isFileLoading: true });
        try {
          const fileType = detectFileType(filePath);
          const handler = getHandlerById(fileType);
          let content = '';
          if (handler?.needsFileContent) {
            let raw: string;
            if (filePath.startsWith(WIKI_PREFIX)) {
              raw = await wikiProvider.readFile(filePath.slice(WIKI_PREFIX.length));
            } else {
              raw = await useVaultStore.getState().readFile(filePath);
            }
            content = handler.deserialize ? handler.deserialize(raw) : raw;
            console.log(`[EditorStore] openFile: ${filePath} type=${fileType} content=${content.length} chars`);
          }
          const newTab: FileTab = {
            id: tabId,
            name,
            path: filePath,
            content,
            isDirty: false,
            fileType,
            activity: detectActivity(filePath, fileType),
            viewMode: handler?.defaultViewMode,
          };
          set((state) => ({
            tabs: [...state.tabs, newTab],
            activeTabId: newTab.id,
          }));
          // Auto-switch to preview mode for file types that prefer preview
          if (handler?.defaultViewMode) {
            set({ viewMode: handler.defaultViewMode });
          }
          persistOpenTabs(vaultId, get().tabs, get().activeTabId);
        } catch (err) {
          console.error('[EditorStore] openFile failed:', err);
        } finally {
          set({ isFileLoading: false });
        }
      },

      openDailyNote: async (dateStr?) => {
        const settings = useSettingsStore.getState();
        const dir = settings.dailyNotesDir || 'daily';
        const fmt = settings.dailyNoteDateFormat || 'YYYY-MM-DD';

        const date = dateStr ? new Date(dateStr) : new Date();
        const fileName = formatDailyDate(date, fmt);
        const filePath = `${dir}/${fileName}.md`;
        const displayName = `${fileName}.md`;

        const vault = useVaultStore.getState();

        try {
          await vault.readFile(filePath);
          await get().openFile(filePath, displayName);
          return;
        } catch {
          // File doesn't exist, create it
        }

        try {
          await vault.createDir(dir);
        } catch {
          // Directory may already exist
        }

        let template = '';
        try {
          template = await vault.readFile('_templates/daily.md');
        } catch {
          template = `---\ntitle: "${fileName}"\ndate: ${fileName}\ntags: [daily]\n---\n\n# ${fileName}\n\n`;
        }

        const content = template
          .replace(/\{\{date\}\}/g, fileName)
          .replace(/\{\{title\}\}/g, fileName)
          .replace(/\{\{year\}\}/g, String(date.getFullYear()))
          .replace(/\{\{month\}\}/g, String(date.getMonth() + 1).padStart(2, '0'))
          .replace(/\{\{day\}\}/g, String(date.getDate()).padStart(2, '0'));

        await vault.writeFile(filePath, content);
        await vault.refreshFileTree();
        await get().openFile(filePath, displayName);
      },

      saveOpenTabs: () => {
        const vaultId = useVaultStore.getState().activeVaultId;
        if (!vaultId) return;
        flushPersistOpenTabs(vaultId, get().tabs, get().activeTabId);
      },

      restoreOpenTabs: async () => {
        const vaultId = useVaultStore.getState().activeVaultId;
        if (!vaultId) return;
        const saved = await loadPersistedOpenTabs(vaultId);
        if (!saved || saved.tabs.length === 0) return;

        for (const tabInfo of saved.tabs) {
          const isWebTab = tabInfo.fileType === 'web'
            || tabInfo.path.startsWith('http://') || tabInfo.path.startsWith('https://');

          if (isWebTab) {
            // Restore web tab — use openWebTab logic
            const webTabId = `web:${tabInfo.path}`;
            const alreadyOpen = get().tabs.find((t) => t.id === webTabId);
            if (alreadyOpen) continue;
            const restoredActivity = detectActivity(tabInfo.path, 'web');
            const newTab: FileTab = {
              id: webTabId,
              name: tabInfo.name,
              path: tabInfo.path,
              content: '',
              isDirty: false,
              fileType: 'web',
              activity: restoredActivity,
              viewMode: tabInfo.viewMode,
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
              const handler = getHandlerById(fileType);
              let content = '';
              if (handler?.needsFileContent) {
                const raw = await useVaultStore.getState().readFile(tabInfo.path);
                content = handler.deserialize ? handler.deserialize(raw) : raw;
              }
              const restoredActivity = detectActivity(tabInfo.path, fileType);
              const newTab: FileTab = {
                id: tabId,
                name: tabInfo.name,
                path: tabInfo.path,
                content,
                isDirty: false,
                fileType,
                activity: restoredActivity,
                cursorLine: tabInfo.cursorLine,
                cursorCol: tabInfo.cursorCol,
                viewMode: tabInfo.viewMode,
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
            set({
              activeTabId: exists.id,
              ...(exists.viewMode ? { viewMode: exists.viewMode } : {}),
            });
          }
        } else if (get().tabs.length > 0 && !get().activeTabId) {
          const firstTab = get().tabs[0];
          set({
            activeTabId: firstTab.id,
            ...(firstTab.viewMode ? { viewMode: firstTab.viewMode } : {}),
          });
        }
      },

      saveFile: async (tabId) => {
        const tab = get().tabs.find((t) => t.id === tabId);
        if (!tab) return;
        try {
          suppressWatcherFor(tab.path);
          const handler = getHandlerById(tab.fileType);
          const output = handler?.serialize ? handler.serialize(tab.content) : tab.content;
          if (tab.path.startsWith(WIKI_PREFIX)) {
            await wikiProvider.writeFile(tab.path.slice(WIKI_PREFIX.length), output);
          } else {
            await useVaultStore.getState().writeFile(tab.path, output);
          }
          set((state) => ({
            tabs: state.tabs.map((t) =>
              t.id === tabId ? { ...t, isDirty: false } : t,
            ),
          }));
        } catch (err) {
          console.error('[EditorStore] saveFile failed:', err);
        }
      },

      flushAutoSaves: async () => {
        await flushAllAutoSaves((tabId) => get().saveFile(tabId));
      },

      checkDiskChanges: async () => {
        const { tabs, activeTabId, diffReviewMode } = get();
        if (diffReviewMode) return;

        const candidates = tabs.filter((tab) => {
          if (tab.fileType === 'web') return false;
          const handler = getHandlerById(tab.fileType);
          return !!handler?.needsFileContent;
        });

        await Promise.allSettled(candidates.map(async (tab) => {
          const handler = getHandlerById(tab.fileType);
          const raw = await useVaultStore.getState().readFile(tab.path);
          const diskContent = handler!.deserialize ? handler!.deserialize(raw) : raw;
          if (diskContent !== tab.content) {
            if (tab.id === activeTabId) {
              get().enterDiffReview(tab.path, tab.content, diskContent);
            } else {
              set((state) => ({
                tabs: state.tabs.map((t) =>
                  t.id === tab.id ? { ...t, content: diskContent, isDirty: false } : t,
                ),
                externalContentVersion: state.externalContentVersion + 1,
              }));
            }
          }
        }));
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
