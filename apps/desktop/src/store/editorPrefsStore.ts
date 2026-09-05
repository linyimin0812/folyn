import { create } from 'zustand';
import { registerPersistSlice } from './settingsPersistence';

export type TablePasteMode = 'ask' | 'convert' | 'text';

export const PERSIST_KEYS_EDITOR_PREFS = [
  'editorFont',
  'editorFontSize',
  'tabSize',
  'wrapColumn',
  'showLineNumbers',
  'syntaxHighlight',
  'autoSave',
  'spellCheck',
  'tablePasteMode',
  'cursorSyncPreview',
] as const;

export interface EditorPrefsState {
  editorFont: string;
  editorFontSize: number;
  tabSize: number;
  wrapColumn: number;
  showLineNumbers: boolean;
  syntaxHighlight: boolean;
  autoSave: boolean;
  spellCheck: boolean;
  tablePasteMode: TablePasteMode;
  cursorSyncPreview: boolean;

  setEditorFont: (v: string) => void;
  setEditorFontSize: (v: number) => void;
  setTabSize: (v: number) => void;
  setWrapColumn: (v: number) => void;
  setShowLineNumbers: (v: boolean) => void;
  setSyntaxHighlight: (v: boolean) => void;
  setAutoSave: (v: boolean) => void;
  setSpellCheck: (v: boolean) => void;
  setTablePasteMode: (v: TablePasteMode) => void;
  setCursorSyncPreview: (v: boolean) => void;

  /** Load this store's slice from the persisted `settings:all` blob. */
  hydrate: (blob: Record<string, unknown>) => void;
}

export const useEditorPrefsStore = create<EditorPrefsState>((set) => ({
  editorFont: 'DM Mono',
  editorFontSize: 13,
  tabSize: 4,
  wrapColumn: 80,
  showLineNumbers: true,
  syntaxHighlight: true,
  autoSave: true,
  spellCheck: false,
  tablePasteMode: 'ask',
  cursorSyncPreview: true,

  setEditorFont: (v) => { set({ editorFont: v }); persist(); },
  setEditorFontSize: (v) => { set({ editorFontSize: v }); persist(); },
  setTabSize: (v) => { set({ tabSize: v }); persist(); },
  setWrapColumn: (v) => { set({ wrapColumn: v }); persist(); },
  setShowLineNumbers: (v) => { set({ showLineNumbers: v }); persist(); },
  setSyntaxHighlight: (v) => { set({ syntaxHighlight: v }); persist(); },
  setAutoSave: (v) => { set({ autoSave: v }); persist(); },
  setSpellCheck: (v) => { set({ spellCheck: v }); persist(); },
  setTablePasteMode: (v) => { set({ tablePasteMode: v }); persist(); },
  setCursorSyncPreview: (v) => { set({ cursorSyncPreview: v }); persist(); },

  hydrate: (blob) => {
    const patch: Partial<EditorPrefsState> = {};
    if (blob.editorFont !== undefined) patch.editorFont = blob.editorFont as string;
    if (blob.editorFontSize !== undefined) patch.editorFontSize = blob.editorFontSize as number;
    if (blob.tabSize !== undefined) patch.tabSize = blob.tabSize as number;
    if (blob.wrapColumn !== undefined) patch.wrapColumn = blob.wrapColumn as number;
    if (blob.showLineNumbers !== undefined) patch.showLineNumbers = blob.showLineNumbers as boolean;
    if (blob.syntaxHighlight !== undefined) patch.syntaxHighlight = blob.syntaxHighlight as boolean;
    if (blob.autoSave !== undefined) patch.autoSave = blob.autoSave as boolean;
    if (blob.spellCheck !== undefined) patch.spellCheck = blob.spellCheck as boolean;
    if (blob.tablePasteMode !== undefined) patch.tablePasteMode = blob.tablePasteMode as TablePasteMode;
    if (blob.cursorSyncPreview !== undefined) patch.cursorSyncPreview = blob.cursorSyncPreview as boolean;
    if (Object.keys(patch).length > 0) set(patch);
  },
}));

const persist = registerPersistSlice({
  name: 'editorPrefs',
  keys: PERSIST_KEYS_EDITOR_PREFS,
  getState: () => useEditorPrefsStore.getState() as unknown as Record<string, unknown>,
  hydrate: (blob) => useEditorPrefsStore.getState().hydrate(blob),
});
