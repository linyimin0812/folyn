import type { FileTypeHandler } from '../types';
import { getFileTypeIcon } from '@/components/icons/FileIcon';
import ErDiagramPreview from './ErDiagramX6';

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
