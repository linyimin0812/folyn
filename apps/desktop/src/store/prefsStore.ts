import { create } from 'zustand';
import { registerPersistSlice, schedulePersist } from './settingsPersistence';
import {
  DEFAULT_SHORTCUTS,
  backfillDefaultShortcuts,
  type ShortcutItem,
} from './settingsStore';

// ponytail: DEFAULT_SHORTCUTS / ShortcutItem / backfillDefaultShortcuts stay
// owned by the legacy settingsStore in PR1 (consumers + existing tests still
// import them from there). PR2 will move the ownership here. Re-exporting now
// would create a confusing dual source of truth; the settingsStore re-export
// stays the single import site until the migration completes.
export { DEFAULT_SHORTCUTS, type ShortcutItem };

export const PERSIST_KEYS_PREFS = [
  'dailyNotesDir',
  'dailyNoteDateFormat',
  'fileTemplates',
  'shortcuts',
] as const;

export interface PrefsState {
  dailyNotesDir: string;
  dailyNoteDateFormat: string;
  fileTemplates: Record<string, string>;
  shortcuts: ShortcutItem[];

  setDailyNotesDir: (v: string) => void;
  setDailyNoteDateFormat: (v: string) => void;
  setFileTemplates: (v: Record<string, string>) => void;
  updateShortcut: (id: string, keys: string[]) => void;
  resetShortcuts: () => void;

  /** Load this store's slice from the persisted `settings:all` blob. */
  hydrate: (blob: Record<string, unknown>) => void;
}

const DEFAULT_FILE_TEMPLATES: Record<string, string> = {
  md: '# {{title}}\n\n',
  html: '<!DOCTYPE html>\n<html lang="zh">\n<head>\n  <meta charset="UTF-8">\n  <title>{{title}}</title>\n</head>\n<body>\n  \n</body>\n</html>',
  excalidraw: '{"type":"excalidraw","version":2,"elements":[],"appState":{"viewBackgroundColor":"#ffffff"}}',
};

export const usePrefsStore = create<PrefsState>((set) => ({
  dailyNotesDir: '__daily__',
  dailyNoteDateFormat: 'YYYY-MM-DD',
  fileTemplates: { ...DEFAULT_FILE_TEMPLATES },
  shortcuts: [...DEFAULT_SHORTCUTS],

  setDailyNotesDir: (v) => { set({ dailyNotesDir: v }); schedulePersist(); },
  setDailyNoteDateFormat: (v) => { set({ dailyNoteDateFormat: v }); schedulePersist(); },
  setFileTemplates: (v) => { set({ fileTemplates: v }); schedulePersist(); },

  updateShortcut: (id, keys) => {
    set((state) => ({
      shortcuts: state.shortcuts.map((s) => (s.id === id ? { ...s, keys } : s)),
    }));
    schedulePersist();
  },

  resetShortcuts: () => {
    set({ shortcuts: [...DEFAULT_SHORTCUTS] });
    schedulePersist();
  },

  hydrate: (blob) => {
    const patch: Partial<PrefsState> = {};
    if (blob.dailyNotesDir !== undefined) {
      // Migrate persisted dailyNotesDir from the old default to the built-in
      // name. Mirrors the legacy settingsStore hydrate path verbatim.
      let dir = blob.dailyNotesDir as string;
      if (dir === 'daily') dir = '__daily__';
      patch.dailyNotesDir = dir;
    }
    if (blob.dailyNoteDateFormat !== undefined) patch.dailyNoteDateFormat = blob.dailyNoteDateFormat as string;
    if (blob.fileTemplates !== undefined) patch.fileTemplates = blob.fileTemplates as Record<string, string>;
    if (blob.shortcuts !== undefined) {
      // Backfill: append any DEFAULT_SHORTCUTS entry whose id is missing from
      // the persisted array. Preserves user-customized keys on existing
      // entries — only missing ids are appended. Mirrors the legacy path.
      patch.shortcuts = backfillDefaultShortcuts(blob.shortcuts as ShortcutItem[]);
    }
    if (Object.keys(patch).length > 0) set(patch);
  },
}));

registerPersistSlice({
  keys: PERSIST_KEYS_PREFS,
  getState: () => usePrefsStore.getState() as unknown as Record<string, unknown>,
  hydrate: (blob) => usePrefsStore.getState().hydrate(blob),
});
