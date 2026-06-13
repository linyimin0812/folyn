import type { FileTypeHandler } from '../types';
import { ClipCardView } from './ClipCardView';
import { getFileTypeIcon } from '@/components/icons/FileIcon';

const handler: FileTypeHandler = {
  id: 'clip',
  extensions: [],
  icon: getFileTypeIcon('clip'),
  supportedViewModes: ['preview'],
  defaultViewMode: 'preview',
  needsFileContent: true,
  useCodeMirror: false,
  Editor: ClipCardView,
};

export default handler;
