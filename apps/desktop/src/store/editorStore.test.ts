import { describe, it, expect, beforeEach, vi } from 'vitest';
import { detectFileType, detectActivity, useEditorStore } from './editorStore';
import { usePrefsStore } from './prefsStore';
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
  usePrefsStore.setState({ dailyNotesDir: '__daily__' });
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
  it('detects clip files by __clips__/ prefix', () => {
    expect(detectFileType('__clips__/tech/foo.md')).toBe('clip');
  });

  it('falls back to "code" for unknown extensions', () => {
    // '.xyz' is not registered; registry mock returns undefined.
    expect(detectFileType('weird.xyz')).toBe('code');
  });

  it('returns "code" for files with no extension', () => {
    expect(detectFileType('README')).toBe('code');
  });
});

describe('detectActivity', () => {
  it('routes wiki-graph to the wiki panel', () => {
    expect(detectActivity('wiki-graph', 'markdown')).toBe('wiki');
  });

  it('routes clip files to the clips panel', () => {
    expect(detectActivity('__clips__/tech/foo.md', 'clip')).toBe('clips');
    expect(detectActivity('__clips__/x.md', 'code')).toBe('clips');
  });

  it('routes wiki:// paths to the wiki panel', () => {
    expect(detectActivity('wiki://entities/react.md', 'markdown')).toBe('wiki');
  });

  it('routes __reports__/ to the analyze panel', () => {
    expect(detectActivity('__reports__/2026-01-01.md', 'markdown')).toBe('analyze');
  });

  it('routes daily notes to the calendar panel', () => {
    expect(detectActivity('__daily__/2026-01-01.md', 'markdown')).toBe('calendar');
  });

  it('uses the configured dailyNotesDir', () => {
    usePrefsStore.setState({ dailyNotesDir: 'journal' });
    expect(detectActivity('journal/2026-01-01.md', 'markdown')).toBe('calendar');
  });

  it('falls back to the files panel for plain markdown', () => {
    expect(detectActivity('notes/a.md', 'markdown')).toBe('files');
  });
});

describe('rewriteTabPrefixes', () => {
  it('rewrites tab paths whose prefix was renamed', () => {
    useEditorStore.setState({
      tabs: [
        { id: 't1', name: 'foo.md', path: 'clips/tech/foo.md', content: '', isDirty: false, fileType: 'clip', activity: 'clips' },
        { id: 't2', name: 'bar.md', path: 'reports/2026-01-01.md', content: '', isDirty: false, fileType: 'markdown', activity: 'analyze' },
        { id: 't3', name: 'note.md', path: 'notes/note.md', content: '', isDirty: false, fileType: 'markdown', activity: 'files' },
        { id: 't4', name: 'react.md', path: 'wiki://entities/react.md', content: '', isDirty: false, fileType: 'markdown', activity: 'wiki' },
      ],
      activeTabId: 't1',
    });

    useEditorStore.getState().rewriteTabPrefixes([
      { from: 'clips', to: '__clips__' },
      { from: 'reports', to: '__reports__' },
    ]);

    const tabs = useEditorStore.getState().tabs;
    expect(tabs[0].path).toBe('__clips__/tech/foo.md');
    expect(tabs[1].path).toBe('__reports__/2026-01-01.md');
    expect(tabs[2].path).toBe('notes/note.md');
    expect(tabs[3].path).toBe('wiki://entities/react.md');
  });

  it('handles exact-match paths (no trailing slash)', () => {
    useEditorStore.setState({
      tabs: [
        { id: 't1', name: 'clips', path: 'clips', content: '', isDirty: false, fileType: 'code', activity: 'files' },
      ],
      activeTabId: 't1',
    });

    useEditorStore.getState().rewriteTabPrefixes([{ from: 'clips', to: '__clips__' }]);
    expect(useEditorStore.getState().tabs[0].path).toBe('__clips__');
  });

  it('is a no-op when mapping is empty', () => {
    useEditorStore.setState({
      tabs: [
        { id: 't1', name: 'foo.md', path: 'clips/tech/foo.md', content: '', isDirty: false, fileType: 'clip', activity: 'clips' },
      ],
      activeTabId: 't1',
    });

    useEditorStore.getState().rewriteTabPrefixes([]);
    expect(useEditorStore.getState().tabs[0].path).toBe('clips/tech/foo.md');
  });
});

