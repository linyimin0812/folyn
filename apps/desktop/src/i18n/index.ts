import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCommon from './locales/zh/common.json';
import enCommon from './locales/en/common.json';
import zhShell from './locales/zh/shell.json';
import enShell from './locales/en/shell.json';
import zhTopbar from './locales/zh/topbar.json';
import enTopbar from './locales/en/topbar.json';
import zhSidebar from './locales/zh/sidebar.json';
import enSidebar from './locales/en/sidebar.json';
import zhSettings from './locales/zh/settings.json';
import enSettings from './locales/en/settings.json';
import zhVault from './locales/zh/vault.json';
import enVault from './locales/en/vault.json';
import zhEditor from './locales/zh/editor.json';
import enEditor from './locales/en/editor.json';
import zhSearch from './locales/zh/search.json';
import enSearch from './locales/en/search.json';
import zhAi from './locales/zh/ai.json';
import enAi from './locales/en/ai.json';
import zhSchedule from './locales/zh/schedule.json';
import enSchedule from './locales/en/schedule.json';
import zhStudy from './locales/zh/study.json';
import enStudy from './locales/en/study.json';
import zhRustErrors from './locales/zh/rustErrors.json';
import enRustErrors from './locales/en/rustErrors.json';
import zhPet from './locales/zh/pet.json';
import enPet from './locales/en/pet.json';
import zhTerminal from './locales/zh/terminal.json';
import enTerminal from './locales/en/terminal.json';
import zhBrowser from './locales/zh/browser.json';
import enBrowser from './locales/en/browser.json';
import zhMmap from './locales/zh/mmap.json';
import enMmap from './locales/en/mmap.json';

// ponytail: static bundle import (no lazy loading). Bundle size is bounded
// by the namespace count; add lazy loading only when total JSON exceeds a
// measurable threshold (e.g. >200KB gzipped). Single init at module load —
// i18next is a singleton, calling init twice is a no-op.
export const SUPPORTED_LOCALES = ['zh', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_STORAGE_KEY = 'quill:locale';

export function detectInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'zh';
  try {
    const stored = window.localStorage?.getItem(LOCALE_STORAGE_KEY);
    if (stored === 'zh' || stored === 'en') return stored;
  } catch {
    // ignore — restricted env
  }
  const navLang = typeof navigator !== 'undefined' ? navigator.language : '';
  if (navLang?.toLowerCase().startsWith('en')) return 'en';
  return 'zh';
}

export const NAMESPACES = [
  'common',
  'shell',
  'topbar',
  'sidebar',
  'settings',
  'vault',
  'editor',
  'search',
  'ai',
  'schedule',
  'study',
  'rustErrors',
  'pet',
  'terminal',
  'browser',
  'mmap',
] as const;

void i18n.use(initReactI18next).init({
  resources: {
    zh: {
      common: zhCommon,
      shell: zhShell,
      topbar: zhTopbar,
      sidebar: zhSidebar,
      settings: zhSettings,
      vault: zhVault,
      editor: zhEditor,
      search: zhSearch,
      ai: zhAi,
      schedule: zhSchedule,
      study: zhStudy,
      rustErrors: zhRustErrors,
      pet: zhPet,
      terminal: zhTerminal,
      browser: zhBrowser,
      mmap: zhMmap,
    },
    en: {
      common: enCommon,
      shell: enShell,
      topbar: enTopbar,
      sidebar: enSidebar,
      settings: enSettings,
      vault: enVault,
      editor: enEditor,
      search: enSearch,
      ai: enAi,
      schedule: enSchedule,
      study: enStudy,
      rustErrors: enRustErrors,
      pet: enPet,
      terminal: enTerminal,
      browser: enBrowser,
      mmap: enMmap,
    },
  },
  lng: detectInitialLocale(),
  fallbackLng: 'zh',
  defaultNS: 'common',
  ns: [...NAMESPACES],
  interpolation: {
    // React already escapes; we don't double-escape.
    escapeValue: false,
  },
  returnNull: false,
  // Missing key: emit the key itself so the UI stays functional; warn in dev.
  saveMissing: true,
  missingKeyHandler: (_lngs, _ns, key) => {
    // eslint-disable-next-line no-console
    console.warn(`[i18n] missing key: ${key}`);
  },
});

export default i18n;
