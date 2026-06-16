import { storageClient } from '@/utils/storageClient';
import type { FileTab, FileType, ViewMode } from './editorStore';
import type { ActivityPanel } from '@/components/shell/ActivityBar';

export interface PersistedTabInfo {
  path: string;
  name: string;
  fileType?: FileType;
  activity?: ActivityPanel;
  cursorLine?: number;
  cursorCol?: number;
  viewMode?: ViewMode;
}

export interface PersistedOpenTabs {
  tabs: PersistedTabInfo[];
  activeTabPath: string | null;
}

function openTabsStorageKey(vaultId: string): string {
  return `editor:openTabs:${vaultId}`;
}

let persistTabsTimer: ReturnType<typeof setTimeout> | null = null;

export function persistOpenTabs(vaultId: string, tabs: FileTab[], activeTabId: string | null) {
  if (persistTabsTimer) clearTimeout(persistTabsTimer);
  persistTabsTimer = setTimeout(() => {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    const data: PersistedOpenTabs = {
      tabs: tabs.map((t) => ({ path: t.path, name: t.name, fileType: t.fileType, activity: t.activity, cursorLine: t.cursorLine, cursorCol: t.cursorCol, viewMode: t.viewMode })),
      activeTabPath: activeTab?.path ?? null,
    };
    storageClient.set(openTabsStorageKey(vaultId), data);
  }, 500);
}

export function flushPersistOpenTabs(vaultId: string, tabs: FileTab[], activeTabId: string | null) {
  if (persistTabsTimer) clearTimeout(persistTabsTimer);
  persistTabsTimer = null;
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const data: PersistedOpenTabs = {
    tabs: tabs.map((t) => ({ path: t.path, name: t.name, fileType: t.fileType, activity: t.activity, cursorLine: t.cursorLine, cursorCol: t.cursorCol, viewMode: t.viewMode })),
    activeTabPath: activeTab?.path ?? null,
  };
  storageClient.set(openTabsStorageKey(vaultId), data);
}

export async function loadPersistedOpenTabs(vaultId: string): Promise<PersistedOpenTabs | null> {
  return storageClient.get<PersistedOpenTabs>(openTabsStorageKey(vaultId));
}
