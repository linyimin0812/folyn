// apps/desktop/src/store/wikiStore.ts

import { create } from 'zustand';
import { wikiProvider } from '@/services/wikiProvider';
import type { WikiEntry, ReviewItem, IngestTask } from '@/types/wiki';
import { generateId } from '@/utils/idGenerator';

export interface ActivityLogEntry {
  id: string;
  timestamp: number;
  type: 'info' | 'success' | 'error' | 'step';
  message: string;
}

interface WikiState {
  isInitialized: boolean;
  wikiRoot: string;
  wikiFiles: WikiEntry[];
  reviewItems: ReviewItem[];
  ingestQueue: IngestTask[];
  isIngesting: boolean;
  isLinting: boolean;
  currentIngestStep: 1 | 2 | null;
  ingestProgress: string;
  activityLog: ActivityLogEntry[];

  initWiki: () => Promise<void>;
  refreshWikiFiles: () => Promise<void>;

  addToIngestQueue: (filePaths: string[]) => void;
  setIngestStatus: (taskId: string, status: IngestTask['status'], error?: string) => void;
  setIngesting: (ingesting: boolean, step?: 1 | 2 | null) => void;
  setLinting: (linting: boolean) => void;
  setIngestProgress: (msg: string) => void;
  clearIngestQueue: () => void;

  pushActivity: (type: ActivityLogEntry['type'], message: string) => void;
  clearActivityLog: () => void;

  addReviewItems: (items: ReviewItem[]) => void;
  resolveReviewItem: (id: string) => void;
  dismissReviewItem: (id: string) => void;
  clearResolvedReviews: () => void;
  executeReviewAction: (
    id: string,
    actionType: 'accept' | 'reject' | 'merge' | 'research',
    options?: { keptPath?: string },
  ) => Promise<{ applied: boolean; log: string }>;

  readWikiFile: (relativePath: string) => Promise<string>;
  writeWikiFile: (relativePath: string, content: string) => Promise<void>;
}

export const useWikiStore = create<WikiState>((set, _get) => ({
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

  initWiki: async () => {
    const root = await wikiProvider.init();
    const files = await wikiProvider.listFiles();
    const reviews = await wikiProvider.readReviews();
    set({
      isInitialized: true,
      wikiRoot: root,
      wikiFiles: files,
      reviewItems: reviews.filter((r) => r.status === 'pending'),
    });
  },

  refreshWikiFiles: async () => {
    const files = await wikiProvider.listFiles();
    set({ wikiFiles: files });
  },

  addToIngestQueue: (filePaths) => {
    const tasks: IngestTask[] = filePaths.map((fp) => ({
      id: generateId(),
      filePath: fp,
      status: 'pending',
    }));
    set((state) => ({ ingestQueue: [...state.ingestQueue, ...tasks] }));
  },

  setIngestStatus: (taskId, status, error) => {
    set((state) => ({
      ingestQueue: state.ingestQueue.map((t) =>
        t.id === taskId ? { ...t, status, error } : t,
      ),
    }));
  },

  setIngesting: (ingesting, step = null) => {
    set({ isIngesting: ingesting, currentIngestStep: step });
  },

  setLinting: (linting) => {
    set({ isLinting: linting });
  },

  setIngestProgress: (msg) => {
    set({ ingestProgress: msg });
  },

  clearIngestQueue: () => {
    set({ ingestQueue: [] });
  },

  pushActivity: (type, message) => {
    const entry: ActivityLogEntry = {
      id: generateId(),
      timestamp: Date.now(),
      type,
      message,
    };
    set((state) => ({
      activityLog: [...state.activityLog.slice(-99), entry],
    }));
  },

  clearActivityLog: () => {
    set({ activityLog: [] });
  },

  addReviewItems: (items) => {
    set((state) => {
      // D2.a dedup: drop new items whose dedupKey matches a resolved/dismissed item;
      // bump lastSeenAt on existing pending items with same key; otherwise append.
      const now = Date.now();
      const existingIdxByDedup = new Map<string, number>();
      state.reviewItems.forEach((r, idx) => {
        if (r.dedupKey) existingIdxByDedup.set(r.dedupKey, idx);
      });
      const toAdd: ReviewItem[] = [];
      const touchedIdx = new Set<number>();
      for (const item of items) {
        if (!item.dedupKey) {
          toAdd.push(item);
          continue;
        }
        const idx = existingIdxByDedup.get(item.dedupKey);
        if (idx === undefined) {
          toAdd.push(item);
          continue;
        }
        const existing = state.reviewItems[idx]!;
        if (existing.status === 'pending') {
          touchedIdx.add(idx);
        }
        // resolved/dismissed: silently drop the new item.
      }
      const base = state.reviewItems.map((r, idx) =>
        touchedIdx.has(idx) ? { ...r, lastSeenAt: now } : r,
      );
      const updated = [...base, ...toAdd];
      wikiProvider.writeReviews(updated);
      return { reviewItems: updated };
    });
  },

  resolveReviewItem: (id) => {
    set((state) => {
      const updated = state.reviewItems.map((r) =>
        r.id === id ? { ...r, status: 'resolved' as const, resolvedAt: Date.now() } : r,
      );
      wikiProvider.writeReviews(updated);
      return { reviewItems: updated };
    });
  },

  dismissReviewItem: (id) => {
    set((state) => {
      const updated = state.reviewItems.map((r) =>
        r.id === id ? { ...r, status: 'dismissed' as const, dismissedAt: Date.now() } : r,
      );
      wikiProvider.writeReviews(updated);
      return { reviewItems: updated };
    });
  },

  clearResolvedReviews: () => {
    set((state) => {
      const pending = state.reviewItems.filter((r) => r.status === 'pending');
      wikiProvider.writeReviews(pending);
      return { reviewItems: pending };
    });
  },

  executeReviewAction: async (id, actionType, options) => {
    const state = useWikiStore.getState();
    const item = state.reviewItems.find((r) => r.id === id);
    if (!item) return { applied: false, log: `review item ${id} not found` };
    // Lazy import to avoid circular dependency at module init.
    const { dispatchReviewAction } = await import('@/services/reviewActionHandlers');
    const result = await dispatchReviewAction(item, actionType, options ?? {});
    if (result.applied) {
      if (actionType === 'accept' || actionType === 'merge') {
        useWikiStore.getState().resolveReviewItem(id);
      } else if (actionType === 'reject') {
        useWikiStore.getState().dismissReviewItem(id);
      }
      // research: leave status pending, just inform.
    }
    useWikiStore.getState().pushActivity(result.applied ? 'success' : 'info', `${actionType} ${item.checkId ?? item.type}: ${result.log}`);
    return result;
  },

  readWikiFile: (relativePath) => wikiProvider.readFile(relativePath),
  writeWikiFile: (relativePath, content) => wikiProvider.writeFile(relativePath, content),
}));
