import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSettingsStore, DEFAULT_SHORTCUTS, backfillBuiltinExcludePatterns, backfillDefaultShortcuts, type ShortcutItem } from './settingsStore';
import { storageClient } from '@/utils/storageClient';

beforeEach(() => {
  storageClient.__resetForTesting();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useSettingsStore theme', () => {
  it('toggles between light and dark', () => {
    useSettingsStore.setState({ theme: 'light' });
    useSettingsStore.getState().toggleTheme();
    expect(useSettingsStore.getState().theme).toBe('dark');
    useSettingsStore.getState().toggleTheme();
    expect(useSettingsStore.getState().theme).toBe('light');
  });

  it('setTheme applies an explicit theme and sets the data-theme attribute', () => {
    useSettingsStore.getState().setTheme('dark');
    expect(useSettingsStore.getState().theme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('setTheme("system") resolves via matchMedia', () => {
    // jsdom defaults to no prefers-color-scheme → light
    useSettingsStore.getState().setTheme('system');
    expect(useSettingsStore.getState().theme).toBe('system');
    expect(['light', 'dark']).toContain(document.documentElement.dataset.theme);
  });
});

describe('useSettingsStore simple setters', () => {
  it('setCurrentPage', () => {
    useSettingsStore.getState().setCurrentPage('settings');
    expect(useSettingsStore.getState().currentPage).toBe('settings');
  });

  it('setSettingsTab', () => {
    useSettingsStore.getState().setSettingsTab('editor');
    expect(useSettingsStore.getState().settingsTab).toBe('editor');
  });

  it('setFontSize updates state and CSS variable', () => {
    useSettingsStore.getState().setFontSize(20);
    expect(useSettingsStore.getState().fontSize).toBe(20);
    expect(document.documentElement.style.getPropertyValue('--ui-font-size')).toBe('20px');
  });

  it('setLineHeight', () => {
    useSettingsStore.getState().setLineHeight(2);
    expect(useSettingsStore.getState().lineHeight).toBe(2);
  });

  it('setVaultName', () => {
    useSettingsStore.getState().setVaultName('custom');
    expect(useSettingsStore.getState().vaultName).toBe('custom');
  });
});

// ── Desktop Pet Mode persistence (R5, AC7) ──
describe('useSettingsStore pet mode', () => {
  it('defaults to disabled with no saved position', () => {
    useSettingsStore.setState({ petModeEnabled: false, petPositionX: -1, petPositionY: -1 });
    expect(useSettingsStore.getState().petModeEnabled).toBe(false);
    expect(useSettingsStore.getState().petPositionX).toBe(-1);
    expect(useSettingsStore.getState().petPositionY).toBe(-1);
  });

  it('setPetModeEnabled updates state and persists to storageClient', async () => {
    const setSpy = vi.spyOn(storageClient, 'set');
    useSettingsStore.getState().setPetModeEnabled(true);
    expect(useSettingsStore.getState().petModeEnabled).toBe(true);
    // debouncedPersist fires after 300ms (fake timers).
    vi.advanceTimersByTime(400);
    expect(setSpy).toHaveBeenCalled();
    const payload = setSpy.mock.calls[setSpy.mock.calls.length - 1][1] as Record<string, unknown>;
    expect(payload.petModeEnabled).toBe(true);
    setSpy.mockRestore();
  });

  it('setPetPosition updates X/Y and persists', async () => {
    const setSpy = vi.spyOn(storageClient, 'set');
    useSettingsStore.getState().setPetPosition(120, 340);
    expect(useSettingsStore.getState().petPositionX).toBe(120);
    expect(useSettingsStore.getState().petPositionY).toBe(340);
    vi.advanceTimersByTime(400);
    const payload = setSpy.mock.calls[setSpy.mock.calls.length - 1][1] as Record<string, unknown>;
    expect(payload.petPositionX).toBe(120);
    expect(payload.petPositionY).toBe(340);
    setSpy.mockRestore();
  });

  it('persisted payload round-trips through storageClient.get', async () => {
    // Capture the persisted payload by writing through the real setter.
    const setSpy = vi.spyOn(storageClient, 'set');
    useSettingsStore.getState().setPetModeEnabled(true);
    useSettingsStore.getState().setPetPosition(50, 70);
    vi.advanceTimersByTime(400);
    const payload = setSpy.mock.calls[setSpy.mock.calls.length - 1][1];
    setSpy.mockRestore();
    storageClient.__resetForTesting();
    await storageClient.set('settings:all', payload);
    const loaded = await storageClient.get<typeof payload>('settings:all');
    expect(loaded).not.toBeNull();
    expect((loaded as Record<string, unknown>).petModeEnabled).toBe(true);
    expect((loaded as Record<string, unknown>).petPositionX).toBe(50);
    expect((loaded as Record<string, unknown>).petPositionY).toBe(70);
  });
});

// ── Pet quick-action panel window persistence (Fix 2) ──
describe('useSettingsStore pet panel pos/size', () => {
  it('defaults to -1 (no saved pos/size yet)', () => {
    useSettingsStore.setState({
      petPanelX: -1,
      petPanelY: -1,
      petPanelWidth: -1,
      petPanelHeight: -1,
    });
    expect(useSettingsStore.getState().petPanelX).toBe(-1);
    expect(useSettingsStore.getState().petPanelY).toBe(-1);
    expect(useSettingsStore.getState().petPanelWidth).toBe(-1);
    expect(useSettingsStore.getState().petPanelHeight).toBe(-1);
  });

  it('setPetPanelPosition updates X/Y and persists', async () => {
    const setSpy = vi.spyOn(storageClient, 'set');
    useSettingsStore.getState().setPetPanelPosition(220, 440);
    expect(useSettingsStore.getState().petPanelX).toBe(220);
    expect(useSettingsStore.getState().petPanelY).toBe(440);
    vi.advanceTimersByTime(400);
    const payload = setSpy.mock.calls[setSpy.mock.calls.length - 1][1] as Record<string, unknown>;
    expect(payload.petPanelX).toBe(220);
    expect(payload.petPanelY).toBe(440);
    setSpy.mockRestore();
  });

  it('setPetPanelSize updates W/H and persists', async () => {
    const setSpy = vi.spyOn(storageClient, 'set');
    useSettingsStore.getState().setPetPanelSize(420, 600);
    expect(useSettingsStore.getState().petPanelWidth).toBe(420);
    expect(useSettingsStore.getState().petPanelHeight).toBe(600);
    vi.advanceTimersByTime(400);
    const payload = setSpy.mock.calls[setSpy.mock.calls.length - 1][1] as Record<string, unknown>;
    expect(payload.petPanelWidth).toBe(420);
    expect(payload.petPanelHeight).toBe(600);
    setSpy.mockRestore();
  });

  it('persisted payload round-trips through storageClient.get', async () => {
    const setSpy = vi.spyOn(storageClient, 'set');
    useSettingsStore.getState().setPetPanelPosition(11, 22);
    useSettingsStore.getState().setPetPanelSize(33, 44);
    vi.advanceTimersByTime(400);
    const payload = setSpy.mock.calls[setSpy.mock.calls.length - 1][1];
    setSpy.mockRestore();
    storageClient.__resetForTesting();
    await storageClient.set('settings:all', payload);
    const loaded = await storageClient.get<typeof payload>('settings:all');
    expect(loaded).not.toBeNull();
    expect((loaded as Record<string, unknown>).petPanelX).toBe(11);
    expect((loaded as Record<string, unknown>).petPanelY).toBe(22);
    expect((loaded as Record<string, unknown>).petPanelWidth).toBe(33);
    expect((loaded as Record<string, unknown>).petPanelHeight).toBe(44);
  });
});

// ── Pet panel size version-gate (default-size bump auto-invalidation) ──
describe('useSettingsStore pet panel size version', () => {
  it('defaults to 0 (pre-versioning) so existing users migrate on next open', () => {
    useSettingsStore.setState({ petPanelSizeVersion: 0 });
    expect(useSettingsStore.getState().petPanelSizeVersion).toBe(0);
  });

  it('setPetPanelSizeVersion updates the field and persists', async () => {
    const setSpy = vi.spyOn(storageClient, 'set');
    useSettingsStore.getState().setPetPanelSizeVersion(7);
    expect(useSettingsStore.getState().petPanelSizeVersion).toBe(7);
    vi.advanceTimersByTime(400);
    const payload = setSpy.mock.calls[setSpy.mock.calls.length - 1][1] as Record<string, unknown>;
    expect(payload.petPanelSizeVersion).toBe(7);
    setSpy.mockRestore();
  });

  it('persisted payload round-trips the version field', async () => {
    const setSpy = vi.spyOn(storageClient, 'set');
    useSettingsStore.getState().setPetPanelSizeVersion(3);
    vi.advanceTimersByTime(400);
    const payload = setSpy.mock.calls[setSpy.mock.calls.length - 1][1];
    setSpy.mockRestore();
    storageClient.__resetForTesting();
    await storageClient.set('settings:all', payload);
    const loaded = await storageClient.get<typeof payload>('settings:all');
    expect(loaded).not.toBeNull();
    expect((loaded as Record<string, unknown>).petPanelSizeVersion).toBe(3);
  });
});

describe('useSettingsStore.updateSettings', () => {
  it('merges partial settings', () => {
    useSettingsStore.getState().updateSettings({ autoSave: false, tabSize: 2 });
    expect(useSettingsStore.getState().autoSave).toBe(false);
    expect(useSettingsStore.getState().tabSize).toBe(2);
  });

  it('updates CSS variable when fontSize is included', () => {
    useSettingsStore.getState().updateSettings({ fontSize: 18 });
    expect(document.documentElement.style.getPropertyValue('--ui-font-size')).toBe('18px');
  });
});

describe('useSettingsStore shortcuts', () => {
  it('updateShortcut updates the keys for the given id', () => {
    useSettingsStore.getState().updateShortcut('bold', ['Ctrl', 'b']);
    const s = useSettingsStore.getState().shortcuts.find((x) => x.id === 'bold')!;
    expect(s.keys).toEqual(['Ctrl', 'b']);
  });

  it('updateShortcut is a no-op for unknown ids', () => {
    const before = useSettingsStore.getState().shortcuts.length;
    useSettingsStore.getState().updateShortcut('does-not-exist', ['X']);
    expect(useSettingsStore.getState().shortcuts.length).toBe(before);
  });

  it('resetShortcuts restores DEFAULT_SHORTCUTS', () => {
    useSettingsStore.getState().updateShortcut('bold', ['X']);
    useSettingsStore.getState().resetShortcuts();
    const s = useSettingsStore.getState().shortcuts.find((x) => x.id === 'bold')!;
    const original = DEFAULT_SHORTCUTS.find((x) => x.id === 'bold')!;
    expect(s.keys).toEqual(original.keys);
  });

  it('DEFAULT_SHORTCUTS includes the global togglePetPanel shortcut with the default Cmd+Shift+Q binding', () => {
    // The global-shortcut entry must round-trip through the same persistence
    // path as the in-editor bindings, and its default keys must match the
    // accelerator documented in the PRD (and asserted by ShortcutEditor's
    // rebind-to-Rust flow). Bumping or renaming this id without updating
    // PetApp's mount-time registration + SettingsPage's rebind hook would
    // silently break the global shortcut.
    const entry = DEFAULT_SHORTCUTS.find((x) => x.id === 'togglePetPanel');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('唤起桌宠面板');
    expect(entry!.keys).toEqual(['⌘', 'Shift', 'Q']);
  });
});

describe('backfillDefaultShortcuts', () => {
  it('appends missing default entries (by id) to a persisted array', () => {
    // Simulate an existing user whose persisted array predates togglePetPanel.
    const persisted = DEFAULT_SHORTCUTS
      .filter((s) => s.id !== 'togglePetPanel')
      .map((s) => ({ ...s }));
    const result = backfillDefaultShortcuts(persisted);
    const ids = result.map((s) => s.id);
    expect(ids).toContain('togglePetPanel');
    expect(result.length).toBe(DEFAULT_SHORTCUTS.length);
  });

  it('preserves user-customized keys on existing entries', () => {
    // User rebound 'bold' to Cmd+X; the backfill must NOT overwrite it with
    // the default Cmd+B.
    const persisted = DEFAULT_SHORTCUTS.map((s) => ({ ...s }));
    const boldIdx = persisted.findIndex((s) => s.id === 'bold');
    persisted[boldIdx].keys = ['⌘', 'X'];
    const result = backfillDefaultShortcuts(persisted);
    const bold = result.find((s) => s.id === 'bold')!;
    expect(bold.keys).toEqual(['⌘', 'X']);
  });

  it('returns DEFAULT_SHORTCUTS copy when persisted is empty or non-array', () => {
    expect(backfillDefaultShortcuts([])).toEqual(DEFAULT_SHORTCUTS);
    expect(backfillDefaultShortcuts(undefined as unknown as ShortcutItem[])).toEqual(DEFAULT_SHORTCUTS);
  });

  it('returns the input unchanged when no defaults are missing', () => {
    const persisted = DEFAULT_SHORTCUTS.map((s) => ({ ...s }));
    const result = backfillDefaultShortcuts(persisted);
    expect(result).toEqual(persisted);
  });
});

describe('backfillBuiltinExcludePatterns', () => {
  const BUILTIN_DIRS = [
    '__wiki__',
    '__clips__',
    '__reports__',
    '__daily__',
    '__study__',
    '__schedule__',
    '__analyze__',
  ];

  it('appends missing built-in dirs when persisted value has __wiki__ but lacks others', () => {
    // Simulates an existing user whose persisted value predates __study__/__schedule__/__analyze__.
    const raw = 'node_modules\n.git\n__wiki__\n__clips__';
    const result = backfillBuiltinExcludePatterns(raw);
    const lines = result.split('\n');
    // All 7 built-in dirs present.
    for (const d of BUILTIN_DIRS) {
      expect(lines).toContain(d);
    }
    // User-defined patterns preserved.
    expect(lines).toContain('node_modules');
    expect(lines).toContain('.git');
    // No duplicates.
    expect(lines.length).toBe(new Set(lines).size);
    // Existing entries keep their order; missing ones appended.
    expect(lines.slice(0, 4)).toEqual(['node_modules', '.git', '__wiki__', '__clips__']);
  });

  it('leaves an already-complete persisted value unchanged (no duplication)', () => {
    const raw = BUILTIN_DIRS.join('\n');
    const result = backfillBuiltinExcludePatterns(raw);
    expect(result).toBe(raw);
  });

  it('preserves user-defined custom patterns', () => {
    const raw = 'node_modules\n__wiki__';
    const result = backfillBuiltinExcludePatterns(raw);
    const lines = result.split('\n');
    expect(lines).toContain('node_modules');
    expect(lines).toContain('__wiki__');
    for (const d of BUILTIN_DIRS) {
      expect(lines).toContain(d);
    }
    // node_modules appears exactly once.
    expect(lines.filter((l) => l === 'node_modules').length).toBe(1);
  });
});
