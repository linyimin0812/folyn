import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

const FS: Map<string, string> = new Map();
const FAKE_HOME = '/tmp/test-home';
const FAKE_NOW = Date.UTC(2026, 5, 15, 12, 0, 0); // 2026-06-15 12:00 UTC
const DAY_MS = 24 * 60 * 60 * 1000;

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('@tauri-apps/api/path', () => ({
  homeDir: vi.fn(async () => FAKE_HOME),
  join: vi.fn(async (...parts: string[]) => parts.filter(Boolean).join('/').replace(/\/+/g, '/')),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(async (p: string) => FS.has(p)),
  readTextFile: vi.fn(async (p: string) => {
    if (!FS.has(p)) throw new Error(`ENOENT: ${p}`);
    return FS.get(p) ?? '';
  }),
  writeTextFile: vi.fn(async (p: string, content: string) => { FS.set(p, content); return undefined; }),
  stat: vi.fn(async (p: string) => {
    if (!FS.has(p)) throw new Error(`ENOENT: ${p}`);
    return { isFile: true, isDirectory: false, isSymlink: false, size: 0, mtime: MTIMES.get(p) ?? null, ctime: null, atime: null, readonly: false, nlink: 0, inode: 0, dev: 0, uid: 0, gid: 0 };
  }),
}));

// Stub getUserProvidersDir — module under test imports it from
// userProvidersCatalog which itself reads the FS mocks above.
// No additional mock needed — it composes homeDir + join.

import { fetchOwnerMap } from './fetchOwnerMap';

const MTIMES: Map<string, Date> = new Map();
let nowOverride: number | null = null;
const REAL_NOW = Date.now;

function setOpenRouterResponse(models: Array<{ id: string; architecture?: { input_modalities?: string[] }; supported_parameters?: string[]; pricing?: { web_search?: string | null } }>) {
  invokeMock.mockImplementation(async (_cmd: string, _args: unknown) => {
    // Cycle through endpoints — two URLs hit; return same payload twice.
    return {
      status: 200,
      body: JSON.stringify({ data: models }),
    };
  });
}

function setFileMtime(path: string, mtime: Date) {
  MTIMES.set(path, mtime);
}

describe('fetchOwnerMap — disk cache + HTTP fallback', () => {
  beforeEach(() => {
    FS.clear();
    MTIMES.clear();
    invokeMock.mockReset();
    nowOverride = null;
    Date.now = () => nowOverride ?? FAKE_NOW;
  });

  afterAll(() => {
    Date.now = REAL_NOW;
  });

  it('first call: no cache file → hits OpenRouter, writes cache', async () => {
    setOpenRouterResponse([
      { id: 'openai/gpt-4o', architecture: { input_modalities: ['text', 'image'] }, supported_parameters: ['tools', 'structured_outputs'] },
      { id: 'anthropic/claude-3-5-sonnet' },
    ]);
    const map = await fetchOwnerMap();
    expect(invokeMock).toHaveBeenCalledTimes(2); // both endpoints
    expect(map['gpt-4o']).toEqual({
      modelId: 'gpt-4o',
      providerId: 'openai',
      capabilities: ['vision', 'function-call', 'structured-output'],
    });
    expect(map['claude-3-5-sonnet']).toEqual({
      modelId: 'claude-3-5-sonnet',
      providerId: 'anthropic',
      capabilities: [],
    });
    // Cache file written.
    const cachePath = '/tmp/test-home/.quill/providers/provider-models.json';
    expect(FS.has(cachePath)).toBe(true);
    const written = JSON.parse(FS.get(cachePath)!);
    expect(written['gpt-4o'].providerId).toBe('openai');
  });

  it('cache fresh (< 24h): no HTTP call, returns cached entries', async () => {
    const cachePath = '/tmp/test-home/.quill/providers/provider-models.json';
    const cachedMap = {
      'gpt-4o': { modelId: 'gpt-4o', providerId: 'openai', capabilities: ['vision'] },
    };
    FS.set(cachePath, JSON.stringify(cachedMap));
    // mtime = 2 hours ago (fresh).
    setFileMtime(cachePath, new Date(FAKE_NOW - 2 * 60 * 60 * 1000));

    const map = await fetchOwnerMap();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(map['gpt-4o']).toEqual(cachedMap['gpt-4o']);
  });

  it('cache stale (> 24h): hits OpenRouter and overwrites cache', async () => {
    const cachePath = '/tmp/test-home/.quill/providers/provider-models.json';
    const staleMap = {
      'old-model': { modelId: 'old-model', providerId: 'stale-provider', capabilities: [] },
    };
    FS.set(cachePath, JSON.stringify(staleMap));
    // mtime = 2 days ago (stale).
    setFileMtime(cachePath, new Date(FAKE_NOW - 2 * DAY_MS));

    setOpenRouterResponse([{ id: 'openai/new-model' }]);
    const map = await fetchOwnerMap();
    expect(invokeMock).toHaveBeenCalled();
    expect(map['new-model']).toEqual({
      modelId: 'new-model',
      providerId: 'openai',
      capabilities: [],
    });
    expect(map['old-model']).toBeUndefined(); // stale cache replaced
    const written = JSON.parse(FS.get(cachePath)!);
    expect(written['new-model']).toBeDefined();
    expect(written['old-model']).toBeUndefined();
  });

  it('web-search capability when pricing.web_search present', async () => {
    setOpenRouterResponse([
      { id: 'perplexity/sonar-pro', pricing: { web_search: '0.01' } },
    ]);
    const map = await fetchOwnerMap();
    expect(map['sonar-pro'].capabilities).toContain('web-search');
  });

  it('reasoning capability when supported_parameters includes "reasoning"', async () => {
    setOpenRouterResponse([
      { id: 'openai/o3', supported_parameters: ['reasoning', 'include_reasoning'] },
    ]);
    const map = await fetchOwnerMap();
    expect(map['o3'].capabilities).toContain('reasoning');
  });
});
