import { create } from 'zustand';
import { registerPersistSlice } from './settingsPersistence';
import type { Pair } from '@/components/ai/PairSelector';

// ponytail: translation panel state persisted to its own slice file
// (~/.mochi/storage/translation.json) via the same registerPersistSlice
// pattern every other store uses. Replaces the prior module-level cache +
// localStorage experiment — user wants config-file parity with other prefs.

/** Default source language id; mirrors AUTO_DETECT_ID in languages.ts.
 *  Inlined here to avoid a store → component-dir import. */
const AUTO_DETECT_ID = 'auto';

export const PERSIST_KEYS_TRANSLATION = [
  'pair',
  'source',
  'target',
  'input',
  'result',
  'preview',
] as const;

export interface TranslationState {
  pair: Pair | null;
  source: string;
  target: string;
  input: string;
  result: string;
  preview: boolean;

  setPair: (p: Pair | null) => void;
  setSource: (s: string) => void;
  setTarget: (t: string) => void;
  setInput: (i: string) => void;
  setResult: (r: string | ((prev: string) => string)) => void;
  setPreview: (p: boolean) => void;

  /** Load this store's slice from the persisted `settings:all` blob. */
  hydrate: (blob: Record<string, unknown>) => void;
}

export const useTranslationStore = create<TranslationState>((set) => ({
  pair: null,
  source: AUTO_DETECT_ID,
  target: 'en',
  input: '',
  result: '',
  preview: false,

  setPair: (p) => { set({ pair: p }); persist(); },
  setSource: (s) => { set({ source: s }); persist(); },
  setTarget: (t) => { set({ target: t }); persist(); },
  setInput: (i) => { set({ input: i }); persist(); },
  setResult: (r) => {
    set((state) => ({ result: typeof r === 'function' ? r(state.result) : r }));
    persist();
  },
  setPreview: (p) => { set({ preview: p }); persist(); },

  hydrate: (blob) => {
    const patch: Partial<TranslationState> = {};
    if (blob.pair !== undefined) patch.pair = (blob.pair as Pair | null) ?? null;
    if (blob.source !== undefined) patch.source = blob.source as string;
    if (blob.target !== undefined) patch.target = blob.target as string;
    if (blob.input !== undefined) patch.input = blob.input as string;
    if (blob.result !== undefined) patch.result = blob.result as string;
    if (blob.preview !== undefined) patch.preview = blob.preview as boolean;
    if (Object.keys(patch).length > 0) set(patch);
  },
}));

const persist = registerPersistSlice({
  name: 'translation',
  keys: PERSIST_KEYS_TRANSLATION,
  getState: () => useTranslationStore.getState() as unknown as Record<string, unknown>,
  hydrate: (blob) => useTranslationStore.getState().hydrate(blob),
});
