import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 模型桥与 kbAsk（kbIntentWatch 的传递依赖）注入 fake，避免拉起真实 LLM 链路。
const llm = vi.hoisted(() => ({ response: {} as unknown }));
vi.mock('./kbLlm', () => ({ kbChatJson: async () => llm.response }));
vi.mock('@/services/knowledge/kbAsk', () => ({ invalidateKbIndexCache: vi.fn() }));

// fileWatcher：捕获订阅回调（真实模块含 Tauri 依赖与单例 watcher 状态）。
const fw = vi.hoisted(() => ({ listener: null as ((paths: string[]) => void) | null }));
vi.mock('@/utils/fileWatcher', () => ({
  subscribeVaultChanges: (l: (paths: string[]) => void) => {
    fw.listener = l;
    return () => {
      fw.listener = null;
    };
  },
  suppressWatcherFor: vi.fn(),
}));

// knowledgeStore：注入可控状态；vaultStore：给 vaultKbFs() 一个内存 manager。
const kbStore = vi.hoisted(() => ({
  listener: null as ((next: unknown, previous: unknown) => void) | null,
  state: { activeThemeId: 'theme-a', contextVaultId: 'v1', buildRunning: false, loadFromManifest: vi.fn(), reconcileTopicEdits: vi.fn() },
}));
vi.mock('@/store/knowledgeStore', () => ({
  useKnowledgeStore: { getState: () => kbStore.state, subscribe: (listener: (next: unknown, previous: unknown) => void) => { kbStore.listener = listener; return () => { kbStore.listener = null; }; } },
  activeThemeFs: () => ({ root: '__kb__', readFile: async (p: string) => { if (!(p in vault.files)) throw new Error(`ENOENT: ${p}`); return vault.files[p]!; }, writeFile: async (p: string, c: string) => { vault.files[p] = c; }, exists: async (p: string) => p in vault.files, rename: async (from: string, to: string) => { vault.files[to] = vault.files[from]!; delete vault.files[from]; } }),
}));
const vault = vi.hoisted(() => ({ files: {} as Record<string, string> }));
vi.mock('@/store/vaultStore', () => ({
  useVaultStore: {
    getState: () => ({
      activeVaultId: 'v1',
      manager: {
        readFile: async (p: string) => {
          if (!(p in vault.files)) throw new Error(`ENOENT: ${p}`);
          return vault.files[p]!;
        },
        writeFile: async (p: string, c: string) => {
          vault.files[p] = c;
        },
        rename: async (o: string, n: string) => {
          vault.files[n] = vault.files[o]!;
          delete vault.files[o];
        },
      },
    }),
  },
}));

import { deriveTopicEditIntents, reconcileTopicEdit, startKbIntentWatch, stopKbIntentWatch } from './kbIntentWatch';
import { sha256Hex } from './kbFs';
import { kbTopicPagePath, kbTopicRefsPath } from './kbPaths';
import { serializeTopicPage, parseTopicPage } from './topicSynth';
import type { KbFs } from './kbFs';
import type { KbRef } from './kbTypes';

function memFs(): KbFs & { files: Record<string, string> } {
  const files: Record<string, string> = {};
  return {
    files,
    readFile: async (p) => {
      if (!(p in files)) throw new Error(`ENOENT: ${p}`);
      return files[p]!;
    },
    writeFile: async (p, c) => {
      files[p] = c;
    },
    exists: async (p) => p in files,
    rename: async (o, n) => {
      files[n] = files[o]!;
      delete files[o];
    },
  };
}

const TP_ID = 'tp-1';
const PAGE_PATH = kbTopicPagePath(TP_ID);
const REFS_PATH = kbTopicRefsPath(TP_ID);

function makeRef(over: Partial<KbRef>): KbRef {
  return {
    id: 'c1',
    topicId: TP_ID,
    anchorText: '旧锚',
    claimText: '旧结论',
    srcId: 'src-1',
    versionHash: 'h1',
    startLine: 1,
    endLine: 1,
    status: 'active',
    ...over,
  };
}

function pageBody(...claimLines: string[]): string {
  return serializeTopicPage(
    { id: TP_ID, title: '窗口管理', sources: ['src-1'] },
    `# 窗口管理\n\n${claimLines.join('\n\n')}\n\n[^c1]: src-1 · notes/a.md · L1-L1 · 旧锚\n`,
  );
}

describe('deriveTopicEditIntents — 纯逻辑：编辑后正文的意图推导', () => {
  it('未变化的引用 → 无更新', () => {
    const body = parseTopicPage(pageBody('- 旧结论 [^c1]')).body;
    const r = deriveTopicEditIntents(body, [makeRef({})], 1);
    expect(r.updates).toEqual([]);
    expect(r.deletions).toEqual([]);
  });

  it('段落文本被改写 → unverified（引用待核验，保留关联）', () => {
    const body = parseTopicPage(pageBody('- 用户改写后的结论 [^c1]')).body;
    const r = deriveTopicEditIntents(body, [makeRef({})], 1);
    expect(r.updates).toEqual([{ ref: makeRef({}), status: 'unverified' }]);
    expect(r.deletions).toEqual([]);
  });

  it('段落改回与程序写入时一致 → unverified 恢复 active', () => {
    const body = parseTopicPage(pageBody('- 旧结论 [^c1]')).body;
    const r = deriveTopicEditIntents(body, [makeRef({ status: 'unverified' })], 1);
    expect(r.updates).toEqual([{ ref: makeRef({ status: 'unverified' }), status: 'active' }]);
  });

  it('引用标记与脚注定义都删了 → 删除意图 + deleted', () => {
    const content = serializeTopicPage(
      { id: TP_ID, title: '窗口管理', sources: ['src-1'] },
      '# 窗口管理\n\n（正文已无该结论）\n',
    );
    const r = deriveTopicEditIntents(parseTopicPage(content).body, [makeRef({})], 42);
    expect(r.deletions).toHaveLength(1);
    expect(r.deletions[0]).toMatchObject({ topicId: TP_ID, anchorText: '旧锚', srcId: 'src-1', versionHash: 'h1' });
    expect(r.deletions[0]!.createdAt).toBe(42);
    expect(r.updates).toEqual([{ ref: makeRef({}), status: 'deleted' }]);
  });

  it('只删了结论行、脚注定义还在 → 不算删除意图，标 unverified', () => {
    const content = serializeTopicPage(
      { id: TP_ID, title: '窗口管理', sources: ['src-1'] },
      '# 窗口管理\n\n[^c1]: src-1 · notes/a.md · L1-L1 · 旧锚\n',
    );
    const r = deriveTopicEditIntents(parseTopicPage(content).body, [makeRef({})], 1);
    expect(r.deletions).toEqual([]);
    expect(r.updates.map((u) => u.status)).toEqual(['unverified']);
  });

  it('旧记录无 claimText（schema 兼容）→ 无法比对段落，不更新', () => {
    const body = parseTopicPage(pageBody('- 用户改了这句 [^c1]')).body;
    const legacy = makeRef({});
    delete legacy.claimText;
    const r = deriveTopicEditIntents(body, [legacy], 1);
    expect(r.updates).toEqual([]);
  });

  it('source-removed 状态的引用不参与推导', () => {
    const body = parseTopicPage(pageBody('- 旧结论 [^c1]')).body;
    const r = deriveTopicEditIntents(body, [makeRef({ status: 'source-removed' })], 1);
    expect(r.updates).toEqual([]);
    expect(r.deletions).toEqual([]);
  });
});

describe('reconcileTopicEdit — 落盘对账', () => {
  const ORIGINAL = pageBody('- 旧结论 [^c1]');
  const EDITED = pageBody('- 用户改写后的结论 [^c1]');

  function seed(): ReturnType<typeof memFs> {
    const fs = memFs();
    fs.files[PAGE_PATH] = ORIGINAL;
    fs.files[REFS_PATH] = JSON.stringify([makeRef({})]);
    fs.files['__kb__/manifest.json'] = JSON.stringify({
      goal: '目标',
      scope: [],
      sources: { 'src-1': { path: 'notes/a.md', currentHash: 'h1', indexVersion: 1 } },
      topics: { [TP_ID]: { path: PAGE_PATH, title: '窗口管理', lastProgramHash: 'will-be-set' } },
    });
    return fs;
  }

  it('用户编辑：refs 标 unverified，lastProgramHash 更新为用户版本', async () => {
    const fs = seed();
    const manifest = JSON.parse(fs.files['__kb__/manifest.json']!) as { topics: Record<string, { lastProgramHash: string }> };
    manifest.topics[TP_ID]!.lastProgramHash = await sha256Hex(ORIGINAL);
    fs.files['__kb__/manifest.json'] = JSON.stringify(manifest);
    fs.files[PAGE_PATH] = EDITED;

    const r = await reconcileTopicEdit(fs, PAGE_PATH);
    expect(r).toMatchObject({ changed: true, deletions: 0, unverified: 1 });
    expect(JSON.parse(fs.files[REFS_PATH]!)).toMatchObject([{ id: 'c1', status: 'unverified' }]);
    // 用户编辑后的 hash 成为新的程序基线（从磁盘重读验证，不用内存旧对象）。
    expect(JSON.parse(fs.files['__kb__/manifest.json']!).topics[TP_ID]!.lastProgramHash).toBe(await sha256Hex(EDITED));
  });

  it('用户删除结论（标记+脚注都没了）：deletions.json 落盘，ref 标 deleted', async () => {
    const fs = seed();
    const manifest = JSON.parse(fs.files['__kb__/manifest.json']!) as { topics: Record<string, { lastProgramHash: string }> };
    manifest.topics[TP_ID]!.lastProgramHash = await sha256Hex(ORIGINAL);
    fs.files['__kb__/manifest.json'] = JSON.stringify(manifest);
    fs.files[PAGE_PATH] = serializeTopicPage(
      { id: TP_ID, title: '窗口管理', sources: ['src-1'] },
      '# 窗口管理\n\n（结论已删）\n',
    );

    const r = await reconcileTopicEdit(fs, PAGE_PATH);
    expect(r).toMatchObject({ changed: true, deletions: 1 });
    expect(JSON.parse(fs.files[REFS_PATH]!)).toMatchObject([{ id: 'c1', status: 'deleted' }]);
    const deletions = JSON.parse(fs.files['__kb__/deletions.json']!) as unknown[];
    expect(deletions).toHaveLength(1);
  });

  it('内容与程序基线一致（程序写入漏网）→ 无操作', async () => {
    const fs = seed();
    const manifest = JSON.parse(fs.files['__kb__/manifest.json']!) as { topics: Record<string, { lastProgramHash: string }> };
    manifest.topics[TP_ID]!.lastProgramHash = await sha256Hex(ORIGINAL);
    fs.files['__kb__/manifest.json'] = JSON.stringify(manifest);
    const before = fs.files[REFS_PATH];

    const r = await reconcileTopicEdit(fs, PAGE_PATH);
    expect(r.changed).toBe(false);
    expect(fs.files[REFS_PATH]).toBe(before);
    expect(fs.files['__kb__/deletions.json']).toBeUndefined();
  });
});

describe('kbIntentWatch — 监听接线（__kb__/topics/*.md）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    kbStore.state.buildRunning = false;
    kbStore.state.loadFromManifest.mockClear();
    kbStore.state.reconcileTopicEdits.mockImplementation(async (paths: string[]) => {
      const fs = { readFile: async (p: string) => { if (!(p in vault.files)) throw new Error(`ENOENT: ${p}`); return vault.files[p]!; }, writeFile: async (p: string, c: string) => { vault.files[p] = c; }, exists: async (p: string) => p in vault.files, rename: async (from: string, to: string) => { vault.files[to] = vault.files[from]!; delete vault.files[from]; } };
      let changed = false;
      for (const path of paths) changed = (await reconcileTopicEdit(fs, path)).changed || changed;
      if (changed) kbStore.state.loadFromManifest();
    });
    vault.files = {};
    startKbIntentWatch();
  });

  afterEach(() => {
    stopKbIntentWatch();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function seedVault(edited: string, originalHash: string): void {
    vault.files[PAGE_PATH] = edited;
    vault.files[REFS_PATH] = JSON.stringify([makeRef({})]);
    vault.files['__kb__/manifest.json'] = JSON.stringify({
      goal: '目标',
      scope: [],
      sources: { 'src-1': { path: 'notes/a.md', currentHash: 'h1', indexVersion: 1 } },
      topics: { [TP_ID]: { path: PAGE_PATH, title: '窗口管理', lastProgramHash: originalHash } },
    });
  }

  it('主题页变更：去抖后对账 + 刷新 store；无关路径忽略', async () => {
    seedVault(pageBody('- 用户改写后的结论 [^c1]'), 'stale');
    fw.listener?.(['__kb__/topics/tp-1.md', 'notes/a.md', '__kb__/topics/tp-1.refs.json']);
    await vi.advanceTimersByTimeAsync(999);
    expect(vault.files[REFS_PATH]).toBe(JSON.stringify([makeRef({})])); // 未触发
    // 触发去抖回调（异步对账开始）；sha256 是真实异步（线程池），
    // 假计时器刷不完 —— 切回真实计时器后等 store 刷新完成再断言。
    await vi.advanceTimersByTimeAsync(1);
    vi.useRealTimers();
    await vi.waitFor(() => expect(kbStore.state.loadFromManifest).toHaveBeenCalledTimes(1));
    expect(JSON.parse(vault.files[REFS_PATH]!)).toMatchObject([{ status: 'unverified' }]);
  });

  it('构建进行中的事件被丢弃', async () => {
    seedVault(pageBody('- 用户改写后的结论 [^c1]'), 'stale');
    kbStore.state.buildRunning = true;
    fw.listener?.(['__kb__/topics/tp-1.md']);
    await vi.advanceTimersByTimeAsync(2000);
    expect(JSON.parse(vault.files[REFS_PATH]!)).toMatchObject([{ status: 'active' }]);
    expect(kbStore.state.loadFromManifest).not.toHaveBeenCalled();
  });

  it('去抖窗口内构建开始：对账推迟到构建结束后（避免并发写 manifest）', async () => {
    seedVault(pageBody('- 用户改写后的结论 [^c1]'), 'stale');
    fw.listener?.(['__kb__/topics/tp-1.md']); // 到达时未在构建
    kbStore.state.buildRunning = true; // 去抖窗口内构建开始
    await vi.advanceTimersByTimeAsync(1000); // fire → 推迟，不对账
    expect(JSON.parse(vault.files[REFS_PATH]!)).toMatchObject([{ status: 'active' }]);
    kbStore.state.buildRunning = false; // 构建结束
    await vi.advanceTimersByTimeAsync(1000); // 下一轮 fire → 对账
    vi.useRealTimers();
    await vi.waitFor(() => expect(kbStore.state.loadFromManifest).toHaveBeenCalledTimes(1));
    expect(JSON.parse(vault.files[REFS_PATH]!)).toMatchObject([{ status: 'unverified' }]);
  });

  it('stop() 清掉未触发的去抖并退订', async () => {
    seedVault(pageBody('- 用户改写后的结论 [^c1]'), 'stale');
    fw.listener?.(['__kb__/topics/tp-1.md']);
    stopKbIntentWatch();
    await vi.advanceTimersByTimeAsync(2000);
    expect(kbStore.state.loadFromManifest).not.toHaveBeenCalled();
    fw.listener?.(['__kb__/topics/tp-1.md']); // 已退订
    await vi.advanceTimersByTimeAsync(2000);
    expect(kbStore.state.loadFromManifest).not.toHaveBeenCalled();
  });
});
