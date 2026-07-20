import type { ReactElement } from 'react';
import { createElement } from 'react';
import type { FileTypeHandler, PreviewProps } from '../types';
import { ExcalidrawEditor } from './ExcalidrawEditor';
import { ExcalidrawPreview } from './ExcalidrawPreview';
import { getFileTypeIcon } from '@/components/icons/FileIcon';

// ponytail: adapter strips PreviewProps to the props ExcalidrawPreview actually
// accepts ({ filePath, alt? }) — it reads the file itself via useVaultStore,
// so content/vaultRoot/onChange are unused. Inline createElement keeps this a
// .ts file (no JSX). Replace with a .tsx wrapper if more props need plumbing.
function ExcalidrawPreviewAdapter(props: PreviewProps): ReactElement {
  return createElement(ExcalidrawPreview, { filePath: props.filePath });
}

const handler: FileTypeHandler = {
  id: 'excalidraw',
  extensions: ['excalidraw'],
  icon: getFileTypeIcon('excalidraw'),
  supportedViewModes: ['edit', 'preview'],
  defaultViewMode: 'edit',
  needsFileContent: true,
  useCodeMirror: false,
  Editor: ExcalidrawEditor,
  Preview: ExcalidrawPreviewAdapter,
};

export default handler;
