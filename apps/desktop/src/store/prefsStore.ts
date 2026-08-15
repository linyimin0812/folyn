import { create } from 'zustand';
import { registerPersistSlice } from './settingsPersistence';
import { isMacPlatform } from '@/utils/shellSidecar';

// ponytail: prefsStore owns ShortcutItem / DEFAULT_SHORTCUTS /
// backfillDefaultShortcuts (PR2 migrated from legacy settingsStore).

export interface ShortcutItem {
  id: string;
  name: string;
  keys: string[];
}

/**
 * Build the default shortcut list for a given primary modifier symbol.
 *
 * `primaryMod` is `⌘` (Command) on macOS and `Ctrl` on Windows/Linux.
 * Windows has no Command key, so a hardcoded `⌘` default would render a
 * meaningless glyph in the settings UI and emit an invalid `Cmd+…`
 * accelerator to the OS-global shortcut layer (Windows uses `Ctrl`/`Super`).
 * Kept pure so tests can assert both platform shapes deterministically.
 */
export function buildDefaultShortcuts(primaryMod: '⌘' | 'Ctrl'): ShortcutItem[] {
  return [
    { id: 'save', name: '保存文档', keys: [primaryMod, 'S'] },
    { id: 'bold', name: '加粗', keys: [primaryMod, 'B'] },
    { id: 'italic', name: '斜体', keys: [primaryMod, 'I'] },
    { id: 'strikethrough', name: '删除线', keys: [primaryMod, 'Shift', 'S'] },
    { id: 'code', name: '行内代码', keys: [primaryMod, 'E'] },
    { id: 'link', name: '插入链接', keys: [primaryMod, 'K'] },
    { id: 'dailyNote', name: '今日笔记', keys: [primaryMod, 'D'] },
    // GLOBAL shortcut — registered with the OS via `pet_panel_set_shortcut` so
    // it fires even when Quill is not focused. The other entries above are
    // in-editor keybindings (consumed by EditorView's keymap, never registered
    // with the OS). Only this entry needs an accelerator conversion + Rust
    // re-registration on rebind (see SettingsPage.tsx ShortcutEditor +
    // PetApp.tsx mount effect).
    { id: 'togglePetPanel', name: '唤起桌宠面板', keys: [primaryMod, 'Shift', 'Q'] },
  ];
}

export const DEFAULT_SHORTCUTS: ShortcutItem[] = buildDefaultShortcuts(
  isMacPlatform() ? '⌘' : 'Ctrl',
);

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

export const DEFAULT_FILE_TEMPLATES: Record<string, string> = {
  md: '# {{title}}\n\n',
  html: '<!DOCTYPE html>\n<html lang="zh">\n<head>\n  <meta charset="UTF-8">\n  <title>{{title}}</title>\n</head>\n<body>\n  \n</body>\n</html>',
  excalidraw: '{"type":"excalidraw","version":2,"elements":[],"appState":{"viewBackgroundColor":"#ffffff"}}',
  // Diagram formats — keys match the primary extension of the file-type
  // handlers (plantuml → puml, graphviz → gv, dbml → dbml) so the "new file"
  // flow seeds starter content for these types.
  puml: '@startuml\nAlice->Bob : Hello\nreturn ok\n@enduml',
  gv: 'digraph G {Hello->World}',
  mermaid: 'graph TD\n  A[开始] --> B{判断}\n  B -->|是| C[结果1]\n  B -->|否| D[结果2]',
  dbml: '// {{title}}\nTable users {\n  id integer [pk, increment]\n  name varchar(255)\n  created_at timestamp\n}',
  mmap: '# {{title}}\n## Child\n### Grandchild\n',
};

/**
 * Backfill persisted `fileTemplates` with any DEFAULT_FILE_TEMPLATES entries
 * that are missing (by extension key). Existing entries — including
 * user-customized content or intentionally cleared templates — are preserved;
 * only keys absent from the persisted map are added from the defaults. Runs
 * at settings-load time so a user who persisted `fileTemplates` before a new
 * default (e.g. `puml`/`gv`/`dbml`) was added sees the new entry appear
 * automatically without resetting their other templates. Mirrors the
 * `backfillDefaultShortcuts` pattern.
 */
export function backfillDefaultFileTemplates(saved: Record<string, string>): Record<string, string> {
  const result = { ...(saved ?? {}) };
  for (const [ext, content] of Object.entries(DEFAULT_FILE_TEMPLATES)) {
    if (result[ext] === undefined) result[ext] = content;
  }
  return result;
}

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
    if (blob.fileTemplates !== undefined) {
      // Backfill: append any DEFAULT_FILE_TEMPLATES entry missing from the
      // persisted map. Existing entries (including user-customized or
      // intentionally cleared content) are preserved — only missing extension
      // keys are added from the defaults. Mirrors the backfillDefaultShortcuts
      // path.
      patch.fileTemplates = backfillDefaultFileTemplates(blob.fileTemplates as Record<string, string>);
    }
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
