import { create } from 'zustand';
import { registerPersistSlice } from './settingsPersistence';

// ponytail: appearanceStore owns Theme/LinkOpenMode type ownership and
// backfillBuiltinExcludePatterns (PR2 migrated from legacy settingsStore).

export type Theme = 'light' | 'dark' | 'system';
export type LinkOpenMode = 'external' | 'internal';

/** Built-in managed dirs that should always be hidden from the file panel. */
const BUILTIN_EXCLUDE_DIRS = [
  '__wiki__',
  '__clips__',
  '__reports__',
  '__daily__',
  '__study__',
  '__schedule__',
  '__analyze__',
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
  'node_modules\n.git\n.DS_Store\ndist\n.next\n.quill-tmp\n__wiki__\n__clips__\n__reports__\n__daily__\n__study__\n__schedule__\n__analyze__';

export const PERSIST_KEYS_APPEARANCE = [
  'theme',
  'fontSize',
  'lineHeight',
  'showAiPanel',
  'showStatusBar',
  'showHiddenFiles',
  'enableWikiPanel',
  'enableClipsPanel',
  'enableAnalyzePanel',
  'enabledAtWiki',
  'enabledAtClips',
  'enabledAtAnalyze',
  'excludePatterns',
  'linkOpenMode',
  'vaultName',
  'showTrayIcon',
] as const;

export interface AppearanceState {
  theme: Theme;
  fontSize: number;
  lineHeight: number;
  showAiPanel: boolean;
  showStatusBar: boolean;
  showHiddenFiles: boolean;
  enableWikiPanel: boolean;
  enableClipsPanel: boolean;
  enableAnalyzePanel: boolean;
  /** Timestamp (Date.now()) when the corresponding panel was first enabled.
   * Used by registerBuiltinPanels to sort Wiki/Clips/Analyze by enable time
   * ascending in the ActivityBar (Files always stays first via order=0).
   * Undefined when the panel is disabled or was enabled before this field
   * was introduced (old users fall back to base order 10/20/30). */
  enabledAtWiki?: number;
  enabledAtClips?: number;
  enabledAtAnalyze?: number;
  excludePatterns: string;
  linkOpenMode: LinkOpenMode;
  vaultName: string;
  showTrayIcon: boolean;

  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setFontSize: (size: number) => void;
  setLineHeight: (height: number) => void;
  setShowAiPanel: (v: boolean) => void;
  setShowStatusBar: (v: boolean) => void;
  setShowHiddenFiles: (v: boolean) => void;
  setEnableWikiPanel: (v: boolean) => void;
  setEnableClipsPanel: (v: boolean) => void;
  setEnableAnalyzePanel: (v: boolean) => void;
  setExcludePatterns: (v: string) => void;
  setLinkOpenMode: (v: LinkOpenMode) => void;
  setVaultName: (name: string) => void;
  setShowTrayIcon: (v: boolean) => void;

  /** Load this store's slice from the persisted `settings:all` blob. */
  hydrate: (blob: Record<string, unknown>) => void;
}

export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  theme: 'light',
  fontSize: 14,
  lineHeight: 1.7,
  showAiPanel: true,
  showStatusBar: true,
  showHiddenFiles: true,
  enableWikiPanel: false,
  enableClipsPanel: false,
  enableAnalyzePanel: false,
  enabledAtWiki: undefined,
  enabledAtClips: undefined,
  enabledAtAnalyze: undefined,
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
  setEnableWikiPanel: (v) => {
    set((s) => ({
      enableWikiPanel: v,
      // ponytail: stamp enabledAt on the false→true transition; clear on
      // true→false so re-enabling later produces a fresh timestamp (panel
      // re-surfaces at the end of the ActivityBar, matching user mental model
      // of "I just turned this back on"). Bypassed by hydrate / direct
      // setState callers (tests / migration) — they own the timestamp.
      enabledAtWiki: v ? (s.enableWikiPanel ? s.enabledAtWiki : Date.now()) : undefined,
    }));
    persist();
  },
  setEnableClipsPanel: (v) => {
    set((s) => ({
      enableClipsPanel: v,
      enabledAtClips: v ? (s.enableClipsPanel ? s.enabledAtClips : Date.now()) : undefined,
    }));
    persist();
  },
  setEnableAnalyzePanel: (v) => {
    set((s) => ({
      enableAnalyzePanel: v,
      enabledAtAnalyze: v ? (s.enableAnalyzePanel ? s.enabledAtAnalyze : Date.now()) : undefined,
    }));
    persist();
  },
  setExcludePatterns: (v) => { set({ excludePatterns: v }); persist(); },
  setLinkOpenMode: (v) => { set({ linkOpenMode: v }); persist(); },
  setVaultName: (name) => { set({ vaultName: name }); persist(); },
  setShowTrayIcon: (v) => { set({ showTrayIcon: v }); persist(); },

  hydrate: (blob) => {
    const patch: Partial<AppearanceState> = {};
    if (blob.theme !== undefined) patch.theme = blob.theme as Theme;
    if (blob.fontSize !== undefined) patch.fontSize = blob.fontSize as number;
    if (blob.lineHeight !== undefined) patch.lineHeight = blob.lineHeight as number;
    if (blob.showAiPanel !== undefined) patch.showAiPanel = blob.showAiPanel as boolean;
    if (blob.showStatusBar !== undefined) patch.showStatusBar = blob.showStatusBar as boolean;
    if (blob.showHiddenFiles !== undefined) patch.showHiddenFiles = blob.showHiddenFiles as boolean;
    if (blob.enableWikiPanel !== undefined) patch.enableWikiPanel = blob.enableWikiPanel as boolean;
    if (blob.enableClipsPanel !== undefined) patch.enableClipsPanel = blob.enableClipsPanel as boolean;
    if (blob.enableAnalyzePanel !== undefined) patch.enableAnalyzePanel = blob.enableAnalyzePanel as boolean;
    if (blob.enabledAtWiki !== undefined) patch.enabledAtWiki = blob.enabledAtWiki as number;
    if (blob.enabledAtClips !== undefined) patch.enabledAtClips = blob.enabledAtClips as number;
    if (blob.enabledAtAnalyze !== undefined) patch.enabledAtAnalyze = blob.enabledAtAnalyze as number;
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
      // Apply theme + font-size side-effects to match the legacy hydrate path.
      const theme = patch.theme ?? get().theme;
      const actual = theme === 'system'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : theme;
      document.documentElement.dataset.theme = actual;
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
