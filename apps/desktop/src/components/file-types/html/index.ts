import type { FileTypeHandler } from '../types';
import { HtmlPreview } from './HtmlPreview';
import { HtmlVisualEditor } from './HtmlVisualEditor';
import { getFileTypeIcon } from '@/components/icons/FileIcon';

const handler: FileTypeHandler = {
  id: 'html',
  extensions: ['html', 'htm'],
  icon: getFileTypeIcon('html'),
  supportedViewModes: ['visual', 'source', 'preview'],
  defaultViewMode: 'visual',
  needsFileContent: true,
  useCodeMirror: false,
  Editor: HtmlVisualEditor,
  Preview: HtmlPreview,
};

export default handler;
