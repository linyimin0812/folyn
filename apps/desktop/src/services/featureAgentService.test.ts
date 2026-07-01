import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks (must be declared before importing the SUT) ──

const fakeAdapter = {
  id: 'claude',
  start: vi.fn(async () => {}),
  send: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
  isRunning: () => false,
  onEvent: vi.fn(),
  offEvent: vi.fn(),
  __emit: (e: unknown) => {
    for (const h of fakeAdapter.__handlers) (h as (x: unknown) => void)(e);
  },
  __handlers: [] as Array<(e: unknown) => void>,
};
fakeAdapter.onEvent.mockImplementation((h: (e: unknown) => void) => {
  fakeAdapter.__handlers.push(h);
});
fakeAdapter.offEvent.mockImplementation((h: (e: unknown) => void) => {
  fakeAdapter.__handlers = fakeAdapter.__handlers.filter((x) => x !== h);
});

vi.mock('@/components/ai/adapterManager', () => ({
  getAdapterForSession: () => fakeAdapter,
  sessionAdapters: new Map(),
}));

vi.mock('@/utils/fileWatcher', () => ({
  pauseWatcher: vi.fn(),
  resumeWatcher: vi.fn(),
  suppressWatcherFor: vi.fn(),
}));

// Stub persistence so aiStore actions don't touch Tauri FS.
vi.mock('@/store/aiSessionPersistence', () => ({
  persistAiState: vi.fn(),
  saveAllSessions: vi.fn(async () => {}),
  loadSessionsFromDisk: vi.fn(async () => {}),
  setSuppressPersist: vi.fn(),
  setupPersistSubscription: vi.fn(),
  debouncedPersist: vi.fn(),
}));

vi.mock('@/store/aiFileChangeActions', () => ({
  applyAcceptChange: vi.fn(),
  applyRejectChange: vi.fn(),
}));

import { useAiStore } from '@/store/aiStore';
import { useVaultStore } from '@/store/vaultStore';
import { useEditorStore } from '@/store/editorStore';
import { useSettingsStore } from '@/store/settingsStore';
import {
  seedAgentFiles,
  agentFileExists,
  runFeatureAgent,
  FEATURE_AGENTS,
  getFeatureAgentEntry,
  getFeatureAgentSendOptions,
} from './featureAgentService';

/** Build a fake VaultManager that records calls and controls file existence. */
function makeFakeManager(opts: {
  hasStudyFile?: boolean;
  /** Extra feature agent files to pre-seed (e.g. ['analyze','clips','daily']). */
  agentFiles?: string[];
  writableFails?: boolean;
} = {}) {
  const files = new Map<string, string>();
  if (opts.hasStudyFile) {
    files.set('.claude/agents/study.md', 'USER-EDITED');
  }
  for (const f of opts.agentFiles ?? []) {
    const entry = getFeatureAgentEntry(f);
    if (entry) files.set(`.claude/agents/${entry.file}`, `USER-${f}`);
  }
  const createdDirs: string[] = [];
  const written: { path: string; content: string }[] = [];

  const manager = {
    createDir: vi.fn(async (p: string) => {
      createdDirs.push(p);
    }),
    readFile: vi.fn(async (p: string) => {
      if (files.has(p)) return files.get(p)!;
      throw new Error(`File not found: ${p}`);
    }),
    writeFile: vi.fn(async (p: string, content: string) => {
      if (opts.writableFails) throw new Error('read-only vault');
      files.set(p, content);
      written.push({ path: p, content });
    }),
    _files: files,
    _createdDirs: createdDirs,
    _written: written,
  };
  return manager;
}

beforeEach(() => {
  useAiStore.setState({
    sessions: [],
    activeSessionId: null,
    studySessionId: null,
    isStreaming: false,
    chatMode: 'chat',
    pendingFileAttachments: [],
  });
  useVaultStore.setState({
    activeVaultId: 'v1',
    currentVault: { basePath: '/vault' } as never,
    manager: makeFakeManager() as never,
    refreshFileTree: vi.fn(async () => {}),
  } as never);
  useSettingsStore.setState({ cliPath: 'claude' } as never);
  useEditorStore.setState({
    flushAutoSaves: vi.fn(async () => {}),
    checkDiskChanges: vi.fn(async () => {}),
  } as never);
  fakeAdapter.__handlers = [];
  fakeAdapter.start.mockClear();
  fakeAdapter.send.mockClear();
  vi.clearAllMocks();
});

describe('FEATURE_AGENTS 注册表 (PR1)', () => {
  it('注册了 study feature', () => {
    const entry = getFeatureAgentEntry('study');
    expect(entry).toBeDefined();
    expect(entry?.file).toBe('study.md');
    expect(entry?.doc).toBeTruthy();
    expect(entry?.doc).toContain('study agent');
  });

  it('注册了 analyze/clips/daily feature (PR3)', () => {
    const analyze = getFeatureAgentEntry('analyze');
    expect(analyze).toBeDefined();
    expect(analyze?.file).toBe('analyze.md');
    expect(analyze?.doc).toContain('项目分析');

    const clips = getFeatureAgentEntry('clips');
    expect(clips).toBeDefined();
    expect(clips?.file).toBe('clips.md');
    expect(clips?.doc).toContain('知识卡片');

    const daily = getFeatureAgentEntry('daily');
    expect(daily).toBeDefined();
    expect(daily?.file).toBe('daily.md');
    expect(daily?.doc).toContain('每日回顾');
  });

  it('FEATURE_AGENTS 含全部四个 feature', () => {
    const features = FEATURE_AGENTS.map((e) => e.feature);
    expect(features).toEqual(expect.arrayContaining(['study', 'analyze', 'clips', 'daily']));
    expect(features).toHaveLength(4);
  });

  it('未注册的 feature 返回 undefined', () => {
    expect(getFeatureAgentEntry('wiki')).toBeUndefined();
    expect(getFeatureAgentEntry('unknown')).toBeUndefined();
  });
});

describe('agentFileExists', () => {
  it('文件存在返回 true', async () => {
    const manager = makeFakeManager({ hasStudyFile: true });
    expect(await agentFileExists(manager as never, 'study')).toBe(true);
  });

  it('文件缺失返回 false', async () => {
    const manager = makeFakeManager({ hasStudyFile: false });
    expect(await agentFileExists(manager as never, 'study')).toBe(false);
  });

  it('未注册的 feature 返回 false（不读盘）', async () => {
    const manager = makeFakeManager();
    expect(await agentFileExists(manager as never, 'wiki')).toBe(false);
    expect(manager.readFile).not.toHaveBeenCalled();
  });
});

describe('seedAgentFiles (write-if-missing)', () => {
  it('缺文件时写入 canonical 内容', async () => {
    const manager = makeFakeManager({ hasStudyFile: false });
    await seedAgentFiles(manager as never);

    const entry = getFeatureAgentEntry('study')!;
    expect(manager.writeFile).toHaveBeenCalledWith(`.claude/agents/${entry.file}`, entry.doc);
    // 文件实际写入 manager
    expect(manager._files.get('.claude/agents/study.md')).toBe(entry.doc);
  });

  it('先创建 .claude/agents 目录', async () => {
    const manager = makeFakeManager({ hasStudyFile: false });
    await seedAgentFiles(manager as never);
    expect(manager.createDir).toHaveBeenCalledWith('.claude/agents');
  });

  it('已存在的文件不覆盖（保留用户修改）', async () => {
    const manager = makeFakeManager({ hasStudyFile: true });
    await seedAgentFiles(manager as never);

    // readFile 命中 study → 不 writeFile study（其它 feature 仍会播种）
    expect(manager.readFile).toHaveBeenCalledWith('.claude/agents/study.md');
    expect(manager.writeFile).not.toHaveBeenCalledWith(
      '.claude/agents/study.md',
      expect.anything(),
    );
    // 用户内容保留
    expect(manager._files.get('.claude/agents/study.md')).toBe('USER-EDITED');
  });

  it('createDir 失败时不抛错（继续逐文件写入）', async () => {
    const manager = makeFakeManager({ hasStudyFile: false });
    manager.createDir.mockRejectedValueOnce(new Error('exists'));
    await expect(seedAgentFiles(manager as never)).resolves.toBeUndefined();
    expect(manager.writeFile).toHaveBeenCalled();
  });

  it('writeFile 失败时静默降级（不抛错）', async () => {
    const manager = makeFakeManager({ hasStudyFile: false, writableFails: true });
    await expect(seedAgentFiles(manager as never)).resolves.toBeUndefined();
    // 失败但未抛——调用方 agentFileExists 返回 false → --bare 回退
    expect(manager._files.has('.claude/agents/study.md')).toBe(false);
  });
});

describe('runFeatureAgent (PR1: cwd 发现 vs --bare 回退)', () => {
  it('agent 文件存在 → bare:false + --agent（cwd 自动发现）', async () => {
    const manager = makeFakeManager({ hasStudyFile: true });
    useVaultStore.setState({ manager: manager as never });

    fakeAdapter.send.mockImplementation(async () => {
      fakeAdapter.__emit({ type: 'text', content: 'hi' });
      fakeAdapter.__emit({ type: 'done' });
    });

    await runFeatureAgent('study', 'do research');

    const state = useAiStore.getState();
    expect(state.studySessionId).not.toBeNull();
    const sess = state.sessions.find((s) => s.id === state.studySessionId)!;
    expect(sess.kind).toBe('study');
    expect(sess.messages[1].content).toBe('hi');

    expect(fakeAdapter.send).toHaveBeenCalledTimes(1);
    const [, opts] = fakeAdapter.send.mock.calls[0];
    expect(opts.agent).toBe('study');
    expect(opts.bare).toBe(false);
  });

  it('agent 文件缺失 → --bare 回退（无 agent）', async () => {
    const manager = makeFakeManager({ hasStudyFile: false });
    useVaultStore.setState({ manager: manager as never });

    fakeAdapter.send.mockImplementation(async () => {
      fakeAdapter.__emit({ type: 'done' });
    });

    await runFeatureAgent('study', 'do research');

    const [, opts] = fakeAdapter.send.mock.calls[0];
    expect(opts.bare).toBe(true);
    expect(opts.agent).toBeUndefined();
  });

  it('复用 study 会话并传 resumeSessionId（多轮）', async () => {
    const manager = makeFakeManager({ hasStudyFile: true });
    useVaultStore.setState({ manager: manager as never });

    fakeAdapter.send.mockImplementation(async () => {
      fakeAdapter.__emit({ type: 'session_id', sessionId: 'cli-42' });
      fakeAdapter.__emit({ type: 'done' });
    });
    await runFeatureAgent('study', 'turn 1');
    const firstOpts = fakeAdapter.send.mock.calls[0][1];
    expect(firstOpts.resumeSessionId).toBeUndefined();

    fakeAdapter.send.mockClear();
    fakeAdapter.send.mockImplementation(async () => {
      fakeAdapter.__emit({ type: 'done' });
    });
    await runFeatureAgent('study', 'turn 2');
    const secondOpts = fakeAdapter.send.mock.calls[0][1];
    expect(secondOpts.resumeSessionId).toBe('cli-42');
    expect(secondOpts.bare).toBe(false);
    expect(secondOpts.agent).toBe('study');

    // 仍只有一个 study 会话
    const studySessions = useAiStore.getState().sessions.filter((s) => s.kind === 'study');
    expect(studySessions).toHaveLength(1);
  });

  it('file_change 事件写入 study 会话（接上 diff 链路）', async () => {
    const manager = makeFakeManager({ hasStudyFile: true });
    useVaultStore.setState({ manager: manager as never });

    fakeAdapter.send.mockImplementation(async () => {
      fakeAdapter.__emit({
        type: 'file_change',
        fileChange: { path: '学习/x.md', oldContent: 'a', newContent: 'b', status: 'pending', createdAt: 1 },
      });
      fakeAdapter.__emit({ type: 'done' });
    });
    await runFeatureAgent('study', 'edit notes');
    const sess = useAiStore.getState().sessions.find((s) => s.kind === 'study')!;
    expect(sess.fileChanges).toHaveLength(1);
    expect(sess.fileChanges[0].path).toBe('学习/x.md');
  });

  it('send 抛错时写入错误并清 streaming', async () => {
    const manager = makeFakeManager({ hasStudyFile: true });
    useVaultStore.setState({ manager: manager as never });

    fakeAdapter.send.mockRejectedValueOnce(new Error('boom'));
    await runFeatureAgent('study', 'explode');
    const sess = useAiStore.getState().sessions.find((s) => s.kind === 'study')!;
    expect(sess.isStreaming).toBe(false);
    expect(sess.messages[1].content).toContain('[错误]');
  });

  it('未支持的 feature 抛错（runFeatureAgent 仅支持 study；analyze/clips/daily 走 bespoke）', async () => {
    await expect(runFeatureAgent('analyze', 'x')).rejects.toThrow(/not supported/);
    await expect(runFeatureAgent('clips', 'x')).rejects.toThrow(/not supported/);
    await expect(runFeatureAgent('daily', 'x')).rejects.toThrow(/not supported/);
    expect(fakeAdapter.send).not.toHaveBeenCalled();
  });
});

describe('seedAgentFiles 覆盖 analyze/clips/daily (PR3)', () => {
  it('播种 study + analyze + clips + daily 四个文件', async () => {
    const manager = makeFakeManager({ hasStudyFile: false });
    await seedAgentFiles(manager as never);

    for (const feature of ['study', 'analyze', 'clips', 'daily']) {
      const entry = getFeatureAgentEntry(feature)!;
      const path = `.claude/agents/${entry.file}`;
      expect(manager.writeFile).toHaveBeenCalledWith(path, entry.doc);
      expect(manager._files.get(path)).toBe(entry.doc);
    }
  });

  it('已存在的 analyze/clips/daily 文件不覆盖', async () => {
    const manager = makeFakeManager({ agentFiles: ['analyze', 'clips', 'daily'] });
    await seedAgentFiles(manager as never);

    expect(manager._files.get('.claude/agents/analyze.md')).toBe('USER-analyze');
    expect(manager._files.get('.claude/agents/clips.md')).toBe('USER-clips');
    expect(manager._files.get('.claude/agents/daily.md')).toBe('USER-daily');
    // 这三个文件 readFile 命中 → 不 writeFile
    const writtenPaths = manager._written.map((w) => w.path);
    expect(writtenPaths).not.toContain('.claude/agents/analyze.md');
    expect(writtenPaths).not.toContain('.claude/agents/clips.md');
    expect(writtenPaths).not.toContain('.claude/agents/daily.md');
  });
});

describe('getFeatureAgentSendOptions (PR3: bespoke feature 调用辅助)', () => {
  it('agent 文件存在 → { agent, bare:false }', async () => {
    const manager = makeFakeManager({ agentFiles: ['analyze', 'clips', 'daily'] });
    useVaultStore.setState({ manager: manager as never });

    expect(await getFeatureAgentSendOptions('analyze')).toEqual({ agent: 'analyze', bare: false });
    expect(await getFeatureAgentSendOptions('clips')).toEqual({ agent: 'clips', bare: false });
    expect(await getFeatureAgentSendOptions('daily')).toEqual({ agent: 'daily', bare: false });
  });

  it('agent 文件缺失 → { bare:true }（--bare 回退）', async () => {
    const manager = makeFakeManager();
    useVaultStore.setState({ manager: manager as never });

    expect(await getFeatureAgentSendOptions('analyze')).toEqual({ bare: true });
    expect(await getFeatureAgentSendOptions('clips')).toEqual({ bare: true });
    expect(await getFeatureAgentSendOptions('daily')).toEqual({ bare: true });
  });

  it('study 也适用（agent 存在→cwd 发现）', async () => {
    const manager = makeFakeManager({ hasStudyFile: true });
    useVaultStore.setState({ manager: manager as never });
    expect(await getFeatureAgentSendOptions('study')).toEqual({ agent: 'study', bare: false });
  });

  it('vault 不可读时回退 { bare:true }', async () => {
    // manager 为 null/undefined → 抛错被捕获
    useVaultStore.setState({ manager: undefined as never });
    expect(await getFeatureAgentSendOptions('analyze')).toEqual({ bare: true });
  });
});
