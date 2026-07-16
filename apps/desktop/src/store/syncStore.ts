import { create } from 'zustand';
import { registerPersistSlice, schedulePersist } from './settingsPersistence';

export const PERSIST_KEYS_SYNC = [
  'syncMethod',
  'syncEndpoint',
  'syncAccessKey',
  'syncSecretKey',
  'syncBucket',
  'autoSync',
  'e2eEncrypt',
] as const;

export interface SyncState {
  syncMethod: string;
  syncEndpoint: string;
  syncAccessKey: string;
  syncSecretKey: string;
  syncBucket: string;
  autoSync: boolean;
  e2eEncrypt: boolean;

  setSyncMethod: (v: string) => void;
  setSyncEndpoint: (v: string) => void;
  setSyncAccessKey: (v: string) => void;
  setSyncSecretKey: (v: string) => void;
  setSyncBucket: (v: string) => void;
  setAutoSync: (v: boolean) => void;
  setE2eEncrypt: (v: boolean) => void;

  /** Load this store's slice from the persisted `settings:all` blob. */
  hydrate: (blob: Record<string, unknown>) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  syncMethod: 'S3 兼容（R2 / MinIO）',
  syncEndpoint: '',
  syncAccessKey: '',
  syncSecretKey: '',
  syncBucket: '',
  autoSync: true,
  e2eEncrypt: false,

  setSyncMethod: (v) => { set({ syncMethod: v }); schedulePersist(); },
  setSyncEndpoint: (v) => { set({ syncEndpoint: v }); schedulePersist(); },
  setSyncAccessKey: (v) => { set({ syncAccessKey: v }); schedulePersist(); },
  setSyncSecretKey: (v) => { set({ syncSecretKey: v }); schedulePersist(); },
  setSyncBucket: (v) => { set({ syncBucket: v }); schedulePersist(); },
  setAutoSync: (v) => { set({ autoSync: v }); schedulePersist(); },
  setE2eEncrypt: (v) => { set({ e2eEncrypt: v }); schedulePersist(); },

  hydrate: (blob) => {
    const patch: Partial<SyncState> = {};
    if (blob.syncMethod !== undefined) patch.syncMethod = blob.syncMethod as string;
    if (blob.syncEndpoint !== undefined) patch.syncEndpoint = blob.syncEndpoint as string;
    if (blob.syncAccessKey !== undefined) patch.syncAccessKey = blob.syncAccessKey as string;
    if (blob.syncSecretKey !== undefined) patch.syncSecretKey = blob.syncSecretKey as string;
    if (blob.syncBucket !== undefined) patch.syncBucket = blob.syncBucket as string;
    if (blob.autoSync !== undefined) patch.autoSync = blob.autoSync as boolean;
    if (blob.e2eEncrypt !== undefined) patch.e2eEncrypt = blob.e2eEncrypt as boolean;
    if (Object.keys(patch).length > 0) set(patch);
  },
}));

registerPersistSlice({
  keys: PERSIST_KEYS_SYNC,
  getState: () => useSyncStore.getState() as unknown as Record<string, unknown>,
  hydrate: (blob) => useSyncStore.getState().hydrate(blob),
});
