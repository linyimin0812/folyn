import type { FileTypeProvider } from '../types';
import { ImageViewer } from './ImageViewer';
import { getFileTypeIcon } from '@/components/icons/FileIcon';

const handler: FileTypeProvider = {
  id: 'image',
  extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico'],
  icon: getFileTypeIcon('image'),
  needsFileContent: false,
  modes: [
    { id: 'preview', kind: 'component', component: ImageViewer },
  ],
};

export default handler;
