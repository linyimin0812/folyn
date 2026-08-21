/**
 * Language list for the translation panel. Ponytail: hardcoded mainstream
 * set — no locale data dependency. Add an entry here when a user asks for a
 * language not covered.
 */
export interface LanguageOption {
  /** Stable id sent to the LLM prompt. */
  id: string;
  /** Display label (in the user's locale — English here for simplicity;
   *  the dropdown is small enough that localized labels are out of scope). */
  label: string;
}

/** Special id for "auto-detect source language". Only valid as a source. */
export const AUTO_DETECT_ID = 'auto';

export const SOURCE_LANGUAGES: readonly LanguageOption[] = [
  { id: AUTO_DETECT_ID, label: 'Auto Detect' },
  { id: 'zh', label: 'Chinese' },
  { id: 'en', label: 'English' },
  { id: 'ja', label: 'Japanese' },
  { id: 'ko', label: 'Korean' },
  { id: 'es', label: 'Spanish' },
  { id: 'fr', label: 'French' },
  { id: 'de', label: 'German' },
  { id: 'ru', label: 'Russian' },
  { id: 'pt', label: 'Portuguese' },
  { id: 'it', label: 'Italian' },
  { id: 'ar', label: 'Arabic' },
  { id: 'hi', label: 'Hindi' },
] as const;

export const TARGET_LANGUAGES: readonly LanguageOption[] = SOURCE_LANGUAGES.filter(
  (l) => l.id !== AUTO_DETECT_ID,
);
