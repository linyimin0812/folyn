import type { FileTypeHandler } from '../types';
import { RichTextEditor } from './RichTextEditor';
import { getFileTypeIcon } from '@/components/icons/FileIcon';

const handler: FileTypeHandler = {
  id: 'rich-text',
  extensions: ['rt'],
  icon: getFileTypeIcon('rich-text'),
  supportedViewModes: ['edit'],
  defaultViewMode: 'edit',
  needsFileContent: true,
  useCodeMirror: false,
  Editor: RichTextEditor,
};

export default handler;
