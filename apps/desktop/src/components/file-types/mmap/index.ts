import type { FileTypeHandler } from '../types';
import { getFileTypeIcon } from '@/components/icons/FileIcon';
import { MarkmapPreview } from './MarkmapPreview';

const handler: FileTypeHandler = {
  id: 'mmap',
  extensions: ['mmap'],
  icon: getFileTypeIcon('mmap'),
  supportedViewModes: ['split', 'edit', 'preview'],
  defaultViewMode: 'split',
  needsFileContent: true,
  useCodeMirror: true,
  Preview: MarkmapPreview,
};

export default handler;
