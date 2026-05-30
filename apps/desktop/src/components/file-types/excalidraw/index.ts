import type { FileTypeHandler } from '../types';
import { ExcalidrawEditor } from './ExcalidrawEditor';
import { getFileTypeIcon } from '@/components/icons/FileIcon';

const handler: FileTypeHandler = {
  id: 'excalidraw',
  extensions: ['excalidraw'],
  icon: getFileTypeIcon('excalidraw'),
  supportedViewModes: ['edit'],
  needsFileContent: true,
  useCodeMirror: false,
  Editor: ExcalidrawEditor,
};

export default handler;
