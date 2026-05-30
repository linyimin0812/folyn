import type { FileTypeHandler } from '../types';
import { ImageViewer } from './ImageViewer';
import { getFileTypeIcon } from '@/components/icons/FileIcon';

const handler: FileTypeHandler = {
  id: 'image',
  extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'],
  icon: getFileTypeIcon('image'),
  supportedViewModes: ['preview'],
  needsFileContent: false,
  useCodeMirror: false,
  Preview: ImageViewer,
};

export default handler;
