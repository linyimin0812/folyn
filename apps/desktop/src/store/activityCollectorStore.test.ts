import { describe, expect, it, beforeEach } from 'vitest';
import { storageClient } from '@/utils/storageClient';
import { markSettingsHydrated } from './settingsPersistence';
import {
  DEFAULT_REPORT_CONFIG,
  parseReportConfig,
  useActivityCollectorStore,
  type CollectRunRecord,
} from './activityCollectorStore';

const run = (over: Partial<CollectRunRecord> = {}): CollectRunRecord => ({
  collectorId: 'git.commit',
  collectorName: 'Git Commit',
  startedAt: 1,
  finishedAt: 2,
  accepted: 3,
  deduped: 4,
  outcome: 'ok',
  logs: ['step 1'],
  ...over,
});

beforeEach(() => {
  storageClient.__resetForTesting();
  markSettingsHydrated();
  useActivityCollectorStore.setState({ reportConfig: DEFAULT_REPORT_CONFIG, collectHistory: [] });
});

describe('reportConfig hydrate round-trip', () => {
  it('setters → persist blob shape → hydrate restores values', () => {
    const { setReportPrompt, setReportModelOverride, setReportRootDir, hydrate } =
      useActivityCollectorStore.getState();
    setReportPrompt('daily', '汇总今天');
    setReportPrompt('weekly', '  汇总本周  ');
    setReportModelOverride({ provider: 'anthropic', model: 'claude-x' });
    setReportRootDir('Reports');

    // Round-trip through JSON (the persistence seam) into a fresh default state.
    const blob = JSON.parse(
      JSON.stringify(useActivityCollectorStore.getState().reportConfig),
    ) as Record<string, unknown>;
    useActivityCollectorStore.setState({ reportConfig: DEFAULT_REPORT_CONFIG });
    hydrate({ reportConfig: blob });

    const rc = useActivityCollectorStore.getState().reportConfig;
    expect(rc.prompts).toEqual({ daily: '汇总今天', weekly: '  汇总本周  ', monthly: '' });
    expect(rc.modelOverride).toEqual({ provider: 'anthropic', model: 'claude-x' });
    expect(rc.rootDir).toBe('Reports');
  });

  it('clearing the override (null) persists as follow-global', () => {
    const { setReportModelOverride, hydrate } = useActivityCollectorStore.getState();
    setReportModelOverride({ provider: 'openai', model: 'gpt' });
    setReportModelOverride(null);
    const blob = JSON.parse(
      JSON.stringify(useActivityCollectorStore.getState().reportConfig),
    ) as Record<string, unknown>;
    useActivityCollectorStore.setState({ reportConfig: DEFAULT_REPORT_CONFIG });
    hydrate({ reportConfig: blob });
    expect(useActivityCollectorStore.getState().reportConfig.modelOverride).toBeUndefined();
  });

  it('parseReportConfig: malformed blob → defaults; partial blob keeps valid fields', () => {
    expect(parseReportConfig(null)).toEqual(DEFAULT_REPORT_CONFIG);
    expect(parseReportConfig('nope')).toEqual(DEFAULT_REPORT_CONFIG);
    expect(parseReportConfig({ prompts: { daily: 5, weekly: 'w' } })).toEqual({
      prompts: { daily: '', weekly: 'w', monthly: '' },
      rootDir: '',
    });
    expect(parseReportConfig({ modelOverride: { provider: 'p' } })).toEqual(DEFAULT_REPORT_CONFIG);
    expect(parseReportConfig({ rootDir: 'R' }).rootDir).toBe('R');
  });
});

describe('collectHistory', () => {
  it('appendCollectRun prepends and caps at 100', () => {
    const { appendCollectRun } = useActivityCollectorStore.getState();
    for (let i = 0; i < 105; i++) appendCollectRun(run({ startedAt: i }));
    const h = useActivityCollectorStore.getState().collectHistory;
    expect(h).toHaveLength(100);
    expect(h[0].startedAt).toBe(104); // most recent first
    expect(h[99].startedAt).toBe(5); // oldest dropped
  });

  it('hydrate: round-trips valid records, drops malformed entries, missing → []', () => {
    const { appendCollectRun, hydrate } = useActivityCollectorStore.getState();
    appendCollectRun(run());
    appendCollectRun(run({ outcome: 'no-result', accepted: 0, deduped: 0, logs: [] }));
    const blob = JSON.parse(
      JSON.stringify(useActivityCollectorStore.getState().collectHistory),
    ) as unknown[];

    useActivityCollectorStore.setState({ collectHistory: [] });
    hydrate({ collectHistory: [...blob, { collectorId: 'bad' }, 'nope'] });
    expect(useActivityCollectorStore.getState().collectHistory).toEqual([
      run({ outcome: 'no-result', accepted: 0, deduped: 0, logs: [] }),
      run(),
    ]);

    useActivityCollectorStore.setState({ collectHistory: [] });
    hydrate({});
    expect(useActivityCollectorStore.getState().collectHistory).toEqual([]);
  });
});
