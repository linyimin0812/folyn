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
import zhRustErrors from './locales/zh/rustErrors.json';
import enRustErrors from './locales/en/rustErrors.json';
import zhPet from './locales/zh/pet.json';
import enPet from './locales/en/pet.json';
import zhTerminal from './locales/zh/terminal.json';
import enTerminal from './locales/en/terminal.json';
import zhBrowser from './locales/zh/browser.json';
import enBrowser from './locales/en/browser.json';
import zhMarkmap from './locales/zh/markmap.json';
import zhWiki from './locales/zh/wiki.json';
import enMarkmap from './locales/en/markmap.json';
import enWiki from './locales/en/wiki.json';
import jaCommon from './locales/ja/common.json';
import jaShell from './locales/ja/shell.json';
import jaTopbar from './locales/ja/topbar.json';
import jaSidebar from './locales/ja/sidebar.json';
import jaSettings from './locales/ja/settings.json';
import jaVault from './locales/ja/vault.json';
import jaEditor from './locales/ja/editor.json';
import jaSearch from './locales/ja/search.json';
import jaAi from './locales/ja/ai.json';
import jaSchedule from './locales/ja/schedule.json';
import jaRustErrors from './locales/ja/rustErrors.json';
import jaPet from './locales/ja/pet.json';
import jaTerminal from './locales/ja/terminal.json';
import jaBrowser from './locales/ja/browser.json';
import jaMarkmap from './locales/ja/markmap.json';
import jaWiki from './locales/ja/wiki.json';
import esCommon from './locales/es/common.json';
import esShell from './locales/es/shell.json';
import esTopbar from './locales/es/topbar.json';
import esSidebar from './locales/es/sidebar.json';
import esSettings from './locales/es/settings.json';
import esVault from './locales/es/vault.json';
import esEditor from './locales/es/editor.json';
import esSearch from './locales/es/search.json';
import esAi from './locales/es/ai.json';
import esSchedule from './locales/es/schedule.json';
import esRustErrors from './locales/es/rustErrors.json';
import esPet from './locales/es/pet.json';
import esTerminal from './locales/es/terminal.json';
import esBrowser from './locales/es/browser.json';
import esMarkmap from './locales/es/markmap.json';
// ponytail: wiki namespace shipped for en/zh/ja only; es/de/fr reuse enWiki as
// fallback so the query tab isn't a missing-key warning wall for those locales.
const esWiki = enWiki;
const deWiki = enWiki;
const frWiki = enWiki;
import deCommon from './locales/de/common.json';
import deShell from './locales/de/shell.json';
import deTopbar from './locales/de/topbar.json';
import deSidebar from './locales/de/sidebar.json';
import deSettings from './locales/de/settings.json';
import deVault from './locales/de/vault.json';
import deEditor from './locales/de/editor.json';
import deSearch from './locales/de/search.json';
import deAi from './locales/de/ai.json';
import deSchedule from './locales/de/schedule.json';
import deRustErrors from './locales/de/rustErrors.json';
import dePet from './locales/de/pet.json';
import deTerminal from './locales/de/terminal.json';
import deBrowser from './locales/de/browser.json';
import deMarkmap from './locales/de/markmap.json';
import frCommon from './locales/fr/common.json';
import frShell from './locales/fr/shell.json';
import frTopbar from './locales/fr/topbar.json';
import frSidebar from './locales/fr/sidebar.json';
import frSettings from './locales/fr/settings.json';
import frVault from './locales/fr/vault.json';
import frEditor from './locales/fr/editor.json';
import frSearch from './locales/fr/search.json';
import frAi from './locales/fr/ai.json';
import frSchedule from './locales/fr/schedule.json';
import frRustErrors from './locales/fr/rustErrors.json';
import frPet from './locales/fr/pet.json';
import frTerminal from './locales/fr/terminal.json';
import frBrowser from './locales/fr/browser.json';
import frMarkmap from './locales/fr/markmap.json';

// ponytail: static bundle import (no lazy loading). Bundle size is bounded
// by the namespace count; add lazy loading only when total JSON exceeds a
// measurable threshold (e.g. >200KB gzipped). Single init at module load —
// i18next is a singleton, calling init twice is a no-op.
export const SUPPORTED_LOCALES = ['zh', 'en', 'ja', 'es', 'de', 'fr'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_STORAGE_KEY = 'quill:locale';

export function detectInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'zh';
  try {
    const stored = window.localStorage?.getItem(LOCALE_STORAGE_KEY);
    if (
      stored === 'zh' ||
      stored === 'en' ||
      stored === 'ja' ||
      stored === 'es' ||
      stored === 'de' ||
      stored === 'fr'
    )
      return stored;
  } catch {
    // ignore — restricted env
  }
  const navLang = typeof navigator !== 'undefined' ? navigator.language : '';
  const lower = navLang?.toLowerCase() ?? '';
  if (lower.startsWith('en')) return 'en';
  if (lower.startsWith('ja')) return 'ja';
  if (lower.startsWith('es')) return 'es';
  if (lower.startsWith('de')) return 'de';
  if (lower.startsWith('fr')) return 'fr';
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
  'rustErrors',
  'pet',
  'terminal',
  'browser',
  'markmap',
  'wiki',
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
      rustErrors: zhRustErrors,
      pet: zhPet,
      terminal: zhTerminal,
      browser: zhBrowser,
      markmap: zhMarkmap,
      wiki: zhWiki,
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
      rustErrors: enRustErrors,
      pet: enPet,
      terminal: enTerminal,
      browser: enBrowser,
      markmap: enMarkmap,
      wiki: enWiki,
    },
    ja: {
      common: jaCommon,
      shell: jaShell,
      topbar: jaTopbar,
      sidebar: jaSidebar,
      settings: jaSettings,
      vault: jaVault,
      editor: jaEditor,
      search: jaSearch,
      ai: jaAi,
      schedule: jaSchedule,
      rustErrors: jaRustErrors,
      pet: jaPet,
      terminal: jaTerminal,
      browser: jaBrowser,
      markmap: jaMarkmap,
      wiki: jaWiki,
    },
    es: {
      common: esCommon,
      shell: esShell,
      topbar: esTopbar,
      sidebar: esSidebar,
      settings: esSettings,
      vault: esVault,
      editor: esEditor,
      search: esSearch,
      ai: esAi,
      schedule: esSchedule,
      rustErrors: esRustErrors,
      pet: esPet,
      terminal: esTerminal,
      browser: esBrowser,
      markmap: esMarkmap,
      wiki: esWiki,
    },
    de: {
      common: deCommon,
      shell: deShell,
      topbar: deTopbar,
      sidebar: deSidebar,
      settings: deSettings,
      vault: deVault,
      editor: deEditor,
      search: deSearch,
      ai: deAi,
      schedule: deSchedule,
      rustErrors: deRustErrors,
      pet: dePet,
      terminal: deTerminal,
      browser: deBrowser,
      markmap: deMarkmap,
      wiki: deWiki,
    },
    fr: {
      common: frCommon,
      shell: frShell,
      topbar: frTopbar,
      sidebar: frSidebar,
      settings: frSettings,
      vault: frVault,
      editor: frEditor,
      search: frSearch,
      ai: frAi,
      schedule: frSchedule,
      rustErrors: frRustErrors,
      pet: frPet,
      terminal: frTerminal,
      browser: frBrowser,
      markmap: frMarkmap,
      wiki: frWiki,
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
