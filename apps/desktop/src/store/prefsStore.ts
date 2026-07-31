import { create } from 'zustand';
import { registerPersistSlice } from './settingsPersistence';

// ponytail: prefsStore owns ShortcutItem / DEFAULT_SHORTCUTS /
// backfillDefaultShortcuts (PR2 migrated from legacy settingsStore).

export interface ShortcutItem {
  id: string;
  name: string;
  keys: string[];
}

export const DEFAULT_SHORTCUTS: ShortcutItem[] = [
  { id: 'save', name: '保存文档', keys: ['⌘', 'S'] },
  { id: 'bold', name: '加粗', keys: ['⌘', 'B'] },
  { id: 'italic', name: '斜体', keys: ['⌘', 'I'] },
  { id: 'strikethrough', name: '删除线', keys: ['⌘', 'Shift', 'S'] },
  { id: 'code', name: '行内代码', keys: ['⌘', 'E'] },
  { id: 'link', name: '插入链接', keys: ['⌘', 'K'] },
  { id: 'dailyNote', name: '今日笔记', keys: ['⌘', 'D'] },
  // GLOBAL shortcut — registered with the OS via `pet_panel_set_shortcut` so
  // it fires even when Quill is not focused. The other entries above are
  // in-editor keybindings (consumed by EditorView's keymap, never registered
  // with the OS). Only this entry needs an accelerator conversion + Rust
  // re-registration on rebind (see SettingsPage.tsx ShortcutEditor +
  // PetApp.tsx mount effect).
  { id: 'togglePetPanel', name: '唤起桌宠面板', keys: ['⌘', 'Shift', 'Q'] },
];

/**
 * Backfill persisted `shortcuts` with any DEFAULT_SHORTCUTS entries that are
 * missing (by id). Existing entries' customized `keys` are preserved — only
 * missing ids are appended from the defaults. This runs at settings-load
 * time so a user who persisted a `shortcuts` array before a new default was
 * added (e.g. `togglePetPanel`) sees the new entry appear automatically
 * without resetting their other rebindings. Mirrors the
 * `backfillBuiltinExcludePatterns` pattern.
 */
export function backfillDefaultShortcuts(saved: ShortcutItem[]): ShortcutItem[] {
  if (!Array.isArray(saved) || saved.length === 0) {
    return [...DEFAULT_SHORTCUTS];
  }
  const savedIds = new Set(saved.map((s) => s.id));
  const missing = DEFAULT_SHORTCUTS.filter((d) => !savedIds.has(d.id));
  if (missing.length === 0) return saved;
  return [...saved, ...missing];
}

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

  setDailyNotesDir: (v) => { set({ dailyNotesDir: v }); persist(); },
  setDailyNoteDateFormat: (v) => { set({ dailyNoteDateFormat: v }); persist(); },
  setFileTemplates: (v) => { set({ fileTemplates: v }); persist(); },

  updateShortcut: (id, keys) => {
    set((state) => ({
      shortcuts: state.shortcuts.map((s) => (s.id === id ? { ...s, keys } : s)),
    }));
    persist();
  },

  resetShortcuts: () => {
    set({ shortcuts: [...DEFAULT_SHORTCUTS] });
    persist();
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

const persist = registerPersistSlice({
  name: 'prefs',
  keys: PERSIST_KEYS_PREFS,
  getState: () => usePrefsStore.getState() as unknown as Record<string, unknown>,
  hydrate: (blob) => usePrefsStore.getState().hydrate(blob),
});
