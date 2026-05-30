import type { FileTypeHandler } from '../types';
import { getFileTypeIcon } from '@/components/icons/FileIcon';

const handler: FileTypeHandler = {
  id: 'code',
  extensions: [],
  icon: getFileTypeIcon('code'),
  supportedViewModes: ['edit'],
  needsFileContent: true,
  useCodeMirror: true,
};

export default handler;
