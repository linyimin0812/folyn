import type { ComponentType, ReactNode } from 'react';

export type ViewMode = 'split' | 'edit' | 'preview';

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
