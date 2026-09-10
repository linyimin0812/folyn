import type { FileTypeProvider } from '../types';
import { SvgPreview } from './SvgPreview';
import { getFileTypeIcon } from '@/components/icons/FileIcon';

const handler: FileTypeProvider = {
  id: 'svg',
  extensions: ['svg'],
  icon: getFileTypeIcon('svg'),
  needsFileContent: true,
  defaultMode: 'split',
  modes: [
    { id: 'edit', kind: 'shell-editor' },
    { id: 'preview', kind: 'component', component: SvgPreview },
    { id: 'split', kind: 'split', split: { left: 'edit', right: 'preview' } },
  ],
};

export default handler;
