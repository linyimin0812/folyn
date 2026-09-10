import type { FileTypeProvider } from '../types';
import { ClipCardView } from './ClipCardView';
import { getFileTypeIcon } from '@/components/icons/FileIcon';

const handler: FileTypeProvider = {
  id: 'clip',
  extensions: [],
  icon: getFileTypeIcon('clip'),
  needsFileContent: true,
  defaultMode: 'preview',
  modes: [
    { id: 'preview', kind: 'component', component: ClipCardView, via: 'inline' },
  ],
};

export default handler;
