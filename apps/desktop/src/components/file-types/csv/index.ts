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
    { id: 'split', kind: 'split', split: { left: 'edit', right: 'preview' } },
    { id: 'preview', kind: 'component', component: CsvFileViewerPreview },
  ],
};

export default handler;
