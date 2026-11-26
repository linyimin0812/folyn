/**
 * External-folder store — browse a real disk folder (outside the vault) in the
 * Files panel. The user picks a folder via the OS dialog; its contents are
 * listed as a VaultEntry-shaped tree rendered under the vault tree; clicking a
 * file opens it as a vault-independent external tab (the same
 * `editorIoService.openFile` route the single external file pick uses, so
 * read/write/persistence all flow through the existing external machinery).
 *
 * Persisted: folder paths only, via storageClient key `externalFolders`
 * (cross-restart, NOT session-scoped — a browsing folder outlives sessions,
 * unlike the research-window session model). On init each path is re-verified
 * (exists + within $HOME); missing folders are dropped and the persisted list
 * is trimmed, so stale entries never accumulate.
 *
 * Boundary: $HOME only — externalFileProvider (which serves the file reads)
 * enforces it; we reject an out-of-home pick up front with a readable error
 * instead of failing later on a scope-denied read.
 */

import { create } from 'zustand';
import type { VaultEntry } from '@folyn/vault-provider';
import { storageClient } from '@/utils/storageClient';
import { isWithinHome, isExternalPath } from '@/utils/isExternalPath';
import { isTauri } from '@/utils/platform';

const STORAGE_KEY = 'externalFolders';

/** Dot-dirs / dependency trees never worth browsing in a reading app. */
const SKIP_DIRS = new Set(['node_modules', '.git', '.DS_Store']);
const MAX_DEPTH = 8;

export interface ExternalFolder {
  /** Absolute path of the folder root. */
  path: string;
  /** Folder display name (last path segment). */
  name: string;
  /** VaultEntry-shaped tree of the folder contents (dirs first, sorted). */
  tree: VaultEntry[];
  /** Load/validation error for THIS folder (missing / out of home). */
  error?: string;
}

interface ExternalFolderState {
  folders: ExternalFolder[];
  /** Init/refresh in flight — Files panel can show a subtle loading state. */
  loading: boolean;
  /** Restore persisted folders (startup; no-op outside Tauri). */
  init: () => Promise<void>;
  /** Register a folder by known path (picker, drop from OS, deep link).
   *  Dedupe + $HOME boundary + existence checked; returns true when added. */
  addFolder: (path: string) => Promise<boolean>;
  /** Build the tree for one folder (also validates + trims state on miss). */
  refreshFolder: (path: string) => Promise<void>;
  /** Drop a folder from the list + persist. */
  removeFolder: (path: string) => void;
}

/** readDir entry shape from @tauri-apps/plugin-fs v2 — NOTE: it has NO
 *  `path` field (only name + type flags); the entry's absolute path must be
 *  composed by the caller as `join(dir, name)`. The plugin is dynamically
 *  imported so its types don't load in non-Tauri test runs. */
interface DirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
}

function lastName(absPath: string): string {
  const trimmed = absPath.replace(/[/\\]+$/, '');
  const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return i === -1 ? trimmed : trimmed.substring(i + 1) || trimmed;
}

/** Recursive listing → VaultEntry tree. Dirs first, then case-insensitive
 *  name order (matches the vault tree's visual language). Hidden entries
 *  (dot-prefixed) and dependency dirs are skipped; depth is capped so a
 *  pathological tree can't wedge the panel. */
async function buildTree(absPath: string, depth = 0): Promise<VaultEntry[]> {
  if (depth >= MAX_DEPTH) return [];
  const [{ readDir }, { join }] = await Promise.all([
    import('@tauri-apps/plugin-fs'),
    import('@tauri-apps/api/path'),
  ]);
  let entries: DirEntry[];
  try {
    entries = (await readDir(absPath)) as DirEntry[];
  } catch {
    return [];
  }
  const mapped: VaultEntry[] = [];
  for (const e of entries) {
    if (e.isSymlink) continue; // no cycle games in a browsing tree
    if (e.name.startsWith('.') && e.name !== '.') continue;
    // ponytail: DirEntry carries no path — compose dir + name (join is
    // separator-aware; string concat breaks Windows backslash paths).
    const childPath = await join(absPath, e.name);
    if (e.isDirectory) {
      if (SKIP_DIRS.has(e.name)) continue;
      const children = await buildTree(childPath, depth + 1);
      mapped.push({ name: e.name, path: childPath, type: 'dir', children });
    } else if (e.isFile) {
      mapped.push({ name: e.name, path: childPath, type: 'file' });
    }
  }
  mapped.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
  return mapped;
}

async function persistPaths(paths: string[]): Promise<void> {
  try {
    await storageClient.set(STORAGE_KEY, paths);
  } catch (err) {
    console.warn('[externalFolderStore] persist failed:', err);
  }
}

async function loadOne(absPath: string): Promise<ExternalFolder | null> {
  if (!(await isWithinHome(absPath))) return null;
  const { exists } = await import('@tauri-apps/plugin-fs');
  if (!(await exists(absPath))) return null;
  return { path: absPath, name: lastName(absPath), tree: await buildTree(absPath) };
}

export const useExternalFolderStore = create<ExternalFolderState>((set, get) => ({
  folders: [],
  loading: false,

  init: async () => {
    if (!isTauri()) return;
    set({ loading: true });
    try {
      const paths = (await storageClient.get<string[]>(STORAGE_KEY)) ?? [];
      const absPaths = (Array.isArray(paths) ? paths : []).filter(
        (p) => typeof p === 'string' && isExternalPath(p),
      );
      // ponytail: sequential, not Promise.all — isWithinHome dynamically
      // imports @tauri-apps/api/path, and concurrent dynamic imports under
      // vitest's vi.mock return an unmocked module instance (false negatives);
      // awaited sequentially each call resolves the mock correctly. Folder
      // counts are small; the sequential cost is noise.
      const results: (ExternalFolder | null)[] = [];
      for (const p of absPaths) {
        results.push(await loadOne(p));
      }
      const folders = results.filter((f): f is ExternalFolder => f != null);
      set({ folders });
      // Trim persisted list to the folders that actually resolved.
      if (folders.length !== absPaths.length) {
        await persistPaths(folders.map((f) => f.path));
      }
    } catch (err) {
      console.warn('[externalFolderStore] init failed:', err);
      set({ folders: [] });
    } finally {
      set({ loading: false });
    }
  },

  addFolder: async (path) => {
    if (!isTauri()) return false;
    if (get().folders.some((f) => f.path === path)) return false; // duplicate
    if (!(await isWithinHome(path))) return false; // $HOME boundary
    const folder = await loadOne(path);
    if (!folder) return false; // missing/unreadable
    set({ folders: [...get().folders, folder] });
    await persistPaths(get().folders.map((f) => f.path));
    return true;
  },

  refreshFolder: async (path) => {
    const folder = await loadOne(path);
    set({
      folders: get().folders.map((f) =>
        f.path === path
          ? folder ?? { ...f, tree: [], error: 'folder missing — removed on next reload' }
          : f,
      ),
    });
  },

  removeFolder: (path) => {
    const next = get().folders.filter((f) => f.path !== path);
    set({ folders: next });
    void persistPaths(next.map((f) => f.path));
  },
}));

/** Test seam: clear module-level cache state (storageClient cache + store). */
export function __clearExternalFolderCache(): void {
  useExternalFolderStore.setState({ folders: [], loading: false });
}
