import type { FileTypeHandler } from '../types';
import { PdfViewer } from './PdfViewer';
import { getFileTypeIcon } from '@/components/icons/FileIcon';

const handler: FileTypeHandler = {
  id: 'pdf',
  extensions: ['pdf'],
  icon: getFileTypeIcon('pdf'),
  supportedViewModes: ['preview'],
  needsFileContent: false,
  useCodeMirror: false,
  Preview: PdfViewer,
};

export default handler;
