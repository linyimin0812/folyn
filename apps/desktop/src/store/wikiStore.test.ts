import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useWikiStore } from './wikiStore';
import type { WikiEntry, ReviewItem } from '@/types/wiki';

// Stub the wiki provider so no real Tauri FS / vault lookups run.
vi.mock('@/services/wikiProvider', () => ({
  wikiProvider: {
    init: vi.fn(),
    listFiles: vi.fn(),
    readReviews: vi.fn(),
    writeReviews: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

import { wikiProvider } from '@/services/wikiProvider';

const sampleFiles: WikiEntry[] = [
  { path: 'entities/react.md', name: 'react.md', type: 'file' },
  { path: 'concepts', name: 'concepts', type: 'dir', children: [{ path: 'concepts/hooks.md', name: 'hooks.md', type: 'file' }] },
];

const sampleReviews: ReviewItem[] = [
  { id: 'r1', type: 'contradiction', title: 'A', description: 'd', affectedPages: [], suggestedActions: [], createdAt: 1, status: 'pending' },
  { id: 'r2', type: 'low_confidence', title: 'B', description: 'd', affectedPages: [], suggestedActions: [], createdAt: 2, status: 'resolved' },
  { id: 'r3', type: 'merge_suggestion', title: 'C', description: 'd', affectedPages: [], suggestedActions: [], createdAt: 3, status: 'dismissed' },
];

beforeEach(() => {
  vi.clearAllMocks();
  useWikiStore.setState({
    isInitialized: false,
    wikiRoot: '',
    wikiFiles: [],
    reviewItems: [],
    ingestQueue: [],
    isIngesting: false,
    isLinting: false,
    currentIngestStep: null,
    ingestProgress: '',
    activityLog: [],
  });
});

describe('useWikiStore.initWiki', () => {
  it('initializes root, files, and pending reviews from the provider', async () => {
    vi.mocked(wikiProvider.init).mockResolvedValueOnce('/vault/__wiki__');
    vi.mocked(wikiProvider.listFiles).mockResolvedValueOnce(sampleFiles);
    vi.mocked(wikiProvider.readReviews).mockResolvedValueOnce(sampleReviews);

    await useWikiStore.getState().initWiki();

    const s = useWikiStore.getState();
    expect(s.isInitialized).toBe(true);
    expect(s.wikiRoot).toBe('/vault/__wiki__');
    expect(s.wikiFiles).toBe(sampleFiles);
    // Only pending reviews are kept on init.
    expect(s.reviewItems.map((r) => r.id)).toEqual(['r1']);
  });

  it('refreshWikiFiles reloads the file list from the provider', async () => {
    vi.mocked(wikiProvider.listFiles).mockResolvedValueOnce(sampleFiles);
    await useWikiStore.getState().refreshWikiFiles();
    expect(useWikiStore.getState().wikiFiles).toBe(sampleFiles);
  });
});

describe('useWikiStore ingest queue', () => {
  it('addToIngestQueue appends pending tasks with generated ids', () => {
    useWikiStore.getState().addToIngestQueue(['a.md', 'b.md']);
    const q = useWikiStore.getState().ingestQueue;
    expect(q).toHaveLength(2);
    expect(q.every((t) => t.status === 'pending')).toBe(true);
    expect(q[0].id).not.toBe(q[1].id);
    expect(q.map((t) => t.filePath)).toEqual(['a.md', 'b.md']);
  });

  it('setIngestStatus updates a task status and error', () => {
    useWikiStore.getState().addToIngestQueue(['a.md']);
    const id = useWikiStore.getState().ingestQueue[0].id;
    useWikiStore.getState().setIngestStatus(id, 'error', 'boom');
    const t = useWikiStore.getState().ingestQueue[0];
    expect(t.status).toBe('error');
    expect(t.error).toBe('boom');
  });

  it('clearIngestQueue empties the queue', () => {
    useWikiStore.getState().addToIngestQueue(['a.md']);
    useWikiStore.getState().clearIngestQueue();
    expect(useWikiStore.getState().ingestQueue).toEqual([]);
  });

  it('setIngesting / setLinting / setIngestProgress update flags', () => {
    useWikiStore.getState().setIngesting(true, 1);
    expect(useWikiStore.getState().isIngesting).toBe(true);
    expect(useWikiStore.getState().currentIngestStep).toBe(1);
    useWikiStore.getState().setLinting(true);
    expect(useWikiStore.getState().isLinting).toBe(true);
    useWikiStore.getState().setIngestProgress('working');
    expect(useWikiStore.getState().ingestProgress).toBe('working');
  });
});

describe('useWikiStore activity log', () => {
  it('pushActivity appends timestamped entries', () => {
    useWikiStore.getState().pushActivity('info', 'started');
    useWikiStore.getState().pushActivity('success', 'done');
    const log = useWikiStore.getState().activityLog;
    expect(log).toHaveLength(2);
    expect(log[0].message).toBe('started');
    expect(log[1].type).toBe('success');
    expect(log.every((e) => typeof e.timestamp === 'number')).toBe(true);
  });

  it('caps the log at 100 entries (keeps the last 99 + new)', () => {
    for (let i = 0; i < 105; i++) useWikiStore.getState().pushActivity('step', `m${i}`);
    const log = useWikiStore.getState().activityLog;
    expect(log).toHaveLength(100);
    expect(log[0].message).toBe('m5'); // first 5 dropped (slice(-99) each push)
  });

  it('clearActivityLog empties the log', () => {
    useWikiStore.getState().pushActivity('info', 'x');
    useWikiStore.getState().clearActivityLog();
    expect(useWikiStore.getState().activityLog).toEqual([]);
  });
});

describe('useWikiStore review items', () => {
  it('addReviewItems appends and persists via writeReviews', () => {
    useWikiStore.getState().addReviewItems([sampleReviews[0]]);
    expect(useWikiStore.getState().reviewItems).toHaveLength(1);
    expect(wikiProvider.writeReviews).toHaveBeenCalledWith(useWikiStore.getState().reviewItems);
  });

  it('resolveReviewItem marks a review as resolved and persists', () => {
    useWikiStore.setState({ reviewItems: [sampleReviews[0]] });
    useWikiStore.getState().resolveReviewItem('r1');
    expect(useWikiStore.getState().reviewItems[0].status).toBe('resolved');
    expect(wikiProvider.writeReviews).toHaveBeenCalled();
  });

  it('dismissReviewItem marks a review as dismissed and persists', () => {
    useWikiStore.setState({ reviewItems: [sampleReviews[0]] });
    useWikiStore.getState().dismissReviewItem('r1');
    expect(useWikiStore.getState().reviewItems[0].status).toBe('dismissed');
  });

  it('clearResolvedReviews drops resolved/dismissed, keeping only pending', () => {
    useWikiStore.setState({ reviewItems: sampleReviews });
    useWikiStore.getState().clearResolvedReviews();
    const items = useWikiStore.getState().reviewItems;
    expect(items.map((r) => r.id)).toEqual(['r1']);
    expect(wikiProvider.writeReviews).toHaveBeenCalledWith(items);
  });
});

describe('useWikiStore read/write delegation', () => {
  it('readWikiFile delegates to wikiProvider.readFile', async () => {
    vi.mocked(wikiProvider.readFile).mockResolvedValueOnce('content');
    const out = await useWikiStore.getState().readWikiFile('entities/react.md');
    expect(out).toBe('content');
    expect(wikiProvider.readFile).toHaveBeenCalledWith('entities/react.md');
  });

  it('writeWikiFile delegates to wikiProvider.writeFile', async () => {
    vi.mocked(wikiProvider.writeFile).mockResolvedValueOnce(undefined);
    await useWikiStore.getState().writeWikiFile('entities/react.md', 'new');
    expect(wikiProvider.writeFile).toHaveBeenCalledWith('entities/react.md', 'new');
  });
});
