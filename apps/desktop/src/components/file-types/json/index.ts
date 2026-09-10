import type { FileTypeProvider } from '../types';
import { JsonFileViewerPreview } from './JsonFileViewerPreview';
import { getFileTypeIcon } from '@/components/icons/FileIcon';

const handler: FileTypeProvider = {
  id: 'json',
  extensions: ['json'],
  icon: getFileTypeIcon('json'),
  needsFileContent: true,
  modes: [
    { id: 'edit', kind: 'shell-editor' },
    { id: 'preview', kind: 'component', component: JsonFileViewerPreview },
  ],
};

export default handler;
