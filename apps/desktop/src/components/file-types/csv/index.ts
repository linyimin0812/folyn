import type { FileTypeHandler } from '../types';
import { CsvFileViewerPreview } from './CsvFileViewerPreview';
import { getFileTypeIcon } from '@/components/icons/FileIcon';

const handler: FileTypeHandler = {
  id: 'csv',
  extensions: ['csv'],
  icon: getFileTypeIcon('csv'),
  supportedViewModes: ['split', 'edit', 'preview'],
  needsFileContent: true,
  useCodeMirror: true,
  Preview: CsvFileViewerPreview,
  defaultViewMode: 'split'
};

export default handler;
