import type { ReactElement } from 'react';
import { createElement } from 'react';
import type { FileTypeProvider, PreviewProps } from '../types';
import { ExcalidrawEditor } from './ExcalidrawEditor';
import { ExcalidrawPreview } from './ExcalidrawPreview';
import { getFileTypeIcon } from '@/components/icons/FileIcon';

// ponytail: adapter strips PreviewProps to the props ExcalidrawPreview actually
// accepts ({ filePath, alt? }) — it reads the file itself via useVaultStore,
// so content/vaultRoot/onChange are unused. Inline createElement keeps this a
// .ts file (no JSX).
function ExcalidrawPreviewAdapter(props: PreviewProps): ReactElement {
  return createElement(ExcalidrawPreview, { filePath: props.filePath });
}

const handler: FileTypeProvider = {
  id: 'excalidraw',
  extensions: ['excalidraw'],
  icon: getFileTypeIcon('excalidraw'),
  needsFileContent: true,
  defaultMode: 'edit',
  modes: [
    { id: 'edit', kind: 'component', component: ExcalidrawEditor },
    { id: 'preview', kind: 'component', component: ExcalidrawPreviewAdapter },
  ],
};

export default handler;
