import { beforeEach, describe, expect, it, vi } from 'vitest';

const { watchCalls, unwatched, readFile, setContentExternal, tabsRef } = vi.hoisted(() => ({
  watchCalls: [] as { path: string; cb: (e: unknown) => void }[],
  unwatched: [] as string[],
  readFile: vi.fn(async (p: string) => fileContents[p] ?? ''),
  setContentExternal: vi.fn(),
  tabsRef: { tabs: [] as Array<{ id: string; path: string; fileType: string; content: string; isDirty: boolean }> },
}));

const fileContents: Record<string, string> = {};

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-fs', () => ({
  watch: vi.fn(async (path: string, cb: (e: unknown) => void) => {
    watchCalls.push({ path, cb });
    return () => unwatched.push(path);
  }),
}));
vi.mock('@/store/editorStore', () => ({
  useEditorStore: { getState: () => tabsRef, subscribe: vi.fn() },
}));
vi.mock('@/store/diffReviewStore', () => ({
  useDiffReviewStore: { getState: () => ({ setContentExternal }) },
}));
vi.mock('@/services/externalFileProvider', () => ({
  resolveAbsolutePath: vi.fn(async (p: string) => p),
  externalFileProvider: {
    readFile: (p: string) => readFile(p),
  },
}));
vi.mock('@/components/file-types/registry', () => ({
  getHandlerById: () => ({ needsFileContent: true }),
}));

import { syncExternalWatches } from './fileWatcher';

const modifyEvent = { type: { modify: { kind: 'any' } }, paths: [] };

describe('syncExternalWatches', () => {
  beforeEach(() => {
    watchCalls.length = 0;
    unwatched.length = 0;
    readFile.mockClear();
    setContentExternal.mockClear();
    for (const k of Object.keys(fileContents)) delete fileContents[k];
  });

  it('watches open external tabs, ignores vault tabs, unwatches closed ones', async () => {
    tabsRef.tabs = [{ id: 'ext:/Users/x/a.md', path: '/Users/x/a.md', fileType: 'markdown', content: 'old', isDirty: false }];
    await syncExternalWatches(tabsRef.tabs);
    expect(watchCalls.map((c) => c.path)).toEqual(['/Users/x/a.md']);

    tabsRef.tabs = [{ id: 'v:notes/b.md', path: 'notes/b.md', fileType: 'markdown', content: 'x', isDirty: false }];
    await syncExternalWatches(tabsRef.tabs);
    expect(unwatched).toEqual(['/Users/x/a.md']);
    expect(watchCalls).toHaveLength(1);
  });

  it('refreshes tab content via setContentExternal when disk differs', async () => {
    const path = '/Users/x/b.md';
    tabsRef.tabs = [{ id: `ext:${path}`, path, fileType: 'markdown', content: 'old', isDirty: false }];
    await syncExternalWatches(tabsRef.tabs);
    fileContents[path] = 'new';

    await watchCalls[0].cb(modifyEvent);
    await new Promise((r) => setTimeout(r));
    expect(setContentExternal).toHaveBeenCalledWith(`ext:${path}`, 'new');
  });

  it('does not overwrite a dirty tab', async () => {
    const path = '/Users/x/c.md';
    tabsRef.tabs = [{ id: `ext:${path}`, path, fileType: 'markdown', content: 'draft', isDirty: true }];
    await syncExternalWatches(tabsRef.tabs);
    fileContents[path] = 'new';

    await watchCalls[0].cb(modifyEvent);
    await new Promise((r) => setTimeout(r));
    expect(setContentExternal).not.toHaveBeenCalled();
  });

  it('skips refresh when disk content matches the tab', async () => {
    const path = '/Users/x/d.md';
    tabsRef.tabs = [{ id: `ext:${path}`, path, fileType: 'markdown', content: 'same', isDirty: false }];
    await syncExternalWatches(tabsRef.tabs);
    fileContents[path] = 'same';

    await watchCalls[0].cb(modifyEvent);
    await new Promise((r) => setTimeout(r));
    expect(setContentExternal).not.toHaveBeenCalled();
  });
});
