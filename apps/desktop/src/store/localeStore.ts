import { create } from 'zustand';
import i18n, { SUPPORTED_LOCALES, type Locale, LOCALE_STORAGE_KEY, detectInitialLocale } from '@/i18n';
import { isTauri } from '@/utils/platform';

// ponytail: locale has its OWN localStorage key (`folyn:locale`) instead of
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

// ponytail: rebuild the macOS app menu bar after a locale change so the
// Edit/Window submenu titles track the user's language. The menu bar is
// built once at app startup (locale="en" bootstrap) and never rebuilt by
// the OS; `pet_rebuild_app_menu` rebuilds it with the new locale's labels.
// Non-Tauri / test envs skip the invoke. Fire-and-forget — a rebuild
// failure leaves the prior menu visible, not a crash.
async function syncAppMenuLocale(lg: Locale): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('pet_rebuild_app_menu', { locale: lg });
  } catch {
    // Non-fatal — the right-click menu still localizes on next open.
  }
}

// ponytail: broadcast the new locale to other Tauri windows (pet /
// pet-panel / pet-bubble / voice-orb). Each is a separate JS realm with
// its own i18next + localeStore instance; without this emit, the pet
// window's i18n.language stays at its module-load value and the native
// right-click menu (read from i18n.language) shows the old locale.
// Mirrors the `pet://icon-changed` pattern. Non-Tauri / test envs skip.
async function emitLocaleChanged(lg: Locale): Promise<void> {
  if (!isTauri()) return;
  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit('locale://changed', { locale: lg });
  } catch {
    // Non-fatal — the pet window will catch up on next launch.
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
    void syncAppMenuLocale(lg);
    void emitLocaleChanged(lg);
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
    // ponytail: Rust built the app menu bar with locale="en" at startup
    // (JS realm hadn't started yet). Push the real stored locale to Rust
    // so the menu bar reflects the user's language on first paint. Without
    // this, a zh user sees English Edit/Window titles until they switch.
    void syncAppMenuLocale(stored);
  },
}));
