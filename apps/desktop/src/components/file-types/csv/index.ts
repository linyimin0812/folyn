import type { FileTypeProvider } from '../types';
import { CsvFileViewerPreview } from './CsvFileViewerPreview';
import { getFileTypeIcon } from '@/components/icons/FileIcon';

const handler: FileTypeProvider = {
  id: 'csv',
  extensions: ['csv'],
  icon: getFileTypeIcon('csv'),
  needsFileContent: true,
  defaultMode: 'split',
  modes: [
    { id: 'edit', kind: 'shell-editor' },
    { id: 'preview', kind: 'component', component: CsvFileViewerPreview },
    { id: 'split', kind: 'split', split: { left: 'edit', right: 'preview' } },
  ],
};

export default handler;
