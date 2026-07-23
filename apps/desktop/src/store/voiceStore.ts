import { create } from 'zustand';
import { registerPersistSlice, schedulePersist } from './settingsPersistence';

// ponytail: voiceStore owns voice-input settings (polish prompt + behavior
// toggles). Mirrors prefsStore / aiConfigStore slice-registration shape.

/** Default polish prompt — reuses the user's AI config (provider/model/key)
 *  via runRigChat; only the system prompt is voice-specific. */
export const DEFAULT_POLISH_PROMPT = `你是一个语音转文字的润色助手。下面是语音识别的原始文本,可能包含口语化的「嗯」「啊」、重复、断句不当等问题。请:
1. 去除口语化语气词和重复
2. 修正标点和断句
3. 保持原意,不要增加或删减信息
4. 只输出润色后的文本,不要任何解释

原始文本:
`;

export const PERSIST_KEYS_VOICE = [
  'polishPrompt',
  'autoPolish',
  'autoPaste',
  'saveSource',
  'sourceDir',
  'globalHotkey',
  'spokenLanguage',
] as const;

/** Spoken-language options for the VoiceSettings dropdown. Values are raw
 *  Apple locale identifiers passed straight to `voice_start(spokenLocale)` →
 *  `AppleSpeechAsr::new(Some(...))`. Bug #2 root cause: an unspecified locale
 *  fell back to the system default (often English on a Chinese-speaking user),
 *  so Chinese speech was routed to the English Apple Speech engine → empty
 *  transcript. Labels mirror `native_name_to_apple_locale` in
 *  `apple_speech.rs` so the visible set tracks the Rust mapping. */
export const SPOKEN_LANGUAGES: { label: string; value: string }[] = [
  { label: '简体中文', value: 'zh-CN' },
  { label: '繁體中文', value: 'zh-TW' },
  { label: 'English', value: 'en-US' },
  { label: '日本語', value: 'ja-JP' },
  { label: '한국어', value: 'ko-KR' },
  { label: 'Français', value: 'fr-FR' },
  { label: 'Deutsch', value: 'de-DE' },
  { label: 'Español', value: 'es-ES' },
  { label: 'Italiano', value: 'it-IT' },
  { label: 'Português', value: 'pt-BR' },
  { label: 'Русский', value: 'ru-RU' },
  { label: 'العربية', value: 'ar-SA' },
  { label: 'Tiếng Việt', value: 'vi-VN' },
  { label: 'ไทย', value: 'th-TH' },
  { label: 'हिन्दी', value: 'hi-IN' },
];

export interface VoiceState {
  polishPrompt: string;
  autoPolish: boolean;
  autoPaste: boolean;
  saveSource: boolean;
  sourceDir: string;
  globalHotkey: string;
  spokenLanguage: string;

  setPolishPrompt: (v: string) => void;
  setAutoPolish: (v: boolean) => void;
  setAutoPaste: (v: boolean) => void;
  setSaveSource: (v: boolean) => void;
  setSourceDir: (v: string) => void;
  setGlobalHotkey: (v: string) => void;
  setSpokenLanguage: (v: string) => void;

  hydrate: (blob: Record<string, unknown>) => void;
}

export const useVoiceStore = create<VoiceState>((set) => ({
  polishPrompt: DEFAULT_POLISH_PROMPT,
  autoPolish: true,
  autoPaste: false,
  saveSource: false,
  sourceDir: '.voice_input',
  globalHotkey: '',
  spokenLanguage: 'zh-CN',

  setPolishPrompt: (v) => { set({ polishPrompt: v }); schedulePersist(); },
  setAutoPolish: (v) => { set({ autoPolish: v }); schedulePersist(); },
  setAutoPaste: (v) => { set({ autoPaste: v }); schedulePersist(); },
  setSaveSource: (v) => { set({ saveSource: v }); schedulePersist(); },
  setSourceDir: (v) => { set({ sourceDir: v }); schedulePersist(); },
  setGlobalHotkey: (v) => { set({ globalHotkey: v }); schedulePersist(); },
  setSpokenLanguage: (v) => { set({ spokenLanguage: v }); schedulePersist(); },

  hydrate: (blob) => {
    const patch: Partial<VoiceState> = {};
    if (typeof blob.polishPrompt === 'string') patch.polishPrompt = blob.polishPrompt;
    if (typeof blob.autoPolish === 'boolean') patch.autoPolish = blob.autoPolish;
    if (typeof blob.autoPaste === 'boolean') patch.autoPaste = blob.autoPaste;
    if (typeof blob.saveSource === 'boolean') patch.saveSource = blob.saveSource;
    if (typeof blob.sourceDir === 'string') patch.sourceDir = blob.sourceDir;
    if (typeof blob.globalHotkey === 'string') patch.globalHotkey = blob.globalHotkey;
    if (typeof blob.spokenLanguage === 'string') patch.spokenLanguage = blob.spokenLanguage;
    if (Object.keys(patch).length > 0) set(patch);
  },
}));

registerPersistSlice({
  keys: PERSIST_KEYS_VOICE,
  getState: () => useVoiceStore.getState() as unknown as Record<string, unknown>,
  hydrate: (blob) => useVoiceStore.getState().hydrate(blob),
});
