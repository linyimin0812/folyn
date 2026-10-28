import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// fileWatcher：捕获订阅回调（真实模块含 Tauri 依赖与单例 watcher 状态）。
const fw = vi.hoisted(() => ({ listener: null as ((paths: string[]) => void) | null }));
vi.mock('@/utils/fileWatcher', () => ({
  subscribeVaultChanges: (l: (paths: string[]) => void) => {
    fw.listener = l;
    return () => {
      fw.listener = null;
    };
  },
  startVaultWatcher: vi.fn(),
  stopVaultWatcher: vi.fn(),
  suppressWatcherFor: vi.fn(),
  pauseWatcher: vi.fn(),
  resumeWatcher: vi.fn(),
  initExternalFileWatcher: vi.fn(),
  syncExternalWatches: vi.fn(),
}));

// knowledgeStore / aiConfigStore：注入可控状态（真实 store 走 vaultStore/磁盘）。
const kbStore = vi.hoisted(() => ({
  listener: null as ((next: unknown, previous: unknown) => void) | null,
  state: {
    activeThemeId: 'theme-a', contextVaultId: 'v1',
    scope: ['notes'] as string[],
    buildRunning: false,
    build: vi.fn(),
  },
}));
vi.mock('@/store/knowledgeStore', () => ({
  useKnowledgeStore: { getState: () => kbStore.state, subscribe: (listener: (next: unknown, previous: unknown) => void) => { kbStore.listener = listener; return () => { kbStore.listener = null; }; } },
}));
const aiState = vi.hoisted(() => ({ state: { kbAutoBuild: true } }));
vi.mock('@/store/aiConfigStore', () => ({
  useAiConfigStore: { getState: () => aiState.state },
  resolvePairConfig: vi.fn(() => null),
}));

import { startKbAutoBuild, stopKbAutoBuild } from './kbAutoBuild';

function emit(paths: string[]): void {
  fw.listener?.(paths);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  kbStore.state.activeThemeId = 'theme-a';
  kbStore.state.scope = ['notes'];
  kbStore.state.buildRunning = false;
  kbStore.state.build.mockClear();
  aiState.state.kbAutoBuild = true;
  startKbAutoBuild();
});

afterEach(() => {
  stopKbAutoBuild();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('kbAutoBuild — 收录范围内变更自动增量收录（切片 B）', () => {
  it('范围内受支持文件：去抖聚合后一次 build(only)', () => {
    emit(['notes/a.md']);
    emit(['notes/b.md', 'notes/a.md']);
    vi.advanceTimersByTime(1499);
    expect(kbStore.state.build).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(kbStore.state.build).toHaveBeenCalledTimes(1);
    expect(kbStore.state.build).toHaveBeenCalledWith(['notes/a.md', 'notes/b.md']);
  });

  it('新事件重置去抖窗口', () => {
    emit(['notes/a.md']);
    vi.advanceTimersByTime(1000);
    emit(['notes/b.md']);
    vi.advanceTimersByTime(1000);
    expect(kbStore.state.build).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(kbStore.state.build).toHaveBeenCalledWith(['notes/a.md', 'notes/b.md']);
  });

  it('忽略：__kb__ 路径（程序自写防自触发）、不支持的扩展名、范围外路径', () => {
    emit(['__kb__/topics/tp-1.md', 'notes/img.png', 'outside/x.md']);
    vi.advanceTimersByTime(2000);
    expect(kbStore.state.build).not.toHaveBeenCalled();
  });

  it('构建进行中到达的事件被丢弃（不叠加触发）', () => {
    kbStore.state.buildRunning = true;
    emit(['notes/a.md']);
    vi.advanceTimersByTime(2000);
    expect(kbStore.state.build).not.toHaveBeenCalled();
  });

  it('开关关闭（kbAutoBuild=false）：不触发', () => {
    aiState.state.kbAutoBuild = false;
    emit(['notes/a.md']);
    vi.advanceTimersByTime(2000);
    expect(kbStore.state.build).not.toHaveBeenCalled();
  });

  it('stop() 清掉未触发的去抖并退订', () => {
    emit(['notes/a.md']);
    stopKbAutoBuild();
    vi.advanceTimersByTime(2000);
    expect(kbStore.state.build).not.toHaveBeenCalled();
    emit(['notes/b.md']); // 已退订，事件无人接
    vi.advanceTimersByTime(2000);
    expect(kbStore.state.build).not.toHaveBeenCalled();
  });

  it('drops debounced changes after switching away and back to the same theme', () => {
    emit(['notes/a.md']);
    const previous = { ...kbStore.state };
    kbStore.state.activeThemeId = 'theme-b'; kbStore.listener?.(kbStore.state, previous);
    const away = { ...kbStore.state };
    kbStore.state.activeThemeId = 'theme-a'; kbStore.listener?.(kbStore.state, away);
    vi.advanceTimersByTime(2000);
    expect(kbStore.state.build).not.toHaveBeenCalled();
  });

  it('目录覆盖：scope 中的目录下新文件也触发', () => {
    emit(['notes/sub/new.md']);
    vi.advanceTimersByTime(1500);
    expect(kbStore.state.build).toHaveBeenCalledWith(['notes/sub/new.md']);
  });
});
