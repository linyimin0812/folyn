import { describe, expect, it, beforeEach } from 'vitest';
import { storageClient } from '@/utils/storageClient';
import { markSettingsHydrated } from './settingsPersistence';
import {
  DEFAULT_REPORT_CONFIG,
  PERSIST_KEYS_ACTIVITY_COLLECTORS,
  isCollectRunRecord,
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

describe('collectHistory (transient — owned by the activity db, not the slice)', () => {
  it('setCollectHistory replaces the list; collectHistory is not persisted', () => {
    expect(PERSIST_KEYS_ACTIVITY_COLLECTORS).not.toContain('collectHistory');
    const { setCollectHistory } = useActivityCollectorStore.getState();
    setCollectHistory([run(), run({ outcome: 'no-result', accepted: 0, deduped: 0, logs: [] })]);
    expect(useActivityCollectorStore.getState().collectHistory).toEqual([
      run(),
      run({ outcome: 'no-result', accepted: 0, deduped: 0, logs: [] }),
    ]);
  });

  it('hydrate ignores a stale persisted collectHistory (db owns it now)', () => {
    useActivityCollectorStore.setState({ collectHistory: [] });
    useActivityCollectorStore.getState().hydrate({ collectHistory: [run()] });
    expect(useActivityCollectorStore.getState().collectHistory).toEqual([]);
  });

  it('isCollectRunRecord guards the legacy → db migration input', () => {
    expect(isCollectRunRecord(run())).toBe(true);
    expect(isCollectRunRecord({ collectorId: 'bad' })).toBe(false);
    expect(isCollectRunRecord('nope')).toBe(false);
    expect(isCollectRunRecord(run({ logs: ['ok', 1 as unknown as string] }))).toBe(false);
  });
});
