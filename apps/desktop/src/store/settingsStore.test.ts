import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSettingsStore, DEFAULT_SHORTCUTS } from './settingsStore';
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
});
