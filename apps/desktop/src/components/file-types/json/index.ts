import type { FileTypeHandler } from '../types';
import { JsonFileViewerPreview } from './JsonFileViewerPreview';
import { getFileTypeIcon } from '@/components/icons/FileIcon';

const handler: FileTypeHandler = {
  id: 'json',
  extensions: ['json'],
  icon: getFileTypeIcon('json'),
  supportedViewModes: ['edit', 'preview'],
  needsFileContent: true,
  useCodeMirror: true,
  Preview: JsonFileViewerPreview,
};

export default handler;
