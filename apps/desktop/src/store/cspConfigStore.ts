import { create } from 'zustand';
import { registerPersistSlice } from './settingsPersistence';

/**
 * CSP config store — the persisted source of truth for the settings tab.
 * The policy itself is applied at runtime via `utils/csp.ts` (a single
 * `<meta http-equiv="Content-Security-Policy">` tag); this store only owns
 * *what* the user configured: "allow all URLs" vs a custom allow-list.
 *
 * Defaults mirror the previous static CSP in tauri.conf.json so existing
 * behavior (jsdelivr / esm.sh / diagrams.net / fonts / plantuml / quickchart)
 * is preserved out of the box.
 */

export type CspMode = 'all' | 'custom';

export const DEFAULT_ALLOWED_URLS: string[] = [
  'https://cdn.jsdelivr.net',
  'https://esm.sh',
  'https://embed.diagrams.net',
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
  'https://www.plantuml.com',
  'https://quickchart.io',
];

export const PERSIST_KEYS_CSP = ['mode', 'allowedUrls'] as const;

export interface CspConfigState {
  /** 'all' → allow any network source (`*`); 'custom' → only allowedUrls. */
  mode: CspMode;
  allowedUrls: string[];

  setMode: (mode: CspMode) => void;
  addUrl: (url: string) => void;
  removeUrl: (url: string) => void;
  setUrls: (urls: string[]) => void;
  reset: () => void;

  /** Load this store's slice from the persisted `settings:all` blob. */
  hydrate: (blob: Record<string, unknown>) => void;
}

export const useCspConfigStore = create<CspConfigState>((set) => ({
  mode: 'custom',
  allowedUrls: [...DEFAULT_ALLOWED_URLS],

  setMode: (mode) => {
    set({ mode });
    persist();
  },

  addUrl: (url) => {
    const s = url.trim();
    if (!s) return;
    set((state) =>
      state.allowedUrls.includes(s) ? state : { allowedUrls: [...state.allowedUrls, s] },
    );
    persist();
  },

  removeUrl: (url) => {
    set((state) => ({ allowedUrls: state.allowedUrls.filter((u) => u !== url) }));
    persist();
  },

  setUrls: (urls) => {
    set({ allowedUrls: urls });
    persist();
  },

  reset: () => {
    set({ mode: 'custom', allowedUrls: [...DEFAULT_ALLOWED_URLS] });
    persist();
  },

  hydrate: (blob) => {
    const patch: Partial<CspConfigState> = {};
    if (blob.mode === 'all' || blob.mode === 'custom') patch.mode = blob.mode;
    if (Array.isArray(blob.allowedUrls)) {
      patch.allowedUrls = (blob.allowedUrls as unknown[]).filter(
        (u): u is string => typeof u === 'string' && u.trim() !== '',
      );
    }
    if (Object.keys(patch).length > 0) set(patch);
  },
}));

const persist = registerPersistSlice({
  name: 'csp',
  keys: PERSIST_KEYS_CSP,
  getState: () => useCspConfigStore.getState() as unknown as Record<string, unknown>,
  hydrate: (blob) => useCspConfigStore.getState().hydrate(blob),
});
