import { describe, it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), open: vi.fn(), choose: vi.fn(), editedNote: vi.fn(), appendNote: vi.fn(),
  state: { currentVault: { id: 'a', name: 'A', basePath: '/vault-a', providerType: 'tauri' }, activeVaultId: 'a', isLoading: false, refreshFileTree: vi.fn() },
  listeners: new Set<() => void>(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, convertFileSrc: (p: string) => `asset:${p}` }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.choose }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
vi.mock('@/store/vaultStore', () => ({ useVaultStore: { getState: () => mocks.state, subscribe: (cb: () => void) => { mocks.listeners.add(cb); return () => mocks.listeners.delete(cb); } } }));
vi.mock('@/utils/pathResolver', () => ({ resolveBasePath: async (p: string) => p }));
vi.mock('@/services/editorIoService', () => ({ openFile: mocks.open }));
vi.mock('@/services/editorNoteService', () => ({ readEditedNoteText: mocks.editedNote, appendNoteInEditor: mocks.appendNote }));
import { buildSubscriptions, disposeSubscriptions } from './subscriptionsCapability';
import type { ExtensionManifest } from 'folyn-extension-sdk';
const manifest: ExtensionManifest = { id: 'test-subscriptions', name: 'Test', version: '0.1.0', tier: 'trusted', main: 'index.js', permissions: { subscriptions: { vault: true, network: true } } };
function changeVault() { mocks.state.currentVault = { id: 'b', name: 'B', basePath: '/vault-b', providerType: 'tauri' }; mocks.state.activeVaultId = 'b'; for (const cb of mocks.listeners) cb(); }
beforeEach(() => {
  mocks.state.currentVault = { id: 'a', name: 'A', basePath: '/vault-a', providerType: 'tauri' }; mocks.state.activeVaultId = 'a'; mocks.state.isLoading = false;
  mocks.invoke.mockReset(); mocks.invoke.mockResolvedValue('content'); mocks.open.mockReset(); mocks.choose.mockReset();
  mocks.editedNote.mockReset(); mocks.editedNote.mockReturnValue(undefined); mocks.appendNote.mockReset();
});
describe('subscription vault snapshots', () => {
  it('exposes the capability only to trusted extensions with both explicit grants', () => {
    expect(buildSubscriptions({ ...manifest, permissions: {} })).toBeUndefined();
    expect(buildSubscriptions({ ...manifest, tier: 'sandbox' })).toBeUndefined();
  });
  it('keeps an in-flight save pinned to the old root after a vault switch', async () => {
    const api = buildSubscriptions(manifest)!;
    const old = api.current()!;
    const pending = old.createText('Articles/story.md', 'saved');
    changeVault();
    await pending;
    expect(mocks.invoke).toHaveBeenCalledWith('subscription_vault_io', expect.objectContaining({ root: '/vault-a', operation: 'createText', path: 'Articles/story.md' }));
    expect(api.current()?.id).toBe('b');
    await expect(old.open('Articles/story.md')).rejects.toThrow('vault has changed');
    expect(mocks.open).not.toHaveBeenCalled();
    disposeSubscriptions(api);
  });
  it('keeps private app data pinned to a Vault ID and never passes a Vault path', async () => {
    const api = buildSubscriptions(manifest)!;
    const old = api.current()!;
    const pending = old.data.writeText('subscriptions/state.json', '{}');
    changeVault();
    await pending;
    expect(mocks.invoke).toHaveBeenCalledWith('subscription_data_io', {
      extensionId: manifest.id, vaultId: 'a', path: 'subscriptions/state.json', operation: 'writeText', content: '{}',
    });
    expect(api.current()?.data).not.toBe(old.data);
    await expect(old.data.readText('../escape')).rejects.toThrow('relative');
    disposeSubscriptions(api);
  });
  it('stops scheduling as soon as a vault transition starts and cleans up listeners', () => {
    const api = buildSubscriptions(manifest)!; const cb = vi.fn(); api.onChange(cb);
    mocks.state.isLoading = true; for (const cb of mocks.listeners) cb();
    expect(api.current()).toBeNull(); expect(cb).toHaveBeenCalledWith(null);
    disposeSubscriptions(api); expect(mocks.listeners.size).toBe(0);
  });
  it('exposes rendered acquisition only with an explicit grant and cancels pending work on disposal', async () => {
    const denied = buildSubscriptions(manifest)!;
    expect(denied.render).toBeUndefined(); disposeSubscriptions(denied);
    const granted = buildSubscriptions({ ...manifest, permissions: { subscriptions: { vault: true, network: true, render: true } } })!;
    let finish: (value: unknown) => void = () => {};
    mocks.invoke.mockImplementation((command: string) => command === 'subscription_render' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve());
    const pending = granted.render!('https://example.com/blog');
    expect(mocks.invoke).toHaveBeenCalledWith('subscription_render', expect.objectContaining({ extensionId: manifest.id, url: 'https://example.com/blog', requestId: expect.any(String) }));
    disposeSubscriptions(granted);
    expect(mocks.invoke).toHaveBeenCalledWith('subscription_cancel_renders', expect.objectContaining({ extensionId: manifest.id, requestIds: [expect.any(String)] }));
    finish({ status: 200, headers: {}, body: '<html>rendered</html>', url: 'https://example.com/blog' });
    await expect(pending).rejects.toThrow('inactive');
  });
  it('tracks image requests for native fallback cancellation and rejects late results after disposal', async () => {
    const granted = buildSubscriptions({ ...manifest, permissions: { subscriptions: { vault: true, network: true, render: true } } })!;
    let finish: (value: unknown) => void = () => {};
    mocks.invoke.mockImplementation((command: string) => command === 'subscription_fetch' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve());
    const pending = granted.fetch('https://example.com/image.png', true);
    expect(mocks.invoke).toHaveBeenCalledWith('subscription_fetch', expect.objectContaining({ binary: true, requestId: expect.any(String) }));
    disposeSubscriptions(granted);
    expect(mocks.invoke).toHaveBeenCalledWith('subscription_cancel_renders', expect.objectContaining({ requestIds: [expect.any(String)] }));
    finish({ status: 200, headers: { 'content-type': 'image/png' }, body: 'aW1hZ2U=', url: 'https://example.com/image.png' });
    await expect(pending).rejects.toThrow('inactive');
  });
  it('does not enable browser fallback IDs without the separate render grant', async () => {
    const api = buildSubscriptions(manifest)!;
    await api.fetch('https://example.com/image.png', true);
    expect(mocks.invoke).toHaveBeenCalledWith('subscription_fetch', expect.objectContaining({ requestId: null }));
    disposeSubscriptions(api);
  });
  it('returns the root directory marker and rejects directories outside the vault', async () => {
    const api = buildSubscriptions(manifest)!;
    mocks.choose.mockResolvedValue('/vault-a');
    expect(await api.current()!.chooseDirectory()).toBe('.');
    mocks.choose.mockResolvedValue('/vault-a/Articles');
    expect(await api.current()!.chooseDirectory()).toBe('Articles');
    mocks.choose.mockResolvedValue('/vault-ab/Articles');
    await expect(api.current()!.chooseDirectory()).rejects.toThrow('inside');
    disposeSubscriptions(api);
  });
  it('does not claim durable support for unimplemented remote providers', () => {
    mocks.state.currentVault.providerType = 's3';
    const api = buildSubscriptions(manifest)!;
    expect(api.current()).toBeNull();
    disposeSubscriptions(api);
  });
  it('rejects path escape and no longer fetches after disposal', async () => {
    const api = buildSubscriptions(manifest)!;
    await expect(api.current()!.readText('../escape')).rejects.toThrow('relative');
    expect(mocks.invoke).not.toHaveBeenCalled();
    disposeSubscriptions(api);
    await expect(api.fetch('https://example.com')).rejects.toThrow('inactive');
  });
});

describe('subscription learning-note boundaries', () => {
  it('reads unsaved Markdown snapshots after native grant/path validation', async () => {
    const api = buildSubscriptions(manifest)!;
    mocks.editedNote.mockReturnValue('');
    expect(await api.current()!.readNote('Notes/Topic.md')).toEqual({ path: 'Notes/Topic.md', title: 'Topic', text: '' });
    expect(mocks.invoke).toHaveBeenCalledWith('subscription_vault_io', expect.objectContaining({ operation: 'readText', root: '/vault-a', path: 'Notes/Topic.md' }));
    mocks.editedNote.mockReturnValue(undefined);
    expect((await api.current()!.readNote('Notes/Topic.md')).text).toBe('content');
    disposeSubscriptions(api);
  });
  it('returns cancellation without reading and limits multi-select to unique current-vault Markdown files', async () => {
    const api = buildSubscriptions(manifest)!;
    mocks.choose.mockResolvedValue(null);
    expect(await api.current()!.chooseNotes()).toEqual([]);
    expect(mocks.invoke).not.toHaveBeenCalled();
    mocks.choose.mockResolvedValue(['/vault-a/Notes/First.md', '/vault-a/Second.md', '/vault-a/Second.md']);
    expect((await api.current()!.chooseNotes()).map(note => note.path)).toEqual(['Notes/First.md', 'Second.md']);
    expect(mocks.choose).toHaveBeenCalledWith(expect.objectContaining({ directory: false, multiple: true, defaultPath: '/vault-a', filters: [{ name: 'Markdown', extensions: ['md'] }] }));
    disposeSubscriptions(api);
  });
  it('rejects other vaults, traversal, non-Markdown files and native symlink errors', async () => {
    const api = buildSubscriptions(manifest)!;
    for (const picked of ['/vault-ab/other.md', '/vault-a/../escape.md', '/vault-a/image.png']) {
      mocks.choose.mockResolvedValue([picked]);
      await expect(api.current()!.chooseNotes()).rejects.toThrow();
    }
    expect(mocks.invoke).not.toHaveBeenCalled();
    mocks.invoke.mockRejectedValue(new Error('symlinks are not allowed'));
    await expect(api.current()!.readNote('linked.md')).rejects.toThrow('symlinks');
    disposeSubscriptions(api);
  });
  it('discards picker results after a vault switch', async () => {
    const api = buildSubscriptions(manifest)!;
    let finish: (value: string[]) => void = () => {};
    mocks.choose.mockImplementation(() => new Promise<string[]>(resolve => { finish = resolve; }));
    const pending = api.current()!.chooseNotes();
    const rejection = expect(pending).rejects.toThrow('vault has changed');
    for (let i = 0; i < 6; i++) await Promise.resolve();
    changeVault(); finish(['/vault-a/Topic.md']);
    await rejection;
    expect(mocks.invoke).not.toHaveBeenCalled();
    disposeSubscriptions(api);
  });
  it('rejects snapshot reads that finish after a vault switch', async () => {
    const api = buildSubscriptions(manifest)!;
    let finish: (value: string) => void = () => {};
    mocks.invoke.mockImplementation(() => new Promise<string>(resolve => { finish = resolve; }));
    const pending = api.current()!.readNote('Topic.md');
    const rejection = expect(pending).rejects.toThrow('vault has changed');
    for (let i = 0; i < 6; i++) await Promise.resolve();
    changeVault(); finish('old vault text');
    await rejection;
    disposeSubscriptions(api);
  });
  it('delegates appends to the editor with the expected snapshot and a fresh pinned read', async () => {
    const api = buildSubscriptions(manifest)!;
    mocks.appendNote.mockImplementation(async (options: { path: string; expectedText: string; readText(): Promise<string>; assertCurrent(): void }) => {
      expect(options.path).toBe('Topic.md'); expect(options.expectedText).toBe('preview');
      expect(await options.readText()).toBe('content'); options.assertCurrent();
    });
    await api.current()!.appendNote('Topic.md', 'addition', 'preview');
    expect(mocks.appendNote).toHaveBeenCalledWith(expect.objectContaining({ vaultId: 'a', path: 'Topic.md', text: 'addition', expectedText: 'preview' }));
    const old = api.current()!;
    changeVault();
    await expect(old.appendNote('Topic.md', 'late addition', 'preview')).rejects.toThrow('vault has changed');
    expect(mocks.appendNote).toHaveBeenCalledTimes(1);
    disposeSubscriptions(api);
  });
});

describe('learning context lifetime', () => {
  it('does not reactivate an old snapshot after A to B to A', async () => {
    const api = buildSubscriptions(manifest)!;
    const old = api.current()!;
    changeVault();
    mocks.state.currentVault = { id: 'a', name: 'A', basePath: '/vault-a', providerType: 'tauri' };
    mocks.state.activeVaultId = 'a';
    for (const listener of mocks.listeners) listener();
    expect(api.current()).not.toBe(old);
    await expect(old.readNote('Topic.md')).rejects.toThrow('vault has changed');
    await expect(old.appendNote('Topic.md', 'late text', 'old text')).rejects.toThrow('vault has changed');
    expect(mocks.invoke).not.toHaveBeenCalled(); expect(mocks.appendNote).not.toHaveBeenCalled();
    disposeSubscriptions(api);
  });
  it('discards reads that finish after extension disposal', async () => {
    const api = buildSubscriptions(manifest)!;
    let finish: (value: string) => void = () => {};
    mocks.invoke.mockImplementation(() => new Promise<string>(resolve => { finish = resolve; }));
    const pending = api.current()!.readNote('Topic.md');
    const rejection = expect(pending).rejects.toThrow('vault has changed');
    for (let i = 0; i < 6; i++) await Promise.resolve();
    disposeSubscriptions(api); finish('late text');
    await rejection;
  });
});
