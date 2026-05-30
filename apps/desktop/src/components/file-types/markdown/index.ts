import type { FileTypeHandler } from '../types';
import { MarkdownPreview } from './MarkdownPreview';

const handler: FileTypeHandler = {
  id: 'markdown',
  extensions: ['md', 'markdown', 'mdx'],
  supportedViewModes: ['split', 'edit', 'preview'],
  needsFileContent: true,
  useCodeMirror: true,
  Preview: MarkdownPreview,
};

export default handler;
