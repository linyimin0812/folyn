import type { FileTypeHandler } from '../types';
import { OfficeFileViewer } from './OfficeFileViewer';
import { getFileTypeIcon } from '@/components/icons/FileIcon';

const handler: FileTypeHandler = {
  id: 'office',
  extensions: [
    'pdf',
    'docx', 'doc', 'dot', 'rtf', 'odt',
    'xlsx', 'xls', 'xlsm', 'xlsb', 'csv', 'ods', 'fods', 'numbers',
    'pptx', 'pptm', 'potx', 'potm', 'ppsx', 'ppsm', 'odp',
    'ofd',
  ],
  icon: getFileTypeIcon('office'),
  supportedViewModes: ['preview'],
  needsFileContent: false,
  useCodeMirror: false,
  Preview: OfficeFileViewer,
};

export default handler;
