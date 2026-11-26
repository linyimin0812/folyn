// externalFolderStore 测试（打开外部文件夹——Files 面板树 + 持久化）。
//
// 环境要点（同 windowSessionService.test）：
//  - isTauri mock 可切换；@tauri-apps/plugin-fs 的 readDir/exists 与
//    @tauri-apps/plugin-dialog 的 open 全 mock。
//  - isWithinHome 依赖 @tauri-apps/api/path 的 homeDir → mock 成固定 home。
//  - storageClient mock 为内存 Map（跨用例持久 → __clearExternalFolderCache）。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const isTauriMock = vi.fn(() => false);
vi.mock('@/utils/platform', () => ({ isTauri: (...a: unknown[]) => isTauriMock(...(a as [])) }));

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

// In-memory disk: folder paths exist; readDir(path) returns entries.
// REAL plugin-fs v2 DirEntry shape — NO `path` field (name + type flags
// only). The store must compose dir + name itself; earlier the mock
// carried `path`, which masked exactly that bug.
const diskMock = vi.hoisted(() => {
  const dirs = new Map<string, Array<{ name: string; isDirectory: boolean; isFile: boolean; isSymlink: boolean }>>();
  return { dirs };
});
vi.mock('@tauri-apps/plugin-fs', () => ({
  readDir: async (path: string) => diskMock.dirs.get(path) ?? [],
  exists: async (path: string) => diskMock.dirs.has(path),
}));

vi.mock('@tauri-apps/api/path', () => ({
  homeDir: async () => '/Users/t',
  join: async (...parts: string[]) => parts.join('/').replace(/\/{2,}/g, '/'),
}));

import {
  useExternalFolderStore,
  __clearExternalFolderCache,
} from '@/store/externalFolderStore';

const HOME = '/Users/t';

function seedFolder(path: string, children: { name: string; isDirectory?: boolean }[]) {
  diskMock.dirs.set(path, children.map((c) => ({
    name: c.name,
    isDirectory: !!c.isDirectory,
    isFile: !c.isDirectory,
    isSymlink: false,
  })));
}

beforeEach(() => {
  __clearExternalFolderCache();
  storageMock.mem.clear();
  diskMock.dirs.clear();
  isTauriMock.mockReturnValue(true);
});

describe('externalFolderStore.init', () => {
  it('restores persisted folders, builds trees, trims missing ones', async () => {
    seedFolder(`${HOME}/docs`, [
      { name: 'b.md' },
      { name: 'z.md' },
      { name: 'sub', isDirectory: true },
      { name: '.hidden' },
    ]);
    seedFolder(`${HOME}/docs/sub`, [{ name: 'deep.md' }]);
    seedFolder(`${HOME}/other`, []);
    // docs + gone (missing on disk) persisted
    storageMock.mem.set('externalFolders', [`${HOME}/docs`, `${HOME}/gone`, `${HOME}/other`]);

    await useExternalFolderStore.getState().init();

    const folders = useExternalFolderStore.getState().folders;
    expect(folders.map((f) => f.path)).toEqual([`${HOME}/docs`, `${HOME}/other`]);
    const docs = folders[0];
    // dirs first + sorted; hidden entries skipped; children nested with
    // COMPOSED absolute paths (dir + name — readDir returns no path)
    expect(docs.tree.map((e) => e.name)).toEqual(['sub', 'b.md', 'z.md']);
    expect(docs.tree[0].path).toBe(`${HOME}/docs/sub`);
    expect(docs.tree[0].children?.map((e) => e.path)).toEqual([`${HOME}/docs/sub/deep.md`]);
    expect(docs.tree[1].path).toBe(`${HOME}/docs/b.md`);
    // trimmed persistence (missing folder dropped)
    expect(storageMock.mem.get('externalFolders')).toEqual([`${HOME}/docs`, `${HOME}/other`]);
  });

  it('no-op outside Tauri', async () => {
    isTauriMock.mockReturnValue(false);
    storageMock.mem.set('externalFolders', [`${HOME}/docs`]);
    await useExternalFolderStore.getState().init();
    expect(useExternalFolderStore.getState().folders).toEqual([]);
  });
});

describe('externalFolderStore.addFolder (drop path)', () => {
  it('adds a folder by path and persists', async () => {
    seedFolder(`${HOME}/dropped`, [{ name: 'x.md' }]);
    const ok = await useExternalFolderStore.getState().addFolder(`${HOME}/dropped`);
    expect(ok).toBe(true);
    expect(useExternalFolderStore.getState().folders.map((f) => f.path)).toEqual([`${HOME}/dropped`]);
    expect(storageMock.mem.get('externalFolders')).toEqual([`${HOME}/dropped`]);
  });

  it('rejects duplicates, out-of-home, missing', async () => {
    seedFolder(`${HOME}/a`, []);
    expect(await useExternalFolderStore.getState().addFolder(`${HOME}/a`)).toBe(true);
    // duplicate
    expect(await useExternalFolderStore.getState().addFolder(`${HOME}/a`)).toBe(false);
    // outside $HOME
    expect(await useExternalFolderStore.getState().addFolder('/etc')).toBe(false);
    // missing on disk
    expect(await useExternalFolderStore.getState().addFolder(`${HOME}/nope`)).toBe(false);
    expect(useExternalFolderStore.getState().folders).toHaveLength(1);
  });
});

describe('externalFolderStore.removeFolder / refreshFolder', () => {
  it('remove drops the folder and persists the rest', async () => {
    seedFolder(`${HOME}/a`, []);
    seedFolder(`${HOME}/b`, []);
    storageMock.mem.set('externalFolders', [`${HOME}/a`, `${HOME}/b`]);
    await useExternalFolderStore.getState().init();

    useExternalFolderStore.getState().removeFolder(`${HOME}/a`);

    expect(useExternalFolderStore.getState().folders.map((f) => f.path)).toEqual([`${HOME}/b`]);
    expect(storageMock.mem.get('externalFolders')).toEqual([`${HOME}/b`]);
  });

  it('refresh of a deleted folder marks it errored, tree emptied', async () => {
    seedFolder(`${HOME}/a`, [{ name: 'x.md' }]);
    storageMock.mem.set('externalFolders', [`${HOME}/a`]);
    await useExternalFolderStore.getState().init();

    diskMock.dirs.delete(`${HOME}/a`);
    await useExternalFolderStore.getState().refreshFolder(`${HOME}/a`);

    const f = useExternalFolderStore.getState().folders[0];
    expect(f.tree).toEqual([]);
    expect(f.error).toBeTruthy();
  });
});
