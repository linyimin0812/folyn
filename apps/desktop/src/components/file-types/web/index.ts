import type { FileTypeProvider } from '../types';
import { WebViewer } from './WebViewer';
import { getFileTypeIcon } from '@/components/icons/FileIcon';

const handler: FileTypeProvider = {
  id: 'web',
  extensions: [],
  icon: getFileTypeIcon('web'),
  needsFileContent: false,
  modes: [
    { id: 'edit', kind: 'component', component: WebViewer },
  ],
};

export default handler;
