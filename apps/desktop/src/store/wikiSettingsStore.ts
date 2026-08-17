// ponytail: wiki behavior knobs (lint trigger, retention, cache ttl). One store,
// one persist slice. No hot reload — values read on next lint/ingest/restart.

import { create } from 'zustand';
import { registerPersistSlice } from './settingsPersistence';

export interface WikiSettingsState {
  autoAfterIngest: boolean;
  semanticManualOnly: boolean;
  archiveRetentionDays: number;
  queryCacheTtlMinutes: number;

  setAutoAfterIngest: (v: boolean) => void;
  setSemanticManualOnly: (v: boolean) => void;
  setArchiveRetentionDays: (v: number) => void;
  setQueryCacheTtlMinutes: (v: number) => void;
  hydrate: (blob: Record<string, unknown>) => void;
}

export const useWikiSettingsStore = create<WikiSettingsState>((set) => ({
  autoAfterIngest: true,
  semanticManualOnly: true,
  archiveRetentionDays: 30,
  queryCacheTtlMinutes: 5,

  setAutoAfterIngest: (v) => { set({ autoAfterIngest: v }); persist(); },
  setSemanticManualOnly: (v) => { set({ semanticManualOnly: v }); persist(); },
  setArchiveRetentionDays: (v) => { set({ archiveRetentionDays: Math.max(1, v) }); persist(); },
  setQueryCacheTtlMinutes: (v) => { set({ queryCacheTtlMinutes: Math.max(0, v) }); persist(); },

  hydrate: (blob) => {
    const patch: Partial<WikiSettingsState> = {};
    if (typeof blob.autoAfterIngest === 'boolean') patch.autoAfterIngest = blob.autoAfterIngest;
    if (typeof blob.semanticManualOnly === 'boolean') patch.semanticManualOnly = blob.semanticManualOnly;
    if (typeof blob.archiveRetentionDays === 'number') patch.archiveRetentionDays = blob.archiveRetentionDays;
    if (typeof blob.queryCacheTtlMinutes === 'number') patch.queryCacheTtlMinutes = blob.queryCacheTtlMinutes;
    if (Object.keys(patch).length > 0) set(patch);
  },
}));

const persist = registerPersistSlice({
  name: 'wiki',
  keys: ['autoAfterIngest', 'semanticManualOnly', 'archiveRetentionDays', 'queryCacheTtlMinutes'] as const,
  getState: () => {
    const s = useWikiSettingsStore.getState();
    return {
      autoAfterIngest: s.autoAfterIngest,
      semanticManualOnly: s.semanticManualOnly,
      archiveRetentionDays: s.archiveRetentionDays,
      queryCacheTtlMinutes: s.queryCacheTtlMinutes,
    };
  },
  hydrate: (blob) => useWikiSettingsStore.getState().hydrate(blob),
});
