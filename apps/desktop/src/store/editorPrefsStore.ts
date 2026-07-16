import { create } from 'zustand';
import { registerPersistSlice, schedulePersist } from './settingsPersistence';

export const PERSIST_KEYS_EDITOR_PREFS = [
  'editorFont',
  'editorFontSize',
  'tabSize',
  'wrapColumn',
  'showLineNumbers',
  'syntaxHighlight',
  'autoSave',
  'spellCheck',
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

  setEditorFont: (v: string) => void;
  setEditorFontSize: (v: number) => void;
  setTabSize: (v: number) => void;
  setWrapColumn: (v: number) => void;
  setShowLineNumbers: (v: boolean) => void;
  setSyntaxHighlight: (v: boolean) => void;
  setAutoSave: (v: boolean) => void;
  setSpellCheck: (v: boolean) => void;

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

  setEditorFont: (v) => { set({ editorFont: v }); schedulePersist(); },
  setEditorFontSize: (v) => { set({ editorFontSize: v }); schedulePersist(); },
  setTabSize: (v) => { set({ tabSize: v }); schedulePersist(); },
  setWrapColumn: (v) => { set({ wrapColumn: v }); schedulePersist(); },
  setShowLineNumbers: (v) => { set({ showLineNumbers: v }); schedulePersist(); },
  setSyntaxHighlight: (v) => { set({ syntaxHighlight: v }); schedulePersist(); },
  setAutoSave: (v) => { set({ autoSave: v }); schedulePersist(); },
  setSpellCheck: (v) => { set({ spellCheck: v }); schedulePersist(); },

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
    if (Object.keys(patch).length > 0) set(patch);
  },
}));

registerPersistSlice({
  keys: PERSIST_KEYS_EDITOR_PREFS,
  getState: () => useEditorPrefsStore.getState() as unknown as Record<string, unknown>,
  hydrate: (blob) => useEditorPrefsStore.getState().hydrate(blob),
});
