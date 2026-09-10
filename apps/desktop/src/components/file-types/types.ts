// ponytail: contracts moved to folyn-extension-sdk (publishable). This file
// re-exports them so existing app-internal `import from './types'` /
// `import from '@/components/file-types/types'` keep working unchanged.
export type {
  ViewMode,
  EditorProps,
  PreviewProps,
  FileTypeHandler,
  FileTypeProvider,
  PresentationModeRegistration,
  PresentationModeId,
  PresentationModeKind,
  SplitComposition,
  
  FilePresentationContext,
  IconRef,
} from 'folyn-extension-sdk';
