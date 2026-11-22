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
import { buildVaultSessions } from './vaultSessionCapability';
import type { ExtensionManifest } from 'folyn-extension-sdk';
const manifest: ExtensionManifest = { id: 'test-reader', name: 'Test', version: '0.1.0', tier: 'trusted', main: 'index.js', permissions: { vault: { write: true } } };
function changeVault() { mocks.state.currentVault = { id: 'b', name: 'B', basePath: '/vault-b', providerType: 'tauri' }; mocks.state.activeVaultId = 'b'; for (const cb of mocks.listeners) cb(); }
beforeEach(() => {
  mocks.state.currentVault = { id: 'a', name: 'A', basePath: '/vault-a', providerType: 'tauri' }; mocks.state.activeVaultId = 'a'; mocks.state.isLoading = false;
  mocks.invoke.mockReset(); mocks.invoke.mockResolvedValue('content'); mocks.open.mockReset(); mocks.choose.mockReset();
  mocks.editedNote.mockReset(); mocks.editedNote.mockReturnValue(undefined); mocks.appendNote.mockReset();
});
describe('vault sessions', () => {
  it('keeps an in-flight save pinned to the old root after a vault switch', async () => {
    const api = buildVaultSessions(manifest);
    const old = api.session()!;
    const pending = old.createText('Articles/story.md', 'saved');
    changeVault();
    await pending;
    expect(mocks.invoke).toHaveBeenCalledWith('extension_vault_io', expect.objectContaining({ root: '/vault-a', operation: 'createText', path: 'Articles/story.md' }));
    expect(api.session()?.id).toBe('b');
    await expect(old.open('Articles/story.md')).rejects.toThrow('vault has changed');
    expect(mocks.open).not.toHaveBeenCalled();
    api.dispose();
  });
  it('keeps private app data pinned to a Vault ID and never passes a Vault path', async () => {
    const api = buildVaultSessions(manifest);
    const old = api.session()!;
    const pending = old.data.writeText('reader/state.json', '{}');
    changeVault();
    await pending;
    expect(mocks.invoke).toHaveBeenCalledWith('extension_data_io', {
      extensionId: manifest.id, vaultId: 'a', path: 'reader/state.json', operation: 'writeText', content: '{}',
    });
    expect(api.session()?.data).not.toBe(old.data);
    await expect(old.data.readText('../escape')).rejects.toThrow('relative');
    api.dispose();
  });
  it('stops scheduling as soon as a vault transition starts and cleans up listeners', () => {
    const api = buildVaultSessions(manifest); const cb = vi.fn(); api.onSessionChange(cb);
    mocks.state.isLoading = true; for (const cb of mocks.listeners) cb();
    expect(api.session()).toBeNull(); expect(cb).toHaveBeenCalledWith(null);
    api.dispose(); expect(mocks.listeners.size).toBe(0);
  });
  it('returns the root directory marker and rejects directories outside the vault', async () => {
    const api = buildVaultSessions(manifest);
    mocks.choose.mockResolvedValue('/vault-a');
    expect(await api.session()!.chooseDirectory()).toBe('.');
    mocks.choose.mockResolvedValue('/vault-a/Articles');
    expect(await api.session()!.chooseDirectory()).toBe('Articles');
    mocks.choose.mockResolvedValue('/vault-ab/Articles');
    await expect(api.session()!.chooseDirectory()).rejects.toThrow('inside');
    api.dispose();
  });
  it('does not claim durable support for unimplemented remote providers', () => {
    mocks.state.currentVault.providerType = 's3';
    const api = buildVaultSessions(manifest);
    expect(api.session()).toBeNull();
    api.dispose();
  });
  it('rejects path escape before reaching the host, and IO after disposal', async () => {
    const api = buildVaultSessions(manifest);
    const session = api.session()!;
    await expect(session.readText('../escape')).rejects.toThrow('relative');
    expect(mocks.invoke).not.toHaveBeenCalled();
    api.dispose();
    await expect(session.readText('a.md')).rejects.toThrow('inactive');
  });
});

describe('vault session note boundaries', () => {
  it('reads unsaved Markdown snapshots after native grant/path validation', async () => {
    const api = buildVaultSessions(manifest);
    mocks.editedNote.mockReturnValue('');
    expect(await api.session()!.readNote('Notes/Topic.md')).toEqual({ path: 'Notes/Topic.md', title: 'Topic', text: '' });
    expect(mocks.invoke).toHaveBeenCalledWith('extension_vault_io', expect.objectContaining({ operation: 'readText', root: '/vault-a', path: 'Notes/Topic.md' }));
    mocks.editedNote.mockReturnValue(undefined);
    expect((await api.session()!.readNote('Notes/Topic.md')).text).toBe('content');
    api.dispose();
  });
  it('returns cancellation without reading and limits multi-select to unique current-vault Markdown files', async () => {
    const api = buildVaultSessions(manifest);
    mocks.choose.mockResolvedValue(null);
    expect(await api.session()!.chooseNotes()).toEqual([]);
    expect(mocks.invoke).not.toHaveBeenCalled();
    mocks.choose.mockResolvedValue(['/vault-a/Notes/First.md', '/vault-a/Second.md', '/vault-a/Second.md']);
    expect((await api.session()!.chooseNotes()).map(note => note.path)).toEqual(['Notes/First.md', 'Second.md']);
    expect(mocks.choose).toHaveBeenCalledWith(expect.objectContaining({ directory: false, multiple: true, defaultPath: '/vault-a', filters: [{ name: 'Markdown', extensions: ['md'] }] }));
    api.dispose();
  });
  it('rejects other vaults, traversal, non-Markdown files and native symlink errors', async () => {
    const api = buildVaultSessions(manifest);
    for (const picked of ['/vault-ab/other.md', '/vault-a/../escape.md', '/vault-a/image.png']) {
      mocks.choose.mockResolvedValue([picked]);
      await expect(api.session()!.chooseNotes()).rejects.toThrow();
    }
    expect(mocks.invoke).not.toHaveBeenCalled();
    mocks.invoke.mockRejectedValue(new Error('symlinks are not allowed'));
    await expect(api.session()!.readNote('linked.md')).rejects.toThrow('symlinks');
    api.dispose();
  });
  it('discards picker results after a vault switch', async () => {
    const api = buildVaultSessions(manifest);
    let finish: (value: string[]) => void = () => {};
    mocks.choose.mockImplementation(() => new Promise<string[]>(resolve => { finish = resolve; }));
    const pending = api.session()!.chooseNotes();
    const rejection = expect(pending).rejects.toThrow('vault has changed');
    for (let i = 0; i < 6; i++) await Promise.resolve();
    changeVault(); finish(['/vault-a/Topic.md']);
    await rejection;
    expect(mocks.invoke).not.toHaveBeenCalled();
    api.dispose();
  });
  it('rejects snapshot reads that finish after a vault switch', async () => {
    const api = buildVaultSessions(manifest);
    let finish: (value: string) => void = () => {};
    mocks.invoke.mockImplementation(() => new Promise<string>(resolve => { finish = resolve; }));
    const pending = api.session()!.readNote('Topic.md');
    const rejection = expect(pending).rejects.toThrow('vault has changed');
    for (let i = 0; i < 6; i++) await Promise.resolve();
    changeVault(); finish('old vault text');
    await rejection;
    api.dispose();
  });
  it('delegates appends to the editor with the expected snapshot and a fresh pinned read', async () => {
    const api = buildVaultSessions(manifest);
    mocks.appendNote.mockImplementation(async (options: { path: string; expectedText: string; readText(): Promise<string>; assertCurrent(): void }) => {
      expect(options.path).toBe('Topic.md'); expect(options.expectedText).toBe('preview');
      expect(await options.readText()).toBe('content'); options.assertCurrent();
    });
    await api.session()!.appendNote('Topic.md', 'addition', 'preview');
    expect(mocks.appendNote).toHaveBeenCalledWith(expect.objectContaining({ vaultId: 'a', path: 'Topic.md', text: 'addition', expectedText: 'preview' }));
    const old = api.session()!;
    changeVault();
    await expect(old.appendNote('Topic.md', 'late addition', 'preview')).rejects.toThrow('vault has changed');
    expect(mocks.appendNote).toHaveBeenCalledTimes(1);
    api.dispose();
  });
});

describe('learning context lifetime', () => {
  it('does not reactivate an old snapshot after A to B to A', async () => {
    const api = buildVaultSessions(manifest);
    const old = api.session()!;
    changeVault();
    mocks.state.currentVault = { id: 'a', name: 'A', basePath: '/vault-a', providerType: 'tauri' };
    mocks.state.activeVaultId = 'a';
    for (const listener of mocks.listeners) listener();
    expect(api.session()).not.toBe(old);
    await expect(old.readNote('Topic.md')).rejects.toThrow('vault has changed');
    await expect(old.appendNote('Topic.md', 'late text', 'old text')).rejects.toThrow('vault has changed');
    expect(mocks.invoke).not.toHaveBeenCalled(); expect(mocks.appendNote).not.toHaveBeenCalled();
    api.dispose();
  });
  it('discards reads that finish after extension disposal', async () => {
    const api = buildVaultSessions(manifest);
    let finish: (value: string) => void = () => {};
    mocks.invoke.mockImplementation(() => new Promise<string>(resolve => { finish = resolve; }));
    const pending = api.session()!.readNote('Topic.md');
    const rejection = expect(pending).rejects.toThrow('vault has changed');
    for (let i = 0; i < 6; i++) await Promise.resolve();
    api.dispose(); finish('late text');
    await rejection;
  });
});
