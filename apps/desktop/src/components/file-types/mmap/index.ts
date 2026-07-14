import type { FileTypeHandler } from '../types';
import { MmapFileViewerPreview } from './MmapFileViewerPreview';
import { getFileTypeIcon } from '@/components/icons/FileIcon';

const handler: FileTypeHandler = {
  id: 'mmap',
  extensions: ['mmap'],
  icon: getFileTypeIcon('mmap'),
  supportedViewModes: ['split', 'edit', 'preview'],
  defaultViewMode: 'split',
  needsFileContent: true,
  useCodeMirror: true,
  Preview: MmapFileViewerPreview,
};

export default handler;
