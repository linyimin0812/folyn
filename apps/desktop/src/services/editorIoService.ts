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
import { snapshot as snapshotVersion } from '@/services/versionHistory';
import { resolveBasePath } from '@/utils/pathResolver';
import { isTauri } from '@/utils/platform';

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
  // ponytail: virtual paths route to in-app views (wiki-graph, wiki-query) via
  // WorkArea's path check — no backing file, so skip readRawContent for them.
  const isVirtualPath = filePath === 'wiki-graph' || filePath === 'wiki-query';
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
    if (!isVirtualPath && !existing.content && getHandlerById(correctFileType)?.needsFileContent) {
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
    if (!isVirtualPath && handler?.needsFileContent) {
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
    // PR2: best-effort version-history snapshot. Never fails the save —
    // version history is a secondary affordance; the user's primary intent
    // (saving) has already succeeded at this point.
    void maybeSnapshotVersion(tab).catch((err) => {
      console.warn('[EditorStore] version snapshot failed:', err);
    });
  } catch (err) {
    console.error('[EditorStore] saveFile failed:', err);
  }
}

/**
 * Close a tab, snapshotting the on-disk content first if the tab is a
 * Versionable File (per PRD §2). Best-effort — never fails the close.
 *
 * Snapshots the on-disk content (NOT the editor dirty state) so the
 * snapshot reflects what's actually persisted to disk. Dedup in the pure
 * service means a snapshot taken here right after a save is a no-op.
 *
 * Exported so callers that previously invoked the bare store `closeTab`
 * can opt into the snapshot path with one import change. The bare store
 * action is still available via `useEditorStore.getState().closeTab` for
 * paths where a snapshot is unwanted (e.g. closing a deleted file).
 */
export function closeTab(tabId: string): void {
  const tab = useEditorStore.getState().tabs.find((t) => t.id === tabId);
  if (tab) {
    void maybeSnapshotVersion(tab).catch((err) => {
      console.warn('[EditorStore] version snapshot on close failed:', err);
    });
  }
  useEditorStore.getState().closeTab(tabId);
}

/**
 * Snapshot `tab`'s on-disk content if it is a Versionable File under the
 * active vault. Skips:
 *   - external tabs (`isExternalPath(tab.path)`) — no vault id bound
 *   - wiki tabs (`wiki://` prefix) — no on-disk path under the vault
 *   - `web` tabs — no on-disk file content (URL-only)
 *   - non-content handlers (`needsFileContent !== true`) — image/office
 *     previews have no editor-buffer state worth snapshotting
 *   - missing `vaultId` / `currentVault` — untitled or vault-less state
 *
 * The "versionable" predicate mirrors `checkDiskChanges`'s filter
 * (`fileType !== 'web' && handler.needsFileContent`) — same gate, same
 * scope per PRD §7. PRD §scope-list ("web" included) is intentional but
 * `web` has no on-disk content, so the practical predicate excludes it.
 */
async function maybeSnapshotVersion(tab: FileTab): Promise<void> {
  if (isExternalPath(tab.path) || tab.path.startsWith(WIKI_PREFIX)) return;
  if (tab.fileType === 'web') return;
  const handler = getHandlerById(tab.fileType);
  if (!handler?.needsFileContent) return;

  const vaultId = useVaultStore.getState().activeVaultId;
  if (!vaultId) return;
  const vault = useVaultStore.getState().currentVault;
  if (!vault) return;

  const vaultRoot = await resolveBasePath(vault.basePath);
  const { join } = await import('@tauri-apps/api/path');
  const absFilePath = await join(vaultRoot, tab.path);

  await snapshotVersion(vaultId, absFilePath);
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
    // editors (excalidraw/drawio/markmap/clip) have no diff UI — just reload from
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
    // Folyn has a handler for. Non-handled types fall back to the `code`
    // (plain-text) editor.
  });
  if (!result) return 0;
  const picked: string | null = typeof result === 'string' ? result : null;
  if (!picked) return 0;
  const name = picked.includes('/') ? picked.substring(picked.lastIndexOf('/') + 1) : picked;
  await openFile(picked, name);
  return 1;
}

/** Open file(s) dropped onto the window from the OS file manager.
 *
 * On macOS, WebKit (WKWebView) exposes the real absolute path on the dropped
 * `File` object (`.path`); we open it directly as a vault-independent external
 * tab — same route as the OS "Open With" flow.
 *
 * On Windows, WebView2's HTML5 `drop` event delivers a `File` object with
 * name/size/type and readable content but NO absolute path (WebView2 security
 * restriction). To get a real path Folyn must enable the Tauri
 * `dragDropEnabled` window flag, but that replaces WebView2's drag-drop handler
 * and breaks ALL in-app HTML5 drag-and-drop (the schedule board, rich-text
 * table row/col reordering) — a Tauri-documented, hard limitation. So instead
 * we read the dropped `File` content and write it to a per-app import staging
 * dir (`~/.folyn/drops/`), then open that staged file by path. The user gets a
 * real, editable, saveable Folyn tab; the cost is that it is a copy (the
 * original is not modified on save). Non-text/binary file types that Folyn
 * does not edit are skipped (no handler → no tab).
 *
 * `Files` here are Web `File` objects (HTML5 DnD), not Tauri paths. Returns the
 * number of files opened. No-op (returns 0) when not running under Tauri. */
export async function openDroppedFiles(files: File[]): Promise<number> {
  if (!isTauri()) return 0;
  let opened = 0;
  for (const f of files) {
    const webkitPath = (f as unknown as { path?: string }).path;
    if (webkitPath) {
      // macOS: real absolute path available — open the actual file.
      const name = webkitPath.includes('/')
        ? webkitPath.substring(webkitPath.lastIndexOf('/') + 1)
        : webkitPath;
      await openFile(webkitPath, name);
      opened++;
      continue;
    }
    // Windows / Linux (WebView2): no path on the File object. Stage the
    // content into ~/.folyn/drops/ and open the staged copy by path. Read as
    // raw bytes (arrayBuffer) and write as bytes — f.text()/writeFile do a
    // UTF-8 round-trip that corrupts binary files (docx/xlsx/pdf/zip are ZIP
    // archives; a bad UTF-8 decode breaks the office viewer with "Corrupted
    // zip"). Byte writes are identity-preserving for text files too, so all
    // handled types go through this one path. Skip types Folyn has no editor
    // for (e.g. plain images) — they are not versionable files.
    const fileType = detectFileType(f.name);
    const handler = getHandlerById(fileType);
    if (!handler) continue;
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const staged = await stageDroppedContent(f.name, bytes);
      await openFile(staged, f.name);
      opened++;
    } catch (err) {
      console.error('[EditorStore] openDroppedFiles: failed to stage', f.name, err);
    }
  }
  return opened;
}

/** Write dropped file bytes to `~/.folyn/drops/<name>` and return that path.
 *  Bytes (not text) so binary archives (docx/xlsx/zip/…) are not corrupted by
 *  a UTF-8 encode/decode round-trip. Overwrites any prior staging of the same
 *  name (re-import = refresh). The path is home-relative (`~/…`) so the tab id
 *  is stable across vault switches and read/write route through
 *  `externalFileProvider` (which resolves `~` → $HOME, enforces the
 *  within-home boundary, and creates the dir). */
async function stageDroppedContent(name: string, bytes: Uint8Array): Promise<string> {
  // Sanitize: keep only the base name (File.name should already be path-free,
  // but guard against a crafted name with separators that would escape drops/).
  const safe = name.replace(/[/\\]+/g, '_') || 'untitled';
  const staged = '~/.folyn/drops/' + safe;
  await externalFileProvider.writeFileBytes(staged, bytes);
  return staged;
}

/** Immediately save all tabs with pending auto-save timers. */
export async function flushAutoSaves(): Promise<void> {
  await flushAllAutoSaves((tabId) => saveFile(tabId));
}
