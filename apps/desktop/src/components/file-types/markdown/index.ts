import type { FileTypeProvider } from '../types';
import { MarkdownPreview } from './MarkdownPreview';
import { getFileTypeIcon } from '@/components/icons/FileIcon';

const handler: FileTypeProvider = {
  id: 'markdown',
  extensions: ['md', 'markdown', 'mdx'],
  icon: getFileTypeIcon('markdown'),
  needsFileContent: true,
  defaultMode: 'split',
  modes: [
    { id: 'edit', kind: 'shell-editor' },
    { id: 'split', kind: 'split', split: { left: 'edit', right: 'preview' } },
    { id: 'preview', kind: 'component', component: MarkdownPreview },
  ],
};

export default handler;
