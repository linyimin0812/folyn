import type { FileTypeHandler } from '../types';
import { HtmlPreview } from './HtmlPreview';
import { HtmlVisualEditor } from './HtmlVisualEditor';
import { getFileTypeIcon } from '@/components/icons/FileIcon';

const handler: FileTypeHandler = {
  id: 'html',
  extensions: ['html', 'htm'],
  icon: getFileTypeIcon('html'),
  supportedViewModes: ['edit', 'preview'],
  defaultViewMode: 'edit',
  needsFileContent: true,
  useCodeMirror: false,
  Editor: HtmlVisualEditor,
  Preview: HtmlPreview,
};

export default handler;
