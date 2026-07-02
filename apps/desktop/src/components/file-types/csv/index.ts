import type { FileTypeHandler } from '../types';
import { CsvTablePreview } from './CsvTablePreview';
import { getFileTypeIcon } from '@/components/icons/FileIcon';

const handler: FileTypeHandler = {
  id: 'csv',
  extensions: ['csv'],
  icon: getFileTypeIcon('csv'),
  supportedViewModes: ['split', 'edit', 'preview'],
  needsFileContent: true,
  useCodeMirror: true,
  Preview: CsvTablePreview,
};

export default handler;
