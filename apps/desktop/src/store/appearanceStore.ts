import { create } from 'zustand';
import { registerPersistSlice } from './settingsPersistence';
import type { CodeThemeId } from '@/editor/codeThemes';

// ponytail: appearanceStore owns Theme/LinkOpenMode type ownership and
// backfillBuiltinExcludePatterns (PR2 migrated from legacy settingsStore).

export type Theme = 'light' | 'dark' | 'system';
export type LinkOpenMode = 'external' | 'internal';

/** Built-in managed dirs that should always be hidden from the file panel. */
const BUILTIN_EXCLUDE_DIRS = [
  '__reports__',
  '__attachments__',
  '__study__',
];

/**
 * Per-dir backfill for persisted excludePatterns: append each missing built-in
 * managed dir without duplicating ones already present or dropping user-defined
 * patterns. Returns the joined newline-separated list.
 */
export function backfillBuiltinExcludePatterns(raw: string): string {
  const existing = raw
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const missing = BUILTIN_EXCLUDE_DIRS.filter((d) => !existing.includes(d));
  return [...existing, ...missing].join('\n');
}

const DEFAULT_EXCLUDE_PATTERNS =
  'node_modules\n.git\n.DS_Store\ndist\n.next\n.folyn-tmp\n__reports__\n__attachments__\n__study__';

export const PERSIST_KEYS_APPEARANCE = [
  'theme',
  'codeTheme',
  'fontFamily',
  'fontSize',
  'lineHeight',
  'showAiPanel',
  'showStatusBar',
  'showHiddenFiles',
  // ponytail: translation page flag. Default true so the ActivityBar icon
  // shows on first launch; user can hide it from Extensions settings.
  'enableTranslationPanel',
  'excludePatterns',
  'linkOpenMode',
  'vaultName',
  'showTrayIcon',
] as const;

export interface AppearanceState {
  theme: Theme;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  showAiPanel: boolean;
  showStatusBar: boolean;
  showHiddenFiles: boolean;
  enableTranslationPanel: boolean;
  excludePatterns: string;
  linkOpenMode: LinkOpenMode;
  vaultName: string;
  showTrayIcon: boolean;

  setTheme: (theme: Theme) => void;
  codeTheme: CodeThemeId;
  setCodeTheme: (id: CodeThemeId) => void;
  toggleTheme: () => void;
  setFontFamily: (family: string) => void;
  setFontSize: (size: number) => void;
  setLineHeight: (height: number) => void;
  setShowAiPanel: (v: boolean) => void;
  setShowStatusBar: (v: boolean) => void;
  setShowHiddenFiles: (v: boolean) => void;
  setEnableTranslationPanel: (v: boolean) => void;
  setExcludePatterns: (v: string) => void;
  setLinkOpenMode: (v: LinkOpenMode) => void;
  setVaultName: (name: string) => void;
  setShowTrayIcon: (v: boolean) => void;

  /** Load this store's slice from the persisted `settings:all` blob. */
  hydrate: (blob: Record<string, unknown>) => void;
}

export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  theme: 'light',
  codeTheme: 'auto',
  fontFamily: 'Sora',
  fontSize: 14,
  lineHeight: 1.7,
  showAiPanel: false,
  showStatusBar: true,
  showHiddenFiles: true,
  enableTranslationPanel: true,
  excludePatterns: DEFAULT_EXCLUDE_PATTERNS,
  linkOpenMode: 'external' as LinkOpenMode,
  vaultName: 'my-vault',
  showTrayIcon: false,

  setTheme: (theme) => {
    const actual = theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;
    document.documentElement.dataset.theme = actual;
    set({ theme });
    persist();
  },

  toggleTheme: () => {
    set((state) => {
      const newTheme = state.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = newTheme;
      return { theme: newTheme };
    });
    persist();
  },

  setCodeTheme: (id) => {
    document.documentElement.dataset.codeTheme = id;
    set({ codeTheme: id });
    persist();
  },

  setFontFamily: (family) => {
    document.documentElement.style.setProperty('--font-ui', `'${family}', sans-serif`);
    set({ fontFamily: family });
    persist();
  },

  setFontSize: (size) => {
    document.documentElement.style.setProperty('--ui-font-size', `${size}px`);
    set({ fontSize: size });
    persist();
  },

  setLineHeight: (height) => {
    set({ lineHeight: height });
    persist();
  },

  setShowAiPanel: (v) => { set({ showAiPanel: v }); persist(); },
  setShowStatusBar: (v) => { set({ showStatusBar: v }); persist(); },
  setShowHiddenFiles: (v) => { set({ showHiddenFiles: v }); persist(); },
  setEnableTranslationPanel: (v) => { set({ enableTranslationPanel: v }); persist(); },
  setExcludePatterns: (v) => { set({ excludePatterns: v }); persist(); },
  setLinkOpenMode: (v) => { set({ linkOpenMode: v }); persist(); },
  setVaultName: (name) => { set({ vaultName: name }); persist(); },
  setShowTrayIcon: (v) => { set({ showTrayIcon: v }); persist(); },

  hydrate: (blob) => {
    const patch: Partial<AppearanceState> = {};
    if (blob.theme !== undefined) patch.theme = blob.theme as Theme;
    if (blob.codeTheme !== undefined) patch.codeTheme = blob.codeTheme as CodeThemeId;
    if (blob.fontFamily !== undefined) patch.fontFamily = blob.fontFamily as string;
    if (blob.fontSize !== undefined) patch.fontSize = blob.fontSize as number;
    if (blob.lineHeight !== undefined) patch.lineHeight = blob.lineHeight as number;
    if (blob.showAiPanel !== undefined) patch.showAiPanel = blob.showAiPanel as boolean;
    if (blob.showStatusBar !== undefined) patch.showStatusBar = blob.showStatusBar as boolean;
    if (blob.showHiddenFiles !== undefined) patch.showHiddenFiles = blob.showHiddenFiles as boolean;
    if (blob.enableTranslationPanel !== undefined) patch.enableTranslationPanel = blob.enableTranslationPanel as boolean;
    if (blob.linkOpenMode !== undefined) patch.linkOpenMode = blob.linkOpenMode as LinkOpenMode;
    if (blob.vaultName !== undefined) patch.vaultName = blob.vaultName as string;
    if (blob.showTrayIcon !== undefined) patch.showTrayIcon = blob.showTrayIcon as boolean;
    if (blob.excludePatterns !== undefined) {
      // Per-dir backfill: append each missing built-in managed dir without
      // duplicating ones already present. Mirrors the legacy settingsStore
      // hydrate path verbatim.
      patch.excludePatterns = backfillBuiltinExcludePatterns(blob.excludePatterns as string);
    }
    if (Object.keys(patch).length > 0) {
      set(patch);
      // Apply theme + font side-effects to match the legacy hydrate path.
      const theme = patch.theme ?? get().theme;
      const actual = theme === 'system'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : theme;
      document.documentElement.dataset.theme = actual;
      const codeTheme = patch.codeTheme ?? get().codeTheme;
      document.documentElement.dataset.codeTheme = codeTheme;
      const fontFamily = patch.fontFamily ?? get().fontFamily;
      document.documentElement.style.setProperty('--font-ui', `'${fontFamily}', sans-serif`);
      const fontSize = patch.fontSize ?? get().fontSize;
      document.documentElement.style.setProperty('--ui-font-size', `${fontSize}px`);
    }
  },
}));

// Re-exported for the persistence loader / future consumers. Kept here so the
// backfill behavior stays co-located with the field it guards.
export { BUILTIN_EXCLUDE_DIRS };

const persist = registerPersistSlice({
  name: 'appearance',
  keys: PERSIST_KEYS_APPEARANCE,
  getState: () => useAppearanceStore.getState() as unknown as Record<string, unknown>,
  hydrate: (blob) => useAppearanceStore.getState().hydrate(blob),
});
