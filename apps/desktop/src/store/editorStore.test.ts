import { describe, it, expect, beforeEach } from 'vitest';
import { detectFileType, detectActivity, useEditorStore } from './editorStore';
import { useSettingsStore } from './settingsStore';

beforeEach(() => {
  useEditorStore.setState({ tabs: [], activeTabId: null });
  useSettingsStore.setState({ dailyNotesDir: '__daily__' });
});describe('detectFileType', () => {
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
    useSettingsStore.setState({ dailyNotesDir: 'journal' });
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
