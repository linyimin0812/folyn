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
import { externalFileProvider } from '@/services/externalFileProvider';
import { isExternalPath } from '@/utils/isExternalPath';
import { WIKI_PREFIX } from '@/types/wiki';
import {
  flushAllAutoSaves,
} from '@/store/editorAutoSave';
import {
  persistOpenTabs,
  flushPersistOpenTabs,
  loadPersistedOpenTabs,
  persistExternalOpenTabs,
  flushPersistExternalOpenTabs,
  loadExternalOpenTabs,
} from '@/store/editorPersistence';

/** Default URL for a freshly created browser tab. */
export const BROWSER_HOME_URL = 'https://www.google.com';

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

/** Resolve which provider reads a path's content. External (absolute / home-
 *  relative) paths go to `externalFileProvider`; wiki-prefixed paths go to
 *  `wikiProvider`; everything else is vault-relative → `vaultStore`. */
export async function readRawContent(filePath: string): Promise<string> {
  if (isExternalPath(filePath)) {
    return externalFileProvider.readFile(filePath);
  }
  if (filePath.startsWith(WIKI_PREFIX)) {
    return wikiProvider.readFile(filePath.slice(WIKI_PREFIX.length));
  }
  return useVaultStore.getState().readFile(filePath);
}

/** Public alias used by file-type handlers that read files outside the
 *  editorStore content flow (e.g. embedded excalidraw preview, the markdown
 *  `:::file-preview` readFile callback). Routes by path shape exactly like
 *  `openFile` does so an external / wiki path resolves correctly. */
export const readFileByRoute = readRawContent;

/** Resolve which provider writes a path's content (mirror of readRawContent). */
async function writeRawContent(filePath: string, content: string): Promise<void> {
  if (isExternalPath(filePath)) {
    await externalFileProvider.writeFile(filePath, content);
    return;
  }
  if (filePath.startsWith(WIKI_PREFIX)) {
    await wikiProvider.writeFile(filePath.slice(WIKI_PREFIX.length), content);
    return;
  }
  await useVaultStore.getState().writeFile(filePath, content);
}

/** Open a file from the vault (reads content via VaultStore). */
export async function openFile(filePath: string, name: string): Promise<void> {
  const get = useEditorStore.getState;
  const set = useEditorStore.setState;
  // External files are vault-independent: their tab id is namespaced `ext:` so
  // it never collides with a vault tab (whose id is `${vaultId}:${relPath}`)
  // and so `switchVault`'s `tabs: []` clear can be narrowed to keep them.
  const isExternal = isExternalPath(filePath);
  const vaultId = isExternal ? 'ext' : (useVaultStore.getState().activeVaultId || '');
  const tabId = isExternal ? `ext:${filePath}` : `${vaultId}:${filePath}`;

  const existing = get().tabs.find((t) => t.id === tabId);
  if (existing) {
    // Re-detect file type: a newly installed plugin may now handle this
    // extension (e.g. plantuml plugin for .puml files created before the
    // plugin was installed).
    const correctFileType = detectFileType(filePath);
    const needsFileTypeUpdate = existing.fileType !== correctFileType;

    // Re-detect activity to fix stale values from before path-based detection
    const correctActivity = detectActivity(filePath, correctFileType);
    const needsActivityUpdate = existing.activity !== correctActivity;

    // If existing tab has empty content but the file type needs content, reload it
    if (!existing.content && getHandlerById(correctFileType)?.needsFileContent) {
      try {
        const handler = getHandlerById(correctFileType);
        const raw = await readRawContent(filePath);
        const content = handler?.deserialize ? handler.deserialize(raw) : raw;
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId ? { ...t, content, fileType: correctFileType, ...(needsActivityUpdate ? { activity: correctActivity } : {}) } : t,
          ),
          activeTabId: tabId,
        }));
      } catch (err) {
        console.error('[EditorStore] Failed to reload content for existing tab:', err);
        set((state) => ({
          activeTabId: existing.id,
          ...(needsFileTypeUpdate || needsActivityUpdate
            ? { tabs: state.tabs.map((t) => t.id === tabId ? { ...t, ...(needsFileTypeUpdate ? { fileType: correctFileType } : {}), ...(needsActivityUpdate ? { activity: correctActivity } : {}) } : t) }
            : {}),
        }));
      }
    } else if (needsFileTypeUpdate || needsActivityUpdate) {
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId
            ? { ...t, ...(needsFileTypeUpdate ? { fileType: correctFileType } : {}), ...(needsActivityUpdate ? { activity: correctActivity } : {}) }
            : t,
        ),
        activeTabId: existing.id,
      }));
    } else {
      set({ activeTabId: existing.id });
    }
    // Auto-switch to appropriate view mode — tab's saved mode takes priority
    const handler = getHandlerById(correctFileType);
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
      const raw = await readRawContent(filePath);
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
    if (isExternal) {
      persistExternalOpenTabs('ext', get().tabs, get().activeTabId);
    }
  } catch (err) {
    console.error('[EditorStore] openFile failed:', err);
  } finally {
    set({ isFileLoading: false });
  }
}

/** Open a new browser tab (web tab in the files work area) and surface it. */
export function openBrowserTab(url: string = BROWSER_HOME_URL): void {
  useEditorStore.getState().openWebTab(url);
  useEditorStore.setState({ activePanel: 'files' });
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
    await writeRawContent(tab.path, output);
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, isDirty: false } : t,
      ),
    }));
  } catch (err) {
    console.error('[EditorStore] saveFile failed:', err);
  }
}

/** Save current open tabs immediately (flush, no debounce). External tabs are
 *  persisted under their own vault-independent key so they survive vault
 *  switches; vault tabs are persisted per-vault as before. */
export function saveOpenTabs(): void {
  const get = useEditorStore.getState;
  const vaultId = useVaultStore.getState().activeVaultId;
  const { tabs, activeTabId } = get();
  const externalTabs = tabs.filter((t) => isExternalPath(t.path));
  if (externalTabs.length > 0) {
    flushPersistExternalOpenTabs('ext', externalTabs, activeTabId);
  }
  if (vaultId) {
    const vaultTabs = tabs.filter((t) => !isExternalPath(t.path));
    flushPersistOpenTabs(vaultId, vaultTabs, activeTabId);
  }
}

/** Restore previously open tabs for the current vault, plus the
 *  vault-independent external tabs. */
export async function restoreOpenTabs(): Promise<void> {
  const get = useEditorStore.getState;
  const set = useEditorStore.setState;
  const vaultId = useVaultStore.getState().activeVaultId;

  // External tabs are vault-independent — restore them once.
  await restoreExternalTabs();

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
      const isExternal = isExternalPath(tabInfo.path);
      const tabId = isExternal ? `ext:${tabInfo.path}` : `${vaultId}:${tabInfo.path}`;
      const alreadyOpen = get().tabs.find((t) => t.id === tabId);
      if (alreadyOpen) continue;
      try {
        const fileType = detectFileType(tabInfo.path);
        const handler = getHandlerById(fileType);
        let content = '';
        if (handler?.needsFileContent) {
          const raw = await readRawContent(tabInfo.path);
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
    // Try file-tab, external-tab, and web-tab id formats
    const fileActiveId = `${vaultId}:${saved.activeTabPath}`;
    const extActiveId = `ext:${saved.activeTabPath}`;
    const webActiveId = `web:${saved.activeTabPath}`;
    const exists = get().tabs.find((t) => t.id === fileActiveId || t.id === extActiveId || t.id === webActiveId);
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
    const raw = await readRawContent(tab.path);
    const diskContent = handler!.deserialize ? handler!.deserialize(raw) : raw;
    const isActive = tab.id === activeTabId;
    // ponytail: CodeMirror editors show a diff-review banner on the active tab
    // (accept/reject), so they need the differs-check + enterDiffReview. Custom
    // editors (excalidraw/drawio/mmap/clip) have no diff UI — just reload from
    // disk unconditionally: update content + bump version → WorkArea remounts
    // the editor with fresh initialData.
    if (isActive && handler?.useCodeMirror) {
      if (diskContent !== tab.content) {
        useDiffReviewStore
          .getState()
          .enterDiffReview(tab.path, tab.content, diskContent);
      }
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
  }));
}

/** Restore vault-independent external tabs (called from restoreOpenTabs). */
async function restoreExternalTabs(): Promise<void> {
  const get = useEditorStore.getState;
  const set = useEditorStore.setState;
  const saved = await loadExternalOpenTabs('ext');
  if (!saved || saved.tabs.length === 0) return;
  for (const tabInfo of saved.tabs) {
    const tabId = `ext:${tabInfo.path}`;
    const alreadyOpen = get().tabs.find((t) => t.id === tabId);
    if (alreadyOpen) continue;
    try {
      const fileType = detectFileType(tabInfo.path);
      const handler = getHandlerById(fileType);
      let content = '';
      if (handler?.needsFileContent) {
        const raw = await externalFileProvider.readFile(tabInfo.path);
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
      set((state) => ({ tabs: [...state.tabs, newTab] }));
    } catch {
      // External file may have been moved/deleted since last session, skip
    }
  }
  // If no vault-tab active id wins later, prefer the last external active tab.
  if (saved.activeTabPath && !get().activeTabId) {
    const extActiveId = `ext:${saved.activeTabPath}`;
    const exists = get().tabs.find((t) => t.id === extActiveId);
    if (exists) {
      set({
        activeTabId: exists.id,
        ...(exists.viewMode ? { viewMode: exists.viewMode } : {}),
      });
    }
  }
}

/** Open an external file picked via the native OS file dialog. Returns the
 *  number of files opened. Used by the Files-panel button, the command
 *  palette, and the drag-drop / OS "Open With" entry points (which call
 *  openFile directly). */
export async function openExternalFile(): Promise<number> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const result = await open({
    multiple: false,
    // No explicit filters: the user owns the machine and may pick any file
    // Quill has a handler for. Non-handled types fall back to the `code`
    // (plain-text) editor.
  });
  if (!result) return 0;
  const picked: string | null = typeof result === 'string' ? result : null;
  if (!picked) return 0;
  const name = picked.includes('/') ? picked.substring(picked.lastIndexOf('/') + 1) : picked;
  await openFile(picked, name);
  return 1;
}

/** Immediately save all tabs with pending auto-save timers. */
export async function flushAutoSaves(): Promise<void> {
  await flushAllAutoSaves((tabId) => saveFile(tabId));
}
