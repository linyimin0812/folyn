import { describe, it, expect, beforeEach } from 'vitest';
import { detectFileType, detectActivity, useEditorStore } from './editorStore';
import { useSettingsStore } from './settingsStore';

beforeEach(() => {
  useEditorStore.setState({ tabs: [], activeTabId: null });
  useSettingsStore.setState({ dailyNotesDir: 'daily' });
});

describe('detectFileType', () => {
  it('detects clip files by clips/ prefix', () => {
    expect(detectFileType('clips/tech/foo.md')).toBe('clip');
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
    expect(detectActivity('clips/tech/foo.md', 'clip')).toBe('clips');
    expect(detectActivity('clips/x.md', 'code')).toBe('clips');
  });

  it('routes wiki:// paths to the wiki panel', () => {
    expect(detectActivity('wiki://entities/react.md', 'markdown')).toBe('wiki');
  });

  it('routes reports/ to the analyze panel', () => {
    expect(detectActivity('reports/2026-01-01.md', 'markdown')).toBe('analyze');
  });

  it('routes daily notes to the calendar panel', () => {
    expect(detectActivity('daily/2026-01-01.md', 'markdown')).toBe('calendar');
  });

  it('uses the configured dailyNotesDir', () => {
    useSettingsStore.setState({ dailyNotesDir: 'journal' });
    expect(detectActivity('journal/2026-01-01.md', 'markdown')).toBe('calendar');
  });

  it('falls back to the files panel for plain markdown', () => {
    expect(detectActivity('notes/a.md', 'markdown')).toBe('files');
  });
});
