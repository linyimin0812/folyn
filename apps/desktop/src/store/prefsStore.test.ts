import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { usePrefsStore, DEFAULT_SHORTCUTS, DEFAULT_FILE_TEMPLATES, buildDefaultShortcuts, backfillDefaultShortcuts, backfillDefaultFileTemplates } from './prefsStore';
import { storageClient } from '@/utils/storageClient';
import { markSettingsHydrated } from './settingsPersistence';

beforeEach(() => {
  storageClient.__resetForTesting();
  markSettingsHydrated();
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

  it('backfills missing default file templates', () => {
    usePrefsStore.getState().hydrate({ fileTemplates: { md: '# mine' } });
    const t = usePrefsStore.getState().fileTemplates;
    expect(t.md).toBe('# mine');
    expect(t.puml).toContain('@startuml');
    expect(t.gv).toContain('digraph');
    expect(t.dbml).toContain('Table users');
  });

  it('missing fields keep defaults', () => {
    usePrefsStore.getState().hydrate({ dailyNotesDir: '__daily__' });
    expect(usePrefsStore.getState().dailyNoteDateFormat).toBe('YYYY-MM-DD');
  });
});

describe('DEFAULT_SHORTCUTS', () => {
  it('includes the global togglePetPanel shortcut bound to the platform primary modifier', () => {
    // The global-shortcut entry must round-trip through the same persistence
    // path as the in-editor bindings. Its default keys use the platform's
    // primary modifier (⌘ on macOS, Ctrl on Windows/Linux) so the OS-global
    // accelerator stays valid on both — Windows has no Cmd key. Bumping or
    // renaming this id without updating PetApp's mount-time registration +
    // SettingsPage's rebind hook would silently break the global shortcut.
    const entry = DEFAULT_SHORTCUTS.find((x) => x.id === 'togglePetPanel');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('唤起桌宠面板');
    // Everything after the primary modifier is platform-independent; the
    // modifier itself is one of the two supported symbols.
    expect(entry!.keys.slice(1)).toEqual(['Shift', 'Q']);
    expect(['⌘', 'Ctrl']).toContain(entry!.keys[0]);
  });
});

describe('buildDefaultShortcuts', () => {
  it('uses ⌘ as the primary modifier on macOS', () => {
    const s = buildDefaultShortcuts('⌘');
    expect(s.find((x) => x.id === 'save')!.keys).toEqual(['⌘', 'S']);
    expect(s.find((x) => x.id === 'togglePetPanel')!.keys).toEqual(['⌘', 'Shift', 'Q']);
  });

  it('uses Ctrl as the primary modifier on Windows/Linux', () => {
    const s = buildDefaultShortcuts('Ctrl');
    expect(s.find((x) => x.id === 'save')!.keys).toEqual(['Ctrl', 'S']);
    expect(s.find((x) => x.id === 'togglePetPanel')!.keys).toEqual(['Ctrl', 'Shift', 'Q']);
  });

  it('preserves Shift and the non-modifier key across platforms', () => {
    expect(buildDefaultShortcuts('⌘').find((x) => x.id === 'strikethrough')!.keys).toEqual(['⌘', 'Shift', 'S']);
    expect(buildDefaultShortcuts('Ctrl').find((x) => x.id === 'strikethrough')!.keys).toEqual(['Ctrl', 'Shift', 'S']);
  });
});

describe('backfillDefaultShortcuts', () => {
  it('returns DEFAULT_SHORTCUTS copy when persisted is empty or non-array', () => {
    expect(backfillDefaultShortcuts([])).toEqual(DEFAULT_SHORTCUTS);
    expect(backfillDefaultShortcuts(undefined as unknown as never[])).toEqual(DEFAULT_SHORTCUTS);
  });

  it('returns the input unchanged when no defaults are missing', () => {
    const persisted = DEFAULT_SHORTCUTS.map((s) => ({ ...s }));
    expect(backfillDefaultShortcuts(persisted)).toEqual(persisted);
  });
});

describe('backfillDefaultFileTemplates', () => {
  it('appends missing default template keys while preserving existing entries', () => {
    const result = backfillDefaultFileTemplates({ md: '# custom' });
    expect(result.md).toBe('# custom');
    expect(result.puml).toContain('@startuml');
    expect(result.gv).toContain('digraph');
    expect(result.dbml).toContain('Table users');
    expect(Object.keys(result).sort()).toEqual(Object.keys(DEFAULT_FILE_TEMPLATES).sort());
  });

  it('returns the defaults copy when input is empty or undefined', () => {
    expect(backfillDefaultFileTemplates({})).toEqual(DEFAULT_FILE_TEMPLATES);
    expect(backfillDefaultFileTemplates(undefined as unknown as Record<string, string>)).toEqual(DEFAULT_FILE_TEMPLATES);
  });

  it('preserves user-cleared (empty-string) templates during backfill', () => {
    const result = backfillDefaultFileTemplates({ md: '' });
    expect(result.md).toBe('');
    expect(result.puml).toBeDefined();
  });

  it('includes diagram starters for puml, gv and dbml', () => {
    const { puml, gv, dbml } = DEFAULT_FILE_TEMPLATES;
    expect(puml).toMatch(/^@startuml/);
    expect(gv).toContain('digraph');
    expect(dbml).toContain('Table users');
  });
});
