import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useClipStore, prepareBatchUrls, type BatchItem } from './clipStore';
import { normalizeUrl } from '@/utils/urlUtils';

// Mock the clip service so no real AI / vault IO runs.
vi.mock('@/services/clipService', () => ({
  clipUrl: vi.fn(async () => 'mocked/path.md'),
  generateClip: vi.fn(),
  saveClip: vi.fn(),
}));

import {
  clipUrl as clipUrlServiceMock,
  generateClip as generateClipMock,
  saveClip as saveClipMock,
} from '@/services/clipService';

// Mock vault store so loadClips / writeBatchSummary don't touch the filesystem.
vi.mock('@/store/vaultStore', () => ({
  useVaultStore: {
    getState: () => ({
      currentVault: { basePath: '/mock' },
      manager: { listFiles: async () => [], writeFile: async () => {} },
      createFile: async () => {},
      refreshFileTree: async () => {},
      readFile: async () => '',
    }),
    // expose setters used by store.getState() reads if needed
  },
}));

beforeEach(() => {
  useClipStore.setState({
    clips: [],
    clipGroups: [],
    allTags: [],
    isLoading: false,
    isClipping: false,
    error: null,
    pendingClip: null,
    clipProgress: '',
    aiStreamText: '',
    aiStreamEvents: [],
    clipUrls: new Map<string, string>(),
    batchItems: [],
    isBatchRunning: false,
    batchSummaryPath: null,
    // Stub loadClips so the force path doesn't touch the real vault.
    loadClips: async () => {},
  });
  vi.clearAllMocks();
});

describe('useClipStore.clipUrl force/overwrite', () => {
  it('passes the existing clip path as overwritePath when force=true', async () => {
    const url = 'https://example.com/article';
    const existingPath = '__clips__/tech/example-article.md';
    useClipStore.setState({
      clipUrls: new Map([[normalizeUrl(url), existingPath]]),
    });

    const result = await useClipStore.getState().clipUrl(url, undefined, undefined, { force: true });

    expect(result).toBe('mocked/path.md');
    const args = vi.mocked(clipUrlServiceMock).mock.calls[0] as unknown[];
    // clipService.clipUrl signature: (url, onProgress, lang, onStream, onEvent, overwritePath)
    expect(args[0]).toBe(url);
    expect(args[5]).toBe(existingPath);
  });

  it('does not pass overwritePath when force is not set', async () => {
    const url = 'https://example.com/other';
    useClipStore.setState({
      clipUrls: new Map([[normalizeUrl(url), '__clips__/tech/other.md']]),
    });

    await useClipStore.getState().clipUrl(url);

    const args = vi.mocked(clipUrlServiceMock).mock.calls[0] as unknown[];
    expect(args[0]).toBe(url);
    expect(args[5]).toBeUndefined();
  });

  it('falls back to no overwrite when force is set but no existing clip exists', async () => {
    const url = 'https://example.com/never-clipped';
    await useClipStore.getState().clipUrl(url, undefined, undefined, { force: true });

    const args = vi.mocked(clipUrlServiceMock).mock.calls[0] as unknown[];
    expect(args[0]).toBe(url);
    expect(args[5]).toBeUndefined();
  });
});

describe('prepareBatchUrls', () => {
  it('ignores empty lines and trims whitespace', () => {
    const items = prepareBatchUrls(['  https://a.com/x  ', '', '   ', 'https://b.com/y']);
    expect(items).toHaveLength(2);
    expect(items[0].url).toBe('https://a.com/x');
    expect(items[1].url).toBe('https://b.com/y');
    expect(items.every((i) => i.status === 'pending')).toBe(true);
  });

  it('marks within-batch duplicates as skipped (keeps first)', () => {
    const items = prepareBatchUrls([
      'https://example.com/a',
      'https://example.com/a#frag', // normalizes to the same key
      'https://example.com/a',
    ]);
    expect(items).toHaveLength(3);
    expect(items[0].status).toBe('pending');
    expect(items[1].status).toBe('skipped');
    expect(items[1].reason).toBe('批量内重复');
    expect(items[2].status).toBe('skipped');
  });

  it('marks invalid URLs as failed', () => {
    const items = prepareBatchUrls(['not-a-url', 'ftp://example.com/x', 'https://valid.com']);
    expect(items).toHaveLength(3);
    expect(items[0].status).toBe('failed');
    expect(items[1].status).toBe('failed');
    expect(items[2].status).toBe('pending');
  });

  it('dedupes after normalization (trailing slash / case)', () => {
    const items = prepareBatchUrls([
      'https://Example.com/path/',
      'https://example.com/path',
    ]);
    expect(items).toHaveLength(2);
    expect(items[0].status).toBe('pending');
    expect(items[1].status).toBe('skipped');
  });
});

describe('useClipStore.clipBatch', () => {
  function mockGenerateClip(url: string) {
    vi.mocked(generateClipMock).mockImplementation(async () => ({
      title: `Title for ${url}`,
      tags: ['tech'],
      suggestedTags: [],
      summary: 'summary',
      keyPoints: [],
      url,
    }));
  }

  function mockSaveClip(path: string) {
    vi.mocked(saveClipMock).mockImplementation(async () => path);
  }

  it('runs each pending URL through generateClip + saveClip and marks done', async () => {
    mockGenerateClip('https://a.com');
    mockSaveClip('__clips__/tech/a.md');

    const summary = await useClipStore.getState().clipBatch(['https://a.com', 'https://b.com']);

    expect(summary.done).toBe(2);
    expect(summary.failed).toBe(0);
    expect(summary.skipped).toBe(0);
    const items = useClipStore.getState().batchItems;
    expect(items.every((i) => i.status === 'done')).toBe(true);
    expect(items[0].clipPath).toBe('__clips__/tech/a.md');

    // saveClip must be called with skipAutoOpen: true (batch never opens files).
    const saveArgs = vi.mocked(saveClipMock).mock.calls[0] as unknown[];
    expect(saveArgs[2]).toEqual({ skipAutoOpen: true });
  });

  it('skips URLs that already exist when force is off', async () => {
    const url = 'https://example.com/exists';
    useClipStore.setState({
      clipUrls: new Map([[normalizeUrl(url), '__clips__/tech/exists.md']]),
    });

    const summary = await useClipStore.getState().clipBatch([url]);

    expect(summary.done).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(vi.mocked(generateClipMock)).not.toHaveBeenCalled();
    const item = useClipStore.getState().batchItems[0];
    expect(item.status).toBe('skipped');
    expect(item.reason).toBe('已存在');
    expect(item.clipPath).toBe('__clips__/tech/exists.md');
  });

  it('force toggle uses the overwrite path via findClipByUrl', async () => {
    const url = 'https://example.com/exists';
    const existingPath = '__clips__/tech/exists.md';
    useClipStore.setState({
      clipUrls: new Map([[normalizeUrl(url), existingPath]]),
    });
    mockGenerateClip(url);
    mockSaveClip(existingPath);

    const summary = await useClipStore.getState().clipBatch([url], { force: true });

    expect(summary.done).toBe(1);
    const saveArgs = vi.mocked(saveClipMock).mock.calls[0] as unknown[];
    expect(saveArgs[1]).toBe(existingPath); // overwritePath
    expect(saveArgs[2]).toEqual({ skipAutoOpen: true });
  });

  it('fail-soft: a failed URL is marked failed and the batch continues', async () => {
    vi.mocked(generateClipMock)
      .mockRejectedValueOnce(new Error('AI boom'))
      .mockResolvedValueOnce({
        title: 'ok', tags: [], suggestedTags: [], summary: '', keyPoints: [], url: 'https://b.com',
      });
    mockSaveClip('__clips__/tech/b.md');

    const summary = await useClipStore.getState().clipBatch([
      'https://a.com',
      'https://b.com',
    ]);

    expect(summary.failed).toBe(1);
    expect(summary.done).toBe(1);
    const items = useClipStore.getState().batchItems;
    expect(items[0].status).toBe('failed');
    expect(items[0].error).toBe('AI boom');
    expect(items[1].status).toBe('done');
  });

  it('within-batch duplicate: second occurrence is skipped without calling AI', async () => {
    mockGenerateClip('https://example.com/dup');
    mockSaveClip('__clips__/tech/dup.md');

    const summary = await useClipStore.getState().clipBatch([
      'https://example.com/dup',
      'https://example.com/dup#x', // normalizes equal
    ]);

    expect(summary.done).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(vi.mocked(generateClipMock)).toHaveBeenCalledTimes(1);
    const items = useClipStore.getState().batchItems;
    expect(items[1].status).toBe('skipped');
    expect(items[1].reason).toBe('批量内重复');
  });

  it('cancel stops the loop before the next URL; remaining items cancelled', async () => {
    // First URL resolves; we cancel before the second starts.
    mockGenerateClip('https://a.com');
    mockSaveClip('__clips__/tech/a.md');

    // Cancel right after the first saveClip resolves, before second iteration.
    vi.mocked(saveClipMock).mockImplementationOnce(async () => {
      useClipStore.getState().cancelBatch();
      return '__clips__/tech/a.md';
    });

    const summary = await useClipStore.getState().clipBatch([
      'https://a.com',
      'https://b.com',
      'https://c.com',
    ]);

    expect(summary.done).toBe(1);
    const items = useClipStore.getState().batchItems;
    expect(items[0].status).toBe('done');
    expect(items[1].status).toBe('cancelled');
    expect(items[2].status).toBe('cancelled');
    // Second URL never reached the AI.
    expect(vi.mocked(generateClipMock)).toHaveBeenCalledTimes(1);
  });

  it('guard: rejects a second concurrent batch', async () => {
    mockGenerateClip('https://a.com');
    // Make the first batch hang on generateClip so isBatchRunning stays true.
    let resolveFirst: () => void = () => {};
    vi.mocked(generateClipMock).mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; }),
    );

    const first = useClipStore.getState().clipBatch(['https://a.com']);
    // Wait a tick so the loop has entered.
    await new Promise((r) => setTimeout(r, 0));

    await expect(useClipStore.getState().clipBatch(['https://b.com']))
      .rejects.toThrow('批量剪藏正在进行中');

    resolveFirst();
    await first;
  });

  it('writes a summary file path on completion', async () => {
    mockGenerateClip('https://a.com');
    mockSaveClip('__clips__/tech/a.md');

    const summary = await useClipStore.getState().clipBatch(['https://a.com']);

    expect(summary.summaryPath).toMatch(/^__clips__\/batch-\d{4}-\d{2}-\d{2}\.md$/);
    expect(useClipStore.getState().batchSummaryPath).toBe(summary.summaryPath);
  });

  it('clearBatch resets items and summary path', async () => {
    useClipStore.setState({
      batchItems: [{ url: 'x', status: 'done' } as BatchItem],
      batchSummaryPath: '__clips__/batch-x.md',
    });
    useClipStore.getState().clearBatch();
    expect(useClipStore.getState().batchItems).toEqual([]);
    expect(useClipStore.getState().batchSummaryPath).toBeNull();
  });
});

