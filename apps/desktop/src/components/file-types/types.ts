// ponytail: contracts moved to mochi-plugin-sdk (publishable). This file
// re-exports them so existing app-internal `import from './types'` /
// `import from '@/components/file-types/types'` keep working unchanged.
export type {
  ViewMode,
  EditorProps,
  PreviewProps,
  FileTypeHandler,
} from 'mochi-plugin-sdk';
