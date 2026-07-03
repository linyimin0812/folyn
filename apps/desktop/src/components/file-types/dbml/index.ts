import type { FileTypeHandler } from '../types';
import { ErDiagramPreview } from './ErDiagramPreview';
import { getFileTypeIcon } from '@/components/icons/FileIcon';

const handler: FileTypeHandler = {
  id: 'dbml',
  extensions: ['dbml'],
  icon: getFileTypeIcon('dbml'),
  supportedViewModes: ['split', 'edit', 'preview'],
  defaultViewMode: 'split',
  needsFileContent: true,
  useCodeMirror: true,
  Preview: ErDiagramPreview,
};

export default handler;
