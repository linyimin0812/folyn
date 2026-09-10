import type { FileTypeProvider } from '../types';
import { getFileTypeIcon } from '@/components/icons/FileIcon';
import { GraphvizPreview } from './GraphvizPreview';

const handler: FileTypeProvider = {
  id: 'graphviz',
  extensions: ['gv', 'dot', 'graphviz'],
  icon: getFileTypeIcon('graphviz'),
  needsFileContent: true,
  defaultMode: 'split',
  modes: [
    { id: 'edit', kind: 'shell-editor' },
    { id: 'split', kind: 'split', split: { left: 'edit', right: 'preview' } },
    { id: 'preview', kind: 'component', component: GraphvizPreview },
  ],
};

export default handler;
