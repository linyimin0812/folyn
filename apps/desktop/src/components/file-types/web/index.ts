import type { FileTypeHandler } from '../types';
import { WebViewer } from './WebViewer';
import { getFileTypeIcon } from '@/components/icons/FileIcon';

const handler: FileTypeHandler = {
  id: 'web',
  extensions: [],
  icon: getFileTypeIcon('web'),
  supportedViewModes: ['edit'],
  needsFileContent: false,
  useCodeMirror: false,
  Editor: WebViewer,
};

export default handler;
