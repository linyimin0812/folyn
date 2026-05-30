import type { FileTypeHandler } from '../types';
import { ImageViewer } from './ImageViewer';

const handler: FileTypeHandler = {
  id: 'image',
  extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'],
  supportedViewModes: ['preview'],
  needsFileContent: false,
  useCodeMirror: false,
  Preview: ImageViewer,
};

export default handler;
