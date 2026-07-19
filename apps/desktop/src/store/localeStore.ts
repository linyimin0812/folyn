import { create } from 'zustand';
import i18n, { SUPPORTED_LOCALES, type Locale, LOCALE_STORAGE_KEY, detectInitialLocale } from '@/i18n';

// ponytail: locale has its OWN localStorage key (`quill:locale`) instead of
// riding the centralized `settings:all` blob. Reason: i18next needs the
// locale synchronously at module init, but settings:all hydrates async via
// loadSettings(). A dedicated key is readable at i18n.init time. Smaller
// diff than retrofitting synchronous settings hydration, and locale is a
// hot read at startup so the trade-off is worth it.

export { SUPPORTED_LOCALES, LOCALE_STORAGE_KEY, detectInitialLocale };
export type { Locale };

function persistLocale(lg: Locale): void {
  try {
    window.localStorage?.setItem(LOCALE_STORAGE_KEY, lg);
  } catch {
    // ignore — restricted env
  }
}

export interface LocaleState {
  locale: Locale;
  setLocale: (lg: Locale) => void;
  /** Hydrate from storage (called once after the i18n singleton is ready). */
  hydrate: () => void;
}

export const useLocaleStore = create<LocaleState>((set, get) => ({
  locale: detectInitialLocale(),

  setLocale: (lg) => {
    if (lg === get().locale) return;
    persistLocale(lg);
    void i18n.changeLanguage(lg);
    set({ locale: lg });
  },

  hydrate: () => {
    const stored = detectInitialLocale();
    if (stored !== get().locale) {
      void i18n.changeLanguage(stored);
      set({ locale: stored });
    } else {
      // Make sure i18n matches — defensive: a stale module-load order could
      // leave i18n on the default while the store has the detected value.
      if (i18n.language !== stored) void i18n.changeLanguage(stored);
    }
  },
}));
