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

// 隔断 excalidraw 链路（editorStore → file-types/registry → ExcalidrawPreview）。
// excalidraw 在当前 pnpm+node 环境下加载报错（roughjs/open-color.json），与本测试无关。
vi.mock('@/components/file-types/registry', () => ({
  getHandlerByExtension: () => undefined,
  getHandlerById: () => undefined,
  getAllHandlers: () => [],
}));

import { useAiStore } from '@/store/aiStore';
import { useVaultStore } from '@/store/vaultStore';
import { useEditorStore } from '@/store/editorStore';
import { useAiConfigStore } from '@/store/aiConfigStore';
import {
  seedAgentFiles,
  agentFileExists,
  runFeatureAgent,
  FEATURE_AGENTS,
  getFeatureAgentEntry,
  getFeatureAgentSendOptions,
  agentFilePathOf,
  claudeMdPathOf,
} from './featureAgentService';

/** Feature 内 agent 文件路径（与 SUT 内部一致，用于 fake manager 文件键）。 */
function vaultAgentPath(feature: string): string {
  const entry = getFeatureAgentEntry(feature)!;
  return `__${feature}__/.claude/agents/${entry.file}`;
}

/** Feature 内 CLAUDE.md 路径（与 SUT 内部一致）。 */
function vaultClaudePath(feature: string): string {
  return `__${feature}__/.claude/CLAUDE.md`;
}

/** Build a fake VaultManager that records calls and controls file existence. */
function makeFakeManager(opts: {
  hasStudyFile?: boolean;
  /** Extra feature agent files to pre-seed (e.g. ['analyze','clips','schedule','wiki']). */
  agentFiles?: string[];
  /** Extra feature CLAUDE.md files to pre-seed. */
  claudeFiles?: string[];
  writableFails?: boolean;
} = {}) {
  const files = new Map<string, string>();
  if (opts.hasStudyFile) {
    files.set(vaultAgentPath('study'), 'USER-EDITED');
    files.set(vaultClaudePath('study'), 'USER-CLAUDE');
  }
  for (const f of opts.agentFiles ?? []) {
    const entry = getFeatureAgentEntry(f);
    if (entry) files.set(vaultAgentPath(f), `USER-${f}`);
  }
  for (const f of opts.claudeFiles ?? []) {
    if (getFeatureAgentEntry(f)) files.set(vaultClaudePath(f), `USER-CLAUDE-${f}`);
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
  useAiConfigStore.setState({ cliPath: 'claude' } as never);
  useEditorStore.setState({
    flushAutoSaves: vi.fn(async () => {}),
    checkDiskChanges: vi.fn(async () => {}),
  } as never);
  fakeAdapter.__handlers = [];
  fakeAdapter.start.mockClear();
  fakeAdapter.send.mockClear();
  vi.clearAllMocks();
});

describe('FEATURE_AGENTS 注册表', () => {
  it('注册了 study feature', () => {
    const entry = getFeatureAgentEntry('study');
    expect(entry).toBeDefined();
    expect(entry?.file).toBe('study.md');
    expect(entry?.doc).toBeTruthy();
    expect(entry?.doc).toContain('study agent');
    expect(entry?.claudeDoc).toBeTruthy();
    expect(entry?.claudeDoc).toContain('study');
  });

  it('注册了 analyze/clips/schedule/wiki feature', () => {
    const analyze = getFeatureAgentEntry('analyze');
    expect(analyze).toBeDefined();
    expect(analyze?.file).toBe('analyze.md');
    expect(analyze?.doc).toContain('项目分析');
    expect(analyze?.claudeDoc).toBeTruthy();

    const clips = getFeatureAgentEntry('clips');
    expect(clips).toBeDefined();
    expect(clips?.file).toBe('clips.md');
    expect(clips?.doc).toContain('知识卡片');
    expect(clips?.claudeDoc).toBeTruthy();

    const schedule = getFeatureAgentEntry('schedule');
    expect(schedule).toBeDefined();
    expect(schedule?.file).toBe('schedule.md');
    expect(schedule?.doc).toContain('每日回顾');
    expect(schedule?.claudeDoc).toBeTruthy();
    expect(schedule?.addVaultDir).toBe(true);

    const wiki = getFeatureAgentEntry('wiki');
    expect(wiki).toBeDefined();
    expect(wiki?.file).toBe('wiki.md');
    expect(wiki?.doc).toContain('wiki');
    expect(wiki?.claudeDoc).toBeTruthy();
  });

  it('FEATURE_AGENTS 含全部五个 feature', () => {
    const features = FEATURE_AGENTS.map((e) => e.feature);
    expect(features).toEqual(expect.arrayContaining(['study', 'analyze', 'clips', 'schedule', 'wiki']));
    expect(features).toHaveLength(5);
  });

  it('未注册的 feature 返回 undefined', () => {
    expect(getFeatureAgentEntry('daily')).toBeUndefined();
    expect(getFeatureAgentEntry('unknown')).toBeUndefined();
  });

  it('daily 已重命名为 schedule（不再注册）', () => {
    expect(getFeatureAgentEntry('daily')).toBeUndefined();
    expect(getFeatureAgentEntry('schedule')).toBeDefined();
  });
});

describe('agentFilePathOf / claudeMdPathOf', () => {
  it('返回 __{feature}__/.claude/agents/<file> 路径', () => {
    expect(agentFilePathOf('study')).toBe('__study__/.claude/agents/study.md');
    expect(agentFilePathOf('schedule')).toBe('__schedule__/.claude/agents/schedule.md');
    expect(agentFilePathOf('wiki')).toBe('__wiki__/.claude/agents/wiki.md');
  });

  it('返回 __{feature}__/.claude/CLAUDE.md 路径', () => {
    expect(claudeMdPathOf('study')).toBe('__study__/.claude/CLAUDE.md');
    expect(claudeMdPathOf('schedule')).toBe('__schedule__/.claude/CLAUDE.md');
  });

  it('未注册的 feature 返回 null', () => {
    expect(agentFilePathOf('daily')).toBeNull();
    expect(claudeMdPathOf('daily')).toBeNull();
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
    expect(await agentFileExists(manager as never, 'daily')).toBe(false);
    expect(manager.readFile).not.toHaveBeenCalled();
  });
});

describe('seedAgentFiles (write-if-missing, 新 __{feature}__/.claude/ 路径)', () => {
  it('缺文件时写入 canonical agent .md 与 CLAUDE.md 内容', async () => {
    const manager = makeFakeManager({ hasStudyFile: false });
    await seedAgentFiles(manager as never);

    const entry = getFeatureAgentEntry('study')!;
    expect(manager.writeFile).toHaveBeenCalledWith(`__study__/.claude/agents/${entry.file}`, entry.doc);
    expect(manager.writeFile).toHaveBeenCalledWith('__study__/.claude/CLAUDE.md', entry.claudeDoc);
    // 文件实际写入 manager
    expect(manager._files.get('__study__/.claude/agents/study.md')).toBe(entry.doc);
    expect(manager._files.get('__study__/.claude/CLAUDE.md')).toBe(entry.claudeDoc);
  });

  it('先创建 __{feature}__/.claude/agents 目录（每 feature 一个）', async () => {
    const manager = makeFakeManager({ hasStudyFile: false });
    await seedAgentFiles(manager as never);
    for (const feature of ['study', 'analyze', 'clips', 'schedule', 'wiki']) {
      expect(manager.createDir).toHaveBeenCalledWith(`__${feature}__/.claude/agents`);
    }
  });

  it('已存在的 agent .md 不覆盖（保留用户修改）', async () => {
    const manager = makeFakeManager({ hasStudyFile: true });
    await seedAgentFiles(manager as never);

    expect(manager.readFile).toHaveBeenCalledWith('__study__/.claude/agents/study.md');
    const writtenPaths1 = manager._written.map((w) => w.path);
    expect(writtenPaths1).not.toContain('__study__/.claude/agents/study.md');
    expect(manager._files.get('__study__/.claude/agents/study.md')).toBe('USER-EDITED');
  });

  it('已存在的 CLAUDE.md 不覆盖（保留用户修改）', async () => {
    const manager = makeFakeManager({ claudeFiles: ['study'] });
    await seedAgentFiles(manager as never);

    expect(manager.readFile).toHaveBeenCalledWith('__study__/.claude/CLAUDE.md');
    const writtenPaths2 = manager._written.map((w) => w.path);
    expect(writtenPaths2).not.toContain('__study__/.claude/CLAUDE.md');
    expect(manager._files.get('__study__/.claude/CLAUDE.md')).toBe('USER-CLAUDE-study');
  });

  it('createDir 失败时不抛错（继续逐文件写入）', async () => {
    const manager = makeFakeManager({ hasStudyFile: false });
    manager.createDir.mockRejectedValueOnce(new Error('exists'));
    await expect(seedAgentFiles(manager as never)).resolves.toEqual(expect.any(Array));
    expect(manager.writeFile).toHaveBeenCalled();
  });

  it('writeFile 失败时静默降级（不抛错）', async () => {
    const manager = makeFakeManager({ hasStudyFile: false, writableFails: true });
    const results = await seedAgentFiles(manager as never);
    expect(results.every((r) => r.status === 'failed')).toBe(true);
    expect(manager._files.has('__study__/.claude/agents/study.md')).toBe(false);
  });

  it('播种 study + analyze + clips + schedule + wiki 五个 feature 的 agent .md + CLAUDE.md', async () => {
    const manager = makeFakeManager({ hasStudyFile: false });
    await seedAgentFiles(manager as never);

    for (const feature of ['study', 'analyze', 'clips', 'schedule', 'wiki']) {
      const entry = getFeatureAgentEntry(feature)!;
      const agentPath = `__${feature}__/.claude/agents/${entry.file}`;
      const claudePath = `__${feature}__/.claude/CLAUDE.md`;
      expect(manager.writeFile).toHaveBeenCalledWith(agentPath, entry.doc);
      expect(manager.writeFile).toHaveBeenCalledWith(claudePath, entry.claudeDoc);
      expect(manager._files.get(agentPath)).toBe(entry.doc);
      expect(manager._files.get(claudePath)).toBe(entry.claudeDoc);
    }
  });

  it('已存在的 analyze/clips/schedule/wiki 文件不覆盖', async () => {
    const manager = makeFakeManager({ agentFiles: ['analyze', 'clips', 'schedule', 'wiki'] });
    await seedAgentFiles(manager as never);

    for (const feature of ['analyze', 'clips', 'schedule', 'wiki']) {
      expect(manager._files.get(vaultAgentPath(feature))).toBe(`USER-${feature}`);
      const writtenPaths = manager._written.map((w) => w.path);
      expect(writtenPaths).not.toContain(vaultAgentPath(feature));
    }
  });

  it('seedAgentFiles 幂等：调用两次不覆盖已写文件（log 覆盖写除外）', async () => {
    const manager = makeFakeManager({ hasStudyFile: false });
    await seedAgentFiles(manager as never);
    const afterFirst = manager._files.get('__study__/.claude/agents/study.md');
    expect(afterFirst).toBeTruthy();

    manager.writeFile.mockClear();
    await seedAgentFiles(manager as never);
    const newAgentWrites = manager.writeFile.mock.calls
      .map((c) => c[0] as string)
      .filter((p) => !p.startsWith('.quill-tmp/'));
    expect(newAgentWrites).toEqual([]);
    expect(manager._files.get('__study__/.claude/agents/study.md')).toBe(afterFirst);
  });

  it('seedAgentFiles 写诊断日志到 .quill-tmp/feature-agent-seed.log', async () => {
    const manager = makeFakeManager({ hasStudyFile: false });
    await seedAgentFiles(manager as never);

    const log = manager._files.get('.quill-tmp/feature-agent-seed.log');
    expect(log).toBeTruthy();
    expect(log).toContain('feature-agent seeding diagnostic');
    expect(log).toContain('study');
    expect(log).toContain('timestamp:');
  });
});

describe('runFeatureAgent (cwd 发现 vs --bare 回退)', () => {
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
    // workingDir 应为 <vault>/__study__/
    expect(fakeAdapter.start).toHaveBeenCalledWith(expect.objectContaining({ workingDir: '/vault/__study__' }));
  });

  it('agent 文件缺失 → --bare 回退 + --agents 内联交付 canonical agent 定义', async () => {
    const manager = makeFakeManager({ hasStudyFile: false, writableFails: true });
    useVaultStore.setState({ manager: manager as never });

    fakeAdapter.send.mockImplementation(async () => {
      fakeAdapter.__emit({ type: 'done' });
    });

    await runFeatureAgent('study', 'do research');

    const [, opts] = fakeAdapter.send.mock.calls[0];
    expect(opts.bare).toBe(true);
    expect(opts.agent).toBe('study');
    expect(opts.agents).toBeDefined();
    expect(opts.agents.study).toBeDefined();
    expect(opts.agents.study.prompt).toBeTruthy();
    expect(opts.agents.study.prompt).toContain('study agent');
    expect(opts.agents.study.description).toBeTruthy();
    expect(opts.agents.study.tools).toBeInstanceOf(Array);
    expect(opts.agents.study.tools?.length).toBeGreaterThan(0);
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

    const studySessions = useAiStore.getState().sessions.filter((s) => s.kind === 'study');
    expect(studySessions).toHaveLength(1);
  });

  it('file_change 事件写入 study 会话（接上 diff 链路）', async () => {
    const manager = makeFakeManager({ hasStudyFile: true });
    useVaultStore.setState({ manager: manager as never });

    fakeAdapter.send.mockImplementation(async () => {
      fakeAdapter.__emit({
        type: 'file_change',
        fileChange: { path: '__study__/x.md', oldContent: 'a', newContent: 'b', status: 'pending', createdAt: 1 },
      });
      fakeAdapter.__emit({ type: 'done' });
    });
    await runFeatureAgent('study', 'edit notes');
    const sess = useAiStore.getState().sessions.find((s) => s.kind === 'study')!;
    expect(sess.fileChanges).toHaveLength(1);
    expect(sess.fileChanges[0].path).toBe('__study__/x.md');
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

  it('未支持的 feature 抛错（runFeatureAgent 仅支持 study）', async () => {
    await expect(runFeatureAgent('analyze', 'x')).rejects.toThrow(/not supported/);
    await expect(runFeatureAgent('clips', 'x')).rejects.toThrow(/not supported/);
    await expect(runFeatureAgent('schedule', 'x')).rejects.toThrow(/not supported/);
    await expect(runFeatureAgent('wiki', 'x')).rejects.toThrow(/not supported/);
    expect(fakeAdapter.send).not.toHaveBeenCalled();
  });
});

describe('getFeatureAgentSendOptions (bespoke feature 调用辅助)', () => {
  it('agent 文件存在 → { agent, bare:false }', async () => {
    const manager = makeFakeManager({ agentFiles: ['analyze', 'clips', 'wiki'] });
    useVaultStore.setState({ manager: manager as never });

    expect(await getFeatureAgentSendOptions('analyze')).toEqual({ agent: 'analyze', bare: false });
    expect(await getFeatureAgentSendOptions('clips')).toEqual({ agent: 'clips', bare: false });
    expect(await getFeatureAgentSendOptions('wiki')).toEqual({ agent: 'wiki', bare: false });
  });

  it('schedule feature 额外传 addDir: [<vault basePath>]（访问 __daily__/）', async () => {
    const manager = makeFakeManager({ agentFiles: ['schedule'] });
    useVaultStore.setState({
      manager: manager as never,
      currentVault: { basePath: '/vault' } as never,
    });

    const opts = await getFeatureAgentSendOptions('schedule');
    expect(opts.agent).toBe('schedule');
    expect(opts.bare).toBe(false);
    expect(opts.addDir).toEqual(['/vault']);
  });

  it('schedule agent 缺失时仍传 addDir（--bare 回退也需跨目录访问）+ 内联交付 agent', async () => {
    const manager = makeFakeManager({ writableFails: true });
    useVaultStore.setState({
      manager: manager as never,
      currentVault: { basePath: '/vault' } as never,
    });

    const opts = await getFeatureAgentSendOptions('schedule');
    expect(opts.bare).toBe(true);
    expect(opts.agent).toBe('schedule');
    expect(opts.addDir).toEqual(['/vault']);
    expect(opts.agents).toBeDefined();
    expect(opts.agents.schedule).toBeDefined();
    expect(opts.agents.schedule.prompt).toContain('每日回顾');
  });

  it('非 schedule feature 不传 addDir', async () => {
    const manager = makeFakeManager({ agentFiles: ['analyze', 'clips', 'wiki'] });
    useVaultStore.setState({ manager: manager as never });

    expect(await getFeatureAgentSendOptions('analyze')).not.toHaveProperty('addDir');
    expect(await getFeatureAgentSendOptions('clips')).not.toHaveProperty('addDir');
    expect(await getFeatureAgentSendOptions('wiki')).not.toHaveProperty('addDir');
  });

  it('agent 文件缺失 → --bare 回退 + --agents 内联交付（5 个 feature）', async () => {
    const manager = makeFakeManager({ writableFails: true });
    useVaultStore.setState({ manager: manager as never });

    for (const feature of ['analyze', 'clips', 'wiki']) {
      const opts = await getFeatureAgentSendOptions(feature);
      expect(opts.bare).toBe(true);
      expect(opts.agent).toBe(feature);
      expect(opts.agents).toBeDefined();
      const def = (opts.agents as Record<string, { prompt: string; description?: string; tools?: string[] }>)[feature];
      expect(def).toBeDefined();
      expect(def.prompt).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(def.tools).toBeInstanceOf(Array);
      expect(def.tools && def.tools.length).toBeGreaterThan(0);
    }
  });

  it('study 也适用（agent 存在→cwd 发现）', async () => {
    const manager = makeFakeManager({ hasStudyFile: true });
    useVaultStore.setState({ manager: manager as never });
    expect(await getFeatureAgentSendOptions('study')).toEqual({ agent: 'study', bare: false });
  });

  it('vault 不可读时回退 --bare + --agents 内联交付（registry 是静态的）', async () => {
    useVaultStore.setState({ manager: undefined as never });
    const opts = await getFeatureAgentSendOptions('analyze');
    expect(opts.bare).toBe(true);
    expect(opts.agent).toBe('analyze');
    expect(opts.agents).toBeDefined();
    expect((opts.agents as Record<string, { prompt: string }>).analyze.prompt).toBeTruthy();
  });
});

describe('call-time 懒播种兜底', () => {
  it('runFeatureAgent 调用时先懒播种（agent 文件最终存在→bare:false）', async () => {
    const manager = makeFakeManager({ hasStudyFile: false });
    useVaultStore.setState({ manager: manager as never });

    fakeAdapter.send.mockImplementation(async () => {
      fakeAdapter.__emit({ type: 'done' });
    });

    await runFeatureAgent('study', 'do research');

    const [, opts] = fakeAdapter.send.mock.calls[0];
    expect(opts.agent).toBe('study');
    expect(opts.bare).toBe(false);
    expect(manager._files.get('__study__/.claude/agents/study.md')).toBeTruthy();
    expect(manager._files.get('__study__/.claude/CLAUDE.md')).toBeTruthy();
  });

  it('getFeatureAgentSendOptions 调用时懒播种', async () => {
    const manager = makeFakeManager({ hasStudyFile: false });
    useVaultStore.setState({ manager: manager as never });

    const before = manager._files.get('__wiki__/.claude/agents/wiki.md');
    expect(before).toBeUndefined();

    const opts = await getFeatureAgentSendOptions('wiki');
    expect(opts).toEqual({ agent: 'wiki', bare: false });
    expect(manager._files.get('__wiki__/.claude/agents/wiki.md')).toBeTruthy();
    expect(manager._files.get('__wiki__/.claude/CLAUDE.md')).toBeTruthy();
  });

  it('懒播种失败不阻塞调用（manager 为 null → --bare + --agents 内联交付）', async () => {
    useVaultStore.setState({ manager: undefined as never });
    const opts = await getFeatureAgentSendOptions('wiki');
    expect(opts.bare).toBe(true);
    expect(opts.agent).toBe('wiki');
    expect(opts.agents).toBeDefined();
    expect((opts.agents as Record<string, { prompt: string }>).wiki.prompt).toBeTruthy();
  });
});

describe('parseAgentDoc（canonical agent .md frontmatter 解析，5 个 feature 全覆盖）', () => {
  // 通过 getFeatureAgentSendOptions fallback 间接测 parseAgentDoc（不导出）。
  // vault 不可读 → 走 catch 块的内联交付路径，agents[feature] 即解析结果。
  beforeEach(() => {
    useVaultStore.setState({ manager: undefined as never });
  });

  const features = ['study', 'analyze', 'clips', 'schedule', 'wiki'] as const;

  for (const feature of features) {
    it(`${feature}: frontmatter 解析出 description / tools / prompt body`, async () => {
      const opts = await getFeatureAgentSendOptions(feature);
      expect(opts.bare).toBe(true);
      expect(opts.agent).toBe(feature);
      expect(opts.agents).toBeDefined();
      const def = (opts.agents as Record<string, {
        description?: string;
        prompt: string;
        tools?: string[];
      }>)[feature];
      expect(def).toBeDefined();
      // description 非空
      expect(typeof def.description).toBe('string');
      expect(def.description!.length).toBeGreaterThan(0);
      // tools 是非空数组
      expect(Array.isArray(def.tools)).toBe(true);
      expect(def.tools!.length).toBeGreaterThan(0);
      // prompt body 是 frontmatter 之后的正文，应包含 "agent" 字样且不包含 frontmatter 分隔符
      expect(def.prompt).toContain('agent');
      expect(def.prompt).not.toMatch(/^---\n/);
      expect(def.prompt).not.toMatch(/\n---$/);
    });
  }

  it('study 的 prompt body 含输出契约标记', async () => {
    const opts = await getFeatureAgentSendOptions('study');
    const def = (opts.agents as Record<string, { prompt: string }>).study;
    expect(def.prompt).toContain('输出契约');
  });

  it('clips 的 prompt body 含信息图相关契约', async () => {
    const opts = await getFeatureAgentSendOptions('clips');
    const def = (opts.agents as Record<string, { prompt: string }>).clips;
    expect(def.prompt).toContain('信息图');
  });

  it('schedule 的 tools 含 Read', async () => {
    const opts = await getFeatureAgentSendOptions('schedule');
    const def = (opts.agents as Record<string, { tools?: string[] }>).schedule;
    expect(def.tools).toContain('Read');
  });
});
