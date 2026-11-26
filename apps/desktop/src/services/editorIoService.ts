import type { FileTab } from '@/store/editorStore';
import {
  detectFileType,
  detectActivity,
  useEditorStore,
} from '@/store/editorStore';
import { useDiffReviewStore } from '@/store/diffReviewStore';
import { useVaultStore } from '@/store/vaultStore';
import { getHandlerById, getDefaultMode, usesShellEditor } from "@/components/file-types/registry";
import { suppressWatcherFor } from '@/utils/fileWatcher';
import { externalFileProvider } from '@/services/externalFileProvider';
import { isExternalPath } from '@/utils/isExternalPath';
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

/** Resolve which provider reads a path's content. External (absolute / home-
 *  relative) paths go to `externalFileProvider`; everything else is
 *  vault-relative → `vaultStore`. */
export async function readRawContent(filePath: string): Promise<string> {
  if (isExternalPath(filePath)) {
    return externalFileProvider.readFile(filePath);
  }
  return useVaultStore.getState().readFile(filePath);
}

/** Public alias used by file-type handlers that read files outside the
 *  editorStore content flow (e.g. embedded excalidraw preview, the markdown
 *  `:::file-preview` readFile callback). Routes by path shape exactly like
 *  `openFile` does so an external path resolves correctly. */
export const readFileByRoute = readRawContent;

/** Resolve which provider writes a path's content (mirror of readRawContent). */
async function writeRawContent(filePath: string, content: string): Promise<void> {
  if (isExternalPath(filePath)) {
    await externalFileProvider.writeFile(filePath, content);
    return;
  }
  await useVaultStore.getState().writeFile(filePath, content);
}

/** Open a file from the vault (reads content via VaultStore). */
export async function openFile(
  filePath: string,
  name: string,
  options?: {
    /** Caller's notion of the current vault — when provided, openFile
     *  aborts if the active vault changed mid-await (e.g. async open from
     *  a stale panel). Omit for same-frame opens (background opens from the
     *  preview: the click handler's vault is the live one). */
    expectedVaultId?: string;
    /** Custom content source (e.g. external file provider). Falls back to
     *  readRawContent on the vault fs. */
    readText?: () => Promise<string>;
    /** Spec 6.2 — 同一文档允许多个独立阅读标签页: open a SECOND tab for
     *  this path even if one is already open (each with its own reading
     *  context). Duplicate instances get a `~N` suffix on the tab id. */
    forceNew?: boolean;
    /** Spec 6.2 — 后台打开不抢夺当前焦点: create the tab without activating
     *  it, inserted to the RIGHT of the source tab (pass the source tab id
     *  in insertAfterTabId). */
    background?: boolean;
    /** Where a background tab lands (right of the source tab). Ignored when
     *  background is false. */
    insertAfterTabId?: string;
  },
): Promise<void> {
  const assertVault = () => {
    if (options?.expectedVaultId && (useVaultStore.getState().isLoading || useVaultStore.getState().activeVaultId !== options.expectedVaultId)) throw new Error('The selected vault has changed');
  };
  assertVault();
  const get = useEditorStore.getState;
  const set = useEditorStore.setState;
  // External files are vault-independent: their tab id is namespaced `ext:` so
  // it never collides with a vault tab (whose id is `${vaultId}:${relPath}`)
  // and so `switchVault`'s `tabs: []` clear can be narrowed to keep them.
  const isExternal = isExternalPath(filePath);
  const vaultId = isExternal ? 'ext' : (useVaultStore.getState().activeVaultId || '');
  const baseTabId = isExternal ? `ext:${filePath}` : `${vaultId}:${filePath}`;

  // Spec 6.2 — forceNew: open a duplicate instance even when a tab for this
  // path exists. Instance ids add a ~N discriminator (first occurrence keeps
  // the canonical id so existing lookups — webview cache, doc history, saved
  // sessions — keep working); N = next free number among open tabs.
  let tabId = baseTabId;
  if (options?.forceNew) {
    const taken = new Set(get().tabs.map((t) => t.id));
    let n = 2;
    while (taken.has(`${baseTabId}~${n}`)) n += 1;
    tabId = `${baseTabId}~${n}`;
  } else {
    tabId = baseTabId;
  }

  const existing = get().tabs.find((t) => t.id === tabId);
  if (existing) {
    // Re-detect file type: a newly installed extension may now handle this
    // extension (e.g. plantuml extension for .puml files created before the
    // extension was installed).
    const correctFileType = detectFileType(filePath);
    const needsFileTypeUpdate = existing.fileType !== correctFileType;

    // Re-detect activity to fix stale values from before path-based detection
    const correctActivity = detectActivity(filePath, correctFileType);
    const needsActivityUpdate = existing.activity !== correctActivity;

    // If existing tab has empty content but the file type needs content, reload it
    if (!existing.content && !existing.isDirty && getHandlerById(correctFileType)?.needsFileContent) {
      try {
        const handler = getHandlerById(correctFileType);
        const raw = await (options?.readText ? options.readText() : readRawContent(filePath));
        assertVault();
        const content = handler?.deserialize ? handler.deserialize(raw) : raw;
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId ? { ...t, content, fileType: correctFileType, ...(needsActivityUpdate ? { activity: correctActivity } : {}) } : t,
          ),
          activeTabId: tabId,
        }));
      } catch (err) {
        console.error('[EditorStore] Failed to reload content for existing tab:', err);
        assertVault();
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
    const targetMode = existing.viewMode ?? getDefaultMode(handler);
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
      const raw = await (options?.readText ? options.readText() : readRawContent(filePath));
      assertVault();
      content = handler.deserialize ? handler.deserialize(raw) : raw;
      console.log(`[EditorStore] openFile: ${filePath} type=${fileType} content=${content.length} chars`);
    }
    assertVault();
    const newTab: FileTab = {
      id: tabId,
      name,
      path: filePath,
      content,
      isDirty: false,
      fileType,
      activity: detectActivity(filePath, fileType),
      viewMode: getDefaultMode(handler),
    };
    // addTab owns insertion + activation + MRU (background: insert right of
    // the source tab and DON'T activate — spec 6.2 后台打开不抢夺当前焦点).
    useEditorStore.getState().addTab(newTab, {
      activate: !options?.background,
      ...(options?.background ? { insertAfterTabId: options.insertAfterTabId ?? null } : {}),
    });
    // Auto-switch to preview mode for file types that prefer preview (only
    // when the new tab is actually being activated — a background tab must
    // not touch the current tab's view mode).
    if (!options?.background && getDefaultMode(handler)) {
      set({ viewMode: getDefaultMode(handler) });
    }
    persistOpenTabs(vaultId, get().tabs, get().activeTabId);
    if (isExternal) {
      persistExternalOpenTabs('ext', get().tabs, get().activeTabId);
    }
  } catch (err) {
    console.error('[EditorStore] openFile failed:', err);
    if (options) throw err;
  } finally {
    set({ isFileLoading: false });
  }
}

/** Open a new browser tab (web tab in the files work area) and surface it. */
export function openBrowserTab(url: string = BROWSER_HOME_URL): void {
  useEditorStore.getState().openWebTab(url);
  useEditorStore.setState({ activePanel: 'files' });
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
      tabs: state.tabs.map((t) => {
        if (t.id === tabId) return { ...t, isDirty: false };
        // Spec 6.2 — duplicate tabs of the same document: a save from one
        // tab lands on disk, so refresh non-dirty siblings' content from
        // the saved buffer (dirty siblings keep the user's uncommitted
        // edits — their save will overwrite the file, not this one).
        if (t.path === tab.path && !t.isDirty && t.fileType === tab.fileType) {
          return { ...t, content: tab.content };
        }
        return t;
      }),
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
 *   - `web` tabs — no on-disk file content (URL-only)
 *   - non-content handlers (`needsFileContent !== true`) — image/office
 *     previews have no editor-buffer state worth snapshotting
 *   - missing `vaultId` / `currentVault` — untitled or vault-less state
 *
 * The "versionable" predicate mirrors `checkDiskChanges`'s filter
 * (`fileType !== 'web' && handler.needsFileContent`) — same gate, same
 * scope per PRD §2. PRD §scope-list ("web" included) is intentional but
 * `web` has no on-disk content, so the practical predicate excludes it.
 */
async function maybeSnapshotVersion(tab: FileTab): Promise<void> {
  if (isExternalPath(tab.path)) return;
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
      // Restore file tab — spec 6.2: the saved id is the INSTANCE id, so
      // duplicate tabs of one path come back as duplicates (not collapsed),
      // each with its own position/reading context. Fallback for legacy
      // sessions without ids: derive from path (dedupes as before).
      const isExternal = isExternalPath(tabInfo.path);
      const derivedTabId = isExternal ? `ext:${tabInfo.path}` : `${vaultId}:${tabInfo.path}`;
      const tabId = tabInfo.id ?? derivedTabId;
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
          pinned: tabInfo.pinned,
          cursorLine: tabInfo.cursorLine,
          cursorCol: tabInfo.cursorCol,
          editorScrollTop: tabInfo.editorScrollTop,
          previewScrollTop: tabInfo.previewScrollTop,
          viewMode: tabInfo.viewMode,
          readingHeading: tabInfo.readingHeading,
        };
        set((state) => ({
          tabs: [...state.tabs, newTab],
        }));
      } catch {
        // File may have been deleted since last session, skip
      }
    }
  }

  // Pinned tabs form the leading group on restore too (stable positions).
  set((state) => {
    if (state.tabs.some((t) => t.pinned) && state.tabs.some((t) => !t.pinned)) {
      return { tabs: [...state.tabs.filter((t) => t.pinned), ...state.tabs.filter((t) => !t.pinned)] };
    }
    return state;
  });

  // Restore active tab
  if (saved.activeTabPath) {
    // Prefer the exact saved instance (activeTabId, spec 6.2) — with
    // duplicate tabs the PATH alone is ambiguous. Fall back to path-derived
    // ids for legacy sessions.
    const exists = saved.activeTabId
      ? get().tabs.find((t) => t.id === saved.activeTabId)
      : get().tabs.find((t) => {
        const fileActiveId = `${vaultId}:${saved.activeTabPath}`;
        const extActiveId = `ext:${saved.activeTabPath}`;
        const webActiveId = `web:${saved.activeTabPath}`;
        return t.id === fileActiveId || t.id === extActiveId || t.id === webActiveId;
      });
    if (exists) {
      set({
        activeTabId: exists.id,
        mruOrder: [exists.id, ...get().tabs.map((t) => t.id).filter((id) => id !== exists.id)],
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
    // editors (excalidraw/drawio/markmap) have no diff UI — just reload from
    // disk unconditionally: update content + bump version → WorkArea remounts
    // the editor with fresh initialData.
    if (isActive && usesShellEditor(handler)) {
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
    const derivedTabId = `ext:${tabInfo.path}`;
    // Spec 6.2 — restore the saved INSTANCE id (duplicates come back as
    // duplicates); legacy sessions without ids fall back to the derived one.
    const tabId = tabInfo.id ?? derivedTabId;
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
        pinned: tabInfo.pinned,
        cursorLine: tabInfo.cursorLine,
        cursorCol: tabInfo.cursorCol,
        editorScrollTop: tabInfo.editorScrollTop,
        previewScrollTop: tabInfo.previewScrollTop,
        viewMode: tabInfo.viewMode,
        readingHeading: tabInfo.readingHeading,
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

/** Open absolute paths from OS-level entry points (window drag-drop events,
 *  the unified ↗ picker, OS "Open With" / file-association launches, and the
 *  single-instance second-launch handoff). Directories register as external
 *  folders in the Files panel (duplicate / outside-$HOME failures get a
 *  toast, never a silent no-op); files open as vault-independent external
 *  tabs. Always lands on the editor page so the Files panel / opened tab is
 *  visible. Returns the number of items handled. No-op (returns 0) when
 *  not running under Tauri. */
export async function openExternalPaths(paths: string[]): Promise<number> {
  if (!isTauri()) return 0;
  if (paths.length === 0) return 0;
  // Any external open lands on the editor page — that is where tabs and the
  // Files-panel external tree appear.
  const { useNavStore } = await import('@/store/navStore');
  useNavStore.getState().setCurrentPage('editor');
  const { stat } = await import('@tauri-apps/plugin-fs');
  const { useExternalFolderStore } = await import(
    '@/store/externalFolderStore',
  );
  let opened = 0;
  for (const p of paths) {
    // Route file vs folder: stat → dir registers as an external folder,
    // file opens as an external tab. stat failure falls through to the file
    // path (openFile surfaces its own error).
    const st = await stat(p).catch(() => null);
    if (st?.isDirectory) {
      const added = await useExternalFolderStore.getState().addFolder(p);
      if (added) {
        opened++;
      } else {
        // addFolder returns false for duplicate / outside-$HOME /
        // unreadable — never a silent no-op, surface which one it was.
        const duplicate = useExternalFolderStore
          .getState()
          .folders.some((f) => f.path === p);
        const { useToastStore } = await import('@/store/toastStore');
        const { default: i18n } = await import('@/i18n');
        useToastStore.getState().push(
          duplicate
            ? i18n.t('editor:filePaste.folderAlreadyAdded')
            : i18n.t('editor:filePaste.folderOutsideHome'),
        );
      }
      continue;
    }
    const name = p.includes('/')
      ? p.substring(p.lastIndexOf('/') + 1)
      : p;
    await openFile(p, name);
    opened++;
  }
  return opened;
}

/** Open external files AND/OR folders picked via the native OS dialog.
 *  One click, one dialog, both kinds selectable (macOS: custom
 *  `pick_external_paths` Rust command — NSOpenPanel with canChooseFiles +
 *  canChooseDirectories, which tauri-plugin-dialog/rfd does not expose;
 *  other platforms fall back to the plugin's files-only dialog).
 *  Picked folders are registered in the Files-panel external tree, picked
 *  files open as external tabs. Returns the number of items handled. Used
 *  by the Files-panel button and the command palette; routing is shared
 *  with every other external-path entry point via `openExternalPaths`. */
export async function openExternalFile(): Promise<number> {
  if (!isTauri()) return 0;
  let paths: string[] | null;
  let useFallback = false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    // null = user cancelled → return 0 (never open a second dialog)
    paths = await invoke<string[] | null>('pick_external_paths');
  } catch {
    // Command unsupported (non-macOS build) → plugin files-only dialog
    paths = null;
    useFallback = true;
  }
  if (useFallback) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const result = await open({
      multiple: true,
      // No explicit filters: the user owns the machine and may pick any file
      // Folyn has a handler for. Non-handled types fall back to the `code`
      // (plain-text) editor.
    });
    if (!result) return 0;
    paths = typeof result === 'string' ? [result] : (result as string[]);
  }
  if (!paths || paths.length === 0) return 0;
  // Same routing as every other external path entry point (drag-drop,
  // "Open With", single-instance handoff): dir → external folder tree,
  // file → external tab, with duplicate-aware toasts on folder failures.
  return openExternalPaths(paths);
}

/** Immediately save all tabs with pending auto-save timers. */
export async function flushAutoSaves(): Promise<void> {
  await flushAllAutoSaves((tabId) => saveFile(tabId));
}
