import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory FS mock — supports the path + fs helpers used by
// userProvidersCatalog and the modelRegistryStore persistence.
const FS: Map<string, string> = new Map();
const FAKE_HOME = '/tmp/test-home';

const { fetchModelsMock } = vi.hoisted(() => ({
  fetchModelsMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/path', () => ({
  homeDir: vi.fn(async () => FAKE_HOME),
  join: vi.fn(async (...parts: string[]) => parts.filter(Boolean).join('/').replace(/\/+/g, '/')),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(async (p: string) => FS.has(p)),
  mkdir: vi.fn(async (p: string) => { FS.set(p, ''); return undefined; }),
  readTextFile: vi.fn(async (p: string) => {
    if (!FS.has(p)) throw new Error(`ENOENT: ${p}`);
    return FS.get(p) ?? '';
  }),
  writeTextFile: vi.fn(async (p: string, content: string) => { FS.set(p, content); return undefined; }),
}));

// Stub settingsPersistence — modelRegistryStore registers a persist slice
// on import; avoid touching storageClient in tests.
vi.mock('./settingsPersistence', () => ({
  registerPersistSlice: vi.fn(),
  schedulePersist: vi.fn(),
}));

vi.mock('@/services/modelRegistry/fetchModels', () => ({
  fetchModels: fetchModelsMock,
}));

import { useModelRegistryStore } from './modelRegistryStore';

const FAKE_MODELS = [
  { id: 'claude-3-5-sonnet', providerId: 'anthropic', capabilities: [], inputModalities: [] },
  { id: 'claude-3-opus', providerId: 'anthropic', capabilities: [], inputModalities: [] },
];

describe('useModelRegistryStore.fetchModelsForProvider — file cache + fallback', () => {
  beforeEach(() => {
    FS.clear();
    fetchModelsMock.mockReset();
    useModelRegistryStore.getState().__reset();
  });

  it('writes fetched models to ~/.quill/providers/{pid}/models.json on success', async () => {
    fetchModelsMock.mockResolvedValue({ models: FAKE_MODELS });
    const r = await useModelRegistryStore.getState().fetchModelsForProvider('anthropic', 'sk-test');
    expect(r.ok).toBe(true);
    // Wait for the fire-and-forget write.
    await new Promise((r) => setTimeout(r, 0));
    const file = FS.get('/tmp/test-home/.quill/providers/anthropic/models.json');
    expect(file).toBeDefined();
    expect(JSON.parse(file!).map((m: { id: string }) => m.id)).toEqual([
      'claude-3-5-sonnet',
      'claude-3-opus',
    ]);
  });

  it('on fetch failure with cached file, repopulates models and appends "使用缓存数据" notice', async () => {
    // Seed cache file first.
    FS.set(
      '/tmp/test-home/.quill/providers/anthropic/models.json',
      JSON.stringify(FAKE_MODELS),
    );
    fetchModelsMock.mockRejectedValue({ detail: 'network down' });

    const r = await useModelRegistryStore.getState().fetchModelsForProvider('anthropic', 'sk-test');
    expect(r.ok).toBe(false);
    const s = useModelRegistryStore.getState();
    expect(s.modelsByProvider.anthropic?.map((m) => m.id)).toEqual([
      'claude-3-5-sonnet',
      'claude-3-opus',
    ]);
    expect(s.fetchErrorByProvider.anthropic).toContain('使用缓存数据');
    expect(s.fetchErrorByProvider.anthropic).toContain('network down');
  });

  it('on fetch failure with no cache, leaves models untouched and surfaces raw error', async () => {
    fetchModelsMock.mockRejectedValue({ detail: 'network down' });
    const r = await useModelRegistryStore.getState().fetchModelsForProvider('anthropic', 'sk-test');
    expect(r.ok).toBe(false);
    const s = useModelRegistryStore.getState();
    expect(s.modelsByProvider.anthropic ?? []).toEqual([]);
    expect(s.fetchErrorByProvider.anthropic).toBe('network down');
  });
});
