// windowSessionService 测试（spec 6.3–6.5）。
//
// 环境要点：
//  - isTauri 被 mock 为可切换（jsdom 无 Tauri；create_research_window 的
//    invoke 路径需要 Tauri=true + mock 的 @tauri-apps/api/core）。
//  - storageClient 全 mock：内存 Map（getFresh 与 get 同源，读 what-you-set）。
//  - window.location.hash 控制研究窗口身份（jsdom 支持直接赋值）。
//  - 模块级绑定状态跨用例持久 → beforeEach __clearSessionState()。

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/platform', () => ({
  isTauri: vi.fn(() => false),
}));

// vi.hoisted：mock 工厂在 import 阶段就被调用（fileTypePreferenceStore 等
// module-eval 期写 storage 的模块先于本文件体执行），共享 Map 必须随工厂
// 一起提升，否则 TDZ ReferenceError。
const storageMock = vi.hoisted(() => {
  const mem = new Map<string, unknown>();
  return {
    mem,
    client: {
      get: async (key: string) => mem.get(key) ?? null,
      getFresh: async (key: string) => mem.get(key) ?? null,
      set: async (key: string, data: unknown) => { mem.set(key, data); },
      remove: async (key: string) => { mem.delete(key); },
      flushNow: async () => {},
    },
  };
});
vi.mock('@/utils/storageClient', () => ({ storageClient: storageMock.client }));
const store = storageMock.mem as Map<string, unknown>;

// 存活研究窗口 label mock（Rust 窗口列表真相）。isTauri=true 时
// invoke('list_research_windows') 返回它。
const liveWindowsMock: string[] = [];
const invokeMock = vi.fn(async (cmd: string) => {
  if (cmd === 'list_research_windows') return [...liveWindowsMock];
  return undefined;
});
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...(args as [])),
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'main' }),
}));

import { isTauri } from '@/utils/platform';
import {
  bindSession,
  getSessionId,
  isResearchWindow,
  isMainWindow,
  listSessions,
  listClosedSessions,
  createResearchWindow,
  restoreSession,
  clearSessionRecord,
  clearAllClosedSessions,
  closeOwnSessionRecord,
  markVaultKnown,
  __clearSessionState,
  __getBoundSessionId,
  type WindowSessionRecord,
} from './windowSessionService';
import { useEditorStore } from '@/store/editorStore';

const INDEX_KEY = 'editor:windowSessions';

function readIndex(): { sessions: Record<string, WindowSessionRecord> } {
  return (store.get(INDEX_KEY) as { sessions: Record<string, WindowSessionRecord> }) ?? { sessions: {} };
}

async function seedRecord(record: Partial<WindowSessionRecord> & { id: string }): Promise<WindowSessionRecord> {
  const idx = readIndex();
  const full: WindowSessionRecord = {
    kind: 'research',
    name: '研究',
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    open: false,
    closedAt: Date.now(),
    vaultId: null,
    tabCount: 0,
    lastDocName: null,
    lastDocPath: null,
    lastHeading: null,
    geometry: null,
    ...record,
  };
  idx.sessions[full.id] = full;
  store.set(INDEX_KEY, idx);
  return full;
}

function setHash(hash: string) {
  window.location.hash = hash;
}

beforeEach(() => {
  store.clear();
  invokeMock.mockClear();
  liveWindowsMock.length = 0;
  __clearSessionState();
  setHash('');
  useEditorStore.setState({ tabs: [], activeTabId: null });
});

afterEach(() => {
  setHash('');
});

describe('bindSession — 主窗口', () => {
  it('无索引（首启）时创建 main 会话', async () => {
    const bound = await bindSession();
    expect(bound.kind).toBe('main');
    expect(bound.sessionId).toBe('main');
    expect(getSessionId()).toBe('main');
    expect(isMainWindow()).toBe(true);
    expect(readIndex().sessions['main']).toBeDefined();
  });

  it('接管最近活跃会话并把其余标记为已关闭（spec 6.5）', async () => {
    await seedRecord({ id: 'r-aaa', name: '研究 A', open: true, lastActiveAt: 1000 });
    await seedRecord({ id: 'r-bbb', name: '研究 B', open: true, lastActiveAt: 2000 });
    // r-bbb 更近 → 被接管。
    const bound = await bindSession();
    expect(bound.sessionId).toBe('r-bbb');
    const idx = readIndex();
    expect(idx.sessions['r-bbb'].open).toBe(true);
    expect(idx.sessions['r-aaa'].open).toBe(false);
    expect(idx.sessions['r-aaa'].closedAt).not.toBeNull();
  });

  it('接管后 listClosedSessions 只剩未接管会话', async () => {
    await seedRecord({ id: 'r-aaa', open: true, lastActiveAt: 1000 });
    await seedRecord({ id: 'r-bbb', open: true, lastActiveAt: 2000 });
    await bindSession();
    const closed = await listClosedSessions();
    expect(closed.map((r) => r.id)).toEqual(['r-aaa']);
  });
});

describe('bindSession — 主窗口重载复绑/存活跳过（恢复开新窗 bug 修复）', () => {
  it('sessionStorage 有上次绑定 → 复绑原会话，跳过接管（dev 重载/⌘R）', async () => {
    sessionStorage.setItem('folyn:mainSession', 'r-own');
    await seedRecord({ id: 'r-own', open: true, closedAt: null, lastActiveAt: 100 });
    await seedRecord({ id: 'r-hot', open: true, closedAt: null, lastActiveAt: 9000 });
    const bound = await bindSession();
    expect(bound.sessionId).toBe('r-own');
    // 更活跃的 r-hot 未被抢占、未被标关闭（窗口可能还活着）。
    expect(readIndex().sessions['r-hot'].open).toBe(true);
    expect(readIndex().sessions['r-hot'].closedAt).toBeNull();
  });

  it('接管跳过有存活宿主的会话，只接管无宿主者', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    liveWindowsMock.push('research-r-live');
    await seedRecord({ id: 'r-live', open: true, closedAt: null, lastActiveAt: 9000 });
    await seedRecord({ id: 'r-dead', open: true, closedAt: null, lastActiveAt: 100 });
    const bound = await bindSession();
    expect(bound.sessionId).toBe('r-dead');
    const idx = readIndex();
    expect(idx.sessions['r-live'].open).toBe(true);
    expect(idx.sessions['r-live'].closedAt).toBeNull();
    vi.mocked(isTauri).mockReturnValue(false);
  });

  it('全部会话都有存活宿主 → 主窗口新开 main 会话（不抢）', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    liveWindowsMock.push('research-r-only');
    await seedRecord({ id: 'r-only', open: true, lastActiveAt: 9000 });
    const bound = await bindSession();
    expect(bound.sessionId).toBe('main');
    expect(readIndex().sessions['r-only'].open).toBe(true);
    vi.mocked(isTauri).mockReturnValue(false);
  });
});

describe('listClosedSessions — 存活真相', () => {
  it('磁盘标志失真但有存活宿主的会话不列出', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    liveWindowsMock.push('research-r-zombie');
    await seedRecord({ id: 'r-zombie', open: false, closedAt: 123 });
    await seedRecord({ id: 'r-real', open: false, closedAt: 456 });
    const closed = await listClosedSessions();
    expect(closed.map((r) => r.id)).toEqual(['r-real']);
    vi.mocked(isTauri).mockReturnValue(false);
  });
});

describe('bindSession — 研究窗口', () => {
  it('从 hash 读取会话 id 并复活关闭记录', async () => {
    await seedRecord({ id: 'r-aaa', open: false, closedAt: 12345 });
    setHash('#/research/r-aaa');
    const bound = await bindSession();
    expect(bound.kind).toBe('research');
    expect(bound.sessionId).toBe('r-aaa');
    expect(getSessionId()).toBe('r-aaa');
    expect(isResearchWindow()).toBe(true);
    expect(readIndex().sessions['r-aaa'].open).toBe(true);
    expect(readIndex().sessions['r-aaa'].closedAt).toBeNull();
  });

  it('索引缺失时补建记录（窗口存在 ⇒ 记录存在）', async () => {
    setHash('#/research/r-new1');
    await bindSession();
    const rec = readIndex().sessions['r-new1'];
    expect(rec).toBeDefined();
    expect(rec.open).toBe(true);
    expect(rec.kind).toBe('research');
  });
});

describe('命名', () => {
  it('「研究 N」取现有最大 N+1', async () => {
    await seedRecord({ id: 'r-a', name: '研究 2', open: false });
    setHash('#/research/r-b');
    await bindSession();
    expect(readIndex().sessions['r-b'].name).toBe('研究 3');
  });
});

describe('createResearchWindow', () => {
  it('新会话写索引（open=true）并 invoke Rust（Tauri 环境）', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    const sid = await createResearchWindow();
    expect(sid).toMatch(/^r-[0-9a-f]+$/);
    expect(readIndex().sessions[sid].open).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith('create_research_window', expect.objectContaining({ sessionId: sid }));
    vi.mocked(isTauri).mockReturnValue(false);
  });

  it('传入 sessionId 时复用既有记录的名称与几何', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    const rec = await seedRecord({
      id: 'r-geo', name: '研究 9', open: false,
      geometry: { x: 10, y: 20, width: 800, height: 600 },
    });
    await createResearchWindow({ sessionId: 'r-geo' });
    expect(invokeMock).toHaveBeenCalledWith('create_research_window', {
      sessionId: 'r-geo',
      title: '研究 9',
      geometry: rec.geometry,
    });
    vi.mocked(isTauri).mockReturnValue(false);
  });

  it('非 Tauri 环境不 invoke', async () => {
    await createResearchWindow();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe('restoreSession', () => {
  it('关闭记录翻回 open 并走 create_research_window', async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    await seedRecord({ id: 'r-res', name: '研究 4', open: false, closedAt: 999 });
    await restoreSession('r-res');
    const rec = readIndex().sessions['r-res'];
    expect(rec.open).toBe(true);
    expect(rec.closedAt).toBeNull();
    expect(invokeMock).toHaveBeenCalledWith('create_research_window', expect.objectContaining({ sessionId: 'r-res' }));
    vi.mocked(isTauri).mockReturnValue(false);
  });

  it('记录不存在时安全 no-op', async () => {
    await restoreSession('r-nope');
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe('closeOwnSessionRecord', () => {
  it('写入快照 + open=false', async () => {
    setHash('#/research/r-close');
    await bindSession();
    useEditorStore.setState({
      tabs: [{ id: 't1', name: 'doc.md', path: '/v/doc.md', fileType: 'markdown' } as never],
      activeTabId: 't1',
    });
    await closeOwnSessionRecord();
    const rec = readIndex().sessions['r-close'];
    expect(rec.open).toBe(false);
    expect(rec.closedAt).not.toBeNull();
    expect(rec.tabCount).toBe(1);
    expect(rec.lastDocName).toBe('doc.md');
  });

  it('未绑定时 no-op', async () => {
    await expect(closeOwnSessionRecord()).resolves.toBeUndefined();
    expect(store.has(INDEX_KEY)).toBe(false);
  });
});

describe('markVaultKnown', () => {
  it('补写本会话 vaultId', async () => {
    setHash('#/research/r-v');
    await bindSession();
    await markVaultKnown('vault-1');
    expect(readIndex().sessions['r-v'].vaultId).toBe('vault-1');
  });
});

describe('清除', () => {
  it('clearSessionRecord 删记录 + 会话 external 键', async () => {
    await seedRecord({ id: 'r-del', open: false });
    store.set('editor:session:r-del:external', { x: 1 });
    await clearSessionRecord('r-del');
    expect(readIndex().sessions['r-del']).toBeUndefined();
    expect(store.has('editor:session:r-del:external')).toBe(false);
  });

  it('clearAllClosedSessions 只删关闭记录', async () => {
    await seedRecord({ id: 'r-open', open: true });
    await seedRecord({ id: 'r-closed', open: false });
    await clearAllClosedSessions();
    const idx = readIndex();
    expect(idx.sessions['r-open']).toBeDefined();
    expect(idx.sessions['r-closed']).toBeUndefined();
  });
});

describe('listSessions', () => {
  it('按 lastActiveAt 降序返回全部', async () => {
    await seedRecord({ id: 'r-old', lastActiveAt: 100, open: false });
    await seedRecord({ id: 'r-new', lastActiveAt: 900, open: false });
    const all = await listSessions();
    expect(all.map((r) => r.id)).toEqual(['r-new', 'r-old']);
  });
});

describe('绑定状态', () => {
  it('未绑定时 getSessionId 回退 main（持久化键安全默认值）', () => {
    expect(__getBoundSessionId()).toBeNull();
    expect(getSessionId()).toBe('main');
  });
});
