/**
 * Language list for the translation panel. Ponytail: hardcoded mainstream
 * set — no locale data dependency. Add an entry here when a user asks for a
 * language not covered.
 */
export interface LanguageOption {
  /** Stable id sent to the LLM prompt. */
  id: string;
  /** i18n key suffix under `settings:translation.languages.*`. The dropdown
   *  and the LLM prompt both resolve via t('settings:translation.languages.' + label). */
  label: string;
}

/** Special id for "auto-detect source language". Only valid as a source. */
export const AUTO_DETECT_ID = 'auto';

export const SOURCE_LANGUAGES: readonly LanguageOption[] = [
  { id: AUTO_DETECT_ID, label: 'auto' },
  { id: 'zh', label: 'zh' },
  { id: 'en', label: 'en' },
  { id: 'ja', label: 'ja' },
  { id: 'ko', label: 'ko' },
  { id: 'es', label: 'es' },
  { id: 'fr', label: 'fr' },
  { id: 'de', label: 'de' },
  { id: 'ru', label: 'ru' },
  { id: 'pt', label: 'pt' },
  { id: 'it', label: 'it' },
  { id: 'ar', label: 'ar' },
  { id: 'hi', label: 'hi' },
] as const;

export const TARGET_LANGUAGES: readonly LanguageOption[] = SOURCE_LANGUAGES.filter(
  (l) => l.id !== AUTO_DETECT_ID,
);
