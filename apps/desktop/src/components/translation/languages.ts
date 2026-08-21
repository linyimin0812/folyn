/**
 * Language list for the translation panel. Ponytail: hardcoded mainstream
 * set — no locale data dependency. Add an entry here when a user asks for a
 * language not covered.
 */
export interface LanguageOption {
  /** Stable id sent to the LLM prompt. */
  id: string;
  /** i18n key suffix under `settings:translation.languages.*` — the dropdown
   *  display label resolves via t('settings:translation.languages.' + label). */
  label: string;
  /** Canonical English name passed to the LLM prompt. UI locale must not
   *  affect the prompt — LLMs parse English names most reliably, and mixing
   *  localized names into an English prompt sentence ("Translate into 日语")
   *  can cause the model to default to a related language. */
  name: string;
}

/** Special id for "auto-detect source language". Only valid as a source. */
export const AUTO_DETECT_ID = 'auto';

export const SOURCE_LANGUAGES: readonly LanguageOption[] = [
  { id: AUTO_DETECT_ID, label: 'auto', name: 'Auto Detect' },
  { id: 'zh', label: 'zh', name: 'Chinese' },
  { id: 'en', label: 'en', name: 'English' },
  { id: 'ja', label: 'ja', name: 'Japanese' },
  { id: 'ko', label: 'ko', name: 'Korean' },
  { id: 'es', label: 'es', name: 'Spanish' },
  { id: 'fr', label: 'fr', name: 'French' },
  { id: 'de', label: 'de', name: 'German' },
  { id: 'ru', label: 'ru', name: 'Russian' },
  { id: 'pt', label: 'pt', name: 'Portuguese' },
  { id: 'it', label: 'it', name: 'Italian' },
  { id: 'ar', label: 'ar', name: 'Arabic' },
  { id: 'hi', label: 'hi', name: 'Hindi' },
] as const;

export const TARGET_LANGUAGES: readonly LanguageOption[] = SOURCE_LANGUAGES.filter(
  (l) => l.id !== AUTO_DETECT_ID,
);
