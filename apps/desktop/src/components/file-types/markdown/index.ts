import type { FileTypeHandler } from '../types';
import { MarkdownPreview } from './MarkdownPreview';
import { getFileTypeIcon } from '@/components/icons/FileIcon';

const handler: FileTypeHandler = {
  id: 'markdown',
  extensions: ['md', 'markdown', 'mdx'],
  icon: getFileTypeIcon('markdown'),
  supportedViewModes: ['split', 'edit', 'preview'],
  needsFileContent: true,
  useCodeMirror: true,
  Preview: MarkdownPreview,
};

export default handler;
