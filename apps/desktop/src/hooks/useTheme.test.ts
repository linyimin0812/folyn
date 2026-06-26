import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSettingsStore } from '@/store/settingsStore';
import { storageClient } from '@/utils/storageClient';

// Shared Tauri mocks are auto-loaded via test/setup.ts — no per-file vi.mock.
//
// useTheme is a React hook (useEffect + zustand selectors) that cannot be
// invoked without a React render — which the AC explicitly excludes. Per the
// task's preferred fallback, these tests drive the *underlying* settingsStore
// interactions that useTheme composes: theme get/set/toggle and the DOM
// data-theme side effects the store actions perform directly. The hook's own
// useEffect (which re-applies theme + subscribes to matchMedia for 'system')
// mirrors the same store-driven application, so this covers the contract.
//
// Residual (not covered without React render): useTheme's useEffect
// subscription to matchMedia 'change' events while theme === 'system', and
// the effect's cleanup. The store's own setTheme('system') already resolves
// and applies the data-theme attribute synchronously.

beforeEach(() => {
  storageClient.__resetForTesting();
  vi.useFakeTimers();
  useSettingsStore.setState({ theme: 'light' });
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useTheme — underlying store contract', () => {
  it('exposes the current theme from the store (useTheme reads state.theme)', () => {
    useSettingsStore.setState({ theme: 'dark' });
    // useTheme returns { theme } sourced from useSettingsStore(state => state.theme)
    expect(useSettingsStore.getState().theme).toBe('dark');
  });

  it('setTheme applies an explicit theme and sets data-theme (useTheme forwards setTheme)', () => {
    const { setTheme } = useSettingsStore.getState();
    setTheme('dark');
    expect(useSettingsStore.getState().theme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');

    setTheme('light');
    expect(useSettingsStore.getState().theme).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('toggleTheme flips between light and dark and updates data-theme', () => {
    const { toggleTheme } = useSettingsStore.getState();
    expect(useSettingsStore.getState().theme).toBe('light');

    toggleTheme();
    expect(useSettingsStore.getState().theme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');

    toggleTheme();
    expect(useSettingsStore.getState().theme).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('setTheme("system") resolves to light/dark via matchMedia and stores "system"', () => {
    // jsdom's matchMedia polyfill (from test/setup.desktop.ts) reports matches=false -> light.
    const { setTheme } = useSettingsStore.getState();
    setTheme('system');
    expect(useSettingsStore.getState().theme).toBe('system');
    expect(['light', 'dark']).toContain(document.documentElement.dataset.theme);
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('setTheme("dark") overrides a previous "system" theme', () => {
    useSettingsStore.getState().setTheme('system');
    useSettingsStore.getState().setTheme('dark');
    expect(useSettingsStore.getState().theme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('useTheme — DOM side effects are driven through the store', () => {
  it('every theme change is reflected in document dataset.theme', () => {
    const { setTheme, toggleTheme } = useSettingsStore.getState();
    setTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    toggleTheme();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('the data-theme attribute is absent until a theme action runs', () => {
    expect(document.documentElement.dataset.theme).toBeUndefined();
    useSettingsStore.getState().setTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
