// ponytail: contracts now live in @quill/plugin-sdk (publishable). Re-export
// the ones this plugin uses instead of re-declaring locally — the SDK is the
// single source of truth, and type-only imports of `react`/SDK are erased at
// build so neither lands in the self-contained blob-URL bundle.
export type {
  ViewMode,
  PreviewProps,
  FileTypeHandler,
  ContainerProps,
} from '@quill/plugin-sdk';
