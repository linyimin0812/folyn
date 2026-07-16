import type { FileTab } from '@/store/editorStore';
import {
  detectFileType,
  detectActivity,
  useEditorStore,
} from '@/store/editorStore';
import { useDiffReviewStore } from '@/store/diffReviewStore';
import { useVaultStore } from '@/store/vaultStore';
import { usePrefsStore } from '@/store/prefsStore';
import { getHandlerById } from '@/components/file-types/registry';
import { suppressWatcherFor } from '@/utils/fileWatcher';
import { wikiProvider } from '@/services/wikiProvider';
import { WIKI_PREFIX } from '@/types/wiki';
import {
  flushAllAutoSaves,
} from '@/store/editorAutoSave';
import {
  persistOpenTabs,
  flushPersistOpenTabs,
  loadPersistedOpenTabs,
} from '@/store/editorPersistence';

/**
 * Editor file-IO service — the file read/write/persist/disk-sync operations
 * that lived as editorStore actions in the legacy god-store.
 *
 * These are service functions (NOT a store): they operate on editorStore's
 * `tabs` via `useEditorStore.getState()` / `useEditorStore.setState()`.
 * Consumers (App init, keyboard shortcuts, fileWatcher) call these functions
 * directly.
 */

function formatDailyDate(date: Date, format: string): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return format
    .replace('YYYY', String(y))
    .replace('MM', m)
    .replace('DD', d);
}

/** Open a file from the vault (reads content via VaultStore). */
export async function openFile(filePath: string, name: string): Promise<void> {
  const get = useEditorStore.getState;
  const set = useEditorStore.setState;
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
}

/** Open (or create) today's daily note. */
export async function openDailyNote(dateStr?: string): Promise<void> {
  const prefs = usePrefsStore.getState();
  const dir = prefs.dailyNotesDir || '__daily__';
  const fmt = prefs.dailyNoteDateFormat || 'YYYY-MM-DD';

  const date = dateStr ? new Date(dateStr) : new Date();
  const fileName = formatDailyDate(date, fmt);
  const filePath = `${dir}/${fileName}.md`;
  const displayName = `${fileName}.md`;

  const vault = useVaultStore.getState();

  try {
    await vault.readFile(filePath);
    await openFile(filePath, displayName);
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
  await openFile(filePath, displayName);
}

/** Save the active tab's content to the vault. */
export async function saveFile(tabId: string): Promise<void> {
  const get = useEditorStore.getState;
  const set = useEditorStore.setState;
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
}

/** Save current open tabs immediately (flush, no debounce). */
export function saveOpenTabs(): void {
  const get = useEditorStore.getState;
  const vaultId = useVaultStore.getState().activeVaultId;
  if (!vaultId) return;
  flushPersistOpenTabs(vaultId, get().tabs, get().activeTabId);
}

/** Restore previously open tabs for the current vault. */
export async function restoreOpenTabs(): Promise<void> {
  const get = useEditorStore.getState;
  const set = useEditorStore.setState;
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
}

/** Check open tabs against disk content and enter diff review if changed. */
export async function checkDiskChanges(): Promise<void> {
  const get = useEditorStore.getState;
  const set = useEditorStore.setState;
  // ponytail: diffReviewMode/externalContentVersion/enterDiffReview live on
  // diffReviewStore. Read diff state from there, not editorStore.
  const { tabs, activeTabId } = get();
  if (useDiffReviewStore.getState().diffReviewMode) return;

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
        useDiffReviewStore
          .getState()
          .enterDiffReview(tab.path, tab.content, diskContent);
      } else {
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tab.id ? { ...t, content: diskContent, isDirty: false } : t,
          ),
        }));
        useDiffReviewStore.setState((s) => ({
          externalContentVersion: s.externalContentVersion + 1,
        }));
      }
    }
  }));
}

/** Immediately save all tabs with pending auto-save timers. */
export async function flushAutoSaves(): Promise<void> {
  await flushAllAutoSaves((tabId) => saveFile(tabId));
}
