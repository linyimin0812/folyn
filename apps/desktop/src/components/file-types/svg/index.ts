import type { FileTypeHandler } from '../types';
import { SvgPreview } from './SvgPreview';
import { getFileTypeIcon } from '@/components/icons/FileIcon';

const handler: FileTypeHandler = {
  id: 'svg',
  extensions: ['svg'],
  icon: getFileTypeIcon('svg'),
  supportedViewModes: ['edit', 'preview', 'split'],
  defaultViewMode: 'split',
  needsFileContent: true,
  useCodeMirror: true,
  Preview: SvgPreview,
};

export default handler;
