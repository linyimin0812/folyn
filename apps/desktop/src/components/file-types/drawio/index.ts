import type { FileTypeProvider } from '../types';
import { DrawioEditor } from './DrawioEditor';
import { DrawioPreview } from './DrawioPreview';
import { getFileTypeIcon } from '@/components/icons/FileIcon';

const handler: FileTypeProvider = {
  id: 'drawio',
  extensions: ['drawio', 'dio'],
  icon: getFileTypeIcon('drawio'),
  needsFileContent: true,
  defaultMode: 'edit',
  modes: [
    { id: 'edit', kind: 'component', component: DrawioEditor },
    { id: 'preview', kind: 'component', component: DrawioPreview },
  ],
};

export default handler;
