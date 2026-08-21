import type { FileTypeHandler } from '../types';
import { getFileTypeIcon } from '@/components/icons/FileIcon';
import { MarkmapPreview } from './MarkmapPreview';

// ponytail: dir + module name kept as `mmap` after the id/extension rename to
// `markmap` — minimum diff; rename would ripple through imports with no user benefit.
const handler: FileTypeHandler = {
  id: 'markmap',
  extensions: ['markmap'],
  icon: getFileTypeIcon('markmap'),
  supportedViewModes: ['split', 'edit', 'preview'],
  defaultViewMode: 'split',
  needsFileContent: true,
  useCodeMirror: true,
  Preview: MarkmapPreview,
};

export default handler;
