import { create } from 'zustand';
import { storageClient } from '@/utils/storageClient';

export type Theme = 'light' | 'dark' | 'system';
export type AppPage = 'editor' | 'vault' | 'settings';
export type SettingsTab = 'appearance' | 'editor' | 'shortcuts' | 'vault' | 'sync' | 'llm' | 'prompt' | 'about';
export type LlmProvider = 'anthropic' | 'openai' | 'google' | 'xai' | 'mistral' | 'groq' | 'openrouter' | 'local';
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

  // LLM
  llmProvider: LlmProvider;
  llmApiKey: string;
  llmModel: string;
  temperature: number;
  maxTokens: number;
  ollamaUrl: string;

  // Shortcuts
  shortcuts: ShortcutItem[];

  // Prompt
  systemPrompt: string;
  writingStyle: string;
  keepContext: boolean;
  autoSendDoc: boolean;

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
}

const SETTINGS_STORAGE_KEY = 'settings:all';

/** Debounced persist to avoid excessive API calls */
let persistTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedPersist(state: Partial<SettingsState>) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    // Extract only serializable settings (exclude functions and runtime state)
    const { theme, fontSize, lineHeight, showAiPanel, showStatusBar, showHiddenFiles, excludePatterns,
      editorFont, editorFontSize, tabSize, wrapColumn, showLineNumbers,
      syntaxHighlight, autoSave, spellCheck, linkOpenMode, vaultPath, imagePath, docExtension,
      watchFileChanges, trashOnDelete, syncMethod, syncEndpoint, syncAccessKey,
      syncSecretKey, syncBucket, autoSync, e2eEncrypt, llmProvider, llmApiKey,
      llmModel, temperature, maxTokens, ollamaUrl, systemPrompt, writingStyle,
      keepContext, autoSendDoc, vaultName, shortcuts } = state as SettingsState;
    storageClient.set(SETTINGS_STORAGE_KEY, {
      theme, fontSize, lineHeight, showAiPanel, showStatusBar, showHiddenFiles, excludePatterns,
      editorFont, editorFontSize, tabSize, wrapColumn, showLineNumbers,
      syntaxHighlight, autoSave, spellCheck, linkOpenMode, vaultPath, imagePath, docExtension,
      watchFileChanges, trashOnDelete, syncMethod, syncEndpoint, syncAccessKey,
      syncSecretKey, syncBucket, autoSync, e2eEncrypt, llmProvider, llmApiKey,
      llmModel, temperature, maxTokens, ollamaUrl, systemPrompt, writingStyle,
      keepContext, autoSendDoc, vaultName, shortcuts,
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
  excludePatterns: 'node_modules\n.git\n.DS_Store\ndist\n.next',

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

  // LLM
  llmProvider: 'anthropic',
  llmApiKey: '',
  llmModel: 'claude-sonnet-4-6',
  temperature: 0.7,
  maxTokens: 2048,
  ollamaUrl: 'http://localhost:11434',

  // Shortcuts
  shortcuts: [...DEFAULT_SHORTCUTS],

  // Prompt
  systemPrompt: '你是一个专业的技术文档写作助手。帮助用户改进 Markdown 文档的质量，包括语言润色、结构优化和内容扩展。保持专业、简洁的技术写作风格，使用中文回复。',
  writingStyle: '技术文档',
  keepContext: true,
  autoSendDoc: true,

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
    useSettingsStore.setState(saved);
  }
});
