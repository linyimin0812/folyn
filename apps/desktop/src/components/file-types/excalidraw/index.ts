import type { FileTypeHandler } from '../types';
import { ExcalidrawEditor } from './ExcalidrawEditor';

const handler: FileTypeHandler = {
  id: 'excalidraw',
  extensions: ['excalidraw'],
  icon: '✏️',
  supportedViewModes: ['edit'],
  needsFileContent: true,
  useCodeMirror: false,
  Editor: ExcalidrawEditor,
};

export default handler;
