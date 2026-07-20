import type { FileTypeHandler } from '../types';
import { getFileTypeIcon } from '@/components/icons/FileIcon';
import { CodeFileViewer } from './CodeFileViewer';

const handler: FileTypeHandler = {
  id: 'code',
  extensions: [],
  icon: getFileTypeIcon('code'),
  supportedViewModes: ['edit', 'preview'],
  defaultViewMode: 'edit',
  needsFileContent: true,
  useCodeMirror: true,
  Preview: CodeFileViewer,
};

export default handler;
