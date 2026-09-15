/**
 * Zustand store for storage provider config. Holds the active provider
 * id + the html-image-mode toggle. Credentials live in
 * `~/.folyn/image-hosts/<provider>.json` via storageConfigStorage; the
 * store caches them in memory after `loadFromDisk()` and persists
 * debounced on every setter.
 *
 * Configs are opaque (`unknown`) keyed by provider id — each provider
 * owns its config shape; the host never narrows it. Defaults come from
 * each provider's `defaultConfig` via the registry, so built-ins and
 * extension providers are treated the same.
 *
 * ponytail: one store, registered as a persist slice named 'storage'
 * so settingsPersistence's loadSettings() picks it up. Mark in
 * EXPECTED_SLICES too.
 */
import { create } from 'zustand';
import { registerPersistSlice } from '../../store/settingsPersistence';
import { storageConfigStorage } from './storageConfigStorage';
import { getAllProviders } from './registry';

// Importing the built-ins registers R2/Qiniu/OSS into the registry at module
// load, before loadFromDisk() seeds defaults below.
import './builtinStorageProviders';

export interface StorageConfigState {
  /** Active provider id. */
  activeProvider: string;
  /** Per-provider config cache (loaded from disk; opaque per provider). */
  configs: Record<string, unknown>;
  loadFromDisk: () => Promise<void>;
  setActiveProvider: (id: string) => void;
  saveProviderConfig: (id: string, cfg: unknown) => Promise<void>;
  removeProviderConfig: (id: string) => Promise<void>;
  getActiveConfig: () => unknown | null;
}

function seedDefaults(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of getAllProviders()) out[p.id] = p.defaultConfig;
  return out;
}

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
  configs: seedDefaults(),

  async loadFromDisk() {
    const disk = await storageConfigStorage.load();
    const next: Record<string, unknown> = seedDefaults();
    for (const [id, cfg] of Object.entries(disk)) next[id] = cfg;
    set({ configs: next });
  },

  setActiveProvider(id) {
    set({ activeProvider: id });
    persist();
  },

  async saveProviderConfig(id, cfg) {
    await storageConfigStorage.set(id, cfg);
    set((s) => ({ configs: { ...s.configs, [id]: cfg } }));
  },

  async removeProviderConfig(id) {
    await storageConfigStorage.remove(id);
    const next: Record<string, unknown> = { ...get().configs };
    // Reset to the provider's default (or drop if unregistered).
    const entry = getAllProviders().find((p) => p.id === id);
    next[id] = entry ? entry.defaultConfig : undefined;
    set({ configs: next });
  },

  getActiveConfig() {
    const { configs, activeProvider } = get();
    return configs[activeProvider] ?? null;
  },
}));
