import { create } from 'zustand';
import { registerPersistSlice } from './settingsPersistence';

/**
 * Activity collector user settings (design §2.1/§8): per-collector
 * enable/poll toggles + interval overrides, the keepRaw/redact privacy
 * switches, and the authSchema-rendered config values keyed by collector id
 * (including each collector's own `allowAiSummary` opt-in). The declaration
 * side (what collectors exist) lives in
 * `services/activity/registry.ts` — this store owns only user preferences.
 */

// ponytail: collector configs (paths, tokens) persist as plain JSON via
// storageClient (~/.folyn/storage/activityCollectors.json). Design §8 requires
// keychain-first encryption — swap this slice's persist/get seam for a
// keychain client in part B; the store shape stays unchanged.
export const PERSIST_KEYS_ACTIVITY_COLLECTORS = [
  'keepRaw',
  'redactPatterns',
  'collectors',
  'configs',
  'pinnedMetrics',
  'reportHashes',
  'reportConfig',
  'collectHistory',
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

/** Report generation config (design §7.5 customization): per-period LLM
 *  prompts (empty string = deterministic template path), an optional
 *  (provider, model) override (undefined = follow global chat config), and
 *  the vault-relative report root dir (empty = 'activity_collection'). */
export interface ReportConfig {
  prompts: { daily: string; weekly: string; monthly: string };
  modelOverride?: { provider: string; model: string };
  rootDir: string;
}

export const DEFAULT_REPORT_CONFIG: ReportConfig = {
  prompts: { daily: '', weekly: '', monthly: '' },
  rootDir: '',
};

/** One completed collector run (scheduled poll or manual collect) —
 *  recorded by runCollect for the 采集记录 view. */
export interface CollectRunRecord {
  collectorId: string;
  collectorName: string;
  startedAt: number;
  finishedAt: number;
  accepted: number;
  deduped: number;
  /** 'ok' when the push outcome exists; 'no-result' covers skipped OR failed. */
  outcome: 'ok' | 'no-result';
  /** Locale-neutral onProgress messages from the collector (capped at 50). */
  logs: string[];
}

/** Cap the persisted history (design: keep the last 100 runs). */
const MAX_COLLECT_HISTORY = 100;

export interface ActivityCollectorState {
  /** Privacy switch (design §8): keep the events' `raw` payload. */
  keepRaw: boolean;
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
  /** Report customization (prompts / model / root dir). */
  reportConfig: ReportConfig;
  /** Runtime-only last-sync info per collectorId (NOT persisted — refreshed
   *  on every collect). */
  lastSync: Record<string, { at: number; accepted: number }>;
  /** Runtime-only collect progress per collectorId (NOT persisted — set by
   *  runCollect from the collector's ctx.onProgress, cleared when the run
   *  ends). Locale-neutral strings from the collector; the UI prefixes the
   *  localized label. */
  collectProgress: Record<string, string>;
  /** Past collection runs (most recent first), persisted across restarts. */
  collectHistory: CollectRunRecord[];

  setKeepRaw: (v: boolean) => void;
  setRedactPatterns: (v: string[]) => void;
  setCollectorSettings: (collectorId: string, patch: Partial<CollectorSettings>) => void;
  setCollectorConfig: (collectorId: string, config: Record<string, unknown>) => void;
  /** Replace the metric pin override map (design §3.3) — one dedicated
   *  setter; the flip semantics live in the pure helper
   *  `components/activity/display.ts togglePinOverride`. */
  setPinnedMetrics: (v: Record<string, boolean>) => void;
  /** Record the hash of the report content we just wrote (§7.5). */
  setReportHash: (path: string, hash: string) => void;
  /** Set one period's LLM prompt ('' = deterministic template). */
  setReportPrompt: (period: 'daily' | 'weekly' | 'monthly', v: string) => void;
  /** Set/clear the report model override (null = follow global chat config). */
  setReportModelOverride: (pair: { provider: string; model: string } | null) => void;
  /** Set the vault-relative report root dir ('' = 'activity_collection'). */
  setReportRootDir: (v: string) => void;
  /** Runtime-only — called by runCollect after a successful push. */
  setLastSync: (collectorId: string, at: number, accepted: number) => void;
  /** Runtime-only — null clears the entry (runCollect's finally). */
  setCollectProgress: (collectorId: string, message: string | null) => void;
  /** Record one completed run (called from runCollect's finally). */
  appendCollectRun: (record: CollectRunRecord) => void;

  hydrate: (blob: Record<string, unknown>) => void;
}

/** Type-guarded parse of a persisted reportConfig blob → defaults on anything malformed. */
export function parseReportConfig(blob: unknown): ReportConfig {
  if (!blob || typeof blob !== 'object' || Array.isArray(blob)) return DEFAULT_REPORT_CONFIG;
  const r = blob as Record<string, unknown>;
  const prompts = { ...DEFAULT_REPORT_CONFIG.prompts };
  if (r.prompts && typeof r.prompts === 'object' && !Array.isArray(r.prompts)) {
    for (const k of ['daily', 'weekly', 'monthly'] as const) {
      const v = (r.prompts as Record<string, unknown>)[k];
      if (typeof v === 'string') prompts[k] = v;
    }
  }
  const mo = r.modelOverride;
  const modelOverride =
    mo && typeof mo === 'object' && !Array.isArray(mo) &&
    typeof (mo as Record<string, unknown>).provider === 'string' &&
    typeof (mo as Record<string, unknown>).model === 'string'
      ? { provider: (mo as Record<string, unknown>).provider as string, model: (mo as Record<string, unknown>).model as string }
      : undefined;
  return {
    prompts,
    rootDir: typeof r.rootDir === 'string' ? r.rootDir : '',
    ...(modelOverride ? { modelOverride } : {}),
  };
}

/** Type-guard a persisted collectHistory entry. */
export function isCollectRunRecord(v: unknown): v is CollectRunRecord {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.collectorId === 'string' &&
    typeof r.collectorName === 'string' &&
    typeof r.startedAt === 'number' &&
    typeof r.finishedAt === 'number' &&
    typeof r.accepted === 'number' &&
    typeof r.deduped === 'number' &&
    (r.outcome === 'ok' || r.outcome === 'no-result') &&
    Array.isArray(r.logs) &&
    r.logs.every((l) => typeof l === 'string')
  );
}

export const useActivityCollectorStore = create<ActivityCollectorState>((set, get) => ({
  keepRaw: false,
  redactPatterns: [],
  collectors: {},
  configs: {},
  pinnedMetrics: {},
  reportHashes: {},
  reportConfig: DEFAULT_REPORT_CONFIG,
  lastSync: {},
  collectProgress: {},
  collectHistory: [],

  setKeepRaw: (v) => { set({ keepRaw: v }); persist(); },
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

  setReportPrompt: (period, v) => {
    set({ reportConfig: { ...get().reportConfig, prompts: { ...get().reportConfig.prompts, [period]: v } } });
    persist();
  },

  setReportModelOverride: (pair) => {
    const prev = get().reportConfig;
    set({ reportConfig: { ...prev, ...(pair ? { modelOverride: pair } : { modelOverride: undefined }) } });
    persist();
  },

  setReportRootDir: (v) => {
    set({ reportConfig: { ...get().reportConfig, rootDir: v } });
    persist();
  },

  setLastSync: (collectorId, at, accepted) => {
    set({ lastSync: { ...get().lastSync, [collectorId]: { at, accepted } } });
  },

  setCollectProgress: (collectorId, message) => {
    const next = { ...get().collectProgress };
    if (message === null) delete next[collectorId];
    else next[collectorId] = message;
    set({ collectProgress: next });
  },

  appendCollectRun: (record) => {
    set({ collectHistory: [record, ...get().collectHistory].slice(0, MAX_COLLECT_HISTORY) });
    persist();
  },

  hydrate: (blob) => {
    const patch: Partial<ActivityCollectorState> = {};
    if (typeof blob.keepRaw === 'boolean') patch.keepRaw = blob.keepRaw;
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
    if (blob.reportConfig && typeof blob.reportConfig === 'object' && !Array.isArray(blob.reportConfig)) {
      patch.reportConfig = parseReportConfig(blob.reportConfig);
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
    if (Array.isArray(blob.collectHistory)) {
      patch.collectHistory = blob.collectHistory.filter(isCollectRunRecord).slice(0, MAX_COLLECT_HISTORY);
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
