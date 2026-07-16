import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAppearanceStore } from '@/store/appearanceStore';
import { storageClient } from '@/utils/storageClient';

// Shared Tauri mocks are auto-loaded via test/setup.ts — no per-file vi.mock.
//
// useTheme is a React hook (useEffect + zustand selectors) that cannot be
// invoked without a React render — which the AC explicitly excludes. Per the
// task's preferred fallback, these tests drive the *underlying* appearanceStore
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
  useAppearanceStore.setState({ theme: 'light' });
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useTheme — underlying store contract', () => {
  it('exposes the current theme from the store (useTheme reads state.theme)', () => {
    useAppearanceStore.setState({ theme: 'dark' });
    // useTheme returns { theme } sourced from useAppearanceStore(state => state.theme)
    expect(useAppearanceStore.getState().theme).toBe('dark');
  });

  it('setTheme applies an explicit theme and sets data-theme (useTheme forwards setTheme)', () => {
    const { setTheme } = useAppearanceStore.getState();
    setTheme('dark');
    expect(useAppearanceStore.getState().theme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');

    setTheme('light');
    expect(useAppearanceStore.getState().theme).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('toggleTheme flips between light and dark and updates data-theme', () => {
    const { toggleTheme } = useAppearanceStore.getState();
    expect(useAppearanceStore.getState().theme).toBe('light');

    toggleTheme();
    expect(useAppearanceStore.getState().theme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');

    toggleTheme();
    expect(useAppearanceStore.getState().theme).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('setTheme("system") resolves to light/dark via matchMedia and stores "system"', () => {
    // jsdom's matchMedia polyfill (from test/setup.desktop.ts) reports matches=false -> light.
    const { setTheme } = useAppearanceStore.getState();
    setTheme('system');
    expect(useAppearanceStore.getState().theme).toBe('system');
    expect(['light', 'dark']).toContain(document.documentElement.dataset.theme);
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('setTheme("dark") overrides a previous "system" theme', () => {
    useAppearanceStore.getState().setTheme('system');
    useAppearanceStore.getState().setTheme('dark');
    expect(useAppearanceStore.getState().theme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('useTheme — DOM side effects are driven through the store', () => {
  it('every theme change is reflected in document dataset.theme', () => {
    const { setTheme, toggleTheme } = useAppearanceStore.getState();
    setTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    toggleTheme();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('the data-theme attribute is absent until a theme action runs', () => {
    expect(document.documentElement.dataset.theme).toBeUndefined();
    useAppearanceStore.getState().setTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
