import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { usePrefsStore, DEFAULT_SHORTCUTS } from './prefsStore';
import { storageClient } from '@/utils/storageClient';

beforeEach(() => {
  storageClient.__resetForTesting();
  vi.useFakeTimers();
  usePrefsStore.setState({
    dailyNotesDir: '__daily__',
    dailyNoteDateFormat: 'YYYY-MM-DD',
    fileTemplates: {
      md: '# {{title}}\n\n',
      html: '<!DOCTYPE html>\n<html lang="zh">\n<head>\n  <meta charset="UTF-8">\n  <title>{{title}}</title>\n</head>\n<body>\n  \n</body>\n</html>',
      excalidraw: '{"type":"excalidraw","version":2,"elements":[],"appState":{"viewBackgroundColor":"#ffffff"}}',
    },
    shortcuts: [...DEFAULT_SHORTCUTS],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usePrefsStore setters', () => {
  it('updateShortcut updates keys for the given id', () => {
    usePrefsStore.getState().updateShortcut('bold', ['Ctrl', 'b']);
    const s = usePrefsStore.getState().shortcuts.find((x) => x.id === 'bold')!;
    expect(s.keys).toEqual(['Ctrl', 'b']);
  });

  it('updateShortcut is a no-op for unknown ids', () => {
    const before = usePrefsStore.getState().shortcuts.length;
    usePrefsStore.getState().updateShortcut('does-not-exist', ['X']);
    expect(usePrefsStore.getState().shortcuts.length).toBe(before);
  });

  it('resetShortcuts restores DEFAULT_SHORTCUTS', () => {
    usePrefsStore.getState().updateShortcut('bold', ['X']);
    usePrefsStore.getState().resetShortcuts();
    const s = usePrefsStore.getState().shortcuts.find((x) => x.id === 'bold')!;
    const original = DEFAULT_SHORTCUTS.find((x) => x.id === 'bold')!;
    expect(s.keys).toEqual(original.keys);
  });

  it('updateShortcut persists', () => {
    const setSpy = vi.spyOn(storageClient, 'set');
    usePrefsStore.getState().updateShortcut('bold', ['X']);
    vi.advanceTimersByTime(400);
    expect(setSpy).toHaveBeenCalled();
    setSpy.mockRestore();
  });

  it('setDailyNotesDir updates', () => {
    usePrefsStore.getState().setDailyNotesDir('notes/daily');
    expect(usePrefsStore.getState().dailyNotesDir).toBe('notes/daily');
  });
});

describe('usePrefsStore.hydrate', () => {
  it('applies scalar fields', () => {
    usePrefsStore.getState().hydrate({
      dailyNotesDir: '__daily__',
      dailyNoteDateFormat: 'DD/MM/YYYY',
    });
    expect(usePrefsStore.getState().dailyNoteDateFormat).toBe('DD/MM/YYYY');
  });

  it('migrates legacy dailyNotesDir "daily" → "__daily__"', () => {
    usePrefsStore.getState().hydrate({ dailyNotesDir: 'daily' });
    expect(usePrefsStore.getState().dailyNotesDir).toBe('__daily__');
  });

  it('backfills missing default shortcuts', () => {
    const persisted = DEFAULT_SHORTCUTS
      .filter((s) => s.id !== 'togglePetPanel')
      .map((s) => ({ ...s }));
    usePrefsStore.getState().hydrate({ shortcuts: persisted });
    const ids = usePrefsStore.getState().shortcuts.map((s) => s.id);
    expect(ids).toContain('togglePetPanel');
    expect(ids.length).toBe(DEFAULT_SHORTCUTS.length);
  });

  it('preserves user-customized keys on existing entries during backfill', () => {
    const persisted = DEFAULT_SHORTCUTS.map((s) => ({ ...s }));
    const boldIdx = persisted.findIndex((s) => s.id === 'bold');
    persisted[boldIdx].keys = ['⌘', 'X'];
    usePrefsStore.getState().hydrate({ shortcuts: persisted });
    const bold = usePrefsStore.getState().shortcuts.find((s) => s.id === 'bold')!;
    expect(bold.keys).toEqual(['⌘', 'X']);
  });

  it('missing fields keep defaults', () => {
    usePrefsStore.getState().hydrate({ dailyNotesDir: '__daily__' });
    expect(usePrefsStore.getState().dailyNoteDateFormat).toBe('YYYY-MM-DD');
  });
});
