import { describe, it, expect, beforeEach, vi } from 'vitest';

const openFile = vi.fn();
vi.mock('@/services/editorIoService', () => ({ openFile: (...args: unknown[]) => openFile(...args) }));

const editor = {
  tabs: [] as Array<{
    id: string; path: string; name: string; fileType: string;
    previewScrollTop?: number;
    previewComponents?: { openCollapsibles: number[]; tabsSelections: Array<{ line: number; active: number }> };
  }>,
  activeTabId: null as string | null,
};
vi.mock('@/store/editorStore', () => ({ useEditorStore: { getState: () => editor } }));
vi.mock('@/store/vaultStore', () => ({ useVaultStore: { getState: () => ({ activeVaultId: 'v1' }) } }));

const requestPreviewNav = vi.fn();
vi.mock('@/store/editorViewState', () => ({
  useEditorViewStateStore: { getState: () => ({ requestPreviewNav }) },
}));

const { useDocLinkHistory } = await import('./docLinkHistory');

function activate(path: string, fileType = 'markdown') {
  // openFile() reuses the deterministic tab for a path (id `vaultId:path` —
  // mirrored here) — mimic that by switching activeTabId to the target tab
  // (created if missing).
  const id = `v1:${path}`;
  if (!editor.tabs.some((t) => t.id === id)) {
    editor.tabs.push({ id, path, name: path, fileType });
  }
  editor.activeTabId = id;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('useDocLinkHistory', () => {
  beforeEach(() => {
    useDocLinkHistory.setState({ trails: {}, vaultId: 'v1' });
    editor.tabs = [];
    editor.activeTabId = null;
    openFile.mockClear();
    requestPreviewNav.mockClear();
  });

  it('follow snapshots the leaving reading position and moves the chain to the target tab', () => {
    activate('a.md');
    useDocLinkHistory.getState().follow({ path: 'b.md', name: 'b.md' }, 1200);
    expect(openFile).toHaveBeenCalledWith('b.md', 'b.md');
    // The chain lives on the target tab now: back from b returns to a@1200.
    expect(useDocLinkHistory.getState().trails['v1:b.md']).toEqual({ back: [{ path: 'a.md', name: 'a.md', scrollTop: 1200 }], forward: [] });
    // The session left tab a — its parked chain is gone.
    expect(useDocLinkHistory.getState().trails['v1:a.md']).toBeUndefined();
  });

  it('keeps chains isolated per reading session — one tab jumping does not touch another session chain', () => {
    activate('a.md');
    useDocLinkHistory.getState().follow({ path: 'b.md', name: 'b.md' }, 10);
    // openFile() landed the reader on b — mimic the activation.
    activate('b.md');
    // Reader switches editor tabs via the TAB BAR to c (a fresh session there).
    activate('c.md');
    useDocLinkHistory.getState().follow({ path: 'd.md', name: 'd.md' }, 20);
    expect(useDocLinkHistory.getState().trails['v1:b.md'].back).toEqual([{ path: 'a.md', name: 'a.md', scrollTop: 10 }]);
    expect(useDocLinkHistory.getState().trails['v1:d.md'].back).toEqual([{ path: 'c.md', name: 'c.md', scrollTop: 20 }]);
    expect(useDocLinkHistory.getState().trails['v1:a.md']).toBeUndefined();
  });

  it('carries the whole chain across a multi-hop session', () => {
    activate('a.md');
    useDocLinkHistory.getState().follow({ path: 'b.md', name: 'b.md' }, 10);
    activate('b.md');
    useDocLinkHistory.getState().follow({ path: 'c.md', name: 'c.md' }, 20);
    // Chain moved b→c carrying a→b.
    expect(useDocLinkHistory.getState().trails['v1:c.md'].back).toEqual([
      { path: 'a.md', name: 'a.md', scrollTop: 10 },
      { path: 'b.md', name: 'b.md', scrollTop: 20 },
    ]);
    expect(useDocLinkHistory.getState().trails['v1:b.md']).toBeUndefined();
  });

  it('goBack on the same document restores the reading position without reopening', async () => {
    activate('a.md');
    // Outline jump: same-doc navigation records a position.
    useDocLinkHistory.getState().pushPosition(500);
    openFile.mockClear();
    useDocLinkHistory.getState().goBack();
    await flush();
    expect(openFile).not.toHaveBeenCalled();
    expect(requestPreviewNav).toHaveBeenCalledWith('a.md', { scrollTop: 500, anchorId: undefined });
    // The forward trail holds the pushed position.
    expect(useDocLinkHistory.getState().trails['v1:a.md']).toEqual({ back: [], forward: [{ path: 'a.md', name: 'a.md', scrollTop: undefined }] });
  });

  it('goBack across documents reopens the source with its scrollTop snapshot and moves the chain back', async () => {
    activate('a.md');
    useDocLinkHistory.getState().follow({ path: 'b.md', name: 'b.md' }, 800);
    activate('b.md');
    useDocLinkHistory.getState().goBack();
    await flush();
    expect(openFile).toHaveBeenLastCalledWith('a.md', 'a.md');
    expect(requestPreviewNav).toHaveBeenCalledWith('a.md', { scrollTop: 800, anchorId: undefined });
    // The chain is anchored on tab a again, carrying b's position forward.
    expect(useDocLinkHistory.getState().trails['v1:a.md']).toEqual({ back: [], forward: [{ path: 'b.md', name: 'b.md', scrollTop: undefined }] });
    expect(useDocLinkHistory.getState().trails['v1:b.md']).toBeUndefined();
  });

  it('goForward returns to the document and lands the chain on its tab', async () => {
    activate('a.md');
    useDocLinkHistory.getState().follow({ path: 'b.md', name: 'b.md' }, 1);
    activate('b.md');
    useDocLinkHistory.getState().goBack();
    activate('a.md');
    // Back restored a's reading position (scrollTop 1) — the scroll
    // persistence path writes that onto tab a; simulate it.
    editor.tabs.find((t) => t.id === 'v1:a.md')!.previewScrollTop = 1;
    useDocLinkHistory.getState().goForward();
    await flush();
    expect(openFile).toHaveBeenLastCalledWith('b.md', 'b.md');
    // Chain back on b, with a@1 re-appended so Back works again from b.
    expect(useDocLinkHistory.getState().trails['v1:b.md']).toEqual({ back: [{ path: 'a.md', name: 'a.md', scrollTop: 1 }], forward: [] });
    expect(useDocLinkHistory.getState().trails['v1:a.md']).toBeUndefined();
  });

  it('captures scrollTop from the tab object when not passed live', async () => {
    activate('a.md');
    useDocLinkHistory.getState().follow({ path: 'b.md', name: 'b.md' }, 42);
    activate('b.md');
    // Reader scrolled after the jump (persisted on the tab) before hitting Back.
    editor.tabs.find((t) => t.id === 'v1:b.md')!.previewScrollTop = 999;
    useDocLinkHistory.getState().goBack();
    await flush();
    expect(useDocLinkHistory.getState().trails['v1:a.md'].forward).toEqual([{ path: 'b.md', name: 'b.md', scrollTop: 999 }]);
  });

  it('a new jump clears the forward trail', () => {
    useDocLinkHistory.setState({ trails: { 'a.md': { back: [], forward: [{ path: 'x.md', name: 'x.md' }] } } });
    activate('a.md');
    useDocLinkHistory.getState().follow({ path: 'b.md', name: 'b.md' });
    expect(useDocLinkHistory.getState().trails['v1:b.md'].forward).toEqual([]);
  });

  it('a trail from another vault is dropped', () => {
    useDocLinkHistory.setState({ trails: { 'a.md': { back: [{ path: 'x.md', name: 'x.md' }], forward: [] } }, vaultId: 'v0' });
    activate('a.md');
    useDocLinkHistory.getState().goBack();
    expect(openFile).not.toHaveBeenCalled();
    expect(useDocLinkHistory.getState().trails['v1:a.md']).toBeUndefined();
  });

  it('prunes chains of closed tabs lazily', () => {
    activate('a.md');
    useDocLinkHistory.getState().pushPosition(0);
    expect(useDocLinkHistory.getState().trails['v1:a.md'].back).toHaveLength(1);
    // Tab closed; activating another tab.
    editor.tabs = editor.tabs.filter((t) => t.id !== 'v1:a.md');
    activate('z.md');
    useDocLinkHistory.getState().pushPosition(0);
    expect(useDocLinkHistory.getState().trails['v1:a.md']).toBeUndefined();
    expect(Object.keys(useDocLinkHistory.getState().trails)).toEqual(['v1:z.md']);
  });

  it('does not record self-links or web tabs', () => {
    activate('a.md');
    useDocLinkHistory.getState().follow({ path: 'a.md', name: 'a.md' });
    activate('https://x', 'web');
    useDocLinkHistory.getState().follow({ path: 'b.md', name: 'b.md' });
    expect(useDocLinkHistory.getState().trails['v1:a.md']).toBeUndefined();
  });

  it('a self-link with a fragment is an in-document jump: pushes the leaving position', () => {
    activate('a.md');
    // Park a prior entry on the same doc chain.
    useDocLinkHistory.getState().pushPosition(100);
    // Reader clicks [intro](./a.md#intro) from scrollTop 40.
    useDocLinkHistory.getState().follow({ path: 'a.md', name: 'a.md', anchorId: 'intro' }, 40);
    expect(useDocLinkHistory.getState().trails['v1:a.md'].back).toEqual([
      { path: 'a.md', name: 'a.md', scrollTop: 100 },
      { path: 'a.md', name: 'a.md', scrollTop: 40 },
    ]);
    // No reopen — the restore targets the same doc by anchor.
    expect(openFile).not.toHaveBeenCalled();
    expect(requestPreviewNav).toHaveBeenCalledWith('a.md', { scrollTop: undefined, anchorId: 'intro' });
  });

  it('follow carries the click-site component snapshot; back replays it via requestRestore', () => {
    activate('a.md');
    const snap = { openCollapsibles: [31], tabsSelections: [{ line: 11, active: 2 }] };
    useDocLinkHistory.getState().follow({ path: 'b.md', name: 'b.md' }, 1200, snap);
    expect(useDocLinkHistory.getState().trails['v1:b.md'].back[0].components).toEqual(snap);
    // Reader reads on b (tabs flipped there), then hits Back.
    activate('b.md');
    editor.tabs.find((t) => t.id === 'v1:b.md')!.previewComponents = { openCollapsibles: [], tabsSelections: [] };
    useDocLinkHistory.getState().goBack();
    expect(requestPreviewNav).toHaveBeenCalledWith('a.md', {
      scrollTop: 1200,
      anchorId: undefined,
      components: snap,
    });
  });

  it('goBack snapshots the leaving scene from the tab\'s persisted previewComponents', () => {
    activate('a.md');
    useDocLinkHistory.getState().follow({ path: 'b.md', name: 'b.md' }, 10);
    activate('b.md');
    const sceneOnB = { openCollapsibles: [55], tabsSelections: [] };
    editor.tabs.find((t) => t.id === 'v1:b.md')!.previewComponents = sceneOnB;
    editor.tabs.find((t) => t.id === 'v1:b.md')!.previewScrollTop = 480;
    useDocLinkHistory.getState().goBack();
    // The forward entry (b) carries b's scene, so Forward lands back in it.
    expect(useDocLinkHistory.getState().trails['v1:a.md'].forward).toEqual([
      { path: 'b.md', name: 'b.md', scrollTop: 480, components: sceneOnB },
    ]);
  });

  it('forwarding a link with an anchor requests an anchor restore', () => {
    activate('a.md');
    useDocLinkHistory.getState().follow({ path: 'b.md', name: 'b.md', anchorId: 'section' }, 7);
    expect(requestPreviewNav).toHaveBeenCalledWith('b.md', { scrollTop: undefined, anchorId: 'section' });
    expect(useDocLinkHistory.getState().trails['v1:b.md'].back).toEqual([{ path: 'a.md', name: 'a.md', scrollTop: 7 }]);
  });
});
