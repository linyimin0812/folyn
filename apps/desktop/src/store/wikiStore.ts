// apps/desktop/src/store/wikiStore.ts

import { create } from 'zustand';
import { wikiProvider } from '@/services/wikiProvider';
import type { WikiEntry, ReviewItem, IngestTask } from '@/types/wiki';

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

  readWikiFile: (relativePath: string) => Promise<string>;
  writeWikiFile: (relativePath: string, content: string) => Promise<void>;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
      const updated = [...state.reviewItems, ...items];
      wikiProvider.writeReviews(updated);
      return { reviewItems: updated };
    });
  },

  resolveReviewItem: (id) => {
    set((state) => {
      const updated = state.reviewItems.map((r) =>
        r.id === id ? { ...r, status: 'resolved' as const } : r,
      );
      wikiProvider.writeReviews(updated);
      return { reviewItems: updated };
    });
  },

  dismissReviewItem: (id) => {
    set((state) => {
      const updated = state.reviewItems.map((r) =>
        r.id === id ? { ...r, status: 'dismissed' as const } : r,
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

  readWikiFile: (relativePath) => wikiProvider.readFile(relativePath),
  writeWikiFile: (relativePath, content) => wikiProvider.writeFile(relativePath, content),
}));
