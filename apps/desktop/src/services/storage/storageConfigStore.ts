/**
 * Zustand store for storage provider config. Holds the active provider
 * id + the html-image-mode toggle. Credentials live in
 * `~/.folyn/image-hosts/<provider>.json` via storageConfigStorage; the
 * store caches them in memory after `loadFromDisk()` and persists
 * debounced on every setter.
 *
 * ponytail: one store, registered as a persist slice named 'storage'
 * so settingsPersistence's loadSettings() picks it up. Mark in
 * EXPECTED_SLICES too.
 */
import { create } from 'zustand';
import { registerPersistSlice } from '../../store/settingsPersistence';
import {
  storageConfigStorage,
  defaultR2Config,
  defaultQiniuConfig,
  defaultOssConfig,
} from './storageConfigStorage';
import type { ProviderConfig } from './types';
import { isR2Config, isQiniuConfig, isOssConfig } from './types';

export interface StorageConfigState {
  /** Active provider id ('r2' | 'qiniu' | future ids). */
  activeProvider: string;
  /** Per-provider config cache (loaded from disk). */
  configs: Partial<Record<string, ProviderConfig>>;
  loadFromDisk: () => Promise<void>;
  setActiveProvider: (id: string) => void;
  saveProviderConfig: (cfg: ProviderConfig) => Promise<void>;
  removeProviderConfig: (id: string) => Promise<void>;
  getActiveConfig: () => ProviderConfig | null;
}

const initialConfigs: Partial<Record<string, ProviderConfig>> = {
  r2: defaultR2Config(),
  qiniu: defaultQiniuConfig(),
  oss: defaultOssConfig(),
};

const persist = registerPersistSlice({
  name: 'storage',
  keys: ['activeProvider'] as const,
  getState: () => {
    const s = useStorageConfigStore.getState();
    return { activeProvider: s.activeProvider };
  },
  hydrate: (blob) => {
    if (typeof blob.activeProvider === 'string') {
      useStorageConfigStore.setState({ activeProvider: blob.activeProvider });
    }
  },
});

export const useStorageConfigStore = create<StorageConfigState>((set, get) => ({
  activeProvider: 'r2',
  configs: initialConfigs,

  async loadFromDisk() {
    const disk = await storageConfigStorage.load();
    const next: Partial<Record<string, ProviderConfig>> = {
      r2: disk.r2 ?? defaultR2Config(),
      qiniu: disk.qiniu ?? defaultQiniuConfig(),
      oss: disk.oss ?? defaultOssConfig(),
    };
    set({ configs: next });
  },

  setActiveProvider(id) {
    set({ activeProvider: id });
    persist();
  },

  async saveProviderConfig(cfg) {
    await storageConfigStorage.set(cfg);
    set((s) => ({ configs: { ...s.configs, [cfg.provider]: cfg } }));
  },

  async removeProviderConfig(id) {
    await storageConfigStorage.remove(id);
    const next: Partial<Record<string, ProviderConfig>> = { ...get().configs };
    next[id] = id === 'r2' ? defaultR2Config()
      : id === 'qiniu' ? defaultQiniuConfig()
      : id === 'oss' ? defaultOssConfig()
      : undefined;
    set({ configs: next });
  },

  getActiveConfig() {
    const { configs, activeProvider } = get();
    const cfg = configs[activeProvider] ?? null;
    if (!cfg) return null;
    if (isR2Config(cfg) || isQiniuConfig(cfg) || isOssConfig(cfg)) return cfg;
    return null;
  },
}));
