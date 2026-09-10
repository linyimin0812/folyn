import type { FileTypeProvider } from '../types';
import { HtmlPreview } from './HtmlPreview';
import { HtmlVisualEditor } from './HtmlVisualEditor';
import { getFileTypeIcon } from '@/components/icons/FileIcon';

const handler: FileTypeProvider = {
  id: 'html',
  extensions: ['html', 'htm'],
  icon: getFileTypeIcon('html'),
  needsFileContent: true,
  defaultMode: 'preview',
  modes: [
    { id: 'visual', kind: 'component', component: HtmlVisualEditor },
    { id: 'source', kind: 'shell-editor' },
    { id: 'preview', kind: 'component', component: HtmlPreview },
  ],
};

export default handler;
