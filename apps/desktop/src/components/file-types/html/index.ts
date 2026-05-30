import type { FileTypeHandler } from '../types';
import { HtmlPreview } from './HtmlPreview';
import { getFileTypeIcon } from '@/components/icons/FileIcon';

const handler: FileTypeHandler = {
  id: 'html',
  extensions: ['html', 'htm'],
  icon: getFileTypeIcon('html'),
  supportedViewModes: ['split', 'edit', 'preview'],
  defaultViewMode: 'preview',
  needsFileContent: true,
  useCodeMirror: true,
  Preview: HtmlPreview,
};

export default handler;
