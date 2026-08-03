import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory FS mock — supports the path + fs helpers used by
// userProvidersCatalog and the modelRegistryStore persistence.
const FS: Map<string, string> = new Map();
const FAKE_HOME = '/tmp/test-home';

const { fetchModelsMock, ownerMapMock } = vi.hoisted(() => ({
  fetchModelsMock: vi.fn(),
  ownerMapMock: vi.fn(),
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
// on import; avoid touching storageClient in tests. registerPersistSlice
// now returns a persist closure the store captures; return a no-op.
vi.mock('./settingsPersistence', () => ({
  registerPersistSlice: vi.fn(() => () => {}),
}));

vi.mock('@/services/modelRegistry/fetchModels', () => ({
  fetchModels: fetchModelsMock,
}));

// Stub fetchOwnerMap — owner enrichment is a file-only concern; tests drive
// the owner map directly via `ownerMapMock`.
vi.mock('@/services/modelRegistry/fetchOwnerMap', () => ({
  fetchOwnerMap: ownerMapMock,
  mergeCapabilitiesIntoOwnerMap: vi.fn(async () => ({})),
  ownerLookupKey: (id: string) => {
    const slashIdx = id.indexOf('/');
    const after = slashIdx < 0 ? id : id.slice(slashIdx + 1);
    const colon = after.indexOf(':');
    return (colon < 0 ? after : after.slice(0, colon)).toLowerCase();
  },
}));

import { useModelRegistryStore } from './modelRegistryStore';

const FAKE_MODELS = [
  { id: 'claude-3-5-sonnet', providerId: 'anthropic', capabilities: [], inputModalities: [] },
  { id: 'gpt-4o', providerId: 'openai', capabilities: [], inputModalities: [] },
];

describe('useModelRegistryStore.fetchModelsForProvider — file cache + fallback', () => {
  beforeEach(() => {
    FS.clear();
    fetchModelsMock.mockReset();
    ownerMapMock.mockReset();
    useModelRegistryStore.getState().__reset();
  });

  it('writes fetched models with `owner` enriched from fetchOwnerMap', async () => {
    fetchModelsMock.mockResolvedValue({ models: FAKE_MODELS });
    ownerMapMock.mockResolvedValue({
      'claude-3-5-sonnet': { modelId: 'claude-3-5-sonnet', providerId: 'anthropic', capabilities: ['vision'] },
      'gpt-4o': { modelId: 'gpt-4o', providerId: 'openai', capabilities: ['vision', 'function-call'] },
    });
    const r = await useModelRegistryStore.getState().fetchModelsForProvider('anthropic', 'sk-test');
    expect(r.ok).toBe(true);
    // Wait for the fire-and-forget write.
    await new Promise((r) => setTimeout(r, 10));
    const file = FS.get('/tmp/test-home/.quill/providers/anthropic/models.json');
    expect(file).toBeDefined();
    const parsed = JSON.parse(file!) as Array<{ id: string; owner: string }>;
    expect(parsed.map((m) => ({ id: m.id, owner: m.owner }))).toEqual([
      { id: 'claude-3-5-sonnet', owner: 'anthropic' },
      { id: 'gpt-4o', owner: 'openai' },
    ]);
  });

  it('falls back owner to providerId when fetchOwnerMap returns empty', async () => {
    fetchModelsMock.mockResolvedValue({ models: FAKE_MODELS });
    ownerMapMock.mockResolvedValue({});
    await useModelRegistryStore.getState().fetchModelsForProvider('anthropic', 'sk-test');
    await new Promise((r) => setTimeout(r, 10));
    const file = FS.get('/tmp/test-home/.quill/providers/anthropic/models.json');
    const parsed = JSON.parse(file!) as Array<{ id: string; providerId: string; owner: string }>;
    expect(parsed[0].owner).toBe('anthropic');
    expect(parsed[1].owner).toBe('openai');
  });

  it('custom provider: enriches in-memory capabilities + group from owner map', async () => {
    // Custom-provider models come back with empty capabilities (Rust list_models
    // returns only ids; merge fallback gives []). The owner map fills both
    // capabilities and group (group = ownerEntry.providerId).
    const customModels = [
      { id: 'gpt-4o', providerId: 'my-custom', capabilities: [], inputModalities: ['text'] },
      { id: 'unknown-model', providerId: 'my-custom', capabilities: [], inputModalities: ['text'] },
    ];
    fetchModelsMock.mockResolvedValue({ models: customModels });
    ownerMapMock.mockResolvedValue({
      'gpt-4o': { modelId: 'gpt-4o', providerId: 'openai', capabilities: ['vision', 'function-call'] },
    });
    const r = await useModelRegistryStore.getState().fetchModelsForProvider('my-custom', 'sk-test', undefined, undefined, 'openai-completions');
    expect(r.ok).toBe(true);
    const s = useModelRegistryStore.getState();
    const models = s.modelsByProvider['my-custom']!;
    // Owner-map hit → capabilities + group filled.
    expect(models[0].capabilities).toEqual(['vision', 'function-call']);
    expect(models[0].group).toBe('openai');
    // Owner-map miss → capabilities stays [], group stays undefined (familyGroup fallback in UI).
    expect(models[1].capabilities).toEqual([]);
    expect(models[1].group).toBeUndefined();
  });

  it('bundled provider: catalog capabilities authoritative; empty caps fall back to owner map', async () => {
    // Bundled fetch — catalog already supplies capabilities for some. Owner
    // map is consulted as fallback when catalog returns [] (Rust list_models
    // returns [] for any model not in the bundled catalog). Group stays
    // undefined for bundled providers (catalog group is authoritative).
    const bundledModels = [
      { id: 'claude-3-5-sonnet', providerId: 'anthropic', capabilities: ['vision'], inputModalities: ['text'] },
      { id: 'qwen/qwen3.7-flash', providerId: 'openrouter', capabilities: [], inputModalities: ['text'] },
    ];
    fetchModelsMock.mockResolvedValue({ models: bundledModels });
    ownerMapMock.mockResolvedValue({
      'claude-3-5-sonnet': { modelId: 'claude-3-5-sonnet', providerId: 'WRONG', capabilities: ['reasoning'] },
      'qwen3.7-flash': { modelId: 'qwen3.7-flash', providerId: 'qwen', capabilities: ['vision', 'reasoning'] },
    });
    await useModelRegistryStore.getState().fetchModelsForProvider('anthropic', 'sk-test');
    const s = useModelRegistryStore.getState();
    // Non-empty catalog caps preserved; owner map's WRONG providerId ignored.
    expect(s.modelsByProvider.anthropic![0].capabilities).toEqual(['vision']);
    expect(s.modelsByProvider.anthropic![0].group).toBeUndefined();
    // Empty catalog caps filled from owner map; group stays undefined (bundled).
    expect(s.modelsByProvider.anthropic![1].capabilities).toEqual(['vision', 'reasoning']);
    expect(s.modelsByProvider.anthropic![1].group).toBeUndefined();
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
      'gpt-4o',
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


describe('useModelRegistryStore.setModelCapabilities', () => {
  beforeEach(() => {
    useModelRegistryStore.getState().__reset();
  });

  it('overwrites capabilities on the matched model and leaves siblings untouched', async () => {
    // Seed two models via the fetch path (owner map stub returns empty).
    ownerMapMock.mockResolvedValue({});
    fetchModelsMock.mockResolvedValue({
      models: [
        { id: 'gpt-4o', providerId: 'openai', capabilities: ['vision'], inputModalities: [] },
        { id: 'gpt-3.5', providerId: 'openai', capabilities: [], inputModalities: [] },
      ],
    });
    await useModelRegistryStore.getState().fetchModelsForProvider('openai', 'sk-test');

    useModelRegistryStore.getState().setModelCapabilities('openai', 'gpt-4o', ['reasoning', 'function-call']);

    const list = useModelRegistryStore.getState().modelsByProvider.openai!;
    expect(list[0].capabilities).toEqual(['reasoning', 'function-call']);
    expect(list[1].capabilities).toEqual([]);
  });

  it('no-op when provider has no cached list', () => {
    const before = useModelRegistryStore.getState().modelsByProvider.openai ?? [];
    useModelRegistryStore.getState().setModelCapabilities('openai', 'gpt-4o', ['reasoning']);
    expect(useModelRegistryStore.getState().modelsByProvider.openai ?? []).toEqual(before);
  });

  it('no-op when model id is not in the cached list', async () => {
    ownerMapMock.mockResolvedValue({});
    fetchModelsMock.mockResolvedValue({
      models: [
        { id: 'gpt-4o', providerId: 'openai', capabilities: ['vision'], inputModalities: [] },
      ],
    });
    await useModelRegistryStore.getState().fetchModelsForProvider('openai', 'sk-test');
    useModelRegistryStore.getState().setModelCapabilities('openai', 'no-such-model', ['reasoning']);
    expect(useModelRegistryStore.getState().modelsByProvider.openai![0].capabilities).toEqual(['vision']);
  });
});
