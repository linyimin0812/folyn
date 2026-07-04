import type { ComponentType, ReactNode } from 'react';

export type ViewMode = 'split' | 'edit' | 'preview' | 'visual' | 'source';

export interface EditorProps {
  content: string;
  tabId: string;
  filePath: string;
  onChange: (content: string) => void;
  onSave: () => void;
}

export interface PreviewProps {
  content: string;
  filePath: string;
  vaultRoot: string;
  /**
   * Optional write-back hook for preview components that allow in-place
   * editing (e.g. the JSON file viewer's left CodeMirror pane). When bound,
   * edits flow through `editorStore.updateTabContent` so Cmd+S / auto-save
   * persist the new content to disk. Optional — handlers that don't edit
   * (csv, office, dbml, markdown) simply omit it.
   */
  onChange?: (content: string) => void;
}

export interface FileTypeHandler {
  id: string;
  extensions: string[];
  icon?: ReactNode;
  supportedViewModes: ViewMode[];
  defaultViewMode?: ViewMode;
  needsFileContent: boolean;
  useCodeMirror?: boolean;
  Editor?: ComponentType<EditorProps>;
  Preview?: ComponentType<PreviewProps>;
  serialize?: (content: string) => string;
  deserialize?: (raw: string) => string;
}
