import { create } from 'zustand';
import { registerPersistSlice } from './settingsPersistence';

/**
 * Activity collector user settings (design §2.1/§8): global polling
 * kill-switch, per-collector enable/poll toggles + interval overrides, the
 * keepRaw/redact privacy switches, and the authSchema-rendered config values
 * keyed by collector id. The declaration side (what collectors exist) lives in
 * `services/activity/registry.ts` — this store owns only user preferences.
 */

// ponytail: collector configs (paths, tokens) persist as plain JSON via
// storageClient (~/.folyn/storage/activityCollectors.json). Design §8 requires
// keychain-first encryption — swap this slice's persist/get seam for a
// keychain client in part B; the store shape stays unchanged.
export const PERSIST_KEYS_ACTIVITY_COLLECTORS = [
  'pollOn',
  'keepRaw',
  'allowAiSummary',
  'redactPatterns',
  'collectors',
  'configs',
  'pinnedMetrics',
  'reportHashes',
] as const;

/** Per-collector user preferences. Missing record = all defaults (on). */
export interface CollectorSettings {
  /** Collector fully disabled — no polling, no manual collect. */
  enabled: boolean;
  /** Polling off for this collector — manual「立即采集」still works. */
  pollOn: boolean;
  /** Overrides the declared `pollIntervalMs` (still floored at 60s). */
  intervalOverrideMs?: number;
}

export const DEFAULT_COLLECTOR_SETTINGS: CollectorSettings = {
  enabled: true,
  pollOn: true,
};

/** Read a collector's settings with defaults filled in. */
export function getCollectorSettings(
  state: { collectors: Record<string, CollectorSettings> },
  collectorId: string,
): CollectorSettings {
  return state.collectors[collectorId] ?? DEFAULT_COLLECTOR_SETTINGS;
}

export interface ActivityCollectorState {
  /** Global polling kill-switch (design §2.1). Off = every collector is
   *  manual-only until flipped back on. */
  pollOn: boolean;
  /** Privacy switch (design §8): keep the events' `raw` payload. */
  keepRaw: boolean;
  /** Privacy switch (design §8, default off): allow AI to read activity data
   *  to generate summaries. When off, the detail panel omits the AI block. */
  allowAiSummary: boolean;
  /** Privacy redaction (design §4.3 step 2): user regexes applied to event
   *  title/summary before ingest. Invalid regexes are skipped at apply time. */
  redactPatterns: string[];
  /** collectorId → user preferences. */
  collectors: Record<string, CollectorSettings>;
  /** collectorId → authSchema form values (secrets included — see the
   *  ponytail note on the persist seam above). */
  configs: Record<string, Record<string, unknown>>;
  /** metricId → explicit pin override (design §3.3). Built-in metrics
   * default pinned, custom ones default collapsed — the override map only
   * records deviations, so an absent key keeps the default. */
  pinnedMetrics: Record<string, boolean>;
  /** report path → content hash of the last content WE wrote (design §7.5
   * conflict rule). Sidecar only — never stored inside the note itself. */
  reportHashes: Record<string, string>;
  /** Runtime-only last-sync info per collectorId (NOT persisted — refreshed
   *  on every collect). */
  lastSync: Record<string, { at: number; accepted: number }>;

  setPollOn: (v: boolean) => void;
  setKeepRaw: (v: boolean) => void;
  setAllowAiSummary: (v: boolean) => void;
  setRedactPatterns: (v: string[]) => void;
  setCollectorSettings: (collectorId: string, patch: Partial<CollectorSettings>) => void;
  setCollectorConfig: (collectorId: string, config: Record<string, unknown>) => void;
  /** Replace the metric pin override map (design §3.3) — one dedicated
   *  setter; the flip semantics live in the pure helper
   *  `components/activity/display.ts togglePinOverride`. */
  setPinnedMetrics: (v: Record<string, boolean>) => void;
  /** Record the hash of the report content we just wrote (§7.5). */
  setReportHash: (path: string, hash: string) => void;
  /** Runtime-only — called by runCollect after a successful push. */
  setLastSync: (collectorId: string, at: number, accepted: number) => void;

  hydrate: (blob: Record<string, unknown>) => void;
}

export const useActivityCollectorStore = create<ActivityCollectorState>((set, get) => ({
  pollOn: true,
  keepRaw: false,
  allowAiSummary: false,
  redactPatterns: [],
  collectors: {},
  configs: {},
  pinnedMetrics: {},
  reportHashes: {},
  lastSync: {},

  setPollOn: (v) => { set({ pollOn: v }); persist(); },
  setKeepRaw: (v) => { set({ keepRaw: v }); persist(); },
  setAllowAiSummary: (v) => { set({ allowAiSummary: v }); persist(); },
  setRedactPatterns: (v) => { set({ redactPatterns: v }); persist(); },

  setCollectorSettings: (collectorId, patch) => {
    const prev = getCollectorSettings(get(), collectorId);
    set({ collectors: { ...get().collectors, [collectorId]: { ...prev, ...patch } } });
    persist();
  },

  setCollectorConfig: (collectorId, config) => {
    set({ configs: { ...get().configs, [collectorId]: config } });
    persist();
  },

  setPinnedMetrics: (v) => {
    set({ pinnedMetrics: v });
    persist();
  },

  setReportHash: (path, hash) => {
    set({ reportHashes: { ...get().reportHashes, [path]: hash } });
    persist();
  },

  setLastSync: (collectorId, at, accepted) => {
    set({ lastSync: { ...get().lastSync, [collectorId]: { at, accepted } } });
  },

  hydrate: (blob) => {
    const patch: Partial<ActivityCollectorState> = {};
    if (typeof blob.pollOn === 'boolean') patch.pollOn = blob.pollOn;
    if (typeof blob.keepRaw === 'boolean') patch.keepRaw = blob.keepRaw;
    if (typeof blob.allowAiSummary === 'boolean') patch.allowAiSummary = blob.allowAiSummary;
    if (blob.pinnedMetrics && typeof blob.pinnedMetrics === 'object') {
      const pinnedMetrics: Record<string, boolean> = {};
      for (const [id, v] of Object.entries(blob.pinnedMetrics as Record<string, unknown>)) {
        if (typeof v === 'boolean') pinnedMetrics[id] = v;
      }
      patch.pinnedMetrics = pinnedMetrics;
    }
    if (blob.reportHashes && typeof blob.reportHashes === 'object') {
      const reportHashes: Record<string, string> = {};
      for (const [p, v] of Object.entries(blob.reportHashes as Record<string, unknown>)) {
        if (typeof v === 'string') reportHashes[p] = v;
      }
      patch.reportHashes = reportHashes;
    }
    if (Array.isArray(blob.redactPatterns)) {
      patch.redactPatterns = blob.redactPatterns.filter((p): p is string => typeof p === 'string');
    }
    if (blob.collectors && typeof blob.collectors === 'object') {
      const collectors: Record<string, CollectorSettings> = {};
      for (const [id, v] of Object.entries(blob.collectors as Record<string, unknown>)) {
        if (v && typeof v === 'object') {
          const s = v as Record<string, unknown>;
          collectors[id] = {
            enabled: typeof s.enabled === 'boolean' ? s.enabled : true,
            pollOn: typeof s.pollOn === 'boolean' ? s.pollOn : true,
            ...(typeof s.intervalOverrideMs === 'number' ? { intervalOverrideMs: s.intervalOverrideMs } : {}),
          };
        }
      }
      patch.collectors = collectors;
    }
    if (blob.configs && typeof blob.configs === 'object') {
      const configs: Record<string, Record<string, unknown>> = {};
      for (const [id, v] of Object.entries(blob.configs as Record<string, unknown>)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          configs[id] = v as Record<string, unknown>;
        }
      }
      patch.configs = configs;
    }
    if (Object.keys(patch).length > 0) set(patch);
  },
}));

const persist = registerPersistSlice({
  name: 'activityCollectors',
  keys: PERSIST_KEYS_ACTIVITY_COLLECTORS,
  getState: () => useActivityCollectorStore.getState() as unknown as Record<string, unknown>,
  hydrate: (blob) => useActivityCollectorStore.getState().hydrate(blob),
});
