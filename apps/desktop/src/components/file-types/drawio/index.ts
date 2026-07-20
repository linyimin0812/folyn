import type { FileTypeHandler } from '../types';
import { DrawioEditor } from './DrawioEditor';
import { DrawioPreview } from './DrawioPreview';
import { getFileTypeIcon } from '@/components/icons/FileIcon';

const handler: FileTypeHandler = {
  id: 'drawio',
  extensions: ['drawio', 'dio'],
  icon: getFileTypeIcon('drawio'),
  supportedViewModes: ['edit', 'preview'],
  defaultViewMode: 'edit',
  needsFileContent: true,
  useCodeMirror: false,
  Editor: DrawioEditor,
  Preview: DrawioPreview,
};

export default handler;
