import { watch, type WatchEvent } from '@tauri-apps/plugin-fs';
import { getHandlerById } from '@/components/file-types/registry';

type UnwatchFn = () => void;

let currentUnwatch: UnwatchFn | null = null;
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

function isModifyEvent(event: WatchEvent): boolean {
  if (event.type === 'any') return true;
  if (typeof event.type === 'object') {
    return 'modify' in event.type || 'create' in event.type;
  }
  return false;
}

function isStructureEvent(event: WatchEvent): boolean {
  if (typeof event.type === 'object') {
    return 'create' in event.type || 'remove' in event.type;
  }
  return false;
}

async function handleWatchEvent(event: WatchEvent) {
  if (paused) return;

  if (isStructureEvent(event)) {
    scheduleFileTreeRefresh();
  }

  if (!isModifyEvent(event)) return;

  const { useEditorStore } = await import('@/store/editorStore');
  const { useVaultStore } = await import('@/store/vaultStore');

  const { tabs, diffReviewMode, diffFilePath } = useEditorStore.getState();
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

      useEditorStore.getState().setContentExternal(tabId, diskContent);
    } catch {
      // file may have been deleted
    }
  }
}

export async function startVaultWatcher(basePath: string): Promise<void> {
  await stopVaultWatcher();
  currentBasePath = basePath.replace(/\/+$/, '');

  try {
    currentUnwatch = await watch(
      currentBasePath,
      handleWatchEvent,
      { recursive: true, delayMs: 500 },
    );
  } catch (err) {
    console.error('[FileWatcher] Failed to start:', err);
  }
}

export async function stopVaultWatcher(): Promise<void> {
  if (currentUnwatch) {
    try {
      currentUnwatch();
    } catch {
      // already stopped
    }
    currentUnwatch = null;
  }
  currentBasePath = '';
  if (pendingRefresh) {
    clearTimeout(pendingRefresh);
    pendingRefresh = null;
  }
}
