import type { FileTypeProvider } from '../types';
import { getFileTypeIcon } from '@/components/icons/FileIcon';
import ErDiagramPreview from './ErDiagramX6';

const handler: FileTypeProvider = {
  id: 'dbml',
  extensions: ['dbml'],
  icon: getFileTypeIcon('dbml'),
  needsFileContent: true,
  defaultMode: 'split',
  modes: [
    { id: 'edit', kind: 'shell-editor' },
    { id: 'split', kind: 'split', split: { left: 'edit', right: 'preview' } },
    { id: 'preview', kind: 'component', component: ErDiagramPreview },
  ],
};

export default handler;
