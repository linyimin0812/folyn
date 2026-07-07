import { create } from 'zustand';
import { storageClient } from '@/utils/storageClient';
import { DEFAULT_BOARD_COLUMNS, COLUMN_COLOR_PALETTE, type BoardColumnDef } from '@/features/schedule/types';

export type Theme = 'light' | 'dark' | 'system';
export type AppPage = 'editor' | 'vault' | 'settings' | 'schedule' | 'study';
export type SettingsTab = 'appearance' | 'editor' | 'shortcuts' | 'vault' | 'sync' | 'ai' | 'templates' | 'skills' | 'about';
export type LinkOpenMode = 'external' | 'internal';

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

interface SettingsState {
  theme: Theme;
  currentPage: AppPage;
  settingsTab: SettingsTab;
  vaultName: string;

  // Appearance
  fontSize: number;
  lineHeight: number;
  showAiPanel: boolean;
  showStatusBar: boolean;
  showHiddenFiles: boolean;
  enableWikiPanel: boolean;
  enableClipsPanel: boolean;
  enableAnalyzePanel: boolean;
  enableDailyPanel: boolean;
  excludePatterns: string;

  // Editor
  editorFont: string;
  editorFontSize: number;
  tabSize: number;
  wrapColumn: number;
  showLineNumbers: boolean;
  syntaxHighlight: boolean;
  autoSave: boolean;
  spellCheck: boolean;

  // Links
  linkOpenMode: LinkOpenMode;

  // Vault
  vaultPath: string;
  imagePath: string;
  docExtension: string;
  watchFileChanges: boolean;
  trashOnDelete: boolean;

  // Sync
  syncMethod: string;
  syncEndpoint: string;
  syncAccessKey: string;
  syncSecretKey: string;
  syncBucket: string;
  autoSync: boolean;
  e2eEncrypt: boolean;

  // AI CLI
  cliAdapter: string;
  cliPath: string;

  // Daily Notes
  dailyNotesDir: string;
  dailyNoteDateFormat: string;

  // File Templates: extension -> template content
  fileTemplates: Record<string, string>;

  // Shortcuts
  shortcuts: ShortcutItem[];

  // Schedule Workbench: 自定义看板列
  boardColumns: BoardColumnDef[];

  // Desktop Pet Mode (macOS MVP). `petModeEnabled` mirrors the pet window's
  // visibility; `petPositionX/Y` persist the last dragged position so the
  // pet reappears where the user left it. `-1` => "no saved position yet,
  // default to a sensible corner".
  petModeEnabled: boolean;
  petPositionX: number;
  petPositionY: number;

  // Pet quick-action panel window (`pet-panel`). Position/size are persisted
  // across restarts so the panel reappears where the user last dragged/resized
  // it instead of snapping back to the pet's default corner. `-1` means "no
  // saved value yet → fall back to `computePanelPosition` next to the pet".
  petPanelX: number;
  petPanelY: number;
  petPanelWidth: number;
  petPanelHeight: number;
  // Monotonically-increasing version of the default panel size. Bump
  // `PET_PANEL_SIZE_VERSION` in `petPosition.ts` whenever the default
  // changes — the open gesture / mount-restore ignore a saved size whose
  // persisted version doesn't match, so a default-size bump auto-applies
  // on next open instead of being shadowed by the old default. `0` means
  // "unset / pre-versioning" so any existing user migrates on next open.
  petPanelSizeVersion: number;

  // Storage-version key for the pet/panel position fields. The pre-fix code
  // saved positions in PHYSICAL pixels (mixed with logical-point work-area
  // math), which on Retina placed the pet at screen-center on launch. The fix
  // stores positions in LOGICAL points; `petPosVersion` gates a one-shot
  // migration that discards the old physical-pixel values (resets to -1) so
  // every upgrader re-runs the default-position branch. Bump to invalidate
  // any future position-unit change.
  petPosVersion: number;

  // Actions
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setCurrentPage: (page: AppPage) => void;
  setSettingsTab: (tab: SettingsTab) => void;
  setFontSize: (size: number) => void;
  setLineHeight: (height: number) => void;
  setVaultName: (name: string) => void;
  updateSettings: (partial: Partial<SettingsState>) => void;
  updateShortcut: (id: string, keys: string[]) => void;
  resetShortcuts: () => void;
  addBoardColumn: (name: string) => string;
  renameBoardColumn: (id: string, name: string) => void;
  reorderBoardColumns: (fromId: string, toId: string) => void;
  setBoardColumns: (columns: BoardColumnDef[]) => void;
  setPetModeEnabled: (enabled: boolean) => void;
  setPetPosition: (x: number, y: number) => void;
  setPetPanelPosition: (x: number, y: number) => void;
  setPetPanelSize: (width: number, height: number) => void;
  setPetPanelSizeVersion: (version: number) => void;
}

const SETTINGS_STORAGE_KEY = 'settings:all';

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

/** Debounced persist to avoid excessive API calls */
let persistTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedPersist(state: Partial<SettingsState>) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    // Extract only serializable settings (exclude functions and runtime state)
    const { theme, fontSize, lineHeight, showAiPanel, showStatusBar, showHiddenFiles,
      enableWikiPanel, enableClipsPanel, enableAnalyzePanel, enableDailyPanel,
      excludePatterns,
      editorFont, editorFontSize, tabSize, wrapColumn, showLineNumbers,
      syntaxHighlight, autoSave, spellCheck, linkOpenMode, vaultPath, imagePath, docExtension,
      watchFileChanges, trashOnDelete, syncMethod, syncEndpoint, syncAccessKey,
      syncSecretKey, syncBucket, autoSync, e2eEncrypt, cliAdapter, cliPath,
      vaultName, shortcuts, dailyNotesDir, dailyNoteDateFormat, fileTemplates, boardColumns,
      petModeEnabled, petPositionX, petPositionY,
      petPanelX, petPanelY, petPanelWidth, petPanelHeight,
      petPanelSizeVersion, petPosVersion } = state as SettingsState;
    storageClient.set(SETTINGS_STORAGE_KEY, {
      theme, fontSize, lineHeight, showAiPanel, showStatusBar, showHiddenFiles,
      enableWikiPanel, enableClipsPanel, enableAnalyzePanel, enableDailyPanel,
      excludePatterns,
      editorFont, editorFontSize, tabSize, wrapColumn, showLineNumbers,
      syntaxHighlight, autoSave, spellCheck, linkOpenMode, vaultPath, imagePath, docExtension,
      watchFileChanges, trashOnDelete, syncMethod, syncEndpoint, syncAccessKey,
      syncSecretKey, syncBucket, autoSync, e2eEncrypt, cliAdapter, cliPath,
      vaultName, shortcuts, dailyNotesDir, dailyNoteDateFormat, fileTemplates, boardColumns,
      petModeEnabled, petPositionX, petPositionY,
      petPanelX, petPanelY, petPanelWidth, petPanelHeight,
      petPanelSizeVersion, petPosVersion,
    });
  }, 300);
}

export const useSettingsStore = create<SettingsState>((set) => ({
  theme: 'light',
  currentPage: 'editor',
  settingsTab: 'appearance',
  vaultName: 'my-vault',

  // Appearance
  fontSize: 14,
  lineHeight: 1.7,
  showAiPanel: true,
  showStatusBar: true,
  showHiddenFiles: true,
  enableWikiPanel: true,
  enableClipsPanel: true,
  enableAnalyzePanel: true,
  enableDailyPanel: true,
  excludePatterns: 'node_modules\n.git\n.DS_Store\ndist\n.next\n.quill-tmp\n__wiki__\n__clips__\n__reports__\n__daily__\n__study__\n__schedule__\n__analyze__',

  // Editor
  editorFont: 'DM Mono',
  editorFontSize: 13,
  tabSize: 4,
  wrapColumn: 80,
  showLineNumbers: true,
  syntaxHighlight: true,
  autoSave: true,
  spellCheck: false,

  // Links
  linkOpenMode: 'external' as LinkOpenMode,

  // Vault
  vaultPath: '~/Documents/quill/my-notes',
  imagePath: 'assets/images/',
  docExtension: '.md',
  watchFileChanges: true,
  trashOnDelete: true,

  // Sync
  syncMethod: 'S3 兼容（R2 / MinIO）',
  syncEndpoint: '',
  syncAccessKey: '',
  syncSecretKey: '',
  syncBucket: '',
  autoSync: true,
  e2eEncrypt: false,

  // AI CLI
  cliAdapter: 'claude',
  cliPath: 'claude',

  // Daily Notes
  dailyNotesDir: '__daily__',
  dailyNoteDateFormat: 'YYYY-MM-DD',

  // File Templates
  fileTemplates: {
    md: '# {{title}}\n\n',
    html: '<!DOCTYPE html>\n<html lang="zh">\n<head>\n  <meta charset="UTF-8">\n  <title>{{title}}</title>\n</head>\n<body>\n  \n</body>\n</html>',
    excalidraw: '{"type":"excalidraw","version":2,"elements":[],"appState":{"viewBackgroundColor":"#ffffff"}}',
  } as Record<string, string>,

  // Shortcuts
  shortcuts: [...DEFAULT_SHORTCUTS],

  // Schedule Workbench: 看板列（默认 4 列）
  boardColumns: DEFAULT_BOARD_COLUMNS.map((c) => ({ ...c })),

  // Desktop Pet Mode — default off; position -1 means "no saved position".
  petModeEnabled: false,
  petPositionX: -1,
  petPositionY: -1,

  // Pet quick-action panel — -1 means "no saved pos/size yet, fall back to
  // `computePanelPosition` next to the pet on first open".
  petPanelX: -1,
  petPanelY: -1,
  petPanelWidth: -1,
  petPanelHeight: -1,
  // 0 = pre-versioning / unset. Any existing user with version 0 mismatches
  // the current `PET_PANEL_SIZE_VERSION` constant and gets migrated to the
  // new default on next open (one-time flip).
  petPanelSizeVersion: 0,

  // Position-unit migration version. 0 = pre-fix (positions saved as physical
  // px, which on Retina placed the pet at screen-center on launch). Bumped to
  // 1 once positions are stored as logical points; the hydrate path discards
  // pre-1 saved positions so the default-position branch re-runs.
  petPosVersion: 1,

  setTheme: (theme) => {
    const actual = theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;
    document.documentElement.dataset.theme = actual;
    set({ theme });
    debouncedPersist(useSettingsStore.getState());
  },

  toggleTheme: () =>
    set((state) => {
      const newTheme = state.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = newTheme;
      debouncedPersist({ ...state, theme: newTheme });
      return { theme: newTheme };
    }),

  setCurrentPage: (page) => set({ currentPage: page }),
  setSettingsTab: (tab) => set({ settingsTab: tab }),
  setFontSize: (size) => {
    document.documentElement.style.setProperty('--ui-font-size', `${size}px`);
    set({ fontSize: size });
    debouncedPersist(useSettingsStore.getState());
  },
  setLineHeight: (height) => {
    set({ lineHeight: height });
    debouncedPersist(useSettingsStore.getState());
  },
  setVaultName: (name) => {
    set({ vaultName: name });
    debouncedPersist(useSettingsStore.getState());
  },
  updateSettings: (partial) => {
    if (partial.fontSize !== undefined) {
      document.documentElement.style.setProperty('--ui-font-size', `${partial.fontSize}px`);
    }
    set(partial);
    debouncedPersist(useSettingsStore.getState());
  },
  updateShortcut: (id, keys) => {
    set((state) => ({
      shortcuts: state.shortcuts.map((s) => (s.id === id ? { ...s, keys } : s)),
    }));
    debouncedPersist(useSettingsStore.getState());
  },
  resetShortcuts: () => {
    set({ shortcuts: [...DEFAULT_SHORTCUTS] });
    debouncedPersist(useSettingsStore.getState());
  },
  // ── 看板列自定义 ──
  addBoardColumn: (name: string) => {
    const id = `col-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    set((state) => {
      const palette = COLUMN_COLOR_PALETTE;
      const color = palette[state.boardColumns.length % palette.length];
      return { boardColumns: [...state.boardColumns, { id, name: name || '新列', color }] };
    });
    debouncedPersist(useSettingsStore.getState());
    return id;
  },
  renameBoardColumn: (id: string, name: string) => {
    set((state) => ({
      boardColumns: state.boardColumns.map((c) => (c.id === id ? { ...c, name } : c)),
    }));
    debouncedPersist(useSettingsStore.getState());
  },
  reorderBoardColumns: (fromId: string, toId: string) => {
    if (fromId === toId) return;
    set((state) => {
      const cols = [...state.boardColumns];
      const fromIdx = cols.findIndex((c) => c.id === fromId);
      const toIdx = cols.findIndex((c) => c.id === toId);
      if (fromIdx < 0 || toIdx < 0) return state;
      const [moved] = cols.splice(fromIdx, 1);
      cols.splice(toIdx, 0, moved);
      return { boardColumns: cols };
    });
    debouncedPersist(useSettingsStore.getState());
  },
  setBoardColumns: (columns: BoardColumnDef[]) => {
    set({ boardColumns: columns });
    debouncedPersist(useSettingsStore.getState());
  },
  setPetModeEnabled: (enabled: boolean) => {
    set({ petModeEnabled: enabled });
    debouncedPersist(useSettingsStore.getState());
  },
  setPetPosition: (x: number, y: number) => {
    set({ petPositionX: x, petPositionY: y });
    debouncedPersist(useSettingsStore.getState());
  },
  setPetPanelPosition: (x: number, y: number) => {
    set({ petPanelX: x, petPanelY: y });
    debouncedPersist(useSettingsStore.getState());
  },
  setPetPanelSize: (width: number, height: number) => {
    set({ petPanelWidth: width, petPanelHeight: height });
    debouncedPersist(useSettingsStore.getState());
  },
  setPetPanelSizeVersion: (version: number) => {
    set({ petPanelSizeVersion: version });
    debouncedPersist(useSettingsStore.getState());
  },
}));

/** Load persisted settings from backend on startup */
storageClient.get<Partial<SettingsState>>(SETTINGS_STORAGE_KEY).then((saved) => {
  if (saved) {
    // Apply theme immediately
    const theme = saved.theme || 'light';
    const actual = theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;
    document.documentElement.dataset.theme = actual;
    // Apply font size to CSS variable
    if (saved.fontSize) {
      document.documentElement.style.setProperty('--ui-font-size', `${saved.fontSize}px`);
    }
    // Backfill excludePatterns for built-in managed dirs
    // (__wiki__/__clips__/__reports__/__daily__/__study__/__schedule__/__analyze__).
    // Per-dir backfill: append each missing built-in dir without duplicating
    // ones already present, so existing users whose persisted value already has
    // some (e.g. __wiki__) but lacks later-added ones (e.g. __study__) also hide
    // them from the file panel.
    if (saved.excludePatterns) {
      saved.excludePatterns = backfillBuiltinExcludePatterns(saved.excludePatterns);
    }
    // Backfill shortcuts: append any DEFAULT_SHORTCUTS entry whose id is
    // missing from the persisted array (e.g. a newly-added global shortcut
    // like `togglePetPanel`). Preserves user-customized keys on existing
    // entries — only missing ids are appended.
    if (saved.shortcuts) {
      saved.shortcuts = backfillDefaultShortcuts(saved.shortcuts);
    }
    // Migrate persisted dailyNotesDir from the old default to the new built-in name.
    if (saved.dailyNotesDir === 'daily') {
      saved.dailyNotesDir = '__daily__';
    }
    // Backfill boardColumns: 必须是非空数组且含一个 isDone 列，否则用默认。
    if (!Array.isArray(saved.boardColumns) || saved.boardColumns.length === 0 || !saved.boardColumns.some((c) => c.isDone)) {
      saved.boardColumns = DEFAULT_BOARD_COLUMNS.map((c) => ({ ...c }));
    }
    // Position-unit migration: pre-fix `petPosVersion !== 1` saved the pet
    // and panel positions in PHYSICAL pixels, which on Retina placed the pet
    // at screen-center on launch (logical work-area math applied to physical
    // values). Discard the stale physical-pixel positions so the default-
    // position branch re-runs and the next save stores logical points.
    if (saved.petPosVersion !== 1) {
      saved.petPositionX = -1;
      saved.petPositionY = -1;
      saved.petPanelX = -1;
      saved.petPanelY = -1;
      saved.petPosVersion = 1;
    }
    useSettingsStore.setState(saved);
  }
});
