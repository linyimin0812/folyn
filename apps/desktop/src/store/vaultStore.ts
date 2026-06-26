import { create } from 'zustand';
import {
  VaultManager,
  VaultProviderRegistry,
  type VaultConfig,
  type VaultEntry,
} from '@quill/vault-provider';
import { useSettingsStore } from './settingsStore';
import { storageClient } from '@/utils/storageClient';
import { startVaultWatcher, stopVaultWatcher } from '@/utils/fileWatcher';
import { generateShortId as generateId } from '@/utils/idGenerator';
import { resolveBasePath } from '@/utils/pathResolver';

async function startWatcherForVault(config: VaultConfig) {
  if (config.providerType !== 'tauri') return;
  try {
    const resolved = await resolveBasePath(config.basePath);
    await startVaultWatcher(resolved);
  } catch (err) {
    console.warn('[VaultStore] Failed to start file watcher:', err);
  }
}

/** Convert a glob-like pattern to a RegExp for matching file/folder names */
function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

/** Check if a file/folder name matches any of the exclude patterns */
function matchesAnyPattern(name: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.includes('*') || pattern.includes('?')) {
      return patternToRegExp(pattern).test(name);
    }
    return name === pattern;
  });
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
}

/** Sync vault info to settingsStore */
function syncToSettings(config: VaultConfig | null) {
  if (config) {
    useSettingsStore.getState().setVaultName(config.name);
    useSettingsStore.getState().updateSettings({ vaultPath: config.basePath });
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
            await get().manager.switchVault(config);
            // Ensure vault root directory exists before listing files
            await get().manager.createDir('');
            await get().refreshFileTree();
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
            const { useAiStore } = await import('./aiStore');
            if (useEditorStore.getState().tabs.length > 0) {
              useEditorStore.getState().saveOpenTabs();
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

            useEditorStore.setState({ tabs: [], activeTabId: null });

            const renamedPairs = await get().migrateSpecialDirs();
            await get().refreshFileTree();

            // Restore saved tabs for the new vault, then rewrite any paths whose
            // on-disk prefix was renamed during migration.
            await useEditorStore.getState().restoreOpenTabs();
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
            const showHidden = useSettingsStore.getState().showHiddenFiles;
            const entries = await get().manager.listFiles('', true, showHidden);

            const excludeRaw = useSettingsStore.getState().excludePatterns || '';
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
          const dailyNotesDir = useSettingsStore.getState().dailyNotesDir;
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
      };
    },
);
