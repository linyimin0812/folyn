import { storageClient } from '@/utils/storageClient';
import { debounce } from '@/utils/debounce';
import { getSessionId } from '@/services/windowSessionService';
import type { FileTab, FileType, ViewMode } from './editorStore';
import type { ActivityPanel } from '@/components/shell/ActivityBar';

export interface PersistedTabInfo {
  path: string;
  name: string;
  /** Full tab id (instance id incl. `~N` duplicate discriminator, spec
   *  6.2). Restore reuses the SAME ids so per-tab runtime state keyed by id
   *  (view-state, find queries) lands on the right tab; duplicates of one
   *  path no longer collapse on restart. */
  id?: string;
  fileType?: FileType;
  activity?: ActivityPanel;
  pinned?: boolean;
  cursorLine?: number;
  cursorCol?: number;
  editorScrollTop?: number;
  previewScrollTop?: number;
  viewMode?: ViewMode;
  readingHeading?: { line: number; text: string };
}

export interface PersistedOpenTabs {
  tabs: PersistedTabInfo[];
  activeTabPath: string | null;
  /** Exact instance id of the active tab (spec 6.2) — the path alone is
   *  ambiguous once duplicate tabs exist. */
  activeTabId?: string | null;
}

// Session-scoped keys (spec 6.3 多窗口): each window hosts one session; a
// research window's tabs must not clobber the main window's (and vice
// versa). Before the first bind the service returns 'main'. Pre-session
// installs wrote `editor:openTabs:<vaultId>` / `editor:externalOpenTabs` —
// load-side fallbacks read them once so existing users' open tabs carry
// over; the first persist writes the session key and the legacy key goes
// stale (never read again).
function openTabsStorageKey(vaultId: string): string {
  return `editor:session:${getSessionId()}:tabs:${vaultId}`;
}

const LEGACY_OPEN_TABS_PREFIX = 'editor:openTabs:';

function externalOpenTabsStorageKey(): string {
  return `editor:session:${getSessionId()}:external`;
}

const LEGACY_EXTERNAL_OPEN_TABS_KEY = 'editor:externalOpenTabs';

function buildPersistedData(vaultId: string, tabs: FileTab[], activeTabId: string | null) {
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const data: PersistedOpenTabs = {
    tabs: tabs.map((t) => ({ id: t.id, path: t.path, name: t.name, fileType: t.fileType, activity: t.activity, pinned: t.pinned, cursorLine: t.cursorLine, cursorCol: t.cursorCol, editorScrollTop: t.editorScrollTop, previewScrollTop: t.previewScrollTop, viewMode: t.viewMode, readingHeading: t.readingHeading })),
    activeTabPath: activeTab?.path ?? null,
    activeTabId: activeTab?.id ?? null,
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
  const saved = await storageClient.get<PersistedOpenTabs>(openTabsStorageKey(vaultId));
  if (saved) return saved;
  return storageClient.get<PersistedOpenTabs>(`${LEGACY_OPEN_TABS_PREFIX}${vaultId}`);
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
      id: t.id,
      path: t.path,
      name: t.name,
      fileType: t.fileType,
      activity: t.activity,
      pinned: t.pinned,
      cursorLine: t.cursorLine,
      cursorCol: t.cursorCol,
      editorScrollTop: t.editorScrollTop,
      previewScrollTop: t.previewScrollTop,
      viewMode: t.viewMode,
      readingHeading: t.readingHeading,
    })),
    activeTabPath: activeTab?.path ?? null,
    activeTabId: activeTab?.id ?? null,
  };
  return data;
}

export function persistExternalOpenTabs(_scope: string, tabs: FileTab[], activeTabId: string | null) {
  const data = buildExternalPersistedData(tabs, activeTabId);
  storageClient.set(externalOpenTabsStorageKey(), data);
}

export function flushPersistExternalOpenTabs(_scope: string, tabs: FileTab[], activeTabId: string | null) {
  const data = buildExternalPersistedData(tabs, activeTabId);
  storageClient.set(externalOpenTabsStorageKey(), data);
}

export async function loadExternalOpenTabs(_scope: string): Promise<PersistedOpenTabs | null> {
  const saved = await storageClient.get<PersistedOpenTabs>(externalOpenTabsStorageKey());
  if (saved) return saved;
  return storageClient.get<PersistedOpenTabs>(LEGACY_EXTERNAL_OPEN_TABS_KEY);
}
