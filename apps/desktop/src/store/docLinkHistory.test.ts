import { describe, it, expect, beforeEach, vi } from 'vitest';

const openFile = vi.fn();
vi.mock('@/services/editorIoService', () => ({ openFile: (...args: unknown[]) => openFile(...args) }));

const editor = { tabs: [] as { id: string; path: string; name: string; fileType: string }[], activeTabId: null as string | null };
vi.mock('@/store/editorStore', () => ({ useEditorStore: { getState: () => editor } }));
vi.mock('@/store/vaultStore', () => ({ useVaultStore: { getState: () => ({ activeVaultId: 'v1' }) } }));

const { useDocLinkHistory } = await import('./docLinkHistory');

function activate(path: string, fileType = 'markdown') {
  editor.tabs = [{ id: path, path, name: path, fileType }];
  editor.activeTabId = path;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('useDocLinkHistory', () => {
  beforeEach(() => {
    useDocLinkHistory.setState({ back: [], forward: [], vaultId: 'v1' });
    openFile.mockClear();
  });

  it('records the source document and goes back to it', async () => {
    activate('a.md');
    useDocLinkHistory.getState().follow({ path: 'b.md', name: 'b.md' });
    expect(useDocLinkHistory.getState().back).toEqual([{ path: 'a.md', name: 'a.md' }]);

    activate('b.md');
    useDocLinkHistory.getState().goBack();
    await flush();
    expect(openFile).toHaveBeenLastCalledWith('a.md', 'a.md');
    expect(useDocLinkHistory.getState().back).toEqual([]);
    expect(useDocLinkHistory.getState().forward).toEqual([{ path: 'b.md', name: 'b.md' }]);

    activate('a.md');
    useDocLinkHistory.getState().goForward();
    await flush();
    expect(openFile).toHaveBeenLastCalledWith('b.md', 'b.md');
    expect(useDocLinkHistory.getState().back).toEqual([{ path: 'a.md', name: 'a.md' }]);
  });

  it('a new jump clears the forward trail', () => {
    useDocLinkHistory.setState({ forward: [{ path: 'x.md', name: 'x.md' }] });
    activate('a.md');
    useDocLinkHistory.getState().follow({ path: 'b.md', name: 'b.md' });
    expect(useDocLinkHistory.getState().forward).toEqual([]);
  });

  it('a trail from another vault is dropped', () => {
    useDocLinkHistory.setState({ back: [{ path: 'x.md', name: 'x.md' }], vaultId: 'v0' });
    useDocLinkHistory.getState().goBack();
    expect(openFile).not.toHaveBeenCalled();
    expect(useDocLinkHistory.getState().back).toEqual([]);
  });

  it('does not record self-links or web tabs', () => {
    activate('a.md');
    useDocLinkHistory.getState().follow({ path: 'a.md', name: 'a.md' });
    activate('https://x', 'web');
    useDocLinkHistory.getState().follow({ path: 'b.md', name: 'b.md' });
    expect(useDocLinkHistory.getState().back).toEqual([]);
  });
});
