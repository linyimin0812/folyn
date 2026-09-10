import type { FileTypeProvider } from '../types';
import { RichTextEditor } from './RichTextEditor';
import { getFileTypeIcon } from '@/components/icons/FileIcon';

const handler: FileTypeProvider = {
  id: 'rich-text',
  extensions: ['richtext'],
  icon: getFileTypeIcon('rich-text'),
  needsFileContent: true,
  defaultMode: 'edit',
  modes: [
    { id: 'edit', kind: 'component', component: RichTextEditor },
  ],
};

export default handler;
