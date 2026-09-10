import type { FileTypeProvider } from '../types';
import { getFileTypeIcon } from '@/components/icons/FileIcon';
import { MarkmapPreview } from './MarkmapPreview';

const handler: FileTypeProvider = {
  id: 'markmap',
  extensions: ['markmap'],
  icon: getFileTypeIcon('markmap'),
  needsFileContent: true,
  defaultMode: 'split',
  modes: [
    { id: 'edit', kind: 'shell-editor' },
    { id: 'split', kind: 'split', split: { left: 'edit', right: 'preview' } },
    { id: 'preview', kind: 'component', component: MarkmapPreview },
  ],
};

export default handler;
