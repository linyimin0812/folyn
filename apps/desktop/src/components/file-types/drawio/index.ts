import type { FileTypeHandler } from '../types';
import { DrawioEditor } from './DrawioEditor';
import { getFileTypeIcon } from '@/components/icons/FileIcon';

const handler: FileTypeHandler = {
  id: 'drawio',
  extensions: ['drawio', 'dio'],
  icon: getFileTypeIcon('drawio'),
  supportedViewModes: ['edit'],
  defaultViewMode: 'edit',
  needsFileContent: true,
  useCodeMirror: false,
  Editor: DrawioEditor,
};

export default handler;
