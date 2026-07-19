import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n, { detectInitialLocale } from '@/i18n';
import { LOCALE_STORAGE_KEY, useLocaleStore } from '@/store/localeStore';

// jsdom in this workspace ships a partial localStorage stub; install a real
// Map-backed localStorage for tests so .clear() / .getItem() work.
function installLocalStorage(): Storage {
  const store = new Map<string, string>();
  const ls: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => store.get(k) ?? null,
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => {
      store.delete(k);
    },
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
  };
  return ls;
}

describe('localeStore + i18n', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', installLocalStorage());
    useLocaleStore.setState({ locale: 'zh' });
    void i18n.changeLanguage('zh');
  });

  it('detects navigator.language en as en', () => {
    const orig = navigator.language;
    Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true });
    expect(detectInitialLocale()).toBe('en');
    Object.defineProperty(navigator, 'language', { value: orig, configurable: true });
  });

  it('setLocale(en) flips i18n.language and persists', () => {
    useLocaleStore.getState().setLocale('en');
    expect(useLocaleStore.getState().locale).toBe('en');
    expect(i18n.language).toBe('en');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
  });

  it('setLocale(zh) flips back and round-trips', () => {
    useLocaleStore.getState().setLocale('en');
    useLocaleStore.getState().setLocale('zh');
    expect(i18n.language).toBe('zh');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh');
  });

  it('missing key falls back to the key itself (no throw)', () => {
    // returnNull=false ensures we never render null for a missing key.
    const got = i18n.t('common.__nonexistent__key__');
    expect(got).toBe('common.__nonexistent__key__');
  });

  it('translates common.ok in both locales', () => {
    useLocaleStore.getState().setLocale('zh');
    expect(i18n.t('common.ok')).toBe('确定');
    useLocaleStore.getState().setLocale('en');
    expect(i18n.t('common.ok')).toBe('OK');
  });
});

