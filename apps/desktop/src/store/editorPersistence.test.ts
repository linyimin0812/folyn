// editorPersistence 会话作用域键测试（spec 6.3）。
//
// 三个断言面：
//  1. persist 写 `editor:session:<sid>:…`（绑定什么会话写什么键）；
//  2. load 会话键缺失时回读 legacy 键（升级用户的打开标签一次性迁移）；
//  3. 不同会话互不覆盖（研究窗口关掉重开后主窗口标签仍在）。
//
// getSessionId 依赖 windowSessionService 的模块级绑定状态——测试里直接
// 用 __clearSessionState + window.location.hash 驱动，不 mock getSessionId
// （真实链路才是被测对象）。

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/platform', () => ({
  isTauri: vi.fn(() => false),
}));

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

vi.mock('@/store/editorAutoSave', () => ({ scheduleAutoSave: vi.fn(), flushAllAutoSaves: vi.fn() }));

import { isTauri } from '@/utils/platform';
import { bindSession, __clearSessionState } from '@/services/windowSessionService';
import {
  flushPersistOpenTabs,
  loadPersistedOpenTabs,
  flushPersistExternalOpenTabs,
  loadExternalOpenTabs,
  type PersistedOpenTabs,
} from './editorPersistence';
import type { FileTab } from './editorStore';

function makeTab(overrides: Partial<FileTab> & { path: string; name: string }): FileTab {
  return {
    id: overrides.id ?? `tab:${overrides.path}`,
    fileType: 'markdown',
    content: '',
    isDirty: false,
    cursorLine: 1,
    cursorCol: 1,
    editorScrollTop: 0,
    previewScrollTop: 0,
    viewMode: 'preview',
    ...overrides,
  } as FileTab;
}

beforeEach(() => {
  store.clear();
  __clearSessionState();
  window.location.hash = '';
});

afterEach(() => {
  window.location.hash = '';
});

describe('会话作用域键', () => {
  it('主窗口（未显式绑定）写 main 作用域键', async () => {
    const tabs = [makeTab({ path: '/v/a.md', name: 'a.md' })];
    flushPersistOpenTabs('vault-1', tabs, tabs[0].id);
    expect(store.has('editor:session:main:tabs:vault-1')).toBe(true);
    expect(store.has('editor:openTabs:vault-1')).toBe(false);
  });

  it('研究窗口写自己的会话键，不碰 main 键', async () => {
    // 先用主窗口身份写 main 键。
    const mainTabs = [makeTab({ path: '/v/main.md', name: 'main.md' })];
    flushPersistOpenTabs('vault-1', mainTabs, mainTabs[0].id);

    // 绑定研究窗口会话 r-xyz。
    window.location.hash = '#/research/r-xyz';
    await bindSession();
    const researchTabs = [makeTab({ path: '/v/research.md', name: 'research.md' })];
    flushPersistOpenTabs('vault-1', researchTabs, researchTabs[0].id);

    expect(store.has('editor:session:r-xyz:tabs:vault-1')).toBe(true);
    // main 的数据原样保留。
    const mainData = store.get('editor:session:main:tabs:vault-1') as PersistedOpenTabs;
    expect(mainData.tabs[0].path).toBe('/v/main.md');
  });

  it('load 从会话键读回', async () => {
    window.location.hash = '#/research/r-xyz';
    await bindSession();
    const tabs = [makeTab({ path: '/v/x.md', name: 'x.md', id: 'tab:dup' })];
    flushPersistOpenTabs('vault-1', tabs, 'tab:dup');

    const loaded = await loadPersistedOpenTabs('vault-1');
    expect(loaded?.tabs[0].id).toBe('tab:dup');
    expect(loaded?.activeTabId).toBe('tab:dup');
  });
});

describe('legacy 兜底读取', () => {
  it('vault 标签：会话键缺失时回读 editor:openTabs:<vaultId>', async () => {
    const legacy: PersistedOpenTabs = {
      tabs: [{ path: '/v/legacy.md', name: 'legacy.md', id: 'legacy:1' }],
      activeTabPath: '/v/legacy.md',
      activeTabId: 'legacy:1',
    };
    store.set('editor:openTabs:vault-1', legacy);

    const loaded = await loadPersistedOpenTabs('vault-1');
    expect(loaded).toEqual(legacy);
  });

  it('external 标签：会话键缺失时回读 editor:externalOpenTabs', async () => {
    const legacy: PersistedOpenTabs = {
      tabs: [{ path: '/tmp/ext.md', name: 'ext.md', id: 'ext:1' }],
      activeTabPath: '/tmp/ext.md',
      activeTabId: 'ext:1',
    };
    store.set('editor:externalOpenTabs', legacy);

    const loaded = await loadExternalOpenTabs('scope');
    expect(loaded).toEqual(legacy);
  });

  it('external 标签：会话键存在时优先（不再读 legacy）', async () => {
    store.set('editor:externalOpenTabs', {
      tabs: [{ path: '/old.md', name: 'old.md' }],
      activeTabPath: '/old.md',
    });
    window.location.hash = '#/research/r-ext';
    await bindSession();
    flushPersistExternalOpenTabs('scope', [makeTab({ path: '/new.md', name: 'new.md', id: 'new:1' })], 'new:1');

    const loaded = await loadExternalOpenTabs('scope');
    expect(loaded?.tabs[0].path).toBe('/new.md');
  });

  it('两者皆无 → null（空文件不落盘）', async () => {
    expect(await loadPersistedOpenTabs('vault-none')).toBeNull();
    expect(await loadExternalOpenTabs('scope')).toBeNull();
  });
});

describe('空数据', () => {
  it('空 tabs 也落盘（空记录，load 返回空 tabs 而非 legacy）', async () => {
    // 原行为：flush 总是写，空 tabs 写空记录——这正好阻断 legacy 兜底，
    // 用户清空标签后重启不会从旧键复活。
    store.set('editor:openTabs:vault-1', {
      tabs: [{ path: '/v/legacy.md', name: 'legacy.md' }],
      activeTabPath: '/v/legacy.md',
    });
    flushPersistOpenTabs('vault-1', [], null);
    const loaded = await loadPersistedOpenTabs('vault-1');
    expect(loaded?.tabs).toEqual([]);
  });

  it('external 空 → 空记录阻断 legacy 兜底', async () => {
    store.set('editor:externalOpenTabs', {
      tabs: [{ path: '/old.md', name: 'old.md' }],
      activeTabPath: '/old.md',
    });
    flushPersistExternalOpenTabs('scope', [], null);
    const loaded = await loadExternalOpenTabs('scope');
    expect(loaded?.tabs).toEqual([]);
  });
});
