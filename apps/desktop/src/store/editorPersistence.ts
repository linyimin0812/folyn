import { storageClient } from '@/utils/storageClient';
import { debounce } from '@/utils/debounce';
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

const EXTERNAL_OPEN_TABS_KEY = 'editor:externalOpenTabs';

function buildPersistedData(vaultId: string, tabs: FileTab[], activeTabId: string | null) {
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const data: PersistedOpenTabs = {
    tabs: tabs.map((t) => ({ path: t.path, name: t.name, fileType: t.fileType, activity: t.activity, cursorLine: t.cursorLine, cursorCol: t.cursorCol, viewMode: t.viewMode })),
    activeTabPath: activeTab?.path ?? null,
  };
  return [vaultId, data] as const;
}

const debouncedPersistOpenTabs = debounce(
  (vaultId: string, tabs: FileTab[], activeTabId: string | null) => {
    const [id, data] = buildPersistedData(vaultId, tabs, activeTabId);
    storageClient.set(openTabsStorageKey(id), data);
  },
  500,
);

export function persistOpenTabs(vaultId: string, tabs: FileTab[], activeTabId: string | null) {
  debouncedPersistOpenTabs(vaultId, tabs, activeTabId);
}

export function flushPersistOpenTabs(vaultId: string, tabs: FileTab[], activeTabId: string | null) {
  debouncedPersistOpenTabs.cancel();
  const [, data] = buildPersistedData(vaultId, tabs, activeTabId);
  storageClient.set(openTabsStorageKey(vaultId), data);
}

export async function loadPersistedOpenTabs(vaultId: string): Promise<PersistedOpenTabs | null> {
  return storageClient.get<PersistedOpenTabs>(openTabsStorageKey(vaultId));
}

// ── External (vault-independent) tab persistence ─────────────────────────
// External tabs (files opened from outside the vault) are persisted under a
// single vault-independent key so they survive vault switches. The `tabs`
// passed in are expected to already be filtered to external paths, but this
// function also filters defensively so a stray vault tab is never written.
function isExternalTabPath(path: string): boolean {
  return path.startsWith('/') || path.startsWith('~') || path.startsWith('$HOME') || /^[A-Za-z]:[\/]/.test(path);
}

function buildExternalPersistedData(tabs: FileTab[], activeTabId: string | null) {
  const externalTabs = tabs.filter((t) => isExternalTabPath(t.path));
  const activeTab = externalTabs.find((t) => t.id === activeTabId);
  const data: PersistedOpenTabs = {
    tabs: externalTabs.map((t) => ({
      path: t.path,
      name: t.name,
      fileType: t.fileType,
      activity: t.activity,
      cursorLine: t.cursorLine,
      cursorCol: t.cursorCol,
      viewMode: t.viewMode,
    })),
    activeTabPath: activeTab?.path ?? null,
  };
  return data;
}

export function persistExternalOpenTabs(_scope: string, tabs: FileTab[], activeTabId: string | null) {
  const data = buildExternalPersistedData(tabs, activeTabId);
  storageClient.set(EXTERNAL_OPEN_TABS_KEY, data);
}

export function flushPersistExternalOpenTabs(_scope: string, tabs: FileTab[], activeTabId: string | null) {
  const data = buildExternalPersistedData(tabs, activeTabId);
  storageClient.set(EXTERNAL_OPEN_TABS_KEY, data);
}

export async function loadExternalOpenTabs(_scope: string): Promise<PersistedOpenTabs | null> {
  return storageClient.get<PersistedOpenTabs>(EXTERNAL_OPEN_TABS_KEY);
}
