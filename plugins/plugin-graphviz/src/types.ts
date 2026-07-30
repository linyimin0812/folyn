// ponytail: local structural types mirroring the host contracts
// (`apps/desktop/src/components/file-types/types.ts` and
// `@quill/container-plugins` ContainerProps). Re-declared here so the plugin
// is self-contained for typecheck without importing host internals — the host's
// adapter assigns these objects into `registerFileTypeHandler` / the container
// registry structurally, so a matching shape is sufficient. Type-only imports
// of `react` are erased at build, so `react` never lands in the bundle.
import type { ComponentType, ReactNode } from 'react';

export type ViewMode = 'split' | 'edit' | 'preview' | 'visual' | 'source';

export interface PreviewProps {
  content: string;
  filePath: string;
  vaultRoot: string;
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
  Editor?: ComponentType<PreviewProps>;
  Preview?: ComponentType<PreviewProps>;
  serialize?: (content: string) => string;
  deserialize?: (raw: string) => string;
}

export interface ContainerProps {
  children?: ReactNode;
  attributes?: Record<string, string>;
  name?: string;
}
