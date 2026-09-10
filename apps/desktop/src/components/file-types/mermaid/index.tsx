import type { FileTypeProvider } from '../types';
import { getFileTypeIcon } from '@/components/icons/FileIcon';
import { MermaidPreview } from './MermaidPreview';

const handler: FileTypeProvider = {
  id: 'mermaid',
  extensions: ['mermaid', 'mmd'],
  icon: getFileTypeIcon('mermaid'),
  needsFileContent: true,
  defaultMode: 'split',
  modes: [
    { id: 'edit', kind: 'shell-editor' },
    { id: 'split', kind: 'split', split: { left: 'edit', right: 'preview' } },
    { id: 'preview', kind: 'component', component: MermaidPreview },
  ],
};

export default handler;
