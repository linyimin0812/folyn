import type { FileTypeProvider } from '../types';
import { getFileTypeIcon } from '@/components/icons/FileIcon';
import { CodeFileViewer } from './CodeFileViewer';

const handler: FileTypeProvider = {
  id: 'code',
  extensions: [],
  icon: getFileTypeIcon('code'),
  needsFileContent: true,
  defaultMode: 'edit',
  modes: [
    { id: 'edit', kind: 'shell-editor' },
    { id: 'preview', kind: 'component', component: CodeFileViewer },
  ],
};

export default handler;
