import { describe, it, expect, beforeEach, vi } from 'vitest';
import { detectFileType, detectActivity, useEditorStore } from './editorStore';
import { useVaultStore } from './vaultStore';
import {
  flushPersistOpenTabs,
  flushPersistExternalOpenTabs,
} from './editorPersistence';

// Mock persistence writes so closeTab's flush behavior is observable without
// touching the Tauri storageClient (and the existing tests stay unaffected).
vi.mock('./editorPersistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./editorPersistence')>();
  return {
    ...actual,
    persistOpenTabs: vi.fn(),
    flushPersistOpenTabs: vi.fn(),
    flushPersistExternalOpenTabs: vi.fn(),
  };
});

beforeEach(() => {
  useEditorStore.setState({ tabs: [], activeTabId: null });
});

// ── closeTab persistence ──────────────────────────────────────────────────
// closeTab must flush immediately (no debounce) so a quit right after closing
// doesn't restore the closed tab from stale persisted data on next launch.
describe('closeTab persistence', () => {
  it('flushes the closed tab out of persisted open tabs immediately', () => {
    useVaultStore.setState({ activeVaultId: 'vault-1' } as never);
    useEditorStore.setState({
      tabs: [
        { id: 't1', name: 'a.md', path: 'a.md', content: '', isDirty: false, fileType: 'markdown', activity: 'files' },
        { id: 't2', name: 'b.md', path: 'b.md', content: '', isDirty: false, fileType: 'markdown', activity: 'files' },
      ],
      activeTabId: 't1',
    });
    vi.mocked(flushPersistOpenTabs).mockClear();
    vi.mocked(flushPersistExternalOpenTabs).mockClear();

    useEditorStore.getState().closeTab('t1');

    expect(flushPersistOpenTabs).toHaveBeenCalledTimes(1);
    const [vaultId, tabsArg, activeTabId] = vi.mocked(flushPersistOpenTabs).mock.calls[0];
    expect(vaultId).toBe('vault-1');
    expect(tabsArg.map((t) => t.id)).toEqual(['t2']);
    expect(activeTabId).toBe('t2');
    // External persistence is flushed too so closed external tabs don't
    // reappear on next launch.
    expect(flushPersistExternalOpenTabs).toHaveBeenCalled();
  });
});

describe('detectFileType', () => {
  it('falls back to "code" for unknown text-ish extensions', () => {
    // '.zzz' is not registered and not a known binary format → generic code editor.
    expect(detectFileType('weird.zzz')).toBe('code');
  });

  it('returns "unsupported" for known binary formats no provider claims', () => {
    // .docx has no builtin provider (the File Viewer extension would claim it);
    // a binary format must not fall through to the text editor.
    expect(detectFileType('report.docx')).toBe('unsupported');
    expect(detectFileType('archive.zip')).toBe('unsupported');
  });

  it('returns "code" for files with no extension', () => {
    expect(detectFileType('README')).toBe('code');
  });
});

describe('detectActivity', () => {
  it('falls back to the files panel for plain markdown', () => {
    expect(detectActivity('notes/a.md', 'markdown')).toBe('files');
  });
});

describe('rewriteTabPrefixes', () => {
  it('rewrites tab paths whose prefix was renamed', () => {
    useEditorStore.setState({
      tabs: [
        { id: 't1', name: 'foo.md', path: 'drafts/tech/foo.md', content: '', isDirty: false, fileType: 'markdown', activity: 'files' },
        { id: 't2', name: 'bar.md', path: 'reports/2026-01-01.md', content: '', isDirty: false, fileType: 'markdown', activity: 'files' },
        { id: 't3', name: 'note.md', path: 'notes/note.md', content: '', isDirty: false, fileType: 'markdown', activity: 'files' },
      ],
      activeTabId: 't1',
    });

    useEditorStore.getState().rewriteTabPrefixes([
      { from: 'drafts', to: '__drafts__' },
      { from: 'reports', to: '__reports__' },
    ]);

    const tabs = useEditorStore.getState().tabs;
    expect(tabs[0].path).toBe('__drafts__/tech/foo.md');
    expect(tabs[0].name).toBe('foo.md');
    expect(tabs[1].path).toBe('__reports__/2026-01-01.md');
    expect(tabs[1].name).toBe('2026-01-01.md');
    expect(tabs[2].path).toBe('notes/note.md');
  });

  it('handles exact-match paths (no trailing slash)', () => {
    useEditorStore.setState({
      tabs: [
        { id: 't1', name: 'drafts', path: 'drafts', content: '', isDirty: false, fileType: 'code', activity: 'files' },
      ],
      activeTabId: 't1',
    });

    useEditorStore.getState().rewriteTabPrefixes([{ from: 'drafts', to: '__drafts__' }]);
    expect(useEditorStore.getState().tabs[0].path).toBe('__drafts__');
  });

  it('updates the tab name when a file is renamed', () => {
    useEditorStore.setState({
      tabs: [
        { id: 't1', name: 'a.md', path: 'notes/a.md', content: '', isDirty: false, fileType: 'markdown', activity: 'files' },
      ],
      activeTabId: 't1',
    });

    useEditorStore.getState().rewriteTabPrefixes([{ from: 'notes/a.md', to: 'notes/c.md' }]);
    const tab = useEditorStore.getState().tabs[0];
    expect(tab.path).toBe('notes/c.md');
    expect(tab.name).toBe('c.md');
  });

  it('is a no-op when mapping is empty', () => {
    useEditorStore.setState({
      tabs: [
        { id: 't1', name: 'foo.md', path: 'drafts/tech/foo.md', content: '', isDirty: false, fileType: 'markdown', activity: 'files' },
      ],
      activeTabId: 't1',
    });

    useEditorStore.getState().rewriteTabPrefixes([]);
    expect(useEditorStore.getState().tabs[0].path).toBe('drafts/tech/foo.md');
  });
});

