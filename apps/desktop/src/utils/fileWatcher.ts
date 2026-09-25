import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { watch, type WatchEvent } from '@tauri-apps/plugin-fs';
import { getHandlerById } from '@/components/file-types/registry';
import { isExternalPath } from '@/utils/isExternalPath';
import { externalFileProvider, resolveAbsolutePath } from '@/services/externalFileProvider';

interface EditorTab {
  id: string;
  path: string;
  fileType: string;
  content: string;
  isDirty: boolean;
}

let currentUnlisten: UnlistenFn | null = null;
let currentBasePath = '';

const suppressedPaths = new Set<string>();
let paused = false;

export function suppressWatcherFor(relativePath: string) {
  suppressedPaths.add(relativePath);
  setTimeout(() => suppressedPaths.delete(relativePath), 2000);
}

export function pauseWatcher() {
  paused = true;
}

export function resumeWatcher() {
  paused = false;
}

let pendingRefresh: ReturnType<typeof setTimeout> | null = null;

function scheduleFileTreeRefresh() {
  if (pendingRefresh) return;
  pendingRefresh = setTimeout(async () => {
    pendingRefresh = null;
    const { useVaultStore } = await import('@/store/vaultStore');
    useVaultStore.getState().refreshFileTree();
  }, 800);
}

interface WatcherEvent {
  type: string;
  paths: string[];
}

function isModifyEvent(type: string): boolean {
  return type.includes('Modify') || type.includes('Create') || type === 'any';
}

function isStructureEvent(type: string): boolean {
  return type.includes('Create') || type.includes('Remove');
}

async function handleWatchEvent(event: WatcherEvent) {
  if (paused) return;

  if (isStructureEvent(event.type)) {
    scheduleFileTreeRefresh();
  }

  if (!isModifyEvent(event.type)) return;

  const { useEditorStore } = await import('@/store/editorStore');
  const { useDiffReviewStore } = await import('@/store/diffReviewStore');
  const { useVaultStore } = await import('@/store/vaultStore');

  const { tabs } = useEditorStore.getState();
  const { diffReviewMode, diffFilePath } = useDiffReviewStore.getState();
  const vaultId = useVaultStore.getState().activeVaultId || '';

  for (const changedPath of event.paths) {
    if (!changedPath.startsWith(currentBasePath)) continue;

    const relativePath = changedPath.slice(currentBasePath.length).replace(/^\//, '');
    if (!relativePath) continue;
    if (suppressedPaths.has(relativePath)) continue;
    if (diffReviewMode && relativePath === diffFilePath) continue;

    const tabId = `${vaultId}:${relativePath}`;
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) continue;
    if (tab.isDirty) continue;

    const handler = getHandlerById(tab.fileType);
    if (!handler?.needsFileContent) continue;

    try {
      const raw = await useVaultStore.getState().readFile(relativePath);
      const diskContent = handler.deserialize ? handler.deserialize(raw) : raw;
      if (diskContent === tab.content) continue;

      // ponytail: setContentExternal moved to diffReviewStore (PR2) — bumps
      // externalContentVersion so editors watching it resync.
      useDiffReviewStore.getState().setContentExternal(tabId, diskContent);
    } catch {
      // file may have been deleted
    }
  }
}

/**
 * External-file (outside-the-vault) tabs aren't covered by the vault-root
 * watcher: they bypass the `startsWith(currentBasePath)` filter and their tab
 * ids (`ext:<path>`) never match the vault `${vaultId}:${relativePath}` lookup.
 * Instead each open external tab gets its own single-file watch via the fs
 * plugin, reconciled whenever the tab list changes.
 */
const externalWatches = new Map<string, () => void>();
const pendingWatches = new Set<string>();

function isExternalModifyEvent(type: WatchEvent['type']): boolean {
  if (typeof type === 'string') return type === 'any';
  return 'modify' in type || 'create' in type;
}

async function refreshExternalTab(path: string): Promise<void> {
  if (paused) return;
  if (suppressedPaths.has(path)) return;

  const { useEditorStore } = await import('@/store/editorStore');
  const { useDiffReviewStore } = await import('@/store/diffReviewStore');

  const tab = useEditorStore.getState().tabs.find((t) => t.id === `ext:${path}`);
  if (!tab || tab.isDirty) return;

  const handler = getHandlerById(tab.fileType);
  if (!handler?.needsFileContent) return;

  try {
    const raw = await externalFileProvider.readFile(path);
    const diskContent = handler.deserialize ? handler.deserialize(raw) : raw;
    if (diskContent === tab.content) return;
    useDiffReviewStore.getState().setContentExternal(tab.id, diskContent);
  } catch {
    // file may have been deleted
  }
}

export async function syncExternalWatches(tabs: EditorTab[]): Promise<void> {
  const wanted = new Set(tabs.map((t) => t.path).filter(isExternalPath));

  for (const [path, unwatch] of externalWatches) {
    if (!wanted.has(path)) {
      unwatch();
      externalWatches.delete(path);
    }
  }

  for (const path of wanted) {
    if (externalWatches.has(path) || pendingWatches.has(path)) continue;
    pendingWatches.add(path);
    try {
      const abs = await resolveAbsolutePath(path);
      const unwatch = await watch(abs, (event) => {
        if (isExternalModifyEvent(event.type)) void refreshExternalTab(path);
      });
      externalWatches.set(path, unwatch);
    } catch {
      // watch failed (file gone / scope denied) — nothing to refresh
    } finally {
      pendingWatches.delete(path);
    }
  }
}

/** One-time hook: keeps external-file watches in sync with open tabs. */
export async function initExternalFileWatcher(): Promise<void> {
  const { useEditorStore } = await import('@/store/editorStore');
  // Reconcile only when the set of external tab paths actually changes —
  // editorStore emits on every keystroke, a plain subscribe would reconcile
  // per keypress.
  const signature = (s: { tabs: EditorTab[] }) =>
    s.tabs
      .map((t) => t.path)
      .filter(isExternalPath)
      .sort()
      .join('\n');
  let last = signature(useEditorStore.getState());
  void syncExternalWatches(useEditorStore.getState().tabs);
  useEditorStore.subscribe((s) => {
    const cur = signature(s);
    if (cur === last) return;
    last = cur;
    void syncExternalWatches(s.tabs);
  });
}

export async function startVaultWatcher(basePath: string): Promise<void> {
  await stopVaultWatcher();
  currentBasePath = basePath.replace(/\/+$/, '');

  // Listen for events emitted by the Rust background-thread watcher.
  currentUnlisten = await listen<WatcherEvent>('app://vault-watcher-event', (e) => {
    void handleWatchEvent(e.payload);
  });

  // Start the watcher on a Rust background thread — returns immediately.
  // The heavy recursive watch setup (inotify/FSEvents for the whole tree)
  // happens off the JS/IPC thread, so it never blocks vault creation or UI.
  try {
    await invoke('start_vault_watcher', { root: currentBasePath });
  } catch (err) {
    console.error('[FileWatcher] Failed to start:', err);
    if (currentUnlisten) {
      currentUnlisten();
      currentUnlisten = null;
    }
  }
}

export async function stopVaultWatcher(): Promise<void> {
  // Tell the Rust thread to stop (sets the atomic flag it polls).
  try {
    await invoke('stop_vault_watcher');
  } catch {
    // command may not be registered yet on cold start
  }
  if (currentUnlisten) {
    try {
      currentUnlisten();
    } catch {
      // already stopped
    }
    currentUnlisten = null;
  }
  currentBasePath = '';
  if (pendingRefresh) {
    clearTimeout(pendingRefresh);
    pendingRefresh = null;
  }
}
