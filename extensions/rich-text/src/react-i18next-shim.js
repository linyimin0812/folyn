const React = window.React;

// ponytail: react-i18next shim. The host initializes react-i18next + i18next
// against its translation bundles (apps/desktop/src/i18n/index.ts) and
// exposes the module on window so the extension (loaded as a blob URL,
// can't resolve bare imports) shares the SAME initialized i18n instance.
// Without this shim, the extension would bundle its own react-i18next
// singleton (uninitialized → useTranslation returns the key verbatim, no
// translations). Mirrors the React shim pattern (window.React).
const r = window.reactI18next;
export const useTranslation = r.useTranslation;
export const initReactI18next = r.initReactI18next;
export const withTranslation = r.withTranslation;
export const I18nextProvider = r.I18nextProvider;
export const getI18n = r.getI18n;
export default r;
