import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getHandlerById } from '@/components/file-types/registry';

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
