import { describe, it, expect, vi, beforeEach } from 'vitest';

// ponytail: mock the two host stores with a tiny zustand-like surface so
// `buildPluginEnv` can subscribe + read without pulling react graphs into
// the test bundle. Each mock exposes `getState()`, `subscribe(listener)`,
// and `__emit(newState)` to drive test transitions.

type ThemeState = { theme: 'light' | 'dark' | 'system' };
type LocaleState = { locale: string };

function createStore<T extends object>(initial: T) {
  let state = initial;
  const listeners = new Set<(s: T, prev: T) => void>();
  return {
    getState: () => state,
    subscribe(listener: (s: T, prev: T) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    __emit(next: T) {
      const prev = state;
      state = next;
      for (const l of listeners) l(next, prev);
    },
  };
}

const { appearanceMock, localeMock } = vi.hoisted(() => {
  type ThemeState = { theme: 'light' | 'dark' | 'system' };
  type LocaleState = { locale: string };
  function createStore<T extends object>(initial: T) {
    let state = initial;
    const listeners = new Set<(s: T, prev: T) => void>();
    return {
      getState: () => state,
      subscribe(listener: (s: T, prev: T) => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      __emit(next: T) {
        const prev = state;
        state = next;
        for (const l of listeners) l(next, prev);
      },
    };
  }
  return {
    appearanceMock: createStore<ThemeState>({ theme: 'light' }),
    localeMock: createStore<LocaleState>({ locale: 'en' }),
  };
});

vi.mock('@/store/appearanceStore', () => ({
  useAppearanceStore: appearanceMock,
  Theme: undefined,
}));
vi.mock('@/store/localeStore', () => ({
  useLocaleStore: localeMock,
}));

// matchMedia stub: default to light. Tests can flip `matchMediaDark`.
let matchMediaDark = false;
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: query.includes('dark') && matchMediaDark,
    addEventListener: () => {},
    removeEventListener: () => {},
  }),
});

import { buildPluginEnv, disposePluginEnv } from './envCapability';

beforeEach(() => {
  appearanceMock.__emit({ theme: 'light' });
  localeMock.__emit({ locale: 'en' });
  matchMediaDark = false;
});

describe('buildPluginEnv', () => {
  it('reads current theme + locale', () => {
    const env = buildPluginEnv();
    expect(env.theme).toBe('light');
    expect(env.locale).toBe('en');
  });

  it('resolves system theme via prefers-color-scheme', () => {
    appearanceMock.__emit({ theme: 'system' });
    matchMediaDark = true;
    const env = buildPluginEnv();
    expect(env.theme).toBe('dark');
  });

  it('pushes theme changes to subscribers', () => {
    const env = buildPluginEnv();
    const cb = vi.fn();
    env.onThemeChange(cb);
    appearanceMock.__emit({ theme: 'dark' });
    expect(cb).toHaveBeenCalledWith('dark');
  });

  it('pushes locale changes to subscribers', () => {
    const env = buildPluginEnv();
    const cb = vi.fn();
    env.onLocaleChange(cb);
    localeMock.__emit({ locale: 'zh' });
    expect(cb).toHaveBeenCalledWith('zh');
  });

  it('does not fire when slice is unchanged', () => {
    const env = buildPluginEnv();
    const cb = vi.fn();
    env.onThemeChange(cb);
    // Same theme value — no fire.
    appearanceMock.__emit({ theme: 'light' });
    expect(cb).not.toHaveBeenCalled();
  });

  it('onThemeChange disposable removes the cb', () => {
    const env = buildPluginEnv();
    const cb = vi.fn();
    const d = env.onThemeChange(cb);
    d.dispose();
    appearanceMock.__emit({ theme: 'dark' });
    expect(cb).not.toHaveBeenCalled();
  });

  it('disposePluginEnv unsubscribes from host stores', () => {
    const env = buildPluginEnv();
    const themeCb = vi.fn();
    const localeCb = vi.fn();
    env.onThemeChange(themeCb);
    env.onLocaleChange(localeCb);
    disposePluginEnv(env);
    // After dispose, store changes do not reach plugin cbs.
    appearanceMock.__emit({ theme: 'dark' });
    localeMock.__emit({ locale: 'zh' });
    expect(themeCb).not.toHaveBeenCalled();
    expect(localeCb).not.toHaveBeenCalled();
  });
});
