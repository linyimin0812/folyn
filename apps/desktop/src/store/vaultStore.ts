import { create } from 'zustand';
import {
  VaultManager,
  VaultProviderRegistry,
  type VaultConfig,
  type VaultEntry,
} from '@quill/vault-provider';
import { useAppearanceStore } from './appearanceStore';
import { useVaultConfigStore } from './vaultConfigStore';
import { usePrefsStore } from './prefsStore';
import { storageClient } from '@/utils/storageClient';
import { startVaultWatcher, stopVaultWatcher } from '@/utils/fileWatcher';
import { generateShortId as generateId } from '@/utils/idGenerator';
import { resolveBasePath } from '@/utils/pathResolver';
import { seedAgentFiles } from '@/services/featureAgentService';
import { isExternalPath } from '@/utils/isExternalPath';
import { externalFileProvider } from '@/services/externalFileProvider';
import { cloneRepo, ensureGitignoreEntries, type BranchStrategy } from '@/services/gitService';
import { matchesAnyPattern } from '@/utils/excludePattern';
import { BUILTIN_EXCLUDE_DIRS } from './appearanceStore';

async function startWatcherForVault(config: VaultConfig) {
  // ponytail: github vaults clone to a local dir, so the file watcher applies
  // to them too — same on-disk layout as a local tauri vault.
  if (config.providerType !== 'tauri' && config.providerType !== 'github') return;
  try {
    const resolved = await resolveBasePath(config.basePath);
    await startVaultWatcher(resolved);
  } catch (err) {
    console.warn('[VaultStore] Failed to start file watcher:', err);
  }
}

/**
 * For a github vault, clone the repo into `basePath` on creation. Idempotent:
 * if the dir already exists with a `.git`, skip the clone (re-add of an
 * already-cloned vault); if it exists and is non-empty without `.git`, fail
 * loudly (refuse to clobber). Only `git clone` is run here — subsequent
 * connect() just opens the local dir, never re-cloning.
 */
async function prepareGithubVault(config: VaultConfig): Promise<void> {
  const opts = config.options as
    | { repoUrl?: string; auth?: string; token?: string; branchStrategy?: BranchStrategy }
    | undefined;
  if (!opts?.repoUrl) {
    throw new Error('GitHub vault requires a repo URL');
  }
  const absPath = await resolveBasePath(config.basePath);
  const { exists } = await import('@tauri-apps/plugin-fs');
  const { join } = await import('@tauri-apps/api/path');
  const dirExists = await exists(absPath);
  if (dirExists) {
    const hasGit = await exists(await join(absPath, '.git'));
    if (hasGit) return; // already cloned — open local, don't clobber
    // ponytail: surface the real reason instead of letting git clone fail
    // with a confusing "already exists and is not empty" message.
    throw new Error(`目标目录已存在且非 git 仓库：${absPath}`);
  }
  await cloneRepo(opts.repoUrl, absPath, {
    auth: (opts.auth as 'https-public' | 'https-private' | 'ssh') ?? 'https-public',
    token: opts.token,
    branch: opts.branchStrategy,
  });
  // Sync built-in managed dirs (__wiki__, __clips__, ...) into the cloned
  // repo's .gitignore so the auto-created local work dirs don't get pushed
  // back to the user's remote. Append-only; existing .gitignore preserved.
  // ponytail: failure is non-fatal — clone already succeeded; surface as
  // warning so a bad .gitignore state can't block vault creation.
  try {
    await ensureGitignoreEntries(absPath, BUILTIN_EXCLUDE_DIRS);
  } catch (err) {
    console.warn('[VaultStore] .gitignore sync after clone failed:', err);
  }
}

interface VaultState {
  /** The vault manager instance (singleton) */
  manager: VaultManager;
  /** All configured vaults */
  vaults: VaultConfig[];
  /** ID of the currently active vault */
  activeVaultId: string | null;
  /** Current vault configuration (derived from vaults + activeVaultId) */
  currentVault: VaultConfig | null;
  /** File tree entries for the current vault root */
  fileTree: VaultEntry[];
  /** Loading state */
  isLoading: boolean;
  /** Last error message */
  error: string | null;

  // ── Vault Management ──

  /** Initialize: connect to the last active vault, or create a default one */
  initVault: () => Promise<void>;
  /** Add a new vault and switch to it */
  addVault: (config: Omit<VaultConfig, 'id'>) => Promise<void>;
  /** Remove a vault configuration */
  removeVault: (id: string) => void;
  /** Switch to a different vault by ID */
  switchVault: (id: string) => Promise<void>;

  // ── Pinning ──

  pinnedPaths: string[];
  togglePin: (path: string) => void;

  // ── File Operations ──

  refreshFileTree: () => Promise<void>;
  /** One-time rename of legacy built-in dir names (quill-wiki/clips/reports/daily) to __name__ form. Returns the pairs actually renamed. */
  migrateSpecialDirs: () => Promise<{ from: string; to: string }[]>;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  createFile: (path: string, content?: string) => Promise<void>;
  deleteFile: (path: string) => Promise<void>;
  createDir: (path: string) => Promise<void>;
  deleteDir: (path: string) => Promise<void>;
  renameFile: (oldPath: string, newPath: string) => Promise<void>;
  moveFiles: (paths: string[], targetDir: string) => Promise<void>;
  copyPath: (srcPath: string, srcType: 'file' | 'dir', targetDir: string) => Promise<void>;
  /** Copy an external (absolute / `~` / `$HOME`) file into a vault directory.
   *  Reads the source via `externalFileProvider` (direct Tauri fs, `$HOME`-
   *  scoped) and writes it through the vault manager, so unlike `copyPath` it
   *  works for sources outside the vault. Resolves a non-colliding name
   *  (original name first, ` 副本` suffix on collision). Returns the new
   *  vault-relative path so the caller can open + reveal it. */
  copyExternalFileToVault: (srcExternalPath: string, targetDir: string) => Promise<string>;
}

/** Insert `suffix` before the file extension (or append for dirs/extensionless names). */
function addCopySuffix(name: string, suffix: string): string {
  const dot = name.lastIndexOf('.');
  if (dot > 0) return name.slice(0, dot) + suffix + name.slice(dot);
  return name + suffix;
}

/** Lazily yield copy-name candidates: same-dir starts at `<name> 副本`; other-dir starts at the original name. Collisions append ` 2`, ` 3`, ... */
function* copyNameCandidates(baseName: string, sameDir: boolean): Generator<string> {
  if (!sameDir) yield baseName;
  yield addCopySuffix(baseName, ' 副本');
  for (let n = 2; ; n++) yield addCopySuffix(baseName, ` 副本 ${n}`);
}

/** Resolve a non-colliding target name in `targetDir` based on the copy rules. */
async function resolveCopyName(
  manager: { listFiles: (path: string, recursive?: boolean, showHidden?: boolean) => Promise<VaultEntry[]> },
  targetDir: string,
  baseName: string,
  sameDir: boolean,
): Promise<string> {
  let existing: Set<string>;
  try {
    const entries = await manager.listFiles(targetDir, false, true);
    existing = new Set(entries.map((e) => e.name));
  } catch {
    existing = new Set();
  }
  let i = 0;
  for (const candidate of copyNameCandidates(baseName, sameDir)) {
    if (!existing.has(candidate)) return candidate;
    if (++i > 1000) throw new Error('Could not find a non-colliding copy name');
  }
  return baseName;
}

/** Recursively copy a directory's contents from srcPath into destPath. */
async function copyDirRecursive(
  manager: { listFiles: (path: string, recursive?: boolean, showHidden?: boolean) => Promise<VaultEntry[]>; createDir: (path: string) => Promise<void>; readFile: (path: string) => Promise<string>; writeFile: (path: string, content: string) => Promise<void> },
  srcPath: string,
  destPath: string,
): Promise<void> {
  await manager.createDir(destPath);
  const entries = await manager.listFiles(srcPath, false, true);
  for (const entry of entries) {
    const srcChild = `${srcPath}/${entry.name}`;
    const destChild = `${destPath}/${entry.name}`;
    if (entry.type === 'dir') {
      await copyDirRecursive(manager, srcChild, destChild);
    } else {
      const content = await manager.readFile(srcChild);
      await manager.writeFile(destChild, content);
    }
  }
}

/** Sync vault info to vaultConfigStore / appearanceStore */
function syncToSettings(config: VaultConfig | null) {
  if (config) {
    useAppearanceStore.getState().setVaultName(config.name);
    useVaultConfigStore.getState().setVaultPath(config.basePath);
  }
}

const STORAGE_KEY = 'vault:configs';

/** Persist vault configs to backend DB */
async function persistVaultConfigs(vaults: VaultConfig[], activeVaultId: string | null) {
  await storageClient.set(STORAGE_KEY, { vaults, activeVaultId });
}

export const useVaultStore = create<VaultState>()(
    (set, get) => {
      VaultProviderRegistry.getInstance();

      return {
        manager: new VaultManager(),
        vaults: [],
        activeVaultId: null,
        currentVault: null,
        fileTree: [],
        isLoading: false,
        error: null,
        pinnedPaths: [],

        initVault: async () => {
          // Load vault configs from local storage
          const saved = await storageClient.get<{ vaults: VaultConfig[]; activeVaultId: string | null }>(STORAGE_KEY);
          if (saved && saved.vaults.length > 0) {
            set({ vaults: saved.vaults, activeVaultId: saved.activeVaultId });
          }

          const { vaults, activeVaultId } = get();

          // If we have saved vaults, reconnect to the last active one
          if (vaults.length > 0) {
            const targetId = activeVaultId ?? vaults[0].id;
            try {
              await get().switchVault(targetId);
            } catch (err) {
              console.warn('[VaultStore] Failed to reconnect vault, clearing invalid config:', err);
              // Remove the broken vault and reset state
              set((state) => ({
                vaults: state.vaults.filter((v) => v.id !== targetId),
                activeVaultId: null,
                currentVault: null,
                fileTree: [],
                error: err instanceof Error ? err.message : 'Failed to connect vault',
              }));
            }
            return;
          }

          // No saved vaults — create a default one
          try {
            await get().addVault({
              name: 'default',
              providerType: 'tauri',
              basePath: '~/quill/default_vault',
            });
          } catch (err) {
            console.warn('[VaultStore] Failed to create default vault:', err);
          }
        },

        addVault: async (partial) => {
          const config: VaultConfig = {
            id: generateId(),
            name: partial.name,
            providerType: partial.providerType,
            basePath: partial.basePath,
            options: partial.options,
          };

          // Connect first — only add to list if successful
          set({ isLoading: true, error: null });
          try {
            if (config.providerType === 'github') {
              await prepareGithubVault(config);
            }
            await get().manager.switchVault(config);
            // Ensure vault root directory exists before listing files
            await get().manager.createDir('');
            await get().refreshFileTree();
            // Seed canonical feature agent files into <vault>/.claude/agents/ (write-if-missing).
            await seedAgentFiles(get().manager);
            // Connection succeeded — now persist the vault
            const newVaults = [...get().vaults, config];
            set({
              vaults: newVaults,
              currentVault: config,
              activeVaultId: config.id,
              pinnedPaths: [],
            });
            syncToSettings(config);
            await persistVaultConfigs(newVaults, config.id);
            await startWatcherForVault(config);
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to connect vault';
            set({ error: message });
            console.error('[VaultStore] addVault failed:', err);
            throw err; // Re-throw so CreateVaultDialog can show the error
          } finally {
            set({ isLoading: false });
          }
        },

        removeVault: (id) => {
          const newVaults = get().vaults.filter((v) => v.id !== id);
          const isCurrent = get().activeVaultId === id;
          set({
            vaults: newVaults,
            ...(isCurrent ? { activeVaultId: null, currentVault: null, fileTree: [] } : {}),
          });
          const newActiveId = isCurrent ? null : get().activeVaultId;
          persistVaultConfigs(newVaults, newActiveId);
        },

        switchVault: async (id) => {
          const config = get().vaults.find((v) => v.id === id);
          if (!config) {
            set({ error: `Vault not found: ${id}` });
            return;
          }

          set({ isLoading: true, error: null });
          try {
            // Save current vault state before switching (skip on initial startup when empty)
            const { useEditorStore } = await import('./editorStore');
            const editorIo = await import('@/services/editorIoService');
            const { useAiStore } = await import('./aiStore');
            if (useEditorStore.getState().tabs.length > 0) {
              editorIo.saveOpenTabs();
            }
            // Save AI sessions for current vault before activeVaultId changes
            await useAiStore.getState().switchVaultSessions(config.id);

            await stopVaultWatcher();
            await get().manager.switchVault(config);
            set({ currentVault: config, activeVaultId: config.id });
            syncToSettings(config);
            await persistVaultConfigs(get().vaults, config.id);

            // Load pinned paths for this vault
            const pinned = await storageClient.get<string[]>(`vault:pinned:${config.id}`);
            set({ pinnedPaths: pinned || [] });

            useEditorStore.setState((state) => ({
              // Preserve vault-independent external tabs across vault switches;
              // drop only the outgoing vault's relative-path tabs.
              tabs: state.tabs.filter((t) => isExternalPath(t.path)),
              activeTabId: null,
            }));

            // Seed canonical feature agent files into <vault>/.claude/agents/ (write-if-missing).
            // 提前到 manager 连接后、migrateSpecialDirs/refreshFileTree 之前——
            // 后者若抛错会跳过 seeding。独立 try/catch 确保不阻塞 switchVault。
            try {
              await seedAgentFiles(get().manager);
            } catch (err) {
              console.warn('[VaultStore] seedAgentFiles failed (call-time fallback will retry):', err);
            }

            const renamedPairs = await get().migrateSpecialDirs();
            await get().refreshFileTree();

            // Restore saved tabs for the new vault, then rewrite any paths whose
            // on-disk prefix was renamed during migration.
            await editorIo.restoreOpenTabs();
            if (renamedPairs.length > 0) {
              useEditorStore.getState().rewriteTabPrefixes(renamedPairs);
            }

            await startWatcherForVault(config);
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to switch vault';
            set({ error: message });
            console.error('[VaultStore] switchVault failed:', err);
          } finally {
            set({ isLoading: false });
          }
        },

        togglePin: async (path) => {
          const { pinnedPaths, activeVaultId } = get();
          const newPinned = pinnedPaths.includes(path)
            ? pinnedPaths.filter((p) => p !== path)
            : [...pinnedPaths, path];
          set({ pinnedPaths: newPinned });
          if (activeVaultId) {
            await storageClient.set(`vault:pinned:${activeVaultId}`, newPinned);
          }
        },

        refreshFileTree: async () => {
          try {
            const showHidden = useAppearanceStore.getState().showHiddenFiles;
            const entries = await get().manager.listFiles('', true, showHidden);

            const excludeRaw = useAppearanceStore.getState().excludePatterns || '';
            const patterns = excludeRaw
              .split('\n')
              .map((line) => line.trim())
              .filter((line) => line.length > 0 && !line.startsWith('#'));

            const filterEntries = (items: VaultEntry[]): VaultEntry[] => {
              if (patterns.length === 0) return items;
              return items
                .filter((entry) => !matchesAnyPattern(entry.name, patterns))
                .map((entry) => {
                  if (entry.type === 'dir' && entry.children) {
                    return { ...entry, children: filterEntries(entry.children) };
                  }
                  return entry;
                });
            };

            set({ fileTree: filterEntries(entries), error: null });
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to load file tree';
            set({ error: message });
            console.error('[VaultStore] refreshFileTree failed:', err);
          }
        },

        migrateSpecialDirs: async () => {
          const pairs: { from: string; to: string }[] = [
            { from: 'quill-wiki', to: '__wiki__' },
            { from: 'clips', to: '__clips__' },
            { from: 'reports', to: '__reports__' },
          ];
          // Only migrate the daily dir if the user is still on the old default.
          const dailyNotesDir = usePrefsStore.getState().dailyNotesDir;
          if (dailyNotesDir === 'daily') {
            pairs.push({ from: 'daily', to: '__daily__' });
          }

          try {
            const rootEntries = await get().manager.listFiles('', false, true);
            const names = new Set(rootEntries.map((e) => e.name));
            const renamed: { from: string; to: string }[] = [];
            for (const { from, to } of pairs) {
              if (!names.has(from)) continue;
              if (names.has(to)) {
                console.warn(`[VaultStore] migrateSpecialDirs: skipping "${from}" → "${to}" (target already exists)`);
                continue;
              }
              await get().manager.rename(from, to);
              renamed.push({ from, to });
            }
            return renamed;
          } catch (err) {
            console.error('[VaultStore] migrateSpecialDirs failed:', err);
            return [];
          }
        },

        readFile: async (filePath) => {
          return get().manager.readFile(filePath);
        },

        writeFile: async (filePath, content) => {
          await get().manager.writeFile(filePath, content);
        },

        createFile: async (filePath, content = '') => {
          await get().manager.writeFile(filePath, content);
          await get().refreshFileTree();
        },

        deleteFile: async (filePath) => {
          await get().manager.deleteFile(filePath);
          await get().refreshFileTree();
        },

        createDir: async (dirPath) => {
          await get().manager.createDir(dirPath);
          await get().refreshFileTree();
        },

        deleteDir: async (dirPath) => {
          await get().manager.deleteDir(dirPath);
          await get().refreshFileTree();
        },

        renameFile: async (oldPath, newPath) => {
          await get().manager.rename(oldPath, newPath);
          await get().refreshFileTree();
        },

        moveFiles: async (paths, targetDir) => {
          const manager = get().manager;

          const movedMap: [string, string][] = [];

          for (const srcPath of paths) {
            const basename = srcPath.includes('/') ? srcPath.substring(srcPath.lastIndexOf('/') + 1) : srcPath;
            const destPath = targetDir ? `${targetDir}/${basename}` : basename;

            const parentDir = srcPath.includes('/') ? srcPath.substring(0, srcPath.lastIndexOf('/')) : '';
            if (parentDir === targetDir) continue;
            if (targetDir.startsWith(srcPath + '/') || targetDir === srcPath) continue;

            try {
              await manager.rename(srcPath, destPath);
              movedMap.push([srcPath, destPath]);
            } catch (err) {
              console.error('[VaultStore] moveFiles rename failed:', srcPath, '→', destPath, err);
            }
          }

          if (movedMap.length > 0) {
            const { useEditorStore } = await import('./editorStore');
            const { tabs } = useEditorStore.getState();
            const updatedTabs = tabs.map((tab) => {
              for (const [oldPrefix, newPrefix] of movedMap) {
                if (tab.path === oldPrefix || tab.path.startsWith(oldPrefix + '/')) {
                  const newPath = newPrefix + tab.path.slice(oldPrefix.length);
                  const newName = newPath.includes('/') ? newPath.substring(newPath.lastIndexOf('/') + 1) : newPath;
                  return { ...tab, path: newPath, name: newName };
                }
              }
              return tab;
            });
            useEditorStore.setState({ tabs: updatedTabs });
          }

          await get().refreshFileTree();
        },

        copyPath: async (srcPath, srcType, targetDir) => {
          const manager = get().manager;
          const basename = srcPath.includes('/') ? srcPath.substring(srcPath.lastIndexOf('/') + 1) : srcPath;
          const parentDir = srcPath.includes('/') ? srcPath.substring(0, srcPath.lastIndexOf('/')) : '';
          const sameDir = parentDir === targetDir;

          const targetName = await resolveCopyName(manager, targetDir, basename, sameDir);
          const targetPath = targetDir ? `${targetDir}/${targetName}` : targetName;

          if (srcType === 'file') {
            const content = await manager.readFile(srcPath);
            await manager.writeFile(targetPath, content);
          } else {
            await copyDirRecursive(manager, srcPath, targetPath);
          }

          await get().refreshFileTree();
        },

        copyExternalFileToVault: async (srcExternalPath, targetDir) => {
          // Read the external source as raw bytes (binary). The earlier text
          // path (readFile → writeTextFile) went through a UTF-8 string
          // round-trip that corrupted non-text files — e.g. a copied .xlsx
          // / zip arrived truncated ("Corrupted zip" error in @file-viewer).
          // Binary read+write preserves bytes for any file type.
          const bytes = await externalFileProvider.readFileBytes(srcExternalPath);
          const baseName = srcExternalPath.includes('/')
            ? srcExternalPath.substring(srcExternalPath.lastIndexOf('/') + 1)
            : srcExternalPath;
          // External→vault is always a cross-dir copy (the source lives outside
          // the vault), so sameDir=false: try the original name first, then
          // ` 副本` suffixes on collision.
          const manager = get().manager;
          const targetName = await resolveCopyName(manager, targetDir, baseName, false);
          const targetPath = targetDir ? `${targetDir}/${targetName}` : targetName;
          await manager.writeFileBytes(targetPath, bytes);
          await get().refreshFileTree();
          return targetPath;
        },
      };
    },
);

/** Subscribe to vaultStore fileTree changes. The callback fires on each
 *  fileTree reference change (debounce by the caller if needed). Returns the
 *  unsubscribe fn. Shared by scheduleStore / studyStore workbench pages. */
export function subscribeToFileTree(cb: () => void): () => void {
  let prev = useVaultStore.getState().fileTree;
  return useVaultStore.subscribe((state) => {
    if (state.fileTree !== prev) {
      prev = state.fileTree;
      cb();
    }
  });
}

/** ponytail: broadcast fileTree + currentVault to secondary Tauri windows
 *  (pet-panel) that mount AiPanel in `embedded` mode. AiPanel's @-mention
 *  reads `useVaultStore.fileTree`, but secondary windows lack vault-path fs
 *  ACL — `refreshFileTree()` fails silently there. The main window owns the
 *  authoritative fileTree (via fs plugin + fileWatcher) and pushes it to
 *  secondary windows on change. Mirrors the `pet://settings-updated` pattern.
 *  Caller is responsible for only invoking this in the MAIN window — the
 *  pet-panel window listens via `listen('pet://file-tree-updated', …)` and
 *  requests a snapshot on mount via `pet://file-tree-request`. */
export function startFileTreeBroadcast(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const emit = async () => {
    if (stopped) return;
    try {
      const { emit } = await import('@tauri-apps/api/event');
      const { fileTree, currentVault } = useVaultStore.getState();
      await emit('pet://file-tree-updated', { currentVault, fileTree });
    } catch {
      // Non-tauri (tests) or emit failed — non-fatal.
    }
  };
  const debounce = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void emit();
    }, 300);
  };
  // Push initial state so a freshly-opened pet panel sees the current tree
  // without waiting for the next fileWatcher tick.
  void emit();
  const unsub = subscribeToFileTree(debounce);
  // ponytail: request-response. A secondary window that mounts AFTER the
  // initial emit misses it; if the vault is already loaded and stable, no
  // fileTree change fires to push it again. Listen for `pet://file-tree-request`
  // from secondary windows and re-emit the current snapshot. The listener is
  // main-window-only because startFileTreeBroadcast is only called from App.tsx.
  let reqUnlisten: (() => void) | undefined;
  (async () => {
    if (stopped) return;
    try {
      const { listen } = await import('@tauri-apps/api/event');
      reqUnlisten = await listen('pet://file-tree-request', () => {
        void emit();
      });
    } catch {
      // Non-tauri (tests) or listen failed — non-fatal.
    }
  })();
  return () => {
    stopped = true;
    unsub();
    reqUnlisten?.();
    if (timer) clearTimeout(timer);
  };
}
